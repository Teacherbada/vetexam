# VetExam 帳號學習紀錄與分析開發報告

基準：已向 GitHub 確認 main 為 2a82dd35eaa4c8ab3fd8dda1d21d9ae659b66a2e。
開發分支：feat/account-learning。原工作目錄及未提交修改完整保留；本次位於 .worktrees/account-learning。
本階段未新增 AI 功能，未修改既有 AI 分類、PDF 匯入、訂閱或管理員功能。

## 分階段提交

| Phase | 提交 | 內容 | 主要修改檔案 |
| --- | --- | --- | --- |
| 1 | f9df215 | 帳號作答歷程、收藏、錯題與安全遷移 | app/api/learning/route.ts、lib/learning-service.ts、lib/learning-client.ts、components/LearningSync.tsx、components/LearningStatus.tsx、data/{progress,favorites,wrongAnswers,tasksProgress}.ts、作答／收藏／錯題頁及 app/layout.tsx |
| 2 | 55abbce | 分析讀帳號首次作答，舊摘要另外保留 | app/analysis/page.tsx |
| 3 | f76373d | 7 天／前 7 天／30 天／累積趨勢 | lib/learning-trends.ts、app/analysis/Trends.tsx |
| 4 | d95a937 | 官方固定章節歷屆頻率 | lib/chapter-frequency.ts、app/analysis/Frequency.tsx、app/api/stats/chapter-frequency/route.ts |
| 5 | d586747 | 個人弱點 × 出題頻率透明推薦 | lib/learning-priorities.ts、app/analysis/Frequency.tsx |
| 6 | c027e3e | 全站首次答對率、難度及樣本門檻 | lib/question-difficulty.ts、components/questions/{OptionDistribution,QuestionDifficulty}.tsx、app/api/stats/difficulty/route.ts |
| 7 | eeb9c61 | 全部／未做過／曾答錯／收藏篩選 | app/subjects/page.tsx、app/api/quiz/route.ts、lib/question-state.ts、lib/learning-service.ts |

整合修正 `4d5d9c8`：遷移重試、離線佇列、移除錯題後再答錯的處理，以及首頁既有進度卡片的帳號資料接線；首頁版面未重寫。`983a31d` 修正章節數較少時的高頻門檻。

## Migration 與資料一致性

唯一新增 migration：migrations/20260925_account_learning.sql。

- practice_attempts 保存一般練習／模擬考多次歷程。帳號加 event UUID 去重；重送沿用 UUID，重做使用新 UUID。伺服器依題庫判分。
- 教練、診斷、確認、補強後確認、追蹤、自訂計畫仍讀既有 diagnostic_items／diagnostic_sessions，不複製成第二份作答資料。
- question_answer_stats 沿用既有 writer 與 user_id／question_id 唯一約束。遷移不寫入全站統計。
- question_review_state 保存收藏、錯題移除及筆記；尚未設定與明確取消分開處理，遷移只補足未知欄位。
- learning_imports 保存舊 progress、dailyProgress、收藏與錯題原始快照，帳號加裝置 UUID 去重。
- localStorage 原始資料不刪除。成功才標記完成；失敗可繼續刷題並重試。離線佇列按帳號分開，伺服器再核對 session 與 owner。
- 同一瀏覽器的無帳號舊資料只由首次遷移的帳號接收，切換帳號不會再次匯入另一個帳號。

已唯讀確認現有資料庫欄位。尚未對正式資料庫套用 migration，也未合併、推送或部署。部署須先執行 migration，再部署程式；回滾程式時保留新增表及原始 localStorage，不刪除學習資料。

## API

| API | 行為 |
| --- | --- |
| GET /api/learning | 依 session 取得帳號首次統計、歷程、收藏、錯題及舊摘要；禁止快取 |
| POST /api/learning | answers、review、import；驗證 session、owner、來源、格式與大小 |
| GET /api/stats/chapter-frequency | 公開題庫的科目／章節／年份／收錄試卷統計 |
| GET /api/stats/difficulty?questionId=… | 既有首次作答聚合統計，不回傳其他使用者資料 |
| GET /api/quiz?...&state=… | 既有 API 加上帳號狀態條件；未登入仍可使用全部題目 |

## 計算規則與限制

- 原分析保留首次作答規則及六科呈現。舊 progress 只有各科總數，無法可靠重建逐題正誤與時間，因此另行顯示摘要，不與帳號統計相加。舊 answered IDs 仍可排除已做題。
- 趨勢使用有時間的歷程，各期間每題取最後一次作答，至少 10 題不同題目才顯示正確率與比較。累積練習與上方首次掌握度分開說明。
- 近 5／10 年以題庫最新收錄年份為基準，兼容民國年與西元年。平均值分母是同科收錄試卷，包含該章節零題的試卷，不宣稱是完整歷屆考試。
- 推薦至少需要每章節 10 題、正確率低於 80%，依「錯誤比例 × 近五年同科出題占比」排序並顯示原因。高頻為同科有出題章節前約三分之一，包含並列。
- 難度至少需要 10 位首次作答者；區間為 80／60／40%，不足時顯示樣本累積中。
- 曾答錯包含已從錯題本移除的歷史錯題。設定頁題數是狀態篩選前上限，實際出題再套用帳號狀態。未做「久未複習」。
- migration 單次上限 2 MB，編輯筆記上限 10,000 字元。超過大小或連線失敗時原資料保留、不標記成功，不清除資料或阻擋刷題。
- 離線保存需要可用的 localStorage；不提供持久儲存的瀏覽器仍可刷題，但無法保證離線紀錄持久保存。

## 驗證

- 各 Phase 均執行 npm run build、npm run lint 與相關測試。
- Build 通過。獨立 worktree 共用既有套件與環境設定，Next.js 有多 lockfile 的工作目錄提示。
- 全套 .test.mjs 加既有分析測試：132 個，114 通過、17 個需另啟用資料庫而跳過、1 個既有失敗。
- 既有失敗位於 tests/subscription.test.mjs 的 manual import mock，缺少 @/data/exam-chapters；乾淨 main 獨立重跑亦失敗，本次未修改訂閱功能。
- 全站 lint 為 78 errors、8 warnings；乾淨 main 為 81 errors、8 warnings，沒有新增 lint 錯誤。
- 帳號 PostgreSQL 整合測試另行啟用，使用 TEMP 表並於交易結束 ROLLBACK。驗證多次歷程、首次去重、跨帳號隔離、遷移去重及合併、錯題再答錯、實際 quiz 篩選 SQL。
- 瀏覽器測試攔截 API fixtures，不寫正式資料。360／375／390／412／1280px，驗證無橫向溢出、分析與首頁帳號進度、收藏、錯題筆記、移除、遷移失敗重試、模擬考送出時機及 guest 不新增帳號歷程。
- 新增 tests/account-learning.test.mjs、tests/account-learning-browser.mjs、tests/{learning-trends,chapter-frequency,learning-priorities,question-difficulty,question-state}.test.mjs。既有 daily／chapter 測試僅補齊新增依賴 mock。
