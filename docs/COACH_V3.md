# 國考教練 2.0 Phase 3

## 基準與唯讀稽核

2026-10-17：GitHub `Teacherbada/vetexam` main 與 fetch 均為 `2a0c624c5a4bcf2706251785abe77f5a436894c7`。根目錄 main 位於較早版本且有大量未提交修改，因此完整保留，在 `.worktrees/coach-v3` / `feat/coach-v3` 開發。已讀 AGENTS.md 與此版本 Next.js 的 Route Handlers、use client 本機文件。

Phase 1、2 已有三類每日任務、理由快照、真實作答、個別分項順序、帳號進度恢復、完成回饋、Asia/Taipei 日期及每日唯一計畫。原有章節補強追蹤與一般練習的 FSRS 也已存在。本次不重建這些功能。

缺少的是持續更新的教練章節複習、精簡模式、週偏好與可比較週報。現有分類為科目／章節，沒有可靠細部考點標籤。

## 本次行為

- 教練的初始診斷、確認、補強驗證、章節追蹤及每日任務，僅在新答案實際保存後更新章節排程。自訂計畫、一般刷題不改其流程。伺服器使用原本答案快照判分，不從解析猜答案。
- 首次／再次答錯：下一個台北日期確認。到期後答對：依序 3、7、14、30 天；之後維持 30 天。到期答錯重設 1 天。一天最多延長一次，同天任一錯誤會重設；同天刷對多題不會一路升到 30 天。
- 同一科目／章節只有一筆排程；記錄錯誤次數、到期日、最後確認日期、最近錨點題目與延遲再錯次數。未分類章節不捏造分類，仍使用原有錯題訊號。
- 弱點保留章節至少 5 道、科目至少 10 道不同題目的門檻；加入同題前次答對、最近答錯的趨勢訊號。一次錯誤只建立複習線索，不認定弱科。
- 新每日計畫優先為已到期章節保留複習配額；既有到期 follow-up 仍連到原 session。先用同章節其他題目，題庫不足可用原題；當天不重複題目 ID。明示同章節不代表相同考點。
- 今天很忙：第一次啟用時，從原任務未完成的題目固定選最多 5 題，依記憶複習、弱點、綜合挑戰順序。切換或重送不重抽，完成結果與原作答共用，不新增第二份作答。正常目標、完整任務及已答紀錄不變；精簡完成不代表正常任務完成。
- 本週偏好：只能選既有官方科目或交給教練安排。優先配置部分綜合挑戰名額，不取代弱點或到期複習。今日題目已固定，因此從下一個新建日程生效；台北時間下週一自動失效，不改長期設定。
- 週報：每日教練任務本週實際作答數、答對數、完成正常或精簡訓練的天數、已安排複習題目完成比例、最近 30 天最多三個可靠弱點章節、可比較的正確率與改善章節、到期與下一次確認日期。
- 趨勢只比較本週至今和上週相同天數的教練作答，每個章節至少有 5 道兩期相同題目，取各期最後一次答案；題幹、選項、答案快照或章節不同則不比較。清楚提示原題記憶效應，不宣稱精熟或顯著進步。

## 使用方式

1. `/study-plan` 選擇國考教練。初始資料不足時仍先完成既有能力診斷。
2. 正常使用三張任務卡；新教練作答自動更新章節複習，下一個新建日程採用最新到期資料。
3. 點「今天很忙（約 5 題）」保存精簡模式，再點「開始或繼續精簡訓練」。`/study-plan/daily?task=busy` 使用相同刷題操作。可隨時切回正常練習。
4. 展開「本週重點與學習週報」，設定科目或查看實際週報；也可重新讀取另一裝置剛更新的資料。此區未展開前不查詢週報。

Phase 1 以前的 `coach_plan IS NULL` 舊任務完整保留，精簡模式需下一次新版日程；不重抽或搬移舊紀錄。

## 資料、效能與安全

新增 `study_plans.coach_state` nullable JSONB，版本 1，包含章節 reviews 與 week-scoped focus。沒有新資料表，章節集合由既有分類限制，不逐題增加無限待辦。精簡的 enabled／positions 保存在既有 `daily_tasks.coach_plan.busy`。

沿用 Better Auth 身份、既有 study_plans 列鎖、交易及作答重送機制。排程更新、首次作答及答案保存同一交易，失敗一起回滾。新 API `/api/study-plan/coach` 為 GET 週報／PUT 本週科目，payload 最多 1 KB、白名單欄位、同來源驗證與 private/no-store；無 userId／正確率／日期的客戶端覆寫入口。精簡使用既有 daily PATCH `{ "busy": true }`。

排程更新最多新增三次固定查詢，不掃歷史。日程每天只生成一次，已保存日程讀取仍不超過原測試的十次固定查詢。週報按需載入，以近期 30 天證據與本週／上週相同天數做有界查詢，不逐題查詢；新增 `diagnostic_items_answered_time_idx` partial index 支援近期作答篩選。沒有 AI API、生成工作或新外部服務。

資料來源要求公開 `kind='exam'`，排程使用題目當下仍有效的科目章節；私人及 AI 題不進入排程。未改題幹、答案、題型、解析、一般刷題、匯入、帳號或付費功能。共用 diagnostic-service 只加「新教練答案更新排程」，明確跳過 custom，原評分與首次統計邏輯保留。

## Migration 與回復

`migrations/20261017_coach_personalization.sql`：一個 nullable JSONB 欄位與一個 partial index；不回填、不改舊題目／學習資料。先 migration，後部署程式。此次尚未套用正式 migration、push 或部署。

重用既有 runner，新增 `--phase3` 選項；預設僅列 SQL，不連線：

```powershell
node scripts/migrate-coach-v2.mjs --phase3
```

將來獲准部署時，先取得必要備份並使用新的本機備份檔名：

```powershell
node scripts/migrate-coach-v2.mjs --phase3 --apply --backup .tmp/coach-v3-before-release.json --env-dir <環境檔目錄>
```

Runner 備份五張學習資料表完整紀錄，交易內比較原有資料是否改變；鎖等待 5 秒、statement 30 秒逾時即回滾。此備份不是全資料庫還原點，不可提交 Git。建立索引期間可能短暫等待／阻擋寫入；若正式資料量增加至無法在窗口完成，應另安排 concurrent index 部署，而非延長鎖定或強行執行。

程式回退時保留新增欄位、索引、原任務與全部作答，不需要 DROP 或資料回灌。舊版忽略新增資料；舊版運作期間不更新新版章節排程，但作答仍保存，不可用舊備份覆蓋新作答。

## 驗證

- 相關單元／整合回歸：61 項，54 通過、0 失敗；7 項外部 PostgreSQL opt-in 測試未啟用。Phase 3 新增 7 組，其中寫入整合均使用隔離 PGlite，沒有載入正式環境變數。
- Phase 1、2 既有 9 組整合測試通過：進度、順序、恢復、跨帳號、重送、舊日程、日期邊界、來源隔離、既有 follow-up 等。
- Phase 3：間隔階梯、同日限制、延遲再錯、退步樣本門檻、題庫不足、未到期延後、真實寫入與回滾、重送不重複、custom／AI 排除、固定精簡子集、切回正常、跨請求恢復、週偏好期限、API 驗證、實際週報、題目版本比對及 migration 冪等。
- 實際 Next UI 與真實服務／API 程式連到隔離 PostgreSQL 的 E2E：Phase 3 週報延遲載入、偏好保存、精簡／完整切換、兩個瀏覽器 context、重新整理、真實完成回饋；Phase 1、2 舊 E2E 同時回歸。
- 375／768／1280 寬度無水平溢出，手機截圖目視檢查；沿用既有樣式，未新增設計系統。
- TypeScript、修改範圍 ESLint、production build、diff whitespace 檢查。建置只出現既有 worktree 多 lockfile 提示，未修改無關設定。

## 實際檔案

新增：

- `lib/coach-personalization.ts`
- `lib/coach-personalization-service.ts`
- `lib/coach-report-service.ts`
- `app/api/study-plan/coach/route.ts`
- `app/study-plan/daily/CoachPersonalization.tsx`
- `migrations/20261017_coach_personalization.sql`
- `tests/coach-v3.test.mjs`
- `tests/coach-v3-browser.mjs`
- `docs/COACH_V3.md`

修改：

- `lib/coach-daily.ts`、`lib/coach-daily-service.ts`：到期優先、偏好、近期退步訊號。
- `lib/daily-task.ts`、`lib/daily-task-service.ts`：精簡快照及實際進度。
- `lib/diagnostic-service.ts`：同交易增量更新教練排程，跳過 custom。
- `app/api/study-plan/daily/route.ts`：既有 PATCH 支援嚴格 busy 布林輸入。
- `app/study-plan/daily/CoachToday.tsx`、`DailyTask.tsx`：模式切換及週報入口。
- `scripts/migrate-coach-v2.mjs`：重用 runner 支援 Phase 3。
- `tests/helpers/coach-v2-fixture.mjs`：加入新 migration／API fixture。
- `tests/helpers/official-explanation-fixture.mjs`、`tests/ai-practice-isolation.test.mjs`、`tests/daily-task.test.mjs`、`tests/diagnostic.test.mjs`、`tests/follow-up.test.mjs`、`tests/reinforcement.test.mjs`、`tests/weakness.test.mjs`：既有手動 TS loader 載入新增教練相依，未變更題庫或解析的產品功能。

## 限制與未驗證項目

沒有可靠考點標籤，因此使用章節，不宣稱相同觀念。舊作答仍供近期弱點分析，新間隔狀態自新版教練作答開始，不批次回填舊紀錄；一般刷題仍使用原有 FSRS，沒有改動其排程。週偏好當週有效且不重抽今天，週日設定會在下週失效。

正式 migration、正式部署、真實會員作答、遠端 PostgreSQL 多連線競爭與正式流量壓測未執行；沒有將隔離 E2E 說成正式驗證。索引建立與程式／schema 部署順序是主要上線風險。
