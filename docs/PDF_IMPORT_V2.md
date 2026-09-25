# PDF Import 2.0 reliability

## 基準與範圍

2026-09-25 執行 `git fetch origin`，遠端 main 為 `671903b4e538c130982205d6fbae5803c9ed7e17`（due review center）。原目錄 HEAD 是 `1292499f2c31d39467e8c76b0fcef02b2cb6eb7b`，有大量未提交修改，因此使用獨立 worktree `.worktrees/pdf-import-v2`、分支 `feat/pdf-import-v2`。未複製原目錄的應用程式修改。

本次只修改 PDF parsing、圖片配對、確認 UI、必要 import 欄位、PDF tests/docs 及 PDF 字型檔 tracing。不變更 DB schema、storage provider、套件宣告或 lockfile。

## 既有流程稽核

- `POST /api/pdf` 以 pdfjs-dist 取得每頁 text items、operator list。原程式按 PDF y 值合併文字行，插入頁碼標記後 regex 切題；寬鬆的題號 regex 可能把年份或數字段落當成題號。
- 原選項 parser 接受 A–E／數字等格式，但缺少至少兩個選項、題幹太短時直接 `return null`，整題消失。選項以出現順序推入陣列，漏掉 B 會把 C 移成 B。原 parser 不辨認答案，回傳空字串。
- 原 `hasImage` 只傳 boolean，與 image route 重新建立的 anchors 不一致。偵測區間甚至向前延伸到上一題，可能讓兩題都被標記。小圖／mask 在偵測與實際擷取使用不同閾值，造成偵測到圖片但擷取不到。
- `app/pdf/ImagePreview.tsx` 實際呼叫 `/api/pdf/images-v10`。2026-09-25 另以唯讀下載正式 `/pdf` 的 JS，確認 `/_next/static/chunks/2bg85ar_cbyv9.js` 包含此路徑。
- `images` 是仍保留的舊版本，較早的文字 anchor 沒有 x 座標合併能力；`images-v10` 加入合併文字行、重疊／水平碎片分組、pending PDF load。兩者有歷史上的第 40 題特殊補救及找到圖片便停止跨頁搜尋的限制。未取得 production access logs，不能證明舊 route 無外部呼叫，所以不刪除。
- 原前端顯示 `imageDataUrls` 全部圖片，卻呼叫 `onImageLoaded(nextSrcs[0])`，導致只保存第一張。原 callback identity／loaded-key guard 也可能使 effect 被取消後不再通知父層。
- 目前 wizard 寫入 `/api/question-sets`，分批則用 `/api/question-sets/batch`。`/api/pdf/confirm` 是另一個保留的舊 route，只存 A–D、沒有圖片，並非目前前端的儲存路徑；本次不刪除或改動。
- 圖片是 PNG/data URL，存在 `questions.image_data_url` TEXT，公開題目 UI 直接當作 `<img src>`。不是 filesystem/object storage URL。
- `unpdf` 在 dependencies 中，但目前 main 的這條流程沒有 import 它。沿用 pdfjs-dist 4.10.38、canvas 0.1.100，不引入第二個 PDF runtime。

## Text extraction 與跨頁切題

`lib/pdf-geometry.ts` 將文字 transform 轉為 viewport 左上原點座標，保留 x/top/bottom，依行與 x 合併文字。`lib/pdf-layout.ts` 在所有頁面資訊就緒後處理文字，題目含穩定暫存 `id`、可修改的 `questionNumber`、start `pageNumber`、`endPage`、`top`、`bottom`、`rawText`。

只有行首符合明確題號標記（`1.`、`1、`、`(1)`、`1)` 等）才切換題目，不因換頁結束。下一頁的 C/D 及題幹延續仍進入前一題。A–E、全形Ａ–Ｅ、括號與同一行的多個選項按字母放入固定槽位；缺 B 保留空 B，不位移其他選項。

`stripMargins` 只檢查頁面上下 12% 的候選文字：相同文字、相近正規化位置，至少出現於兩頁且達全份頁數的一半才去除。常見純頁碼及「第 n 頁 共 m 頁」也只在 margin 移除。不 hardcode 年份、科目或某張考卷。

答案只從獨立且明確的 `答案：A`／`正確答案：A`／`Answer: A` 行取得；沒有或互相衝突時為 `null`。不讀題意猜答案、不生成詳解。確認 UI 將 null 顯示為「未知／留空」，既有 DB 匯入契約仍使用空字串代表未知。

每頁文字／operator 擷取分別容錯；整頁不可讀時回傳 page warning。已成功解析的其他頁／題不清空。缺選項或空題幹仍保留一題與 rawText，交由人工修正。

## Image extraction 與 spatial association

每頁只讀一次 operator list，追蹤 save/restore、transform、form transform，將 embedded raster、mask、repeat（含 typed-array positions）及可安全取得 bounds 的 painted vector path 轉成 region。

Region 保存 `id/page/x/y/width/height/source`。來源分為 raster、drawing、重疊混合區域 rendered。重疊碎片／緊鄰同寬垂直碎片合成完整 bounds；不把獨立並排圖強制合併。只對已 paint 的 path 擷取，過小或整頁背景型 drawing 不自動当作圖。

配對在 memory 使用題號到下一題號的頁面區間；同頁圖只屬於一個區間，不給所有同頁題目。跨頁區間可接收下一頁下一題號之前的圖。圖片跨越區間、太接近下一題（24 pt）、drawing 或首題上方的最近區域（120 pt 以內）標為「圖片不確定」。以區間中點決定初始歸屬，人可改配。無對應題目且離首題過遠的裝飾圖不自動掛題。

V2 的 ImagePreview 把這份 `regions` 送到現有 `/api/pdf/images-v10`，因此不再使用第二套題號推測。未帶 regions 的舊呼叫仍維持原行為，包括歷史補救；V2 不走第 40 題特例。用原頁 render 保留遮罩、標註與色彩，再依完整 bounding box 加 12 pt margin 擷取 PNG。render scale 從 1.5 提升到 2，無有損壓縮或圖片內裁切。

每個 PDF/page 的 render 有 pending promise 合併並行請求及既有 bounded LRU cache，最多六張 render 頁面、兩份 PDF、80 筆圖片結果。不是每題 render 整份 PDF；只 render 實際含該题圖片的頁面。cache eviction 或另一個 serverless instance 可以重新 render，這不是永久跨 request 快取保證。單頁超過 24M pixels 不降畫質硬縮，改提示手動補圖。

## 一題多圖與既有 DB 相容

評估 JSON array 存入 image_data_url 會破壞現有 img src；新增 question_images table 則需同步修改公開題目查詢／顯示，超過本次範圍。因此採 preview 多圖陣列，正式儲存時將所有保留圖片按順序、原像素大小、16px 間隔合成單一無損 PNG。公開題目 UI 不需修改，所有圖片均保存。

每張 preview 圖可保留、移除、改配、上移；也能追加手動圖片。移動後兩題都需要重新確認。合成有 32M pixels／32000px 高度上限，超過時保留原 preview、顯示錯誤且不以舊圖儲存。正式 payload 只送合成 PNG，不重複送原始多圖陣列／座標／rawText。

人工修改題號透過 optional `questionNumber` 保留到一般及分批匯入。未傳這個欄位的既有呼叫維持原本依陣列／批次順序編號。其他 import 欄位與 file_hash／duplicate SQL 不變；原 PDF bytes 的 SHA-256 不受圖片擷取／排序影響，重試不能繞過 duplicate protection。

## Deterministic confidence

由 100 開始扣分，最低 0，不使用 LLM：

| 條件 | 扣分 |
| --- | ---: |
| 題號不合法（1–999 整數） | 25 |
| 題幹少於 2 字／超過 6000 字 | 30 |
| 少於四個／超過五個選項或空選項 | 25 |
| 沒答案 | 20 |
| 答案不在實際非空選項內 | 25 |
| 題號不連續／重複 | 10 |
| 選項序列不是 ABCD 或 ABCDE | 15 |
| 圖片不確定／文字提到附圖卻沒偵測到 | 20 |
| parser/page warning | 30 |
| 跨頁（仍成功延續） | 5 |

≥90 正常、70–89 黃色、<70 紅色。分數是格式可靠性提示，不是醫學正確性機率。人工修正文／選項／答案後會重算格式分數；原 extraction 警告仍可見，人工確認是獨立狀態，不假造 100 分。

## Manual review / fallback

既有第 2 步新增「需要確認」，可按缺選項、沒答案、圖片不確定、題號不連續、跨頁、parser 警告跳題。可編輯題號、題幹、選項、答案；年份與整份題庫科目沿用返回第 1 步修改，章節沿用第 3 步。

低 confidence 不使 parse request 失敗，不丟棄其他題。使用者逐題修正並「已人工確認」後進儲存；答案可保持未知。既有儲存 API 仍要求完整題幹及至少 A–D，未完成者留在 preview 繼續修正或由使用者刪除，不做背景靜默丟題或繞過驗證。這不是把 96 題寫 DB、另外 4 題持久化成新工作佇列的改版；本次 review queue 存在目前 wizard。

圖片失敗可獨立重試、手動補圖／移除，不重傳解析結果。伺服器 render 失敗不清空題目；修正期間先清空合成欄位，避免把舊圖片匯入。刷新頁面不保留 preview，沿用原流程限制。

正常 PDF 解析後，此頁選擇既有「稍後分類」模式，使 extraction/import 預設不觸發 AI。既有 AI 章節分類元件／service／API 完全未改，使用者仍可自行切換；若主動另選 AI 分類，那是既有功能的 token 用量，非此 parser 所產生。本次沒有新增 LLM／Vision／OCR SaaS／embedding／RAG；預設 PDF Import 為 0 AI token。

## Tests 與環境

- `node --test tests/pdf-layout.test.mjs tests/pdf-batches.test.mjs tests/pdf-page-auth.test.cjs`：parser fixtures、真正 PDF.js + canvas fixture、真實 route handler（mock auth/DB）、兩個 concurrent 圖片請求只 render 一次、原 file_hash、批次 optional 題號與原有 auth／capacity checks。
- `node tests/pdf-review-browser.mjs`：需 Playwright/Edge，可設 PLAYWRIGHT_MODULE、TEST_BASE_URL；mock APIs，不寫 DB。320/375/768/1280 寬度，review queue、修正、圖片改配／排序、所有圖片合成儲存，確認沒有 AI requests。
- `node tests/pdf-batches-browser.mjs`：將原來過時的單頁按鈕定位更新為 main 的三步 wizard；保留 capacity、手機、overlap、sequential batches、failure retry/idempotent import ID、413 測試。
- `npx tsc --noEmit`、`npm run build`。本機 build 使用不可連線的 fixture DB URL，避免 production 資料；Better Auth schema probe 會報連線提示，build exit code 仍為 0。這不代表已驗證 production DB schema。
- 不啟用 `PDF_BATCH_DB_TEST`，未對正式 DB 建表／寫題／刪題。DB integration case 明確 skip，沒有把 skip 算成 pass。
- main 的 package.json 與 lockfile 中 canvas optional Linux 套件版本不同，`npm ci` 失敗。驗證以 `npm install --package-lock=false` 安裝宣告套件；實測 pdfjs-dist 4.10.38、canvas 0.1.100、unpdf 1.8.1。未新增 dependency／改 lockfile，此既有 clean-install 問題仍待獨立處理。

## 尚未完整處理的 cases

- 純掃描圖片的 OCR、手寫答案、無明確題號 delimiter、多欄混排、數字／圈號選項、獨立答案對照表；不猜测這些內容。
- 旋轉頁面使用 viewport transform，但直書或單行混合旋轉文字沒有完整 reading-order 支援。
- 非重複的 header/footer、很長的共用題幹、多題共用一張圖、圖片上方屬下一題的特殊版面可能需人工改配。
- Vector 只取可取得 bounds 的 painted paths。由許多短線／小圖元組成、沒有整體 bounds 的圖表可能漏偵測；保留文字附圖提示與手動補圖路徑，不承諾所有繪圖完整自動化。
- 頁面完全損毀時無法憑空建立未知題號；以 page warning 明示需補題。整份 PDF 無可辨識題號仍回傳明確錯誤。
- 多圖 DB 僅保存合成 PNG，圖片座標、信心與 review 狀態不是新增持久化 schema；目前不提供重新整理後續傳或單張圖片 DB 編輯。
- 圖片失敗重試仍重新送原 PDF（既有傳輸方式）；本次沒有新增永久上傳 session/object storage。

## Production smoke 與未修改功能

最終本機結果：30 個 node tests 中 29 pass、0 fail、1 DB integration skip；兩套瀏覽器測試均 pass；TypeScript pass；production build exit 0。新增 parser/geometry 與圖片元件 scoped lint 為 0 errors、2 個原生 img 顯示建議（data URL 圖片維持原生 img，未做有損最佳化）。驗證截圖與 build log 放在 worktree 的 `.tmp/pdf-review/` 與 `.tmp/pdf-build.log`，不提交測試產物。

2026-09-25 對 `https://vetexam-tw.vercel.app` 做 GET-only smoke：`/pdf` 200；`/api/pdf`、`/api/pdf/images`、`/api/pdf/images-v10`、`/api/pdf/confirm` 均 405（POST-only 的預期回應）。另外確認正式前端 bundle 使用 images-v10。沒有 production 匯入，沒有部署此次分支；這項 smoke 僅證明目前正式頁面與 route 存在，不能取代新版本部署後登入驗證。

未改 Homepage、Study Plan、FSRS、Due Review、Weakness analysis、Coach、Daily task、Custom plan、Notes、Favorites、Wrong questions、Admin 其他功能、Auth、Subscription、PRO、Billing、AI chapter classification implementation、Question statistics、Existing public question UI、全站 styling。

## 變更檔案

| 檔案 | 用途 |
| --- | --- |
| `app/api/pdf/route.ts` | 頁面幾何、容錯、review metadata |
| `lib/pdf-layout.ts` | 切題、頁首尾、跨頁、配圖、confidence |
| `lib/pdf-geometry.ts` | 文字與 operator 座標 |
| `app/api/pdf/images-v10/route.ts` | 明確 regions、並行 render cache、圖片品質 |
| `app/pdf/page.tsx` | review queue、題號／答案、0-token default、圖片操作 |
| `app/pdf/ImagePreview.tsx` | regions、多圖 callback、獨立重試 |
| `app/pdf/ReviewImages.tsx` | 多圖合成、移除／改配／排序 |
| `lib/import-batches.ts` | optional 人工題號傳输 |
| `lib/pdf-batch-import.ts` | 分批題號驗證與保存 |
| `app/api/question-sets/route.ts` | 一般匯入保存 optional 題號 |
| `next.config.ts` | 僅 PDF endpoints 的標準字型 tracing |
| `tests/pdf-layout.test.mjs` | parser／geometry／真實 PDF route fixtures |
| `tests/pdf-review-browser.mjs` | wizard／手機／多圖 UI |
| `tests/pdf-batches.test.mjs` | 題號與 preview 欄位隔離回歸 |
| `tests/pdf-batches-browser.mjs` | 原批次回歸適配 main 三步 UI |
| `docs/PDF_IMPORT_V2.md` | 稽核、實作、測試、限制 |
