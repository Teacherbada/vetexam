# 官方接受複數答案與早期年份支援

## 範圍與相容性

本次只調整官方答案的輸入、判定、顯示，以及國考年份的輸入範圍。學生仍選一個選項；答案集合中的任一選項都算正確。沒有新增 AI 呼叫，沒有變更教練選題政策、計分權重、章節分類、會員、訂閱或首頁。

基準：`Teacherbada/vetexam`，`main` 的 `55b84307ae76d594fcf191303648141ca36bac93`。開發位於 `feat/multiple-official-answers` 獨立 worktree，保留原工作目錄所有未提交修改。

實際資料庫使用 Neon PostgreSQL，程式以 Neon tagged SQL 與 `pg` transaction 存取，沒有 Prisma/Drizzle model。

- `questions.answer` 原為 `text`；舊值 `C` 原樣保留。單一答案繼續寫 `C`，多個答案寫 JSON 陣列的文字 `["A","B"]`。不需要重新匯入舊題。
- API 的題目 `answer` 回應維持字串相容性；共用 `answerKeys()` 轉成陣列。新增題目 API 可接受字串或字串陣列。
- `diagnostic_items.answer_key` 同樣是 text，但原本 CHECK 只允許一個 A–E；需要放寬限制，才能保存複數正解的教練快照。`selected_answer` 保持單一字母。
- 新官方答案只接受 A–D。歷史單一 E 及既有私人五選項的讀取相容性保留；不允許新增含 E 的複數官方答案。
- 去除重複、空字串、null 成員並排序；例如 `["B","A","A",""]` 正規化為 `["A","B"]`。遇到無效非空成員（如 X、數字或物件）拒絕整個答案，避免把有疑義的官方答案默默改掉。空答案沿用既有「尚未設定」流程，不計入有效作答。
- 獸醫練功房使用獨立的 `ai_questions`／作答流程，本次未改變該資料、答案規格或隔離條件。

## 使用方式與 JSON

管理員可從 `/admin/questions` 的單題編輯或鍵盤輸入區設定 A、B 等答案組合；表格輸入可用 `1 A、B` 或 `1 ["A","B"]`。連續答案字串模式仍保持每個字母代表一題，避免歧義。

`/manual`、`/pdf/manual` 及 `/pdf` 解析後的答案選單均支援所有 15 種非空 A–D 組合。PDF 擷取支援明確寫出的 `答案：A、B`；不會猜測互相衝突的答案行。

以下為 `/api/manual-questions` 的請求範例；實際使用既有登入、管理員及科目／章節驗證。不要直接對正式站送測試資料。

```json
{
  "name": "民國 90 年官方題目",
  "visibility": "public",
  "examSubject": "獸醫病理學",
  "examYear": 90,
  "questions": [
    {
      "question": "請替換為正式題幹",
      "options": ["選項 A", "選項 B", "選項 C", "選項 D"],
      "answer": ["A", "B"],
      "explanation": ""
    },
    {
      "question": "舊格式仍可使用",
      "options": ["選項 A", "選項 B", "選項 C", "選項 D"],
      "answer": "D",
      "explanation": ""
    }
  ]
}
```

既有 `/api/question-sets`、`/api/pdf/confirm` 和 PDF 分批匯入沿用各自原有 envelope，只擴充每题 `answer`。精選解析匯入的 `expectedAnswer` 也可使用 `["A","B"]`，必須比對完整集合；只提供 `A` 不可匹配 A、B 題。

年份選單從只列最近 10 年改為民國 90 年至當年度（2026 年為民國 115 年），上限每年自動增加。API 同時接受 ROC 年及舊的西元輸入，但保存為既有西元整數。唯讀查核確認 production 的 `question_sets.exam_year` 本來就是西元，例如 2024、2025、2026；本次沒有轉換舊資料。題庫篩選繼續根據實際資料庫年份產生，沒有 106 年下限。

## 正誤判定與歷史資料

前端透過 `isCorrectAnswer()`，SQL 透過 `selected_answer = ANY(vetexam_answer_keys(answer))` 判斷。涵蓋正式練習、模擬交卷、單題 API、錯題重練、收藏／錯題重新進入的共同刷題頁、首頁既有挑戰元件、首次作答統計、學習紀錄、記憶排程及教練／每日／自訂計畫共用答案快照。

完成作答後以 `A、B` 呈現，所有接受選項均標綠。揭露時機與單選操作維持既有流程。

沒有改寫既有歷史作答、學習紀錄或教練快照。日後管理員修改答案時，沿用原本預覽、確認與首次作答統計重算流程；既有 practice_attempts 和歷史教練快照不另行追溯重算。

## Migration、備份及回復

`migrations/20261014_multiple_official_answers.sql` 只新增兩個 PostgreSQL 函式與放寬 `diagnostic_items_answer_key_check`，不新增資料欄位、不 UPDATE/DELETE 題庫或作答紀錄。

必須先完成 migration，再部署依賴函式的新版本。可先執行不連線的規劃模式：

```sh
node scripts/migrate-multiple-official-answers.mjs
```

實際執行必須明確提供 `--apply --preserve-existing --backup .tmp/<新檔名>.json`，並設定目標資料庫環境。Runner 在 transaction 中檢查實際 schema、建立答案／教練快照及 constraint 定義備份，比較 questions、question_sets、question_answer_stats、diagnostic_items、practice_attempts 全表摘要，任何異常回滾。鎖定逾時 5 秒、SQL 逾時 30 秒；備份不覆蓋已有檔案且不提交 Git。

部署前另保留資料庫服務的完整備份／還原點；本地 runner 的 JSON 是針對本次答案變更的核對資料，不是全庫備份。

若 migration 失敗，transaction 回滾並保留原服務。舊程式可繼續使用新增函式及放寬後的 CHECK。尚未寫入任何複數答案時可回退程式並保留相容 migration；若已有複數答案，不可退回只認單一答案的程式，應保留新讀取邏輯並向前修正。不可把多個答案截成第一個來回復。

2026-10-14 經使用者授權正式部署，已先完成 production migration。執行前備份答案與教練快照；執行後比對摘要，確認 questions 1,040 筆、question_sets 13 筆、question_answer_stats 30 筆、diagnostic_items 160 筆、practice_attempts 24 筆的資料完全未改寫。備份僅保存在本機 `.tmp`，不提交版本庫。程式將依既有 main → Vercel 流程發布；線上驗證結果另於交付訊息回報。

## 驗證與限制

- 已執行 80 項測試：75 通過、0 失敗、5 項需要外部資料庫寫入的測試略過。上述瀏覽器驗證、`tsc --noEmit`、`npm run build`、核心變更 ESLint 及 `git diff --check` 均通過。建置只有 worktree 多份 lockfile 的既有環境提示，未因此改動專案設定。
- `tests/multiple-official-answers.test.mjs`：9 項隔離 PostgreSQL 測試，涵蓋指定十種案例、migration 重入與資料保留、非法答案／年份、完整答案集合比對、教練／每日／自訂計畫、first-answer stats／practice history／memory、管理員統計重算、實際匯入 route、PDF 分批與重複送出及圖片資料保留。
- `tests/multiple-official-answers-browser.mjs`：實際 Next.js 頁面 + Edge，HTTP 連到隔離 fixture，驗證單選、多個正解標示、作答前隱藏解析、交卷、錯題重練、管理員預覽／保存、民國年份選取及手機／桌面寬度。沒有寫入 production。
- 既有精選解析、官方解析、答案統計、PDF parser／匯入與權限、AI 題庫驗證器測試一併回歸。
- 對外部資料庫有寫入風險的 opt-in 測試保持停用；以隔離 PGlite 執行本次 SQL 寫入測試。未宣稱已在 production 完成新答案寫入驗證。

## 修改檔案

答案核心：`lib/question-answer.ts`、`lib/admin-question-input.ts`、`lib/question-detail-answer.ts`、`lib/question-stats.ts`、`lib/admin-questions.ts`、`lib/learning-service.ts`、`lib/diagnostic-service.ts`、`lib/due-review-service.ts`、`lib/public-questions.ts`、`lib/option-distribution.ts`。

匯入／年份：`lib/exam-year.ts`、`lib/import-batches.ts`、`lib/pdf-batch-import.ts`、`lib/pdf-layout.ts`、`app/api/manual-questions/route.ts`、`app/api/question-sets/route.ts`、`app/api/pdf/route.ts`、`app/api/pdf/confirm/route.ts`、`app/manual/page.tsx`、`app/pdf/manual/page.tsx`、`app/pdf/page.tsx`、`app/pdf/QuestionChapters.tsx`、`components/questions/ImportClassification.tsx`。

管理及精選解析交叉驗證：`app/admin/questions/QuestionsAdmin.tsx`、`app/api/admin/questions/route.ts`、`app/admin/questions/FeaturedExplanationImport.tsx`、`lib/featured-explanation-import-input.ts`、`lib/featured-explanation-import.ts`、`public/examples/featured-explanations.schema.json`、`docs/FEATURED_EXPLANATION_IMPORT.md`。

答案呈現：`app/questions/page.tsx`、`app/questions/[id]/QuestionDetail.tsx`、`app/wrong-test/page.tsx`、`app/wrong/page.tsx`、`app/favorites/page.tsx`、`app/pdf/questions/PDFQuestionsClient.tsx`、`components/questions/QuestionCard.tsx`、`components/questions/OptionDistribution.tsx`、`components/dashboard/WeeklyQuestionDialog.tsx`。

Migration／測試：上述 migration、runner、新增兩個 multiple-official-answers 測試與 `tests/helpers/multiple-answers-fixture.mjs`；既有 `tests/admin-questions.test.mjs`、`tests/ai-questions.test.mjs`、`tests/option-distribution.test.mjs`、`tests/pdf-batches.test.mjs`、`tests/pdf-layout.test.mjs`、`tests/pdf-page-auth.test.cjs`、`tests/helpers/official-explanation-fixture.mjs` 只補新共用 helper 載入或 fixture migration。
