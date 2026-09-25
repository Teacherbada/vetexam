# 到期複習中心 Phase 2

基準：2026-09-25 `git fetch origin` 後的 GitHub `Teacherbada/vetexam` main，
`c4f367bed28e2d6cc9879ba8e30abe3e25600a34`。獨立 worktree／分支 `feat/fsrs-memory-phase2`；原 main 工作區的未提交修改未納入。

Phase 1 建立逐題 memory 與 daily normal due priority；Phase 2 讓登入者主動查看及完成到期複習。
無 AI、0 token、不 backfill、不根據舊 accuracy 建立 memory；不取代 weakness，也不取代 Coach 3／7 天 follow-up。
`enable_fuzz:false`、Again／Good、FSRS 參數、Coach、每日配額及 custom plan 均不變。

## 判定與排序

- 僅 session user 的 memory，INNER JOIN 現存 question／public question_set。
- 正確答案經 trim／uppercase 後必須為 A–E，且對應選項非空白；與既有 practice validator 一致。
- `dueNow`：`due <= now`，含逾期及恰好現在到期。
- `dueToday`：`due < 台北明日 00:00`，含逾期、現在及今天稍後到期；邊界不含明日零時。
- `upcoming7Days`：`now < due <= now + 7 × 24 小時`，不含已到期；與今天稍後到期可重疊。
- queue 僅 `dueNow`，依 due、官方 scheduler 即時計算的 retrievability、last_review（null 最前）、question_id 遞增，不打亂、不補未到期題。

API 在 REPEATABLE READ／READ ONLY transaction 內使用相同 now 和資料快照。
固定最多三次集合查詢：有效候選 aggregate counts、最早 due card metadata、所選 ID 的一次 question／image batch。
空 queue 不查題幹。使用 `(user_id,due)`，沒有逐題 SQL。metadata 查詢以 `FETCH FIRST … WITH TIES` 保留截止 due 的所有同時到期卡，交由原 scheduler 排序後才截取 limit；大量同時到期時 metadata 可能超過 50，但題幹、圖片與 API queue 永遠最多 50。沒有重寫或硬編碼另一套 retrievability 公式。

## API

`GET /api/review/due?limit=20`，限登入，身份只取 session。省略 limit 為 20；僅接受 5／10／20／30／50，其餘 400。guest 401、暫時失敗 503；皆 `Cache-Control: private, no-store`。

```json
{
  "owner": "session-user-id",
  "asOf": "2026-09-25T12:00:00.000Z",
  "dueNow": 13,
  "dueToday": 15,
  "upcoming7Days": 27,
  "queue": [{
    "id": 123, "questionSetId": 1, "questionNumber": 1,
    "subject": "獸醫病理學", "question": "題幹",
    "options": ["甲", "乙", "丙", "丁", "戊"],
    "answer": "A", "explanation": "既有解析", "imageDataUrl": null,
    "examYear": 115, "questionSetName": "公開題庫"
  }]
}
```

retrievability、stability、difficulty 不傳至 client、不保存 snapshot history。

## 畫面與作答

`/study-plan` 既有內容下方僅增加「到期複習」按鈕，連至 `/review`。
沿用 quiz CSS；從原一般練習抽出 `QuestionCard`，共用題幹、A–E、圖片、選項鎖定、答案／解析與收藏。
空白選項不顯示，保留原 letter index。未改全站樣式、首頁或導覽。

開始／繼續都重新讀取 server queue，不使用本機刪除題目冒充最新排程。
作答先保存既有 account-scoped learning outbox，再等待同步：

`enqueueLearning(action=answers, mode=practice, event_id)` → `/api/learning` → `recordPractice` → `recordMemory` → 原 FSRS。

`enqueueLearning` 僅增加保存成功的 boolean 回傳，原呼叫者行為不變。
失敗保留相同 event_id，重試不建立新事件；等待 server 同步成功並重新讀取 queue 後才顯示已完成。
先保留本題答案／解析供閱讀，再由按鈕重新讀取下一個到期題。新排程未到期時即不在 queue；若時間已到則允許再次出現。
頁面切換帳號後隱藏舊 owner 資料；favorites 與 wrong state 沿用既有 learning snapshot。
不新增 mode、答案歷史、accuracy、錯題或排程歷史資料表。

## 並發與重送

未另建作答 API，沿用 Phase 1 account advisory transaction lock、event 唯一鍵、batch SELECT FOR UPDATE 與同交易 upsert／rollback。
同一事件重送不增加 reps；兩裝置各自真實作答使用不同 event_id，各計一次。延遲事件仍以原 `max(answered_at,last_review)` 防止 card 時鐘回退，不重播歷史。
兩裝置可看見同一題；不把這種讀取情況當成新 attempt mode 或額外排程來源。

## 驗證

- 新增 `tests/due-review.test.mjs`：台北／7 天邊界、合法 limit、guest／session 隔離、private no-store、503、空 memory、未來／現在 due、私人／刪除／無效題、不同 user、超過 limit 的 due 平手與 retrievability／last_review／ID 排序、圖片／E 選項、固定 batch 次數、答對／答錯的既有排程及事件重送。
- Phase 1 FSRS、account learning、Study Plan Phase 1–8、learning priorities／trends：59 項不同測試全部通過，DB fixtures 全啟用、無 skip；使用 session TEMP tables，不新增正式帳號或作答。
- 首輪 58／59；既有 reinforcement DB fixture 再次遇到本機比 DB 慢約 4.35 秒。以測試專用 preload 唯讀取得 DB 時間、校準測試程序 Date.now，原檔及產品公式不變，該 suite 6／6 通過。
- Phase 1 真實兩條 PostgreSQL 連線測試確認第二裝置必須先等待 advisory lock 才存取 attempt／card；既有更新測試覆蓋延遲事件、reps、rollback 與 event 去重。
- 新增 `tests/due-review-browser.mjs`：320／375／768／1280 無 overflow，圖片載入、A–E、答對／答錯、收藏／錯題、失敗保存／同 event 重試、server queue 更新、完成、reload、guest；四種寬度均通過，320px 截圖已目視檢查。
- 原 `account-learning-browser.mjs`：五種寬度的一般練習、收藏、錯題與帳號流程通過；原 `daily-task-browser.mjs`：30 題作答、續答、完成、錯題與四種寬度通過。
- 修改範圍 ESLint：0 errors；2 個既有 img 使用方式警告（原 quiz 及抽出的共用卡片）。TypeScript noEmit 通過；Next 16.2.12 production build 通過，45 靜態頁。

重跑入口：

```sh
node --test tests/due-review.test.mjs tests/question-memory.test.mjs tests/account-learning.test.mjs
# 載入 DATABASE_URL / TEST_DATABASE_URL，MEMORY_DB_TEST=1、LEARNING_DB_TEST=1 啟用 DB fixtures。
# Phase 1 文件列出其他 regression suites 與 DB flags。
node tests/due-review-browser.mjs
# PLAYWRIGHT_MODULE 可指向既有 Playwright；TEST_BASE_URL 指向本機 production server。
npm run build
```

## Migration 與部署狀態（2026-09-25）

**Phase 2 不需任何 migration**，沒有新增表、欄位、索引或 dependency。
唯讀查核目前本機 DATABASE_URL：`question_memory_state`、PK 與 `question_memory_due_idx(user_id,due)` 均存在；memory=0、practice_attempts=0。
此查核只證實該連線的 DB，未讀取 Vercel Production secrets 作跨環境比對。

GitHub 已證實 Phase 1 `c4f367be` 的 Production deployment **6659246827** 成功（2026-09-25 11:02:08 UTC），
environment URL `https://vetexam-m0ogrzhmh-is-me.vercel.app`；Vercel commit status 也為 success。
正式站 `https://vetexam-tw.vercel.app/study-plan` 200，guest `/api/learning` 200／`owner:null`／private no-store。

本次 Phase 2 尚未 push／部署。正式站 `/review` 404 符合尚未發布狀態，不能宣稱 Phase 2 production smoke 已通過；本機 production build 與 browser smoke 已通過。
