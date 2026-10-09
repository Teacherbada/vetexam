# AI 試題題庫｜第一階段

## 範圍與隔離

本功能處理管理員在站外準備的文字 JSON 題目，不呼叫 AI API，不解析 PDF 產生新題目，不改變會員方案、付款或額度。
國考的 questions、question_sets、question_answer_stats 與瀏覽器 progress／錯題／每日任務紀錄維持原狀。
AI 題使用 UUID 及獨立資料表，不使用虛構國考年份，不會被既有國考查詢、模擬成績、排行榜、弱點分析或教練選題讀取。

AI 題批次匯入後固定為 draft + pending。管理員逐題明確確認後，才變成 published + approved，保存審核者與時間。
儲存任何修改（包含來源）會增加 revision，清除目前版本的審核／發布資訊，退回草稿。
既有 AI 作答以 content_snapshot 保存當時題目、答案、解析、來源、版本及判定，不刪除、不追溯重算。舊畫面以 revision 防止回答或發布過時版本。

## 安裝與 migration

需原有 DATABASE_URL、ADMIN_USER_ID、BETTER_AUTH_SECRET 與會員登入設定。沒有新增環境變數、依賴或外部服務。

1. 確認目前連線是預定驗收資料庫。
2. 閱讀 migrations/20261009_ai_question_bank.sql。
3. 執行 node scripts/migrate-ai-questions.mjs（僅顯示 dry run 說明）。
4. 執行 node scripts/migrate-ai-questions.mjs --apply。
5. 執行 npm run build，使用 npm run dev 或 npm start 啟動本機驗收。

migration 在單一交易新增以下三表與索引，使用 IF NOT EXISTS，可重複執行；不修改或重建既有表：

- ai_question_batches：匯入識別碼、請求雜湊、批次名稱、管理員及成功／明確排除明細。
- ai_questions：AI 題內容、來源、指紋、版本、草稿／發布與人工審核狀態。
- ai_question_attempts：會員 AI 作答、版本與內容快照，和國考作答分開。

初次實作驗收時未把 migration 套用至正式 schema，也未發布正式站。整合測試在隨機獨立 schema 執行 migration、匯入與作答，最後 ROLLBACK。

## 管理員操作

1. 登入既有管理員帳號。
2. 在 /pdf 的既有匯入介面點「AI 試題 JSON 匯入／審核」，或在 /admin/questions 點「AI 試題匯入／審核」，進入 /admin/ai-questions。
3. 下載 JSON 範例及範例來源教材。可直接上傳 public/examples/ai-questions.json 驗收；對應教材是 public/examples/ai-source.txt，內容為明確標示的假設比例計算案例，不冒用真實教材。
4. 每批提供 name 與 questions（1–200 題）。可上傳 JSON 或貼上 JSON。畫面可展開查看完整官方科目／章節清單。
5. 點「解析並預覽」。每一題列出錯誤與未確認來源欄位；可返回 JSON 修正再預覽。
6. 若部分題目錯誤，預設禁止匯入。可明確勾選「只匯入有效題目」，被排除題號與原因會保存並顯示於批次畫面。
7. 點「確認匯入為草稿」。同一 requestKey 的相同請求重試回傳先前結果；不再建立題目。不同識別碼仍受題幹指紋唯一限制。
8. 在批次選單查看全部、草稿或已發布題目；可載入更多批次。每批最多 200 題，整批列出可逐題展開。
9. 展開題目，修改官方分類、題幹、選項、答案、完整／選項解析及來源。先「儲存修改並待審核」。
10. 人工核對已儲存的題目、答案、解析、來源與可公開性，勾選確認後點「確認審核並發布此題」。
11. 已發布題目也可編輯；儲存後自動撤回草稿。或直接「撤回為草稿」。未儲存的內容不能被當作已審核版本發布。
12. 發生版本衝突或其他視窗更新時，重新載入後再核對。

## JSON 欄位

完整可直接使用檔案：public/examples/ai-questions.json。請以實際教材替換示範資料。

- subject、chapter：data/exam-chapters.ts 的既有固定科目與章節，皆必填。
- question：題幹，必填。
- options：剛好四個不重複、非空文字選項，依 A/B/C/D 排列。
- answer：唯一 A/B/C/D（小寫可正規化）。
- explanation：完整解析，必填。
- optionExplanations：選填，若提供須為四個字串；個別項目可空白。
- source.title：講義／書名，必填。
- source.edition：版本，未知可留空。
- source.chapter：來源中的章節，與官方分類章節分開。
- source.printedPages：書本印刷頁碼（例如「12–14」）；未知留空。
- source.pdfPages：PDF 檔的頁次（例如「15–17」）；未知留空。
- source.excerpt：支持答案的短摘錄，必填，最多 2000 字。
- source.url：選填 HTTPS 公開來源連結。不要提供私人教材、含帳密或帶私人存取權的下載網址。網站不會擷取、上傳或公開整份教材。
- generationMethod：固定「依管理員提供資料由 AI 生成，再由管理員審核」。

來源定位至少提供 source.chapter、printedPages、pdfPages 其中一項，並提供書名與摘錄。其餘未知欄位保留空字串，介面顯示「未提供／未確認」。
不接受匯入資料中的年份、图片、發布狀態或自行擴充分類。來源可信度由管理員實際核對，系統只驗證格式與定位完整性。
每批 HTTP 請求最多 2 MiB（含包裝欄位），前端檔案限 1,900,000 bytes，以預留 JSON 包裝空間。

## 會員操作

1. 登入會員，從 /subjects 點「AI 試題」，進入 /ai-questions。
2. 選擇官方科目與章節，點「開始 AI 練習」。
3. 只會取得已發布且已人工審核的題目。列表不傳答案、解析、摘錄或草稿。
4. 以原刷題樣式選 A/B/C/D，伺服器檢查目前發布狀態與版本，存入 AI 專用作答表。
5. 作答後顯示資料庫保存的答案、完整／各選項解析、教材來源及摘錄，不重新生成。
6. 印刷頁碼與 PDF 頁次分開列出；未提供的欄位不標為已確認；有來源 URL 才顯示可點擊連結。
7. 可略過、下一題、載入下一頁（每頁 50 題）、重新選擇科目。畫面上的本輪 AI 答對數僅為 AI 練習摘要。

每題顯示「AI 試題｜非歷屆國考題」，入口顯示「依管理員提供的教材由 AI 生成，經人工審核後發布；不代表官方命題。」

## API 與一致性

- /api/admin/ai-questions GET：管理員批次／整批題目；POST：preview、import、save、publish、unpublish。
- /api/ai-questions GET：登入會員的已審核發布題目；POST：登入會員作答，會重新驗證發布狀態。
- 每個管理員 API 都先 requireAdmin，頁面另使用 requireAdminPage。前端的 isAdmin 等旗標不參與授權。
- 使用既有 session 身分，不接受用戶提供的 user_id／審核者。
- 所有回應 private, no-store；寫入驗證同來源、JSON 格式及串流大小。
- 預覽簽章綁定內容、重複題狀態、管理員及有效期；正式匯入在交易鎖內重新驗證。
- 相同科目加 NFKC／空白正規化題幹的 SHA-256 指紋防止同批及跨批重複。不進行語義相似度或外部 AI 去重。
- 作答與撤回／編輯以列鎖協調；同會員 requestKey 的作答重試不重複建立紀錄。
- 無刪除 AI 題目 API，避免移除作答所引用題目。

## 檔案與共用程式影響

新增：
- lib/ai-question-input.ts、lib/ai-question-service.ts、lib/ai-question-http.ts、lib/ai-question-client.ts
- app/api/admin/ai-questions/route.ts、app/api/ai-questions/route.ts
- app/admin/ai-questions/page.tsx、AIQuestionsAdmin.tsx
- app/ai-questions/page.tsx、AIPractice.tsx
- components/questions/AISource.tsx
- migrations/20261009_ai_question_bank.sql、scripts/migrate-ai-questions.mjs
- public/examples/ai-questions.json、public/examples/ai-source.txt
- tests/ai-questions.test.mjs、tests/ai-questions-browser.mjs
- docs/AI_QUESTION_BANK_PHASE1.md

既有檔案僅增加入口：
- app/pdf/page.tsx：管理員匯入區連到 AI 匯入／審核。
- app/admin/questions/page.tsx：國考題管理頁連到 AI 題管理。
- app/subjects/page.tsx：科目選擇頁增加 AI 練習入口。

沿用既有 requireAdmin、requireAdminPage、questionTransaction、預覽簽章／錯誤回應，以及題目管理與刷題 CSS，沒有更改共用 helper、國考選題／統計或首頁。工作區原有未提交修改保留。

## 驗證指令

- node node_modules/typescript/bin/tsc --noEmit
- npm run build
- node node_modules/eslint/bin/eslint.js lib/ai-question-input.ts lib/ai-question-service.ts lib/ai-question-http.ts app/api/ai-questions/route.ts app/api/admin/ai-questions/route.ts app/admin/ai-questions app/ai-questions components/questions/AISource.tsx
- node --test tests/ai-questions.test.mjs
- 設定 AI_QUESTIONS_DB_TEST=1 後執行上述 AI 測試，使用 TEST_DATABASE_URL 或專案 DATABASE_URL；測試建立獨立 schema，完全回滾。
- node --test tests/admin-questions.test.mjs tests/pdf-batches.test.mjs tests/pdf-page-auth.test.cjs tests/question-stats.test.mjs tests/exam-chapters.test.mjs
- 設定 PLAYWRIGHT_MODULE 為既有 Playwright 的 index.mjs（若不在專案依賴中），node tests/ai-questions-browser.mjs。使用本機 3119 port 與 Edge，測試暫時建立 fixture 路由，結束後移除。
- 在本機測試站執行 tests/pdf-batches-browser.mjs（設定 TEST_BASE_URL）。

瀏覽器測試以真實元件與攔截 API fixture 驗證操作；匿名保護直接測試真實 API。真正的資料寫入、草稿隔離與交易一致性另外以 PostgreSQL 整合測試驗證。沒有使用正式管理員帳號或新增正式會員。

## 本次驗證結果（2026-10-09）

- TypeScript noEmit 通過；最後 Next.js 16.2.12 production build（含 TypeScript）通過。
- 新增程式的 ESLint 通過（0 error、0 warning）。
- AI 專項 6/6 通過，含 PostgreSQL migration、批次列表 SQL、匯入冪等、草稿隔離、發布、修訂、舊作答快照保留及失敗回滾。
- 既有國考回歸 26/26 通過，含管理員答案維護、固定分類、PDF 分批匯入、頁面權限及統計的 PostgreSQL 測試；沒有略過的項目。
- AI 瀏覽器驗收通過：JSON 檔案、錯誤預覽、明確部分匯入、防重複點擊、人工發布、修改後重新審核、資料庫內容呈現、來源缺漏標示、AI 與國考 localStorage 隔離、既有國考圖片題。
- 320／375／768／1280px 無水平溢出；手機截圖已檢視。截圖位於 .tmp/ai-question-artifacts/admin-375.png 與 practice-375.png。
- 既有 PDF 瀏覽器回歸通過：圖片題容量預檢、分批範圍、重疊阻擋、依序送出、重試沿用識別碼、純文字 413 錯誤可恢復。
- git diff --check 通過；暫時測試 fixture 頁面已移除。
- 初次驗收的 PostgreSQL 測試使用隔離 schema／暫存表並回滾；當時未對正式 schema 執行本次 migration，也未部署正式站。

## 正式發布準備（使用者後續授權）

以 origin/main 的 b9b581e 為基礎建立獨立發布分支，僅納入 AI 題庫新增檔案與三個入口；保留正式站較新的登入相容性、首頁與 PDF 審閱功能。
AI 頁面請求使用 AbortController，不依賴 AbortSignal.timeout，以符合正式站 Safari 15.5 目標。
正式資料庫已透過公開題目內容雜湊比對確認；migration 只新增三張 AI 表及索引，不植入示範題，不自動進行人工審核。

正式發布驗證：最新版分支 production build、TypeScript、AI 專項 7/7、ESLint 與 320／375／768／1280px 瀏覽器流程均通過。已套用正式 migration；對照 migration 前後，既有題庫、會員及國考作答筆數相同，AI 三表為空，未植入或發布示範題。
