# Phase 4：補強任務與複習後驗證

基於 Phase 3 `657367bfd9a0779a99c91237694049b371a59b2d`；發布前重新 fetch 確認 GitHub main。範圍為國考教練的補強任務、複習、立即驗證及必要儲存/API。沿用現有卡片、按鈕、題目選項、進度條與手機樣式。

## 使用流程

`/study-plan` 國考教練入口、`/study-plan/confirmation` 分析頁顯示目前任務與建議下一步。「開始補強」由伺服器選出最高優先且樣本足夠的正式科目＋章節，建立任務後前往 `/study-plan/reinforcement`。

1. `reviewing`：等待自行複習，使用自己的課本、講義或可信資料。
2. 按「我已完成複習」只變成 `reviewed`，記錄複習時間，不修改分數或判定掌握。
3. 按「開始確認」建立 `verification` session，狀態 `verifying`，逐題提交並保存。
4. 達門檻為 `short_term`（短期掌握），才推薦下一個章節；未達為 `needs_work`（仍需加強）。
5. 未通過必須先按「再次複習」，增加 review_count，再回報完成複習，才能建立新一輪確認。
6. 「稍後再複習」為 `deferred`，保留原狀態供恢復；不完成、不消除弱點，也不另開第二個任務。

相關內容區塊僅顯示「相關 VetExam 筆記功能準備中。」沒有假筆記、教材或筆記 CRUD。沒有間隔排程、AI、concept 分析或「掌握穩定」。

## 檔案

新增：

- `lib/reinforcement.ts`：集中規則、選題、優先序、狀態與 payload 型別。
- `lib/reinforcement-service.ts`：任務與驗證的交易、權限、儲存及讀取。
- `app/api/study-plan/reinforcement/route.ts`：GET 讀取、POST 建立、PATCH 狀態動作、PUT 作答。
- `app/study-plan/reinforcement/page.tsx`、`Reinforcement.tsx`：補強頁與可重用的國考教練入口卡片。
- `migrations/20260916_reinforcement_tasks.sql`、`scripts/migrate-reinforcement.mjs`。
- `tests/reinforcement.test.mjs`、`tests/reinforcement-browser.mjs`、`tests/diagnostic-database.mjs`。
- 本文件。

修改：

- `app/study-plan/ModeSelector.tsx`：顯示目前補強任務及正確下一步。
- `app/study-plan/confirmation/WeaknessOverview.tsx`：加入可操作補強卡片；清楚分開歷史分析與目前補強狀態。
- `lib/diagnostic.ts`、`lib/diagnostic-service.ts`：既有 session 模型增加 verification 類型、指定 session 讀取、驗證來源分類和附加 metadata；沿用 snapshot、逐題儲存與伺服器評分。
- `lib/confirmation-service.ts`：驗證結果獨立於原本分析；保留驗證前已存在的一般首答證據，排除驗證產生的新增首答，避免改寫歷史樣本。
- `tests/diagnostic.test.mjs`、`tests/weakness.test.mjs`：暫存表測試改用獨立直連，避免 Neon 交易連線池保留 session 暫存表。正式 Phase 1～3 流程沒有重設或改版。

## DB 與持久化

新增一張 `reinforcement_tasks`：id、user_id、subject、chapter、source_session_id、source_analysis JSONB、status、paused_status、review_count、created_at、started_at、review_completed_at、verification_completed_at。

`source_analysis` 是建立當時的有效樣本與弱點評估快照，`source_session_id` 關聯同帳號初始診斷。複習完成時間與驗證完成時間分開記錄；每輪驗證也保存當輪複習時間與輪次。

既有 `diagnostic_sessions` 只新增 `reinforcement_task_id` 與 `verification_metadata`；kind 允許 verification。每次確認保留自己的 session，metadata 保存 review_attempt、reviewed_at、repeated_question_ids、pass_threshold、min_questions。答案沿用 `diagnostic_items` 的題目與答案快照、selected_answer、is_correct、answered_at，沒有另建完整作答表。既有首答統計仍維持 first-answer 語意。

每個 user 在 status 非 short_term 的任務上有 partial unique index；所有建立、狀態修改、作答與模式切換沿用 study_plans 列鎖序列化。同一輪驗證有 `(reinforcement_task_id, review_attempt)` unique index。重複開始返回原 active task/session，重送同答案不重複計分；改答案或過期輪次會拒絕。跨帳號 task/session 由伺服器身份及複合外鍵隔離，不接受客戶端 user_id 或分數。

重新登入由 DB 讀取進度，不依賴 localStorage。狀態／最後一題完成在同一交易提交。切回 custom 不刪紀錄，補強寫入須為 coach。

## 選題與判定

設定集中於 `lib/reinforcement.ts`：

- `REINFORCEMENT_VERIFICATION_QUESTION_COUNT = 5`
- `REINFORCEMENT_PASS_THRESHOLD = 0.8`
- `REINFORCEMENT_MIN_VERIFICATION_QUESTIONS = 3`
- `REINFORCEMENT_RECENT_DAYS = 7`（只用於避開立即重題，並非複習排程）

只取公開、有有效答案、相同正式 subject＋chapter 的題目；再次讀取來源建立快照時重驗分類與公開性。未分類或其他章節不會混入。

排除集合包括最近 7 天診斷／確認／驗證出現或作答的題目、最近首答與本任務所有前次驗證題目。足夠題目時完全避開集合；集合外未作答優先，其次距上次作答最久。最後才從排除集合補足，仍以較久作答優先。同一輪不重複同一 question_id。曾作答或出現過的題目 ID 與數量會記錄，画面標示重複數。

不足 5 題用實際題數；3～5 題需至少 80% 才給短期掌握（4/5、4/4、3/3 通過）。僅 1～2 題仍可完成，但樣本不足不給短期掌握，保留仍需加強並說明原因。零題不建立空 session，保留待確認進度並顯示稍後再試。

伺服器使用當次 session 保存的 threshold/minimum 評分，即使未來調整設定也不改寫舊次判定。每次分數、題目、複習輪次及完成時間保留。

## 歷史與目前狀態

Phase 3 的初始診斷與弱點確認分析保留。補強驗證不覆寫它們，也不把舊診斷正確率直接提高。畫面分開顯示「補強前有效樣本／正確率」、「補強確認正確率」與「目前狀態」。短期掌握章節不再列為下一個主要任務；下一步沿用 Phase 3 排序並從所有合格章節繼續選取，因此原本第三順位也能接續。

## 驗證與發布

規則/API/DB 測試：

```powershell
$env:REINFORCEMENT_DB_TEST='1'
$env:WEAKNESS_DB_TEST='1'
$env:DIAGNOSTIC_DB_TEST='1'
node --test tests/reinforcement.test.mjs tests/weakness.test.mjs tests/diagnostic.test.mjs
node --test tests/study-plan.test.mjs tests/question-stats.test.mjs tests/exam-chapters.test.mjs
```

前三套共 20 項，含 PostgreSQL 暫存表整合；另外 12 項模式、首答與一般 quiz／章節驗證通過（另兩項非本次範圍的 DB 測試未啟用）。涵蓋最高優先章節、唯一 active、複習 gate、精確章節與選題順序、重題 fallback、0／2／3／5 題、通過與失敗、重送、跨帳號、跨交易續作、再次複習、保留首答與舊分析、Phase 1～3 回歸。

瀏覽器測試：設定 `PLAYWRIGHT_MODULE` 為既有 Playwright 模組路徑、`TEST_BASE_URL` 為已啟動站台，再執行 `node tests/reinforcement-browser.mjs`。使用攔截 API 測試資料覆蓋建立、複習、驗證、續作、通過、失敗、再次複習、稍後與教練入口。320／375／768／1280px 無水平溢出及頁面 JS 錯誤。截圖在 `.tmp/reinforcement-artifacts`，不納入發布。

`npm run build` 與修改範圍 ESLint 通過；發布另以 scoped commit 的乾淨 archive 建置，排除工作區原有支付與其他修改。

Migration 演練明確使用 public schema、transaction、lock timeout，連續執行兩次後驗證既有 session/item 筆數不变並回滾。正式套用用 `node scripts/migrate-reinforcement.mjs --apply`。測試使用 Neon 非 pooler 直連，暫存表隨後端連線關閉消失；已清除早先連線池保留的本次診斷測試暫存表。

正式題庫現況：六科各 80 題公開題目，僅 2 題有正式章節分類。現在可能因章節有效樣本不足而沒有補強推薦，會顯示真實資料不足，不假造弱點、不變更題目或分類。完整登入後補強流程以暫存 DB 與瀏覽器 fixture 驗證，正式站驗證公開頁面及未登入權限，不建立虛構正式使用者學習紀錄。

未修改首頁 `app/page.tsx`、PDF、一般刷題 UI、Auth、Subscription、PRO、Favorites、Wrong、Admin、題目、解析與正式章節分類。工作區原有其他未提交變更不納入本次 commit。
