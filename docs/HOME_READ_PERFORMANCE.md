# 首頁資料讀取、Quick 20 與隨機挑戰

基準：GitHub `Teacherbada/vetexam`，fetch 後 `origin/main` = `3f2c53398dd78ed4749a7ba308721f1ee3a77ee4`。實作分支 `feat/home-read-performance`；獨立 worktree `.worktrees/home-read-performance`。原工作目錄與其他既有 worktree 的修改未覆蓋。

## Profiling 與結果

原始數據、waterfall、SQL、遮罩帳號後的 EXPLAIN 與 index definitions：[`HOME_READ_MEASUREMENTS.json`](HOME_READ_MEASUREMENTS.json)。量測日期：2026-09-26（台灣）。所有真實 DB 操作均為 READ ONLY；沒有執行 migration 或正式作答。

量測分成三組，不能混為同一種延遲：

1. 真實正式站無登入 GET：基準 availability 暖請求 727–746 ms，weekly 492–505 ms；learning 回 `{owner:null}`，不是登入帳號完整 payload 的時間。
2. 同一部電腦、同版 Node/Next、before/after 各自 production build、同一 DB 的本機 HTTP：下表為後三次暖請求中位數。這是 localhost TTFB/response time，包含 server 與 DB 往返，不包含正式站 CDN 延遲。
3. Playwright 固定延遲：session/public/admin 150 ms、完整 learning 900 ms、summary 100 ms。所有 API 攔截為 fixture；每狀態三次中位數，用於驗證依賴關係，不代表真實使用者 p50/p95。

| 本機 production HTTP | Before 暖請求 ms | After 暖請求 ms | 回應 |
| --- | ---: | ---: | --- |
| session | 13 | 12 | guest/null |
| `/api/learning` | 15 | 7 | guest/owner:null |
| `/api/learning/summary` | 無 | 14 | guest/owner:null |
| public availability | 261 | 14 | 962 bytes；after 命中 server cache |
| weekly | 142 | 13 | before 空狀態；after 有效 fallback，232 bytes |
| admin status | 10 | 9 | guest/401 |

公開 API 第一個請求：availability 1736 → 443 ms；weekly 171 → 280 ms。weekly 冷快取新增一次 fallback SELECT，因此冷請求沒有變快；後續命中快取才省去 DB 查詢。冷數字受連線暖機影響，不以單次值推論穩定改善。

| 瀏覽器 production build / 固定延遲 | Before ms | After ms |
| --- | ---: | ---: |
| guest Hero 可見 | 345 | 362 |
| signed-in Hero 可見 | 342 | 363 |
| returning Hero 可見 | 358 | 345 |
| guest 今日學習狀態 | 464 | 488 |
| signed-in 今日學習狀態 | 1369 | 631 |
| returning / 同帳號 summary cache | 1387 | 471 |

Hero 可見時間以 navigation 開始至 `h1` 可見為代理指標；沒有宣稱 Hero/guest 變快。登入狀態不再等待完整 learning；有快取時只需等 Better Auth 確認身份。每次首頁 session request 2 → 1；登入時 admin status 2 → 1；登入完整 waterfall request 數 7 → 6（少兩個重複請求，多一個 summary）。

### 真實帳號資料的唯讀 SQL

選取 practice history 最多的一個帳號做唯讀抽樣；沒有輸出其紀錄或身份。`readLearning` 原函式逐字比對（正規化換行）保持不變。

| service | SELECT 數 | payload | 時間 |
| --- | ---: | ---: | ---: |
| baseline readLearning | 4 | 43,846 bytes | 591 ms |
| after readLearning（未改） | 4 | 43,846 bytes | 437 ms |
| after readLearningSummary | 1 | 274 bytes | 125 ms |

以上排除 EXPLAIN、建立連線與 transaction wrapper 時間；不是 authenticated HTTP endpoint 的完整時間。full 前後差異是量測波動，沒有將其當作 full query 優化。summary 對同輪 full 減少約 99.4% payload。未用正式登入 credential，因此沒有宣稱已量到真實登入 HTTP p95。

### 實際瓶頸與 query review

- 首頁依 `getLearningStatus() === 'loading'` 等待 migration → outbox → 完整 learning；今日題數還要掃 history。
- `readLearning` 依序讀 first-answer progress、history、wrong/favorites review、legacy。對簡單 summary 而言，傳回題目全文與完整 history 不必要。
- availability 每次做兩個依序 Neon 查詢，weekly 每次重查；沒有 server cache。
- Home 的 `getSession()` 與 LearningSync/全域 session store 重複；Home/AdminLink 各查 admin status。
- EXPLAIN 已看到 `question_answer_stats_user_question_key`、`practice_attempts_history_idx`、`diagnostic_sessions_user_kind_idx`、`learning_imports_pkey` 等索引；diagnostic_items 有 `(session_id,position)` 與 `(session_id,source_question_id)`，review 有 `(user_id,question_id)`。小資料表上部分 sequential scans 合理，未取得缺 index 的證據，因此不加 migration。

### 首頁 DB statement 數量

下表是程式實際執行路徑中的資料 SELECT 數（由 service/query wrapper 與 cache 命中行為確認），**排除 Better Auth 內部 SQL、連線/schema check、BEGIN/SET/COMMIT、migration/outbox writes**；不是整個 DB 的全域 query counter。

| 路徑 | Before | After |
| --- | ---: | ---: |
| public availability + weekly，冷 cache | 3 | 3（weekly）或 4（fallback） |
| public availability + weekly，暖 cache | 3 | 0 |
| 首頁帳號初始同步（full 仍照常） | 4 | 5：full 4 + summary 1 |
| returning 首頁合計，公開暖 cache | 7 | 5 |
| 冷 cache + fallback + full sync 合計 | 7 | 9 |

沒有假稱所有情境 DB 都減少：本次保留完整同步，冷啟動多 summary/fallback 查詢；收益是首頁先顯示、公開暖快取減少查詢。Learning transaction wrapper 原有額外五個控制 statements 維持；summary 亦使用同一 wrapper。

## 實作與正確性

### Summary / 同步

- 新增 authenticated `GET /api/learning/summary`，owner 只取 server session；HTTP `private, no-store`。
- 各科 `{completed,correct,wrong}` 沿用 first-answer stats；今日題數沿用同一份 `HISTORY_SQL` 來源（practice + answered diagnostic），以台灣日界聚合。guest 仍用原本 dailyProgress。
- `learningSummary:v1:<userId>` 儲存最小摘要；owner/date/數字結構不符時不用。cache 在 server session 確認同一帳號後才可顯示，不把 guest 或 A 帳號資料給 B。
- summary 與原完整同步並行；migration、outbox、recordPractice、完整 readLearning 及 `/api/learning` 語義維持。full 成功後以同一資料更新摘要，版本與 generation 防止 late summary 覆蓋新 full／跨帳號。
- focus/online 原有 retryLearning 仍同步並更新 summary；網路失敗保留可用 cache，既有 LearningStatus 可重試。重新 mount 背景取新摘要，不永遠停在 cache。
- 沒有新增 Auth store。Home 改訂閱 Better Auth `useSession()`；admin helper 只共用同帳號的 in-flight promise，完成後移除，不持久快取權限。回應身份不符即不顯示。
- Motion CSS/動畫樣式保持；動態資料卡不掛會隱藏文字的 reveal，Motion 啟動不再依賴 full sync。其他既有 hover、reduced motion 與無 observer 行為保留。

### Server cache

讀取本機 Next 16.2.12 的 `unstable_cache`、Route Handlers 文件。Next 16 建議 `use cache`，但此專案未啟用 Cache Components；依本次要求避免全域 rendering 改變，使用仍支援的 `unstable_cache` 包住純公開讀取。

- availability：120 秒，tag `public-home-availability`；兩個 cold SELECT 並行。
- weekly/fallback：60 秒，tag `public-home-weekly`；一次 response 固定一題，cache window 可同題。
- 不把 cookies/headers/session 放進 cache；不快取私人題庫或個人摘要於 server shared cache。
- 題目新增/刪改、visibility/chapter/year 更新後，靠 TTL 的下次請求重新驗證。Next stale revalidation 期間可先回舊值；不是精準 120/60 秒硬過期 SLA。沒有跨 Admin mutation 的侵入式修改。單題 dialog 仍即時檢查公開可見性。
- 不新增依賴、不使用 TanStack Query、不新增 Redis 或外部服務、不改 Next 全域設定。

### Quick 20

Home 與 Subjects 共用抽出的 `buildQuizUrl()`；Subjects 的詳細設定邏輯保持。

```text
/questions?groups=[{"subject":"獸醫病理學","years":[],"count":"20"}]&order=random&mode=practice&state=all&started=1
```

實際由 URLSearchParams 編碼；不指定 chapter 即全章節。公開 scope 仍由原 Questions 頁送到 quiz API。一般 quiz selection/去重/題數不足行為未改；`查看全部題庫` 仍到 `/subjects`。

### Weekly / fallback

先跑原 weeklyMostMissed（台灣本週、MIN_ATTEMPTS=10、至少一筆答錯、原排序），成功回 `source:'weekly'`。不足則 `RANDOM_PUBLIC_CHALLENGE_SQL`：公開 set、有 exam_year、非空題幹、合法 A–E、答案對應 option 非空、至少兩個非空 options，`ORDER BY RANDOM() LIMIT 1`。無有效題回 `{question:null,source:null}`。

weekly 的人數/答錯率/排名/本週一至今不變。fallback 顯示「今日隨機挑戰／本週統計累積中，先來挑戰一題」，不顯示統計或排名。只為移除排名欄後的 fallback 設定單欄，保留卡片位置與既有外觀。

沿用 WeeklyQuestionDialog，新增可選 title。既有 questionId 單題回應以前漏掉 E 選項，本次只在此單題回應補上非空 E，以支援合法 fallback；一般多題 quiz options/Questions UI/答案判定不改。

## 驗證與重跑

- `node --test tests/home-read.test.mjs tests/account-learning.test.mjs tests/question-stats.test.mjs tests/exam-chapters.test.mjs tests/admin-question-chapters.test.mjs`：18 pass，4 個舊的 opt-in DB mutation tests 未啟用。
- `node tests/home-read-db.mjs`：真實 PostgreSQL READ ONLY + SELECT CTE fixtures，覆蓋 private/blank/非法答案/空選項/少於兩選項/E/無有效題、9/10/12 次 weekly 門檻、台灣午夜/隔日邊界、跨帳號隔離、summary 與 full 數字一致。沒有 CREATE/INSERT/UPDATE/DELETE。
- `node tests/home-read-browser.mjs`：guest/signed-in/returning/migration/empty & pending outbox/offline；session/admin 去重；weekly/fallback/empty；E dialog；Quick20/不足3題；Subjects dialog；320/375/768/1280px。
- `node tests/account-learning-browser.mjs`：完整帳號、紀錄、收藏、錯題、遷移/重試與五種寬度回歸通過。
- `node tests/home-experience-browser.mjs`：六種使用者狀態 × 八種寬度、導覽/admin、倒數、搜尋、weekly dialog、自訂首頁、reduced motion、無 observer、同步 error 通過。
- 修改的 TS/TSX lint：0 errors；CSS 不在 ESLint parser 範圍。`git diff --check` 通過。
- `next build --webpack`：production build + TypeScript + 45 static pages 通過。build 使用不可連線的 fixture DB，Better Auth schema check 因此有連線警告；不是正式 DB build 驗證。runtime 另以 read-only 真 DB 驗證公開 API。
- `node tests/account-learning-production.mjs` 對現有正式站：API/guest guards、五頁/五種寬度檢查完成，但最後捕捉到一筆 React hydration error #418，因此整體 smoke **未全通過**。另外以只允許 GET 的瀏覽器檢查定位於 `/`；五頁均回 200。正式站尚未包含本次修改；沒有將這個既有線上問題混入本次修正。
- 本機 production server / 真實 DB 唯讀 Quick20 API：逐一驗證所有有公開題目的科目，回應數 `min(20,total)`、ID 不重複、科目一致，通過。
- 截圖：`.tmp/home-read/screenshots/random_fallback-card.png` 等，已目視確認；`.tmp/home-experience/after/` 保留全套原首頁回歸截圖。

環境重跑：`PLAYWRIGHT_MODULE` 指向已有 Playwright，`TEST_BASE_URL` 指向本機 production server；不需新增 dependency。SQL/profile 腳本以 `PROFILE_ENV_FILE` 指定既有 env 檔（預設本環境 `../../.env.local`），只讀取 DATABASE_URL、不複製或顯示值。正式 DB 測試連線採 READ ONLY；browser tests 的 API 全部攔截。

`home-read-profile.mjs before|after`：`BROWSER_ONLY=1` 只測 browser；不設定時記錄正式站無登入 GET + 唯讀 SQL（`PROFILE_BASE_URL` 可覆寫）。`home-read-public-profile.mjs before|after` 只接受明確 localhost URL，比較 production HTTP。不要把 `after-server` 中正式站控制組的 GET 解讀成已部署的新版本。

## 發布範圍

沒有 push、部署或正式 DB 寫入。新版已做本機 production smoke；現有正式站另做唯讀 smoke。新版部署後仍需線上 smoke，不能以舊站檢查取代。

沒有修改：Homepage visual redesign/動畫 CSS、Questions UI/答案判定、FSRS、due review、Weakness/Coach/Study Plan/Daily task/Custom Plan、PDF/Notes/AI classification、Admin 功能與權限規則、subscription/billing/PRO、Better Auth 設定與語義、official chapter mapping、題庫內容。沒有變更 env 檔、Windows 持久環境變數、VS Code/Codex auth 設定、Git config，也沒有碰 kids-video-factory。測試伺服器只在子程序中設定臨時測試變數。
