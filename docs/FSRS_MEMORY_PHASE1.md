# FSRS 記憶排程 Phase 1

基準：fetch 後 GitHub `Teacherbada/vetexam` 的 `main`，`13a13999c83424dbeea69ba9a986043d8ac7ea2e`。
獨立 worktree／分支 `feat/fsrs-memory-phase1`，不混入原工作區的未提交修改。

## 目的與邊界

替登入使用者對公開題目的新 practice／exam 作答保存逐題記憶狀態，以到期訊號輔助 daily normal 選題。
不回填既有 attempts、首答、瀏覽器 archive 或 Coach 歷史，不虛構作答。

`weakness.ts` 是最近表現、樣本門檻及確認證據的章節分析；FSRS 是單題的記憶排程，retrievability 並非 accuracy，兩者獨立。
原章節 follow-up 仍是通過驗證後 3 天，再從第一階段實際完成時間起 7 天，`FOLLOW_UP_INTERVALS_DAYS=[3,7]` 不變。
FSRS 不改 initial／confirmation、補強狀態、驗證門檻、stable／queued、custom plan 或 notes。
本階段 daily／Coach／custom 作答仍走既有 diagnostic_items，不更新 FSRS。

## 套件與參數

- `ts-fsrs` 精確鎖定 npm 穩定版 **5.4.2**，官方要求 Node >=20；本機 Node **24.18.0**、Next.js **16.2.12**。
- [官方專案](https://github.com/open-spaced-repetition/ts-fsrs) 為 MIT 授權，保留套件 LICENSE；只有 scheduler，沒有 binding／optimizer。
- npm metadata：解壓 706,415 bytes，無 runtime dependencies。不升級其他相依套件。
- 使用正式 `Card`、`createEmptyCard`、`next` 與 `get_retrievability` API。
- `fsrs({enable_fuzz:false})`，其餘使用鎖定版本的預設參數（含短期 learning steps）。相同 card／時間／rating 得相同結果。
- 答錯 → `Rating.Again`；答對 → `Rating.Good`。無 Hard／Easy UI。
- 無 LLM、AI API、embedding、RAG 或 token 成本。

## Schema

`migrations/20260925_question_memory_state.sql` 僅新增 `question_memory_state` 與索引，可 transaction 執行、可重跑。

| 欄位 | PostgreSQL 型別／用途 |
| --- | --- |
| user_id | TEXT，FK → Better Auth `user.id` |
| question_id | INTEGER，FK → `questions.id` |
| due | TIMESTAMPTZ，精確的下次到期時間 |
| stability / difficulty | DOUBLE PRECISION，保存 FSRS 值，不換算成正確率 |
| elapsed_days / scheduled_days | INTEGER；elapsed_days 在 5.4.2 仍屬必要 Card 欄位，官方已標記 6.0 將移除 |
| learning_steps | INTEGER，正式 Card 必要欄位 |
| reps / lapses | INTEGER，作答／遺忘計數 |
| state | SMALLINT，New=0、Learning=1、Review=2、Relearning=3 |
| last_review | TIMESTAMPTZ，可 NULL |
| updated_at | TIMESTAMPTZ，實際持久化時間 |

主鍵 `(user_id,question_id)` 同時支援 user＋question 查詢；另有 `(user_id,due)` 索引。
FK 使用 ON DELETE CASCADE；migration 本身不刪除或修改任何既有 row，也不插入 memory row。
數值有非負／狀態範圍約束，stability 不接受 Infinity／NaN，difficulty 限制 0–10。

## 作答交易與時間

既有 `/api/learning` 身份驗證與參數檢查不改，使用 session 帳號，guest／跨帳號 queue 不可寫入。
`recordPractice` 延用公開性、答案與選項驗證；不存在／私人題目不會產生 attempt 或 memory。

1. 以 account-scoped PostgreSQL transaction advisory lock 序列化一般作答（也保護尚未存在的 card）。
2. 沿用首答統計寫入，再插入 practice_attempts。
3. `ON CONFLICT(user_id,event_id) DO NOTHING RETURNING ...` 只提供真正的新事件；重送不改 reps、due 或 updated_at。
4. 新事件涉及的 card 一次 batch SELECT FOR UPDATE，在記憶體依 answered_at、event_id 排序逐一 `next`，一次 batch upsert。
5. 由既有 questionTransaction 將首答、attempt、memory 一起 commit；任何寫入錯誤向上拋出並整筆 rollback。沿用 learning outbox 重試，不吞掉錯誤留下半套 state。

同一 exam 批次的 memory 讀寫固定兩次 SQL，不隨題數逐題往返。重送無新事件時不查 memory。
單次批次按作答時間處理；跨請求離線事件晚到時，用 `max(answered_at,last_review)` 防止 card 時鐘倒退，仍將每個有效新事件計一次。attempt 的原時間不改，不重播全部歷史；此保守策略不等同完整歷史重算。

## Daily normal 整合與 fallback

建立當日任務時，批次讀取同帳號、目前公開候選題的 memory，一次 SELECT；已固定的今日題單不重抽。
不改任何 daily config、weakness／review 配額、follow-up 保留優先、章節 cap、混題與快照。

normal 排序先保護近期未重複（原 last_seen／last_answered 加上 memory.last_review），再沿用當日科目數、章節覆蓋與累積科目平衡。
在這些限制下依 **due <= now → 未作答 → 較舊作答** 選擇；近期題仍最後回用。due 並非可以越過科目平衡或 7 天保護的硬配額。
平手沿用較舊時間、appearances、既有 random tie。weakness 選題完全不讀 FSRS 訊號。
沒有 memory 時走原 comparator，20 個 seeded fixture 的完整輸出（含順序、配額及 tie 值）與基準 main 的 SHA256 相同。

memory 讀取包在 SAVEPOINT；SQL 或轉換錯誤會 ROLLBACK TO SAVEPOINT，回傳空 Map 並沿用原選題。恢復 savepoint 也失敗（如連線中斷）則仍交由外層 rollback。
`readMemory` 只供 server 內部，回傳 due、stability、difficulty、last_review 與官方算出的 0–1 retrievability；未新增 API 或 UI，也不保存過時的 retrievability。

## 檔案

新增：本文件、`lib/question-memory-service.ts`、`migrations/20260925_question_memory_state.sql`、`scripts/migrate-question-memory.mjs`、`tests/question-memory.test.mjs`、`tests/memory-test-loader.mjs`。
修改：`lib/learning-service.ts`、`lib/daily-task.ts`、`lib/daily-task-service.ts`、`package.json`、`package-lock.json`、`tests/account-learning.test.mjs`、`tests/daily-task.test.mjs`。
未修改任何 app 頁面／API、UI／CSS、Auth、Subscription／PRO、Admin、PDF、AI 分類、notes、收藏、錯題或題庫內容。

## 驗證

規則／API／PostgreSQL 測試覆蓋首次答對／答錯、後續更新、event 重送、帳號隔離、guest、私人／不存在題目、完整 Card 日期 roundtrip、跨交易保存、retrievability、批次查詢、亂序、rollback、並發鎖、due 邊界、近期保護、章節 cap、科目平衡、follow-up reserved、weakness quota 與空 memory 原版結果。
daily PostgreSQL fixture 另驗證實際持久化的 due card 進入 normal，且 30 題仍為 20 normal＋8 weakness＋2 follow-up。
Study Plan Phase 1–8 與 account learning migration／sync 原測試均啟用 DB fixtures，無正式測試帳號或作答。

本機 Node 時鐘比 DB 落後約 4.3 秒，使未修改的 reinforcement fixture 的 CURRENT_TIMESTAMP 被既有弱點公式排為未來資料。該套測試以臨時 preload 在測試程序內校準 Date.now 後 **6/6 通過**；沒有修改公式、測試原檔或系統時鐘。
上述 suites 共 **56 項不同測試**，分批驗證通過（包含所有指定 DB fixtures）；最終批次寫入版本的 FSRS＋account learning **10/10** 通過。並發測試使用兩條真實 PostgreSQL 連線驗證第二個請求在 attempt／card 存取前等待第一個交易釋鎖。

執行入口（DB 使用直接連線的 session TEMP fixtures；可用 TEST_DATABASE_URL）：

```powershell
$env:MEMORY_DB_TEST='1'; $env:LEARNING_DB_TEST='1'
node --test tests/question-memory.test.mjs tests/account-learning.test.mjs
$env:DIAGNOSTIC_DB_TEST='1'; $env:WEAKNESS_DB_TEST='1'; $env:REINFORCEMENT_DB_TEST='1'
$env:FOLLOW_UP_DB_TEST='1'; $env:DAILY_TASK_DB_TEST='1'; $env:CUSTOM_PLAN_DB_TEST='1'; $env:NOTES_DB_TEST='1'
node --test tests/study-plan.test.mjs tests/diagnostic.test.mjs tests/weakness.test.mjs tests/reinforcement.test.mjs tests/follow-up.test.mjs tests/daily-task.test.mjs tests/custom-plan.test.mjs tests/notes.test.mjs tests/learning-priorities.test.mjs tests/learning-trends.test.mjs
```

本次檔案 ESLint 通過；全站 `npm run lint` 的既有 **78 errors / 8 warnings** 位於範圍外檔案，依 scope guard 不修改。獨立 TypeScript noEmit 通過，Next.js 16 production build 通過（44 靜態頁）。未新增畫面，本次未重跑瀏覽器 fixture。

## Migration／部署

```sh
node scripts/migrate-question-memory.mjs
node scripts/migrate-question-memory.mjs --apply
```

未帶 --apply 會在 REPEATABLE READ transaction 內連續執行兩次、比對 users／questions／attempts／first answers／study plans／diagnostic items／custom plans，最後 rollback。
--apply 也先完成同樣 dry-run，再開新 transaction 套用及檢查後 commit；失敗 rollback，設定 lock／statement timeout。
先 migration，再部署新版作答服務；只退回程式時可以保留 additive table。

2026-09-25 已在目前 DATABASE_URL 所連接資料庫完成 dry-run rollback 及正式 apply commit。兩次皆確認：users=2、questions=800、practice_attempts=0、first_answers=1、study_plans=1、diagnostic_items=0、custom_plans=1；新 memory 表 0 筆，沒有 backfill。Phase 2 開始時重新查核：`c4f367bed28e2d6cc9879ba8e30abe3e25600a34` 已在 GitHub main；GitHub Production deployment `6659246827` 於 2026-09-25 11:02:08 UTC 回報 success，Vercel commit status 亦成功。現有 DATABASE_URL 唯讀確認 memory 表與 `(user_id,due)` 索引存在、memory／practice_attempts 均 0；未比對 Vercel Production secrets。

## Phase 2 可另行評估

在明確新規格下評估 Hard／Easy 自評、其他作答來源、可解釋的記憶 UI、延遲事件重建策略及參數調整。不得直接以 retrievability 取代 accuracy／weakness，也不自動改掉 3／7 天章節追蹤。
