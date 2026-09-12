# 公開答題統計與最多人答錯 V1

開發基準：GitHub `main` / `9c15c6aab4ee91640dbeb94f262140a00c02b6be`。

## 修改範圍

| 檔案 | 內容 |
| --- | --- |
| `app/questions/page.tsx` | 非阻塞統計送出；練習鎖答送一題、模考交卷送已作答題目；年份顯示改為民國優先 |
| `app/subjects/page.tsx` | 年份顯示改為民國優先，增加「最多人答錯」入口 |
| `app/api/quiz/route.ts` | 增加單一公開題目 `questionId`，供排行榜沿用原本刷題流程 |

新增：

- `lib/exam-year.ts`：顯示 `民國 115 年（西元 2026）`，DB 與篩選值維持原值。
- `lib/question-stats.ts`：輸入驗證、首次作答 SQL、排行榜 SQL 與伺服器門檻。
- `app/api/stats/answers/route.ts`：登入身分驗證與答題統計寫入。
- `app/api/stats/most-missed/route.ts`：公開彙總排行榜。
- `app/most-missed/page.tsx`：最近 7 天／全期間、科目／年份篩選與魔王題卡片。
- `migrations/20260912_question_answer_stats.sql`：只新增統計表及索引。
- `scripts/migrate-question-stats.mjs`：transaction migration runner，預設 dry run。
- `tests/question-stats.test.mjs`：API、驗證與隔離 PostgreSQL 測試。
- `tests/question-stats-browser.mjs`：手機瀏覽器與答題流程測試。
- 本文件。

## 資料庫

唯讀確認現有 `questions.id` 是 integer sequence 主鍵，160 筆均唯一；`question_sets.id` 是 integer 主鍵、Better Auth `"user".id` 是 text 主鍵。沒有章節欄位。題目 ID 可在題目不刪除重建的前提下作為穩定關聯鍵。

完整、可重現 SQL 位於 [migration](../migrations/20260912_question_answer_stats.sql)：

```sql
CREATE TABLE IF NOT EXISTS question_answer_stats (
  id BIGSERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT question_answer_stats_user_question_key UNIQUE (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS question_answer_stats_question_idx
  ON question_answer_stats (question_id);
CREATE INDEX IF NOT EXISTS question_answer_stats_created_idx
  ON question_answer_stats (created_at);
```

唯一約束已包含 `(user_id, question_id)` 的唯一索引，不另建立重複索引。另有主鍵索引；合計四個索引。

不保存姓名、email、IP、裝置識別或選擇的答案。內部僅保留去重所需 user ID、題目 ID、伺服器判定與首次時間。刪除使用者／題目會 cascade 移除相關統計，不更改被參照表。

```sh
node scripts/migrate-question-stats.mjs
node scripts/migrate-question-stats.mjs --apply
```

同一 migration 在 transaction 中重跑兩次，確認可重現；dry run 回滾，`--apply` 才 commit。已對目前工作區 `DATABASE_URL` 完成 dry run 及 apply。如果另一部署環境使用不同資料庫，也需對該 DB 執行 apply。API 不在 request 內建立表。

## API 與寫入時機

`POST /api/stats/answers`

```json
{"answers":[{"question_id":123,"selected_answer":"B"}]}
```

- user ID 只取 Better Auth session；未登入回 `{ "success": true, "recorded": false }`，不查詢／寫入統計表，仍正常刷題。
- 僅允許 question ID 與選擇答案；偽造 `is_correct`、`user_id` 等欄位會被拒絕。
- 同源 JSON 請求；最多 100 題與 16 KiB body（包含串流大小限制）。不建立 fingerprint。
- 單一 `INSERT ... SELECT` 由 DB 的答案判斷正誤，僅納入公開、答案有效且選項存在的題目。不存在／私人題目不寫入。
- `ON CONFLICT (user_id, question_id) DO NOTHING` 保留首次結果，`created_at`、`updated_at` 均不因重刷或 retry 更動。並行／重複請求的去重由 DB 保證；DB 首個成功 insert 勝出。
- 成功回 `{ "success": true }`，不回傳正確答案、正誤、個人紀錄或 user ID。
- 練習：鎖答後送該題。模考：交卷（含全答完自動交卷）後送已答題目；未作答不送，交卷前選項變更不送。
- Client 100 題一批、每批最多重試一次、每次 8 秒 timeout。背景送出，不等待統計才顯示答案／下一題；503 或網路中斷不影響 localStorage。
- 沒有離線持久佇列；持續斷線或分頁立即關閉可能使統計未送達，不宣稱完整蒐集所有離線作答。

`GET /api/stats/most-missed?range=7d|all&subject=...&year=2026`

- `MIN_ATTEMPTS = 10` 只定義在伺服器 `lib/question-stats.ts`，API 回傳門檻供 UI 顯示。
- 單一彙總查詢，JOIN 公開題庫、GROUP BY 題目、COUNT 總數及錯誤／正確數；無 N+1。
- `HAVING COUNT(*) >= MIN_ATTEMPTS` 依**所選期間及條件**計算門檻。
- `7d` 是 DB 當下往前 7×24 小時的 `created_at` 首次作答紀錄，不是曆週，也不含舊題重刷。
- 排序使用未四捨五入的 `wrong_attempts / total_attempts DESC`、`total_attempts DESC`、`question_id ASC`；展示百分比取一位小數。最多回 20 題。
- 回傳題號、年份、科目、題幹、A–D 選項與彙總數字；不回 answer、explanation 或使用者資料。
- `year` 使用 DB 原始值；UI 可顯示民國年，但不修改原有資料。無章節欄位或推測分類。

排行榜入口在 `/subjects`；頁面 `/most-missed` 沿用刷題 CSS／按鈕。第一張最近 7 天卡片顯示「本週魔王題」、VetExam、年份、科目、題號、答錯率及人數。沒有樣本時顯示累積中，不造假資料。

「開始作答」導向 `/questions?started=1&mode=practice&questionId=...`。只有實際開啟刷題才取得既有測驗資料、作答後顯示解析。排行榜頁面與統計 API 不提前回傳答案；既有 quiz API 本來就會把答案交給作答頁，此階段不重構該機制。

## 保留的功能

`data/progress.ts`、`data/wrongAnswers.ts`、`data/favorites.ts`、`data/tasksProgress.ts` 完全未改；既有錯題去重、筆記、收藏、答題進度、每日進度與重新測驗保留。排行榜不讀 localStorage。

私人題庫、PDF、Auth architecture、付款／訂閱、管理員權限與首頁皆未修改。工作區原有其他未提交修改不包含在本次提交內。

## 驗證

```powershell
node --test tests/question-stats.test.mjs
$env:STATS_DB_TEST='1'
node --test tests/question-stats.test.mjs
npx tsc --noEmit
npm run build
```

資料庫測試在 transaction 的獨立 schema 建立 fixture，最後整體 rollback，不把測試使用者／作答混入正式資料。已通過：A 首次答錯、A 重刷不覆蓋、B 首次答對、未登入跳過、偽造正確率拒絕、503、10 人門檻、私人／不存在題目排除、時間窗、排序與公開欄位。

瀏覽器測試需 Playwright，可用外部暫存安裝而不改本專案 dependency：

```powershell
npm run start -- --port 3100
# 另一個終端，設定外部 Playwright index.mjs 的實際絕對路徑：
$env:PLAYWRIGHT_MODULE='C:/path/to/playwright/index.mjs'
node tests/question-stats-browser.mjs
```

已驗證 320／375／768px 無水平溢出，375px 實际點擊：練習鎖答、模考送出時機、提前／自動交卷、未作答排除、統計故障不中斷刷題、localStorage 保留、年份顯示、排行榜篩選與單題作答。排行榜有資料的 UI 使用瀏覽器 fixture；正式資料庫維持真實紀錄。

Build、TypeScript、本次全部 TS／TSX／MJS 檔案 ESLint、diff whitespace 檢查通過。全專案 lint 排除工作區既存 `.security-audit` 產物後仍有 83 errors、6 warnings，位於未修改的 PDF、首頁、錯題頁等檔案；未擴大修復範圍。

## 下一階段社群詳解注意事項

詳解應使用獨立資料表，以 `questions.id` 關聯，另規劃作者權限／審核／版本，不將內容或票數塞入首次作答表。題目刪除重匯會換 ID 並 cascade 統計；正式題目維護應維持原 ID。正確答案若修訂，目前已寫入的 boolean 不會回算，需要另外定義答案版本與統計重算政策。這階段沒有實作社群詳解、章節或投票。
