# 選項作答分布與最常誤選 V1

開發基準：GitHub `Teacherbada/vetexam` 最新 `main`，`f039a431fe50a7efc3ce3882ce0ac2b55d50a004`。本次使用獨立 worktree，原工作區的金流、訂閱及其他未提交修改不包含在發佈內。

## 實際版本與需求差異

此版本已有首次作答統計、排行榜與官方 `questions.explanation` 文字欄位，尚無六科首頁直接作答、社群解析或 Helpful vote。依使用者補充，以國考倒數同寬的小卡提供「本週最多人答錯」與首頁挑戰視窗，不建立六張卡或另一套社群系統。

## 檔案與行為

| 區域 | 檔案 | 改動 |
| --- | --- | --- |
| 首次作答及 SQL | `lib/question-stats.ts` | 正規化 A–E、儲存選項、選項彙總、台灣曆週按答錯人數排名 |
| Migration | `migrations/20260912_option_distribution.sql`、`scripts/migrate-option-distribution.mjs` | 現有表增加 nullable 欄位、可重跑、預設回滾 |
| 公開 API | `app/api/stats/option-distribution/route.ts`、`app/api/stats/weekly-most-missed/route.ts` | 彙總查詢、錯誤狀態、參數驗證 |
| 前端共用 | `lib/answer-statistics-client.ts`、`lib/option-distribution.ts` | 保留既有送出／重試機制，最常誤選與並列計算 |
| 分布 UI | `components/questions/OptionDistribution.tsx`、`option-distribution.module.css` | 可展開、門檻、標籤、進度條、重試 |
| 首頁 | `app/page.tsx`、`app/home.css`、`components/dashboard/WeeklyMostMissed.tsx` | 倒數下方小卡、載入／空資料／錯誤狀態 |
| 首頁作答 | `components/dashboard/WeeklyQuestionDialog.tsx`、`weekly-question-dialog.module.css` | 原生 dialog，鎖答、官方解析、作答後展開分布 |
| 練習／模考 | `app/questions/page.tsx` | 練習作答後／交卷回顧才掛載分布，不重寫原頁 |
| 測試 | `tests/option-distribution.test.mjs`、`tests/option-distribution-browser.mjs`、`tests/question-stats.test.mjs` | API、SQL、legacy NULL、重刷、並列、週界、手機與顯示時機 |

## 儲存與舊資料

唯讀查核現有 `question_answer_stats` 只有 id、question_id、user_id、is_correct、created_at、updated_at；題目具有 A–D 以及 nullable `option_e`。沿用 A–E schema，送出時大小寫正規化，僅接受單一字母與實際存在的非空白選項。

```sql
ALTER TABLE question_answer_stats
  ADD COLUMN IF NOT EXISTS selected_answer TEXT
  CONSTRAINT question_answer_stats_selected_answer_check
  CHECK (selected_answer IS NULL OR selected_answer IN ('A','B','C','D','E'));
```

無預設值、無回填，舊紀錄保持 NULL。伺服器使用 session user ID，`INSERT ... SELECT` 由 DB 答案計算 is_correct，並一起寫入驗證後選項。`ON CONFLICT (user_id, question_id) DO NOTHING` 保留首次紀錄與時間；重刷也不會替舊 NULL 補上新答案。

未登入的 `POST /api/stats/answers` 保留 `{success:true, recorded:false}`，不寫 DB。沒有新增 fingerprint。Client 無法指定正確率、正解或 user ID。

Migration runner 在 transaction 中設定 5 秒 lock timeout、30 秒 statement timeout，同一 migration 跑兩次檢查可重跑性；無 `--apply` 時回滾。已完成 dry run 及 apply。

## 分布 SQL 與門檻

`GET /api/stats/option-distribution?questionId=...` 使用 `OPTION_DISTRIBUTION_SQL`：公開題目 JOIN 題庫、將有效選項轉成至多五列、LEFT JOIN 選項非 NULL 的首次作答，以選項 GROUP BY、COUNT。只回傳各選項彙總，不查出逐人紀錄後用 JS 計數。分母是有效選項計數之和，不包含舊 NULL，也排除題目現已不存在的選項。

既有 question_id 索引足夠；已在隔離 schema 執行 EXPLAIN，未增加重複索引。完整 SQL 在 `lib/question-stats.ts` 的 `OPTION_DISTRIBUTION_SQL`。

`MIN_OPTION_DISTRIBUTION_ATTEMPTS = 5` 只定義於伺服器 `lib/question-stats.ts`。不足時 API 回 `sufficient:false, options:[]`，不回選項百分比；UI 顯示累積中。足夠時以一位小數呈現，總和可能因四捨五入略差於 100%。明示「依 N 次有效首次作答選項紀錄統計；不含未記錄選項的舊作答」。

API 不查詢或回傳正確答案、is_correct、最常誤選或使用者身分。這是公開 aggregate endpoint，不驗證匿名使用者是否真的作答；UI 僅在作答後掛載／請求。正確答案仍來自既有 quiz response，不額外新增洩漏正解的統計 API。既有 quiz API 本來會回傳題目答案，此階段沒有重構測驗安全模型。

## 顯示與最常誤選

- 首頁卡片保持小尺寸；「挑戰這題」開啟可用 Escape 關閉的 dialog，關閉後焦點回入口。作答前無解析或分布，鎖答後顯示官方解析與展開分布。無官方答案時不判定正誤或寫入統計。
- 練習模式：作答後才出現「大家都選了什麼？」可展開區域，預設收合，不影響下一題。
- 模考：交卷前不掛載、不請求分布；交卷後每題回顧可展開，未作答題目不會被統計成新作答。
- 分布只在展開時請求，避免回顧大量題目同時請求。盡量等待當次背景統計送出（最多等待 1.5 秒），讀取有 8 秒 timeout，可重試。若寫入持續較慢，分布可能暫未包含當次作答；收合再展開可重新取得。
- 使用既有中性／正確綠色、CSS progress bar，不加 chart library；標示「你的答案」「正確答案」。
- 前端從既有正解排除正確選項，以未四捨五入 count 找最大錯誤選項。並列全部列出；比例相同但 count 不同不誤判並列。全部答對時無最常誤選；正解未提供時不推測最常誤選。
- API 503、timeout 不影響官方解析、下一題、交卷或本機紀錄。

首頁週榜以 `Asia/Taipei` 週一 00:00 到現在計算，至少 10 人首次作答且有錯誤才顯示。按答錯人數、總作答人數、題目 ID 排序；不是依錯誤率，也不是最近七天。原有 `/most-missed` 最近七天／全期間排行榜不變。

## 保留範圍與後續解析模型

原有 PDF 匯入、私人題庫、Auth、管理員、訂閱／付款、收藏、錯題本、進度資料函式及原排行榜不變；不建立章節、XP、投票、留言、AI、圖片下載、社群功能。

現有官方 `questions.explanation` 是純文字，足以人工寫「B 為什麼錯、C 為什麼對」，但無法可靠逐選項查詢、審核或呈現。查核的 repo 與 DB 沒有 community explanation schema，不能宣稱已足夠。下一階段若需要結構化逐選項解析，建議獨立以 question_id、option_letter 關聯的解析資料模型，規劃作者／來源、版本與審核狀態，避免塞入作答統計表；尚未實作。

## 驗證與正式資料限制

- `npm run build` 成功；`npx tsc --noEmit` 成功。
- 本次新增與修改的功能程式及測試檔 ESLint 通過；`app/page.tsx` 原有同步 setState lint 錯誤保留。全專案 lint 為 81 errors、6 warnings，來自既有頁面／PDF 等檔案。
- 全部單元測試：47 項、42 通過、5 項需另外啟用 DB 測試而跳過。
- 另啟用 `STATS_DB_TEST=1` 跑本次與既有統計測試：8 項全部通過（包含兩项 PostgreSQL 測試）。隔離 schema 與 fixture 隨 transaction 全部回滾。
- Production build 的 Playwright 瀏覽器測試通過：320／375／768／1280px，作答／交卷前不顯示也不請求分布，並列、門檻、標籤、API 故障、首頁 dialog、焦點恢復、空資料狀態，無 browser page errors。
- `git diff --check` 通過。
- 原有 package-lock 在目前本機 npm 的 `npm ci` 有 canvas optional dependency 不同步錯誤；本機以工作區已安裝依賴完成 build，未變更既有 dependency／lockfile。仍需以 Vercel 部署結果確認線上 build。
- 正式站 `https://vetexam-tw.vercel.app` 唯讀查核：240 題公開題目，目前 0 題具有有效正確答案。現有資料無法產生有效對錯／選項統計；UI 顯示累積中符合真實資料，不加入假樣本或猜答案。必須補入正確答案並有新的登入使用者首次作答，才會達到 5 筆分布／10 筆週榜門檻。

測試方式：`PLAYWRIGHT_MODULE` 指向外部 Playwright 的 index.mjs；`TEST_BASE_URL` 設為測試站（預設 localhost:3100）。瀏覽器測試攔截測試資料請求，不把 fixture 寫入正式資料庫。
