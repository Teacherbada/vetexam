# AI 半自動章節分類 Phase 1

## 範圍與操作

整合既有 `/pdf`、`/manual`、`/pdf/manual` 頁面；沒有新增頁面或分類入口。保留 `/pdf` 原本的既有題目分類工具，以便日後修改已儲存的章節。

匯入時提供三種模式：

- **AI 自動分類（推薦）**：解析／輸入完成後按「開始 AI 章節分類」，或第一次按儲存啟動分類。第一次分類後一定停在原頁供檢查，再按儲存才寫入。低信心需接受建議、選擇官方章節或暫不分類；高信心預設收合，可展開修改。
- **整份題庫指定相同章節**：全題套用選定官方章節，不呼叫 AI。
- **稍後分類**：全題 `chapter = null`，不呼叫 AI。

分批 PDF 匯入也使用同一份已確認分類結果，不在每個儲存批次重新呼叫 AI。題幹、選項、答案、解析、題序或科目變更會讓既有分類失效；圖片載入不影響文字分類。AI 不會修改題目、選項、答案或解析。

兩個既有手動頁原本呼叫不存在的 `/api/manual-question-set`，本次改接現有 `/api/manual-questions`，同步傳送科目及章節。手動匯入保留 PRO 私人題庫能力，管理員可建立公開或私人題庫；AI endpoint 僅限管理員。非管理員可使用同章節或稍後分類。

## API 與設定

`POST /api/admin/questions/classify`

```json
{
  "examSubject": "獸醫病理學",
  "questions": [{
    "question": "題幹",
    "options": ["甲", "乙", "丙", "丁"],
    "answer": "B",
    "explanation": "既有解析"
  }]
}
```

回傳 `results` 陣列，每題含 `suggestedChapter`、`confidence`、`secondChoice`、`reason`。分類 API 不寫入資料庫。

伺服器環境設定：

```dotenv
OPENAI_API_KEY=由部署環境安全提供
OPENAI_CHAPTER_MODEL=gpt-4.1-mini
```

`OPENAI_CHAPTER_MODEL` 可省略。沿用 `ADMIN_USER_ID`、既有登入與資料庫設定；不更改登入或訂閱實作，不新增 dependency。金鑰不傳入瀏覽器。未設定金鑰時仍回傳未分類結果，匯入不受阻。

使用 OpenAI Responses API 與 strict JSON Schema，`store: false`。格式依 [OpenAI Structured Outputs 官方文件](https://developers.openai.com/api/docs/guides/structured-outputs)。每批最多 20 題、題目內容合計 24,000 字元；題目較長時拆成較小批次。單題超過預算不截斷，改保留未分類。這是即時多題批次呼叫，並非非同步 OpenAI Batch API。Provider timeout 45 秒，瀏覽器單批 timeout 55 秒；不自動重試以避免重複費用。

傳送科目、官方章節、題幹、A–D（存在 E 時亦傳送）、正確答案、既有解析。要求以主要考點分類，跨章節提供第二候選，題目內指令只當資料。confidence 是模型自評、**不是經校準的正確率**；`>= 0.90` 歸高信心，`< 0.90` 且有建議時需人工確認。

## 章節驗證與失敗處理

唯一章節來源仍為 `data/exam-chapters.ts`，UI、prompt、JSON Schema enum 與寫入驗證共用此來源。後端驗證主／第二章節的精確名稱及科目歸屬、confidence 數值範圍、理由長度，按每題 ID 對應，不依模型回傳順序。未知章節、重複／遺漏 ID 或非法結果只讓對應題目未分類。

金鑰缺失、HTTP 錯誤、timeout、拒答、不完整 JSON、截斷回應均回退為 null。單批失敗不丟棄其他成功批次。畫面提供手動選擇或保留 null 的機會；不因 AI 失敗回滾題庫。一般 PDF、分批 PDF 與手動寫入端皆再次檢查合法章節，拒絕非法字串後才開始寫入。

## Schema 與相容性

2026-09-21 唯讀檢查目前 DB：`public.questions.chapter` 已存在，型別 `text`、允許 NULL。現有 migration 為 `migrations/20260913_exam_chapters.sql`。本次 **沒有新增 migration、欄位或回填舊資料**；沒有修改 `question_sets` schema。實際 DB 欄位清單沒有 `question_sets.chapter`。

只保存最終人工選擇／接受的 `questions.chapter`；高信心未逐題確認者保存 AI 建議，失敗／稍後分類者保存 NULL。confidence、reason、secondChoice、reviewed 僅存於本次匯入前端狀態，不額外加 metadata 欄位。舊 API 請求未提供 chapter 時仍以 NULL 儲存；舊分批 staging 請求維持原 payload 結構及重試雜湊，不強制加入新欄位。

## 修改檔案

- `app/pdf/page.tsx`、`app/pdf/BatchImportPanel.tsx`：接入分類、確認與分批儲存。
- `app/manual/page.tsx`、`app/pdf/manual/page.tsx`：官方科目、同一確認元件、修正原有失效 API 連結。
- `components/questions/ImportClassification.tsx`、`components/questions/useImportClassification.ts`：共用模式、確認 UI、狀態與批次請求。
- `app/api/admin/questions/classify/route.ts`：管理員分類 endpoint。
- `lib/chapter-classification.ts`、`lib/chapter-classification-service.ts`：共用驗證、批次預算、provider 呼叫與回退。
- `app/api/question-sets/route.ts`、`app/api/manual-questions/route.ts`、`lib/import-batches.ts`、`lib/pdf-batch-import.ts`：分類驗證、傳遞與寫入。
- `tests/chapter-classification.test.mjs`、`tests/chapter-classification-browser.mjs`：新增分類測試。
- `tests/pdf-batches.test.mjs`、`tests/pdf-batches-browser.mjs`、`tests/admin-question-chapters-browser.mjs`、`tests/pdf-page-auth.test.cjs`：既有測試適配與相容性驗證。
- 本文件。

沒有修改首頁、subjects、刷題、登入、訂閱系統、favorites、wrong、learning plan、國考教練或既有視覺樣式檔。上述區域原有未提交變更保留，本次未加以改動。新增 UI 沿用 `app/pdf/pdf.module.css` 的 card、button、status、focus 與 responsive 規則。

## 驗證

- `npm run build`：通過。
- `npx tsc --noEmit`：通過。
- 新增程式與測試的 ESLint：通過。修改範圍 lint 仍有原版本既存的 3 errors / 2 warnings（PDF 頁的 effect、any、img 與題庫 API 的 any）；已用 `git show HEAD:<file>` 比對，沒有新增 lint 問題。
- 23 項單元／API／PostgreSQL／登入顯示測試：全部通過，沒有跳過。DB 測試使用隔離 schema 或暫存表並在 finally 回滾；確認不同章節、人工章節、NULL、舊題目與批次重試。
- 分類瀏覽器測試涵蓋同章節不呼叫 AI、多章節、高／低信心、人工修改、API 故障、部分批次成功、NULL 回退、編輯後分類失效、兩個手動入口，以及 320/375/768/1280px 排版；已檢視手機與桌機截圖。
- 既有 PDF 分批匯入與既有題目章節分類瀏覽器回歸測試均通過，包含容量限制、批次重試、權限、篩選及匯入後題庫銜接。
- 本機未設定 OpenAI 金鑰，尚未執行真實模型準確率或付費 API 連線測試。測試使用可重現回應，不代表獸醫分類準確率已達 90%。

本次只實作 AI 半自動章節分類 Phase 1，整合現有匯入流程；不包含其他既有未提交工作。

## 正式發布

使用者於 2026-09-21 授權直接發布正式網站。發布基準為最新 GitHub main `8ed5915163f88739af83ed4481046341ceeea73b`，以獨立工作目錄僅加入上列 20 個功能／測試／文件檔案，保留 main 的首頁及 PDF 圖片修正。

發布副本 production build 通過；另外執行 20 項非 DB 測試全部通過，3 項 DB 測試此輪未重跑（實作驗證時均已通過）。既有 lockfile 導致 `npm ci --offline` 報 canvas optional dependency 不一致，因此本機乾淨副本 build 使用原工作區已安裝的依賴，沒有更改 dependency 或 lockfile；Vercel 的實際安裝／建置狀態需於發布後確認。

正式站：`https://vetexam-tw.vercel.app`。AI 實際推論仍需 Production 環境提供有效 `OPENAI_API_KEY`，不可把密鑰提交到 repository。
