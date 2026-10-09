# 會員 AI 試題入口、題型隔離與 100 MB 教材

此增補延續既有 `/ai-questions` 與管理員教材流程，不重設首頁。主工作目錄的未提交修改保留；實作在 `feat/ai-practice-isolation` 隔離工作樹。

## 會員操作

1. 在首頁「選擇題庫開始練習」區按「AI 試題」，或使用主要導覽中的同名入口。路徑為 `/ai-questions`；未登入先導向登入頁。
2. 選擇既有科目及章節，按「開始 AI 練習」。只取 `ai_questions` 中已人工核准發布、未刪除的題目。
3. 點選選項，再按「提交答案」；提交成功後顯示保存答案、解析、選項解析及教材來源，不呼叫模型。
4. 按「下一題」。最後一題提交後按「查看測驗結果」，結果及每題均標示「AI 試題｜非歷屆國考題」。本輪統計只呈現本輪已提交 AI 題目，不加入首頁國考學習進度。
5. 無已發布題時顯示「此分類目前沒有已審核發布的 AI 試題」，不會補入國考題。可重新選擇科目。

## 資料與 API 邊界

|資料表|固定 kind|用途|
|---|---|---|
|`questions`|`exam`|既有國考／原題庫選題，不改變舊資料用途|
|`question_answer_stats`|`exam`|既有國考首次作答統計與排行榜|
|`practice_attempts`|`exam`|既有國考練習紀錄|
|`diagnostic_items`|`exam`|既有教練／診斷作答快照|
|`ai_questions`|`ai`|AI 題目；原本已有 NOT NULL、DEFAULT 及 CHECK|
|`ai_question_attempts`|`ai`|AI 作答；外鍵只能引用 AI 題目|

新增型別欄位均有 NOT NULL、固定 DEFAULT 和 CHECK 限制；既有內容、ID、外鍵、作答與統計保留。固定型別與實體表隔離使任何查詢 `questions` 的既有選題入口都無法抽到 AI 題，無須改寫所有國考 SQL。`exam` 表示原有題庫體系，沒有把原本私人手動題改稱官方真題，也沒有修改其用途。

已檢查：`app/api/quiz/route.ts` 的公開隨機／依序／科目／年份／章節／單題及既有私人題庫分支；模擬考使用相同選題 API，僅刷題操作模式不同。教練初始診斷、確認、補強驗證、追蹤、每日與自訂任務共用 `diagnosticCandidates`／`createDiagnosticSession` 或從原國考快照選題。到期複習、搜尋、排行榜與弱點分析都未引用 AI 表。

教材生成與 JSON AI 匯入只寫 `ai_questions`；DEFAULT kind='ai' 及 CHECK 防止寫成其他型別。AI API 的列表與作答回應亦提供 kind='ai'。會員列表只投影題幹與選項；答案 API 再驗證發布狀態。草稿／撤回題與私人 PDF 僅管理員可讀。國考答題 API 拒絕 UUID 題號與客戶端額外題型欄位，AI 練習不寫入國考 localStorage、學習同步、統計或教練 API。

## 100 MB 教材上傳

前版遠端實際限制為 3 MB，本增補實作 100 MB（104,857,600 bytes），並保留原有最多 100 頁及文字品質檢查。

Vercel 的函式請求／回應上限為 4.5 MB，不能只放大單次上傳設定。[官方限制](https://vercel.com/docs/functions/limitations)

- 3 MB 以內沿用原上傳流程；較大檔案在瀏覽器分為 1 MB，每次 JSON 請求小於 2 MB。伺服器驗證總長、段號、每段長度、PDF 標頭、內容雜湊及管理員身分。
- 同一上傳、同一段重送只接受相同內容。進度暫存在 `ai_material_uploads`／`ai_material_upload_chunks`；同頁中斷後重新選取同一檔案可續傳，重新整理後重新上傳也不影響已保存教材或題目。
- 最多 5 份未完成上傳，24 小時過期；開始下一次上傳時清理過期的暫存分段。已保存教材及題目不清除。
- 所有分段完成才擷取文字並保存私人教材。合併在 PostgreSQL 內進行，避免再將整份大檔送回資料庫。完成標記與教材保存同一交易，之後重送 finish 回傳同一教材。
- 大 PDF 原頁連結會進入 `/admin/ai-materials/source`。管理員經授權 API 每次讀取 1 MB，在瀏覽器建立暫時 Blob PDF 檢視，不公開私人教材 URL。所有分段均再次驗證權限、回應 no-store。
- 上傳、續傳、文字擷取、查看原頁與會員作答都不呼叫 AI。
- 原出題成本控制不變：最多 10 題／批、18 KB 選定文字、固定模型、輸入／輸出上限、零模型自動重試、每批 USD 0.20 與最近 24 小時 USD 2 硬限制。

## Migration 與部署

已套用前版 AI 題庫及教材 migration 的環境，先檢查資料庫目標後執行：

```powershell
node scripts/migrate-ai-practice.mjs
node scripts/migrate-ai-practice.mjs --apply
```

第一條僅乾跑。第二條在交易中套用 `20261011_ai_practice_isolation.sql` 與 `20261011_ai_material_uploads.sql`。前者只加固定題型欄位；後者調整 AI 教材 bytea 長度限制並新增兩張暫存上傳表。沒有刪除或重建既有題庫、會員或作答表。先套 migration 再發布新程式。

修改範圍：首頁兩個入口、`AIPractice.tsx` 提交與結果操作、AI service 回應 kind、上述 migrations／runner、教材分段上傳 service／client／route、私人教材分段讀取與檢視頁、教材容量常數與提示、Next 新路由 PDF 相依追蹤，以及對應測試。國考選題與統計演算法未改動。

## 驗證

- `tests/ai-practice-isolation.test.mjs`：真實 PostgreSQL 中同時放置國考、已發布 AI 與草稿 AI；執行實際隨機／科目／年份／模擬考 route、教練候選 query、會員 AI API、題型約束及作答統計隔離。資料只存在隨機 schema 交易內，結束回滾。
- `tests/ai-material-upload.test.mjs`：真實 100 MB PDF 擷取、客戶端分段大小／續傳、權限；以 `AI_UPLOAD_100MB_DB_TEST=1` 啟用 100 MB 真實 DB 分段保存及 SHA-256 核對，完成回滾。
- `tests/ai-questions-browser.mjs`：首頁入口、科目／章節、明確提交、下一題、結果標示、空狀態、國考 localStorage 不變、既有圖片題，320／375／768／1280px。
- `tests/ai-materials-browser.mjs` 及原 AI／PDF／國考分類／統計／弱點／教練測試：回歸原有行為與成本、審核、來源驗證。

測試不呼叫真實模型，也不消耗會員 AI 額度；本次會員功能本身沒有生成呼叫。

驗證結果（2026-10-09）：TypeScript、正式建置與本次修改範圍 ESLint 均通過；上述新增 7 項測試全部通過，含 100 MB 實際資料庫保存與 SHA-256 完全一致（15 秒單次 SQL 時限）；原功能回歸 57 項通過、5 項其他模組 DB 整合測試未啟用；兩套桌面／手機瀏覽器驗收通過。未做真實 AI 生成呼叫。
