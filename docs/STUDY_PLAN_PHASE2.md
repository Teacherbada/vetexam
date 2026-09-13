# 國考教練初始診斷 Phase 2

開發基底：GitHub main / Phase 1 正式版 `2a8279d7931ea1c685047dec176596ae4ba42534`。

## 範圍與檔案

修改既有檔案只有：

- `app/page.tsx`：移除 hero 區學習計畫按鈕，於 navigation 陣列的管理員國考解析項目後新增一般功能「設定學習計畫」。
- `app/study-plan/ModeSelector.tsx`：教練模式顯示初始診斷介紹／續作／結果入口，更新診斷開放狀態。

新增：

- `app/study-plan/diagnostic/page.tsx`、`Diagnostic.tsx`、`diagnostic.module.css`：介紹、逐題作答、已儲存進度、續作與初步結果。
- `app/api/study-plan/diagnostic/route.ts`：GET 讀取，POST 建立或取得同一份診斷，PUT 儲存答案。
- `lib/diagnostic.ts`：集中題數、最近作答期間、最低樣本及初步提醒門檻；抽題、驗證與科目摘要。
- `lib/diagnostic-service.ts`：資料庫交易內建立、續作、判分、統計整合。
- `migrations/20260914_initial_diagnostic.sql`、`scripts/migrate-initial-diagnostic.mjs`：兩張 additive 資料表與可重跑 migration。
- `tests/diagnostic.test.mjs`、`tests/diagnostic-browser.mjs`：規則、API、SQL 與畫面驗證。

沒有修改 home.css、globals.css、其他首頁區塊、登入、註冊、訂閱／PRO、管理員權限、PDF、一般刷題、收藏、錯題、正式分類、題目或解析內容。既有未提交修改保留，不納入本次提交。

## 首頁入口

管理員：國考解析 → 設定學習計畫。一般使用者及訪客：只顯示設定學習計畫，無 placeholder。
兩者沿用同一個 nav renderer 與既有 flex／手機選單；高度、字級、間距、邊框、圓角與 hover／focus 由同一組既有樣式處理。
沒有新增定位、位移或首頁 CSS。訪客仍可看模式介紹，建立診斷需既有登入。

## Production 結構與實際題量

修改前唯讀確認 Neon：既有 `study_plans`、`question_answer_stats`、`questions.subject/chapter` 可沿用；`session` 是 Better Auth 登入 session，沒有測驗 session。
一般刷題 `progress`／`dailyProgress` 是瀏覽器 localStorage，不能可靠地提供跨裝置續作。

當時公開題庫四科各 80 題：病理、實驗診斷、普通疾病、公共衛生；藥理及傳染病無公開題目。只有兩題已有章節。
診斷會先排除無法判分或空題幹題目，因此實際題數依建立當下的可用資料決定，最多每科 10 題，不保證一定有 60 題。
UI 明示各缺題科目、實際題數；沒有題目的科目不當作零分。不能為了湊六科另造名稱或分類。

## 最小資料模型

- `diagnostic_sessions`：UUID、user_id（唯一，FK 到 study_plans）、created_at、completed_at。每個學習計畫只有一份初始診斷。
- `diagnostic_items`：session_id、position、來源 question_id／source_question_id、subject、chapter、題幹／選項／附圖／答案快照、selected_answer、is_correct、answered_at。

這是診斷專屬的題目清單與作答，不重建一般 answer history。使用者從 session 關聯取得；session + position 主鍵與 session + source_question_id 唯一約束避免重題。
題目快照保留診斷當時版本，來源被修改或刪除也不會令進度消失或重新判分。答案快照只供伺服器判分，不回傳給作答中的瀏覽器。
來源刪除時 question_id 設 NULL，source_question_id 保留原始識別碼。
診斷完成也不刪除明細。切換模式只暫停教練寫入，不刪除 session。

## 抽題與避免重複

1. 沿用 `EXAM_SUBJECTS` 與正式章節 constants，限定 public 題庫及可用 A–E 答案。
2. 每科最多 10 題，依未作答 → 七天前作答 → 最近七天作答排序。
3. 同優先層選取目前較少涵蓋的章節，再依較舊作答時間、隨機順序打散；未分類題目共用未分類組。
4. 六科交錯排列，建立後固定題目與順序，中斷續作不重新抽題。
5. 科目缺題就使用該科實際可用題目，不挪其他科大量題目假裝補齊。全部無題時回傳可重試空狀態且不建立空 session。

已知限制：既有統計只保存首次作答，`updated_at` 可能由答案校正更新，不能當作最近作答時間。本次依首次作答 created_at 與診斷 answered_at 判斷已知歷史；既有一般刷題的後續重做／未上傳紀錄無法完整辨識。依範圍限制，沒有改動一般刷題來蒐集新的完整歷程。

## 續作與一致性

- session 與抽題清單一次交易儲存；每題作答也以交易完成。
- 使用 session 帳號查找診斷，不接受 user_id 或前端 correct。
- 鎖定既有 study_plans row，讓建立、作答與模式切換序列化；讀取用共享鎖取得一致的進度。
- 重送相同題目／答案回傳既有進度；更換已儲存答案回 409；不能跳過目前題目。
- 送出成功後才增加畫面進度；網路失敗可重試或重新讀取，下一次從第一個未答題繼續。
- 沿用 `recordFirstAnswers` 與既有統計鎖，首次答案統計不因診斷重複覆寫。診斷本身以快照判分，原始題庫日後校正不回溯改動診斷。
- 不寫入或重置 localStorage，因此不改變既有首頁本裝置進度／錯題功能的行為。

## 初步結果

完成實際抽取題目後顯示六科正確題數／實際題數。每科至少 5 題才可能列入疑似弱科；低於 60% 時最多提醒兩科「目前可能需要進一步確認」。缺題／樣本不足明示資料不足。
不判斷章節、不建立 mastery、補強任務、間隔複習、筆記或 AI。
「繼續弱點確認」為停用按鈕並明示下一階段開放，不導向未實作流程。

## 驗證

- `npm run build` 成功，含 TypeScript。
- 新增及修改診斷 TS／TSX ESLint 通過。
- `DIAGNOSTIC_DB_TEST=1 node --test tests/diagnostic.test.mjs`：規則及 PostgreSQL 測試通過。使用連線專屬 TEMP 表，涵蓋 60 題建立、跨交易續作、重送、帳號隔離、模式切換、原題變更／刪除、E 選項、完成結果、私有／無答案排除及缺題／零題 fallback。TEMP 資料於連線結束移除，不建立正式帳號或題目。
- 既有 Phase 1、題目統計、正式章節測試：12 通過、2 預設跳過（這兩項既有 PostgreSQL 測試未啟用）。
- Edge headless fixture 測試通過：首頁 guest/user/admin、320／375／768／1200／1280／1440px、入口順序與對齊；診斷建立、作答失敗重試、離開續作、重新載入、完成與缺樣本結果、未登入保護；無 page errors。
- Migration 在真實 PostgreSQL 交易內連續執行兩次並 rollback 驗證通過。
- 畫面截圖位於 `.tmp/diagnostic-artifacts/`。
- 既有 `exam-chapters-browser.mjs` 也通過六科設定、搜尋與刷題 URL、零題及四種螢幕寬度回歸檢查。

## 部署

其他環境需先套用 additive migration，再部署程式：

```sh
node scripts/migrate-initial-diagnostic.mjs
node scripts/migrate-initial-diagnostic.mjs --apply
```

未帶 `--apply` 只試跑並 rollback。此 migration 不變更任何既有 table 的欄位。
