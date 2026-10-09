# 國考 PDF 匯入：快速檢查工作台 V1

基準：`Teacherbada/vetexam` main `b9b581e0ae05bf6db2a6ddd146b9c691aa23838e`。
分支：`feat/pdf-review-workbench-v1`。僅建立 Draft PR，待 Preview 驗收後由使用者決定是否合併。

## 使用方式

1. 在 `/pdf` 選科目、年份與 PDF，依原流程解析。
2. 「檢查解析結果」新增快速工作台，預設只列「需要確認」，包含明顯異常；可切換全部、圖片題、已確認。
3. 點題號或表格列，下方並排顯示原 PDF 與解析結果；手機改為上下排列。PDF 依 `pageNumber` 使用本機 blob URL 的 `#page=N` 跳頁，跨頁題提示結束頁。
4. 「標記已人工確認」更新原本 `reviewed`，待確認列會移除，但保留當前對照便於檢視。修改內容／答案／圖片後，沿用原本流程重新取消確認。
5. 「展開完整編輯」開啟原 accordion、捲動到題目並移動鍵盤焦點。圖片預覽、上傳、移除、改配、多圖排序、分類與最終匯入沿用原流程。

工作台只列「圖片候選」，不保證圖片存在或裁切正確。所有自動通過題仍可檢視／編輯。格式分數不等於內容正確率。

## 狀態

使用既有 `reviewStatus()`／`assessQuestion()` 重新計算編輯後題目的格式分數及 warnings，沒有新增 scoring 或 parser。

- 已人工確認：`reviewed` 為 true。
- 明顯異常：未確認且分數 <70，或有缺選項、題號不合法、題幹長度異常、答案不在選項內等既有 warning。
- 自動檢查通過：未確認、分數 >=90 且沒有 warning。
- 需要確認：其餘未確認題。

五張統計卡為全部題目數、自動檢查通過、需要人工確認、明顯異常、圖片候選；畫面註明需要人工確認包含明顯異常，圖片候選可與其他狀態重疊。

## 檔案範圍

修改：`app/pdf/page.tsx`，小範圍接入新元件、將原統計移到工作台、調整圖片候選／格式分數文案，以及完整編輯的焦點。

新增：

- `app/pdf/ImportReviewWorkbench.tsx`：統計、篩選、表格、選題、PDF 與解析結果對照。
- `app/pdf/import-review.ts`：既有 assessment 的狀態標籤對應。
- `app/pdf/import-review.module.css`：使用現有 token 和按鈕樣式，桌面並排、手機堆疊，表格在自身區域水平捲動。
- `tests/pdf-workbench.test.mjs`、`tests/pdf-workbench-browser.mjs`：狀態邊界與互動／網路次數測試。
- 本說明。

未修改 `app/api/pdf/route.ts`、`lib/pdf-layout.ts`、`ReviewQueue`、`ReviewImages`、`ImagePreview`、`images-v10`、DB、Auth、章節分類、首頁或其他題庫頁面。

## 效能與資源

工作台只讀取本次解析的題目資料，不發出 fetch。選題之前沒有 iframe；選題後才建立原 File 的 object URL，換檔或離開對照時 revoke。沒有轉成 base64、重新上傳、第二次 parser、逐頁 canvas render 或全圖片擷取。

Native PDF viewer 自己按瀏覽器能力載入原文件；不是應用程式預先 render 每頁。瀏覽器可能不支援嵌入預覽或忽略 `#page`，因此提供「在新分頁開啟原 PDF」連結與明確頁碼。缺少頁碼時顯示說明，避免錯誤指向其他題目的頁面。

原 ImagePreview 的 IntersectionObserver、最多兩個 request、request/image cache，以及 images-v10 的 PDF/page/render/image cache 完全保留。

本機 Edge 隔離測試結果（API 回應為 fixture，不代表正式 PDF 解析時間）：

- 六題：送出至工作台約 153 ms。
- 200 題：送出至工作台約 343 ms；待確認 40 題，切換全部可看到 200 題。
- 每次使用者明確送出只發生一次 `/api/pdf`。
- 工作台篩選／對照／標記期間圖片擷取 0 次；进入完整編輯後才發生 1 次。
- 200 題總覽也沒有追加圖片請求；AI request 0 次。

沒有量測真實大型國考 PDF 前後 p95，不能宣稱上述數字是正式解析時間。Server parser 完全未變，新增 UI 不位於解析 API 的執行路徑。

## 驗證

`node --test tests/pdf-workbench.test.mjs tests/pdf-layout.test.mjs tests/pdf-page-auth.test.cjs tests/pdf-batches.test.mjs tests/chapter-classification.test.mjs`：39 passed、0 failed、1 skipped（PostgreSQL 整合測試沒有設定測試 DB）。其中既有真實 PDF fixture 驗證 PDF.js 解析、圖片 region 與並行 rendered page cache。

本機瀏覽器測試（全部使用隔離 API fixture，不寫入正式資料）：

- `tests/pdf-workbench-browser.mjs`：預設／各種篩選、統計、狀態、A–E、頁碼連結、跨頁／無頁碼、人工確認、編輯失效、accordion 焦點、手動上傳、移除、blob cleanup、200 題總覽；320／375／768／1280px 沒有頁面水平溢出。
- `tests/pdf-review-browser.mjs`：既有 review queue、完整編輯、圖片改配、順序與無損多圖合併、fileHash、mock 匯入；320／375／430／768／1024／1280／1440px 通過。
- `tests/pdf-batches-browser.mjs`：容量預檢、分批範圍、失敗重試、同一 import ID、完成匯入、413 錯誤保留題目。

`npm run build` 與 `tsc --noEmit`：成功。Build 使用 placeholder DB/auth 環境，沒有使用正式密鑰。

`npm run lint`：既有 73 errors、8 warnings 維持不變；新增檔案均無 lint 問題。沒有混入無關 lint 修復。

## Preview 人工驗收

使用管理員帳號在 Preview 上傳實際國考 PDF，確認瀏覽器內建 viewer 能顯示第 N 頁，特別抽查跨頁、圖片候選及掃描 PDF 限制。測試真實資料保存時使用可辨識的測試題庫；Preview 如共用 Production DB，請先確認資料隔離。此次自動測試沒有建立正式題庫或登入新帳號。
