# 題庫校對工作台

## 基準與唯讀現況

- 專案：`Teacherbada/vetexam`，最新基準 `3040c57c70af3fcba99c0981f2a17561a5d2539f`。
- 開發分支：`feat/question-proofreading`；獨立 worktree `.worktrees/question-proofreading`。原根目錄 `main` 的既有未提交修改全部保留。
- 資料存於 Neon PostgreSQL，現有 `questions`／`question_sets`，透過 Neon SQL 與 `pg` transaction 存取。
- `questions.answer` 為文字：單一 `A` 或多個答案的 JSON 陣列文字。選項為 `option_a`～`option_e`；题號／科目在 question，年份／考卷名稱在 question_set。
- 圖片存於 `image_data_url`，既有 PDF 多圖流程已將多圖合成一張 PNG。2026-10-14 唯讀查核：1,040 題、1 題有 E、66 題有圖片，全部使用 PNG／JPEG／WebP data URL；最大現存圖片約 1.06 MB 字元。沒有修改該 E 題或其他正式題目。
- 既有維護中心只有答案、精選解析編輯；答案修正依既有流程重算首次統計。精選解析有草稿／發布版本；舊答案和解析 API 均保留。

## 操作入口

`/admin/questions` → **題庫校對工作台** → `/admin/questions/proofread`。

可直接帶入 `/admin/questions/proofread?bankId=<題庫ID>&questionId=<題目ID>`。

1. 選年份、科目與考卷。只列公開國考題庫；不包含私人題庫或獸醫練功房。
2. 使用題號格、題號搜尋、全部／待核對／已核對／異常／有圖片篩選切換題目。
3. 單題面板可修改題幹、選項、答案、圖片、解析，切換預覽；提供上一題、下一題、儲存、儲存並下一題。
4. 刪除或重排選項時，畫面清空答案並要求重新指定、確認，避免答案指向錯誤內容。
5. 返回整卷後按原題號顯示**所有完整題幹與選項**；圖片／解析可展開。編輯後可返回原總覽位置。
6. 每題確認後標記已核對；有疑似異常需再次明確确认。題幹、有效答案／選項不完整或圖片解碼失敗，不得標記已核對。
7. 全題人工核對且題數符合原考卷設定、題號連續且無重複，才能按「確認整卷校對完成」。完成不會自動發布解析。
8. 誤改時展開「修改歷史與單題回復」，核對修改前後內容並回復該次修改前版本。回復保留原題 ID、回到待核對；解析不自動重新發布。

桌面使用左側題號格與可捲動單題面板；小螢幕改上下排列。沿用 AdminShell、study-button、現有配色與卡片、ImageViewer 及安全 Markdown 元件。離開或切換題目會提醒未儲存內容。

## 資料、圖片與安全

新增三個 metadata 表：

| 表 | 用途 |
| --- | --- |
| `question_proofreading` | 原圖順序、合圖摘要、編輯版號、人工核對指紋與時間、歷史統計提示旗標 |
| `question_edit_history` | 修改者、時間、欄位、前後快照與防重複 request ID |
| `question_bank_proofreading` | 整卷人工確認者、時間與當時內容指紋 |

題幹／選項／答案／解析／合圖繼續使用原 questions 欄位。不更換 ID，不改題號、年份、科目、章節或題庫歸屬，不新增重複題目，不提供題目刪除入口。

- 保留現有資料模型，選項支援 2～5 個，代號按順序固定 A–E，不接受空白選項。答案只能指向實際存在的選項。新工作台可設定包含 E 的多個官方正解，學生仍單選；原四選項匯入器仍沿用其原有 A–D 驗證。
- 圖片支援新增、替換、移除、上移、原圖放大及從同卷其他題目附加。附加會保存圖片副本，移除只改本題關聯；不刪除其他題目或歷史中的原圖。
- 每題最多 8 張，新上傳 PNG／JPEG／WebP 每張 2 MB；JSON 請求上限 3.8 MB，可分次保存。合圖上限 32 百萬像素／32,000 像素高／約 3.4 MB data URL 字元。超限或格式／解碼失敗時拒絕交易，不保存半套圖片。
- 伺服器驗證圖片實際格式，再依原圖順序合成 PNG，前台與教練繼續讀原來的 `image_data_url` 格式；沒有新增外部圖片服務、伺服器任意 URL 抓取或圖片資源刪除。
- 整卷 API 不傳完整原圖，只回圖片數量與版本；原圖由有管理員驗證的獨立 GET 按需讀取，縮圖 lazy loading。歷史先載最近 50 筆摘要，完整差異逐筆讀取，不一次下載所有歷史圖片。
- 全部 GET／PATCH／原圖／歷史均檢查既有管理員身份；頁面使用既有 requireAdminPage。更新 body 採白名單、來源及大小限制。
- 更新在 transaction 內重新讀取並鎖定題目、核對版本；過期版本回傳 409。前端保留草稿並提示重新載入；儲存失敗不顯示成功。
- request ID 有資料庫唯一約束，遺失回應後重送不重複套用。保存前後差異與單題回復都在同一交易內。
- 校對指紋涵蓋題幹、選項、答案、解析、圖片、原題識別與解析版本。即使从舊答案／解析 API 改內容，先前人工核對也會失效，整卷完成狀態會重新計算。

## 異常檢查

使用確定性規則，不呼叫 AI：缺答案、答案指向空選項、E 選項、重複文字、空白選項、空白／短題幹或結尾疑似截斷、圖片格式／讀取失敗、題號重複／缺漏、解析中明確標示的答案與官方答案不同。

疑似截斷與解析不一致只作提示，不能替代人工判讀醫學內容。沒有偵測異常不會自動標記已核對。

## 歷史成績策略

預設保留首次作答統計、practice_attempts、教練快照與記憶狀態，不做大量追溯改写。新作答依目前答案判定。

只有「單純改答案，題幹和選項都未改」時，管理員可明確勾選重算**該題**的有效首次作答統計；不刪掉缺選項的舊統計，不變更歷史練習或教練成績。題幹或選項增刪／重排時拒絕此重算，避免把舊字母當成新選項內容。

編輯歷史記錄是否選擇 `first_answer_statistics` 重算。回復內容不會反向改寫歷史成績。工作台顯示三種紀錄筆數及說明；題目難度區會標示歷史版本差異，曾更改內容的題目不再用目前選項解讀舊分布。排行榜、教練策略與學習計畫演算法維持原有首次成績／歷史語意。

## Migration 與回復計畫

檔案：`migrations/20261014_question_proofreading.sql`。

只新增 metadata 表／索引，擴充既有 `vetexam_answer_keys` 支援實際 E 選項；不 UPDATE 或 DELETE 任何既有題目、解析、圖片與作答資料。舊題無 metadata 時皆為待核對，舊答案與單張圖片照常讀取。

`node scripts/migrate-question-proofreading.mjs` 預設只列計畫、不連資料庫。正式套用前先建立資料庫備份／還原點，確認現行 schema 與目標，再使用明確的 `--apply --preserve-existing --backup .tmp/<新檔名>.json --env-dir <既有環境設定目錄>`。

Runner 使用 transaction、鎖定／SQL 逾時，備份原答案函式與既有校對 metadata；比對 questions、question_sets、question_answer_stats、practice_attempts、diagnostic_items 全表摘要，任何不符回滾。備份檔只留本機，不提交 Git。

部署順序必須是 migration → 新程式 → 唯讀線上驗證。新統計提示 API 會讀 metadata 表，不可漏跑 migration。

若 migration 失敗，由 transaction 回滾。若程式回退，優先保留新增表與歷史，停用新入口；不要刪除校對歷史／原圖。尚未寫入 A、E 等複數 E 答案時，可還原函式原定義。已使用新答案格式後不要退回不支援它的讀取程式，應向前修正。誤操作用單題歷史回復，不重建題庫。

2026-10-15 經使用者授權正式部署，已先完成 production migration。執行前以唯讀交易備份題庫及相關作答資料（約 29 MB），另保留原答案函式與校對 metadata 備份；這是本次範圍的備份，不是全庫備份。備份僅存本機 `.tmp`，不提交版本庫。

Migration 交易前後全表摘要一致：questions 1,040 筆、question_sets 13 筆、question_answer_stats 30 筆、practice_attempts 24 筆、diagnostic_items 160 筆均未改寫。程式依既有 main → Vercel 流程發布，線上部署驗證另於交付訊息回報；沒有以正式題目進行寫入測試。

## 已驗證

- 90 項測試：85 通過、0 失敗，5 項需要外部資料庫寫入的 opt-in 測試略過。
- 新增 9 組隔離 PostgreSQL 測試，涵蓋需求的題目／選項／答案／圖片修改、80 題完整總覽、缺漏重複題號、權限、原 ID 與其他题目隔離、重送／衝突／交易回滾、人工核對失效、單題回復、歷史紀錄保留與單題統計重算。
- 實際 Next.js 頁面與 Edge 瀏覽器：假 E 刪除、A／B 答案、題幹與預覽、未儲存切題提醒、圖片放大／排序／移除／新增、回整卷更新、80 題與最後一題、核對篩選與搜尋；375／768／1280 寬度皆可操作且無水平溢出。
- 既有複數答案、精選解析新增／發布／批次匯入、PDF parser／圖片／匯入／權限、AI 題庫與既有統計測試回歸通過。
- TypeScript 型別檢查、核心新增程式 ESLint、diff 檢查及 `npm run build` 全部通過。

所有寫入驗證只用隔離資料。正式資料安全仍需依部署前後的 schema、摘要與備份檢查，不以測試通過代替 production 核對。

## 範圍與限制

- 舊 PDF 匯入已合成的圖片沒有可還原的分張原圖；工作台將它視為一張，必要時重新上傳正確原圖。新工作台保存的多圖可個別排序／替換／回復。
- 沒有新增 OCR、原始 PDF 對照、AI 校對或自動修改。
- 不改原題號；發現缺題／重複題號會阻止確認整卷完成，管理員需依既有流程處理來源資料。
- 內容回復保留草稿，不自動發布精選解析；舊版本若本來缺少必要欄位，需參考差異手動修正，不直接還原不完整內容。
- 獸醫練功房、私人題庫、訂閱、會員、首頁、題目分類及教練選題策略均未修改。

## 修改檔案

新增工作台：`app/admin/questions/proofread/page.tsx`、`Proofreading.tsx`、`proofread.module.css`；入口修改 `app/admin/questions/QuestionsAdmin.tsx`。

新增 API／服務：`app/api/admin/questions/proofread/route.ts`、`lib/question-proofreading.ts`、`lib/question-proofreading-input.ts`、`lib/question-proofreading-images.ts`；`next.config.ts` 僅補新 API 的既有 Canvas 原生套件部署追蹤，避免 Linux 部署漏檔。

必要相容調整：`lib/question-answer.ts` 保留 E 的複數答案讀取；`app/api/quiz/route.ts`、`lib/learning-service.ts` 補傳實際存在的 E 選項；`app/api/stats/difficulty/route.ts`、`app/api/stats/option-distribution/route.ts`、`lib/option-distribution.ts`、`components/questions/QuestionDifficulty.tsx`、`components/questions/OptionDistribution.tsx` 僅增加曾校對題目的歷史版本提示。

Migration／工具／測試：`migrations/20261014_question_proofreading.sql`、`scripts/migrate-question-proofreading.mjs`、`tests/helpers/proofreading-fixture.mjs`、`tests/proofreading.test.mjs`、`tests/proofreading-browser.mjs` 及本文件。
