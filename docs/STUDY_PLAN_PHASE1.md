# 學習計畫 Phase 1

基底：GitHub main `3d0f9ee5773417427ab2ef568e595264478aa997`，開發前與 HEAD 相同。

## 功能

首頁新增學習計畫入口 `/study-plan`，提供國考教練／自訂進度兩張說明卡片。
登入使用者可儲存、切換模式；重新載入從資料庫讀取，不依賴 localStorage。
未登入時可閱讀介紹，需登入才能儲存。讀取失敗時禁止覆寫未知狀態並提供重試，儲存失敗不假裝成功。
頁面明示目前只開放模式選擇；診斷、弱點分析演算法、補強任務、間隔追蹤、自訂題數及排程留待後續階段。

## 儲存與 API

- `study_plans`：`user_id` 為主鍵並參照 Better Auth 的 `user.id`；`mode` 僅允許 `coach`／`custom`，另存建立及更新時間。
- `GET /api/study-plan`：取得 session 帳號的模式；尚未建立回傳 `{ mode: null }`。
- `PUT /api/study-plan`：僅接受 `{ mode: "coach" | "custom" }`，透過 session 決定帳號，原子 upsert。
- 未登入回 401，跨來源寫入回 403，無效格式回 400／415，超過 1 KB 回 413，暫時失敗回 503。
- 所有回應使用 `Cache-Control: private, no-store`。不接受前端傳入帳號 ID。
- 切換僅更新 mode 及 updated_at；不刪除或修改作答、錯題、收藏、分析與既有進度。

## Migration

已核對目前 DATABASE_URL 所連接 Neon 的相關欄位，並於本次開發套用 `migrations/20260913_study_plans.sql`。
套用前先於交易中連續執行兩次並 rollback 驗證，之後以 `--apply` 正式 commit。
其他環境部署前執行：

```sh
node scripts/migrate-study-plans.mjs
node scripts/migrate-study-plans.mjs --apply
```

第一個指令為 rollback 試跑，第二個才保留變更。未自動建立使用者模式、不回填既有資料。

現有 `question_answer_stats` 是每位使用者每題的首次作答統計，不是完整重複作答歷程；後續診斷需另行評估，Phase 1 不改寫它。
章節沿用 `questions.chapter` 與 `data/exam-chapters.ts`，本次不新增 Concept 或分類資料。

## 驗證

- `npm run build` 通過，包含 TypeScript 與 38 個靜態頁。
- 新增 TS／TSX 的 ESLint 通過。
- `node --test tests/study-plan.test.mjs`：6/6 通過。使用 API mock 驗證 session 隔離、模式切換、資料驗證、未登入、跨來源及資料庫錯誤。
- `tests/study-plan-browser.mjs`：Edge headless 使用測試 API fixture 驗證儲存、切換、重新載入、儲存失敗、讀取重試及未登入；320／375／768／1280px 無水平溢出，無 page errors。
- 畫面截圖：`.tmp/study-plan-artifacts/mode-375.png`。
- 線上 DB migration 試跑及套用成功；未使用真實會員帳號做登入端到端測試。

## 變更邊界

既有程式只在 `app/page.tsx` 新增一個入口。新頁沿用 home.css、StudyIcon 與 study-button；沒有新增依賴。
本次保留既有未提交修改，未改動登入註冊、刷題、PDF、訂閱付款或管理員功能，也未部署網站或推送 Git。
