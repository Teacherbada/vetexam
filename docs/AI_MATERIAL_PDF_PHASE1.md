# 教材 PDF 出題（第一階段增補）

此功能與 `/pdf` 的「國考 PDF 題目匯入」分開。原 JSON 匯入與會員 AI 練習保留。實作位於 VetExam 的 `feat/material-pdf-ai` 分支／`.tmp/ai-question-bank-release` 工作樹；原主工作目錄的未提交修改未覆寫。

## 設定與 migration

伺服器環境變數：`DATABASE_URL`、既有 `ADMIN_USER_ID`／認證設定、`OPENAI_API_KEY`。金鑰不使用 `NEXT_PUBLIC_` 前綴，不會送到瀏覽器。未設定金鑰時仍可上傳、預覽、估價；開始／續接 API 拒絕呼叫模型。畫面會明示缺少金鑰及尚未完成真實生成驗證。

先確認資料庫為預定環境，並已套用 `20261009_ai_question_bank.sql`。本次新增：

```powershell
node scripts/migrate-ai-materials.mjs
node scripts/migrate-ai-materials.mjs --apply
```

第一條只顯示說明，不修改 DB。第二條在單一交易中套用 `migrations/20261010_ai_material_generation.sql`：

- `ai_materials`：私人 PDF bytes、文件雜湊、逐頁擷取文字／SHA-256／文字可用性／圖形提示。
- `ai_generation_jobs`：不可變更的批次設定、模型、預留額度與冪等識別。
- `ai_generation_items`：逐題派送、進度、錯誤、用量、題目識別與費用。
- `ai_question_material_sources`：題目對應原始教材、PDF 頁次與頁面雜湊。
- `ai_questions.deleted_at`：保留資料的刪除標記；既有列保持 NULL。

不修改國考題、會員、國考作答與統計資料表。Migration 可重複執行。請先套 migration 再發布新程式；回退程式不必刪除新增資料。此次開發驗證只在隔離 schema 的交易內套用並回滾，未套用到正式 public schema，未部署此增補版。

## 完整操作

1. 以管理員登入，從 `/pdf` 或 `/admin/ai-questions` 點「教材 PDF 出題」，進入 `/admin/ai-materials`。
2. 上傳最多 3 MB、100 頁的文字型 PDF。此時只有文字擷取與私人保存，不呼叫 AI。相同文件雜湊會使用原教材記錄。
3. 逐頁預覽文字，透過限管理員的原始 PDF 連結對照原頁。掃描／空白／明顯亂碼頁會標記需 OCR 或人工處理，含這些頁的範圍不可生成。本版不提供 OCR。圖片、向量圖形、表格順序與公式需人工確認；需要看圖才能作答的內容請人工處理。
4. 填資料名稱、版本（未知留空）、既有科目與章節。教材章節名稱可另外填寫，未知留空，不把官方分類假稱為教材章節。選 PDF 起迄頁次、1–10 題及基礎／中等／進階。印刷頁碼逐頁人工填寫，不從 PDF 頁次推測。
5. 按「檢查範圍與估算費用」。本批擷取文字最多 18 KB（UTF-8）；超過請縮小範圍。估價不呼叫 AI。
6. 確認文字品質與圖表限制、同意將選定文字送到 OpenAI 及費用上限，才按「開始生成」。同一份教材與相同設定會回到原工作，即使換分頁／重複點擊也不另建批次。
7. 每次只處理一題，完成立即存為草稿。頁面會接續尚未開始的題目，單次模型請求 40 秒時限，路由最長 60 秒。可在目前題目完成後暫停；關閉頁面後其餘題目不會在背景自動跑完。重開後從歷次工作載入，按「繼續尚未開始的題目」。
8. 失敗時立即停止接續，已完成草稿保留。可人工繼續其他尚未開始的題目，失敗題不重試。若工作在模型呼叫中中斷，90 秒後續接操作會將它標為「結果不明」，不重新派送，可能已計費。若原呼叫稍後成功返回，同一派送識別仍可保存結果一次。
9. 點「查看本批草稿、逐題審核與批次發布」。逐題對照原 PDF 頁面，編修題幹、選項、答案、解析、來源。來源 PDF 頁次必須在原批次範圍內，摘錄仍須能在擷取原文找到；禁止加入私人教材連結。
10. 儲存後逐題勾選「我已人工核對…」，可逐題發布，或按「批次發布已逐題確認的 N 題」。只發布目前儲存版本；版本衝突整批交易回滾。成功生成不等於人工審核。
11. 已發布題修改後退回待審草稿。刪除須先退回草稿並勾選確認，僅設刪除標記，歷史作答快照保留；刪除題不再出現在列表及會員 API。
12. 會員從 `/ai-questions` 練習核准題目。固定標示「AI 試題｜非歷屆國考題」，答案、解析與來源只讀資料庫，無模型呼叫。AI 作答存於獨立表，完全不進入國考模擬、排行、弱點或教練選題。

## 模型與費用硬限制

固定模型：`gpt-4.1-mini-2025-04-14`，OpenAI Responses API，`store:false`、嚴格 JSON Schema，無工具／搜尋／對話歷史，零自動重試。只傳本批選定頁面的擷取文字、題型設定和同批先前題幹，原始 PDF 不上傳 OpenAI。

依 [GPT-4.1 mini 官方價格](https://developers.openai.com/api/docs/models/gpt-4.1-mini)，未折扣文字 input USD 0.40／百萬 tokens，output USD 1.60／百萬 tokens。價格核對日期 2026-10-09。使用 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 限制輸出格式。

- 每題：序列化請求 UTF-8 bytes 加 1,024 framing 預留，須不超過 32,000 的保守輸入 token 上界；輸出 `max_output_tokens=2400`。
- 每題預留 USD 0.01664，10 題最多 USD 0.16640；每批硬上限 USD 0.20。
- 全站教材出題最近 24 小時預留上限 USD 2，建立工作和實際派送分別檢查，防止跨日續接繞過限制。這個限額不涵蓋既有其他 OpenAI 功能或站外使用。
- 資料庫鎖先取得一次性派送權並提交，再執行模型網路請求；不在長交易內等待模型。多分頁或並行 step 不會重複派送。
- 已失敗、結果不明或已完成的派送保留費用預留，不因失敗而退款／重跑。回應含有效 usage 時另外記錄模型用量費用；未知 usage 不假報零費用。估價為保守上限，不含稅、匯率與非模型服務費。
- 若供應商價格變更，需同步檢查後端固定價格／上限及說明；模型不可由客戶端自由指定。

模型指令明確限制只能依教材，資料不足須回傳 insufficient；沒有來源、偽造頁碼、不在原頁的摘錄、格式不符或重複題會成為失敗項，不自動補題。原文比對只能驗證來源定位，不能證明推論正確；題目是否忠於教材、是否有唯一答案仍必須由管理員人工審核。

## 範例與驗證

- 可直接上傳：`public/examples/ai-material-sample.pdf`（合成比例計算教材，無私人內容）。選科目「獸醫公共衛生學」、章節「獸醫流行病學」、PDF 第 1 頁、1 題。
- 原 JSON 範例：`public/examples/ai-questions.json`，對應原文 `public/examples/ai-source.txt`；仍可從 AI 題庫下載及批次匯入。
- 自動測試：`tests/ai-materials.test.mjs`；原 AI 題庫：`tests/ai-questions.test.mjs`。
- 瀏覽器驗收：`tests/ai-materials-browser.mjs`、`tests/ai-questions-browser.mjs`。本機暫時 fixture 路由會在結束時刪除；API 以測試資料攔截，不呼叫模型或寫入正式題庫。
- 真實 PDF 擷取／字元與頁次測試使用本機 pdfjs；資料庫測試用 `AI_QUESTIONS_DB_TEST=1` 開啟，只在隨機隔離 schema 的交易內執行並回滾。

本機未設定 `OPENAI_API_KEY`，因此真實 OpenAI 生成、實際生成品質與供應商計費尚未驗證；模型回應／失敗路徑使用可重現 fixture 驗證。上線前須在伺服器設定金鑰，以上述合成教材產生 1 題，核對 usage、摘錄、人工審核及會員呈現。

## 本次共用調整的理由

`lib/ai-question-service.ts` 和管理員題庫 API／介面增加教材來源檢查、原頁連結、批次人工發布與草稿刪除；會員查詢排除刪除標記。這些是同一 AI 題庫生命週期的必要擴充，沒有修改國考資料表或統計。`next.config.ts` 只增加新教材 API 的 PDF worker／canvas 部署檔案追蹤。`app/pdf/page.tsx` 只增加獨立入口，既有國考解析、圖片與匯入程式未改。

## 驗證結果（2026-10-09）

- `npx tsc --noEmit`：通過。
- `npm run build`：通過；新管理頁與 API 均列入產物，PDF worker/runtime/canvas 檔案追蹤確認存在。
- 本次修改範圍 ESLint：通過。全專案 `npm run lint` 有原有 73 errors／8 warnings，位於舊 PDF 圖片路由、其他頁面與舊測試等；未做無關修正。
- 教材／AI 題庫測試：14 項通過，含隔離 PostgreSQL 實際交易、migration 重複執行、派送去重、失敗續接、頁次／摘錄核對、費用拒絕與批次發布回滾。
- 原國考相關回歸：47 項通過、5 項未啟用其他模組 DB 整合測試；涵蓋 PDF 文字與圖片擷取、實際 PDF 路由、匯入批次、管理員畫面權限、官方分類、國考作答與弱點／教練邏輯。
- 兩套瀏覽器驗收通過；桌面與 320／375／768／1280px 均無橫向溢位。涵蓋教材上傳、OCR 阻擋、費用確認、重複點擊、失敗後重開續接、原頁查閱連結、批次發布／刪除，以及既有 JSON 匯入、AI 作答統計隔離、國考圖片題。
- 真實模型生成：未驗證（未設定 OPENAI_API_KEY）；沒有宣稱 fixture 結果是真實 AI 產物。

`.gitattributes` 僅將新增 PDF 範例標為 binary，避免 Windows 換行轉換破壞 PDF 位移表。

修改／新增清單：`.gitattributes`、`app/admin/ai-materials/{page.tsx,AIMaterialsAdmin.tsx}`、`app/api/admin/ai-materials/route.ts`、`lib/ai-material-{input,pdf,model,service}.ts`、`app/admin/ai-questions/AIQuestionsAdmin.tsx`、`app/api/admin/ai-questions/route.ts`、`lib/ai-question-service.ts`、`app/pdf/page.tsx`、`next.config.ts`、上述 migration 與 runner、`public/examples/ai-material-sample.pdf`、本文件，以及 `tests/ai-materials.test.mjs`、`tests/ai-materials-browser.mjs`、`tests/ai-material-fixtures.mjs`與 `tests/ai-questions.test.mjs`。
