# Phase 1.5：精選解析批次匯入

建立於 Phase 1（53c9a543）之上。沿用 `questions.explanation`、`explanation_status`、`explanation_version`；不需要 migration，不新增資料表、不呼叫 AI、不修改題目、選項、答案、圖片或作答紀錄。

## 管理員操作

1. 進入 `/admin/questions` 題目維護中心，展開「批次匯入精選解析」。
2. 下載 JSON 範例與 Schema。從現有題目清單取得正確的 **ID** 及答案，將範例資料全部換成實際核對過的內容。題號不是 ID。
3. 選擇 JSON →「上傳並驗證預覽」。此步驟只讀資料，不儲存。
4. 查看分類、題目摘要、題庫答案與解析預覽；勾選可匯入項目，確認核對後按「確認匯入並儲存草稿」。
5. 查看逐筆成功／失敗／略過結果。未勾選項目也會列入略過數量。
6. 在題目清單篩選「草稿」，選擇「查看／編輯」，沿用 Phase 1 人工核對與發布流程。

全部既有解析（包括草稿）均不接受批次覆蓋。要修改既有內容，請使用單題編輯。資料異常需修改 JSON 後重新預覽，不會自行補寫解析或猜測答案。

## JSON 合約

- 正式 Schema：`public/examples/featured-explanations.schema.json`。
- 下載範例：`public/examples/featured-explanations.example.json`（示意 ID 123 不代表已核對的正式題目，必須替換）。
- TypeScript：`lib/featured-explanation-import-input.ts`。

```json
{
  "explanations": [
    {
      "questionId": 123,
      "expectedAnswer": "C",
      "explanation": "### 核心考點\n\n請替換成已核對的實際解析。",
      "sourceReferences": []
    }
  ]
}
```

每批 1–50 筆；UTF-8 檔案上限 2 MiB，API request body 上限 3 MiB（包含簽章與選取資訊）。每筆解析含附加網址上限 20,000 個 UTF-16 字元，不得空白或含 NUL。最多 10 個來源網址，每個最多 2,048 字元，只接受有效 HTTP／HTTPS 網址、不含帳密。JSON Schema 無法完整表示跨列 ID 唯一性、UTF-16 長度、來源附加後長度或與資料庫的配對，後端會額外驗證。

`sourceReferences` 不建立新欄位，會以「參考資料」清單附加至 Markdown 末尾，預覽顯示的是實際準備儲存的全文；不開啟、不抓取網址。原始解析本身仍必填，不能僅靠網址充當解析。舊 API 及所有題目欄位保持相容。

`expectedAnswer` 接受單一大寫 A–E（相容現有選項欄位）；必須與資料庫經 trim／uppercase 的單一答案一致，且對應選項不為空。多答案、缺答案等題目會拒絕。本功能不讀取 Markdown 中的答案來修改原答案。

## 精確配對及預覽簽章

- 只查 `questions.id`，同時要求 `kind='exam'` 及 `question_sets.visibility='public'`。私人題庫、`ai_questions` 及錯誤題型不可寫入，也不回傳其內容。
- 同檔案重複 ID 的所有項目都拒絕，非只拒絕後面一筆。
- 可選 `questionFingerprint` 為 64 位小寫 SHA-256。可複製管理員預覽中的「題目指紋」；不是模型推測值。
- 指紋規則：UTF-8 `JSON.stringify` 下列陣列後 SHA-256：
  `['vetexam-exam-question-v1', Number(id), Number(question_set_id), question ?? '', option_a ?? '', option_b ?? '', option_c ?? '', option_d ?? '', option_e ?? '', answer ?? '', subject ?? '', question_number ?? null, image_data_url ?? '', exam_year ?? null]`。
  不做文字正規化，不依賴解析內容。
- 即使未提供指紋，也會對每個可匯入項目簽發 15 分鐘、綁定管理員身分／原始預覽內容／題目及解析版本的 HMAC token。使用現有 `BETTER_AUTH_SECRET`，無新金鑰。
- 寫入前重新驗證並比較簽章。預覽後題目、答案、圖片、題庫、解析或版本變更，或提交內容遭修改，均不採用舊預覽。

## API 與交易

`POST /api/admin/questions/explanation/import`，沿用 `requireAdmin`、`ADMIN_USER_ID` 及 session，後端拒絕非管理員與跨來源操作。

- 預覽：`{ "action": "preview", "input": { "explanations": [...] } }`。
- 儲存：`{ "action": "import", "input": { "explanations": [...] }, "selected": [{ "index": 0, "token": "預覽回傳簽章" }] }`。
- `index` 是檔案內的零起算位置，只用於選取；真正配對仍以 `questionId` 及伺服器重新驗證為準。
- 每批一次批量查詢；寫入於既有 `questionTransaction` 內鎖住選中的題目列，對題庫列持 shared lock 以維持公開範圍，然後一次批量 UPDATE。不鎖整張題目表或統計表。
- SQL 再次限制「公開國考、解析空值、草稿狀態」，只更新解析文字、草稿狀態及版本。兩個同時提交的請求會依列鎖依序檢查，後者看到已有內容後略過。
- 驗證錯誤的選中項目失敗，其餘合格項目可成功；已有內容／未勾選項目略過。資料庫執行失敗則整筆交易 rollback，全部嘗試寫入項目回報失敗，不回報假成功。
- 網路回應遺失可重新預覽；同檔案重送因已有解析而略過，不再增加版本或覆蓋。
- 不提供批次發布或刪除。若誤匯入，內容仍只有管理員可見，可用 Phase 1 單題編輯修正，確認後再發布。

## 驗證與部署

寫入測試使用 PGlite 記憶體 PostgreSQL，瀏覽器 API 攔截後交給真實 route/service SQL。測試不載入正式資料庫環境變數。

```powershell
# 先指定本機隔離測試工具安裝位置（不可改成正式 DB）。
$env:PGLITE_MODULE = '<local path>/@electric-sql/pglite/dist/index.js'
$env:PLAYWRIGHT_MODULE = '<local path>/playwright/index.mjs'
node --test tests/featured-explanation-import.test.mjs tests/featured-explanations.test.mjs tests/official-explanations.test.mjs
node tests/featured-explanation-import-browser.mjs
node tests/official-explanations-browser.mjs
```

涵蓋 20 筆新增、重複匯入、既有草稿／發布保護、ID／答案／指紋／欄位錯誤、權限、部分成功、過期及被修改的預覽、交易 rollback、reload、Markdown 與 320／375／768／1280px 顯示。Phase 1 回歸驗證草稿不公開、原有作答階段與題庫隔離。

僅 `lib/admin-question-http.ts` 做共用調整：可選 request body 上限，其他既有 API 預設仍為 64 KiB；超限訊息改為通用 JSON 資料過大。其他共用解析渲染、權限、作答及統計程式皆重用且不修改。

沿用 GitHub main → Vercel 部署，不執行 migration。回復程式可部署前一個已驗證版本；已匯入草稿仍是 Phase 1 原生資料，可由原介面繼續管理，不需刪資料或回復 SQL。

## 本次檔案範圍

| 檔案 | 用途 |
| --- | --- |
| `app/admin/questions/QuestionsAdmin.tsx` | 兩行整合既有維護中心入口與清單更新 |
| `app/admin/questions/FeaturedExplanationImport.tsx` | 檔案上傳、分類預覽、勾選確認、結果 |
| `app/api/admin/questions/explanation/import/route.ts` | 管理員預覽／匯入 API |
| `lib/featured-explanation-import.ts` | 格式、精確配對、簽章、交易寫入 |
| `lib/featured-explanation-import-input.ts` | 共用型別、限制及分類文字 |
| `lib/admin-question-http.ts` | 沿用有上限的 JSON body 讀取，新增可選上限 |
| `public/examples/featured-explanations.schema.json` | 正式 JSON Schema |
| `public/examples/featured-explanations.example.json` | 可下載格式範例 |
| `tests/featured-explanation-import.test.mjs` | 隔離 SQL／API 測試 |
| `tests/helpers/featured-explanation-import-fixture.mjs` | 隔離資料與真實 API 載入器 |
| `tests/featured-explanation-import-browser.mjs` | 桌面／手機操作驗收 |
| `docs/FEATURED_EXPLANATION_IMPORT.md` | 操作、合約、安全及回復說明 |

驗證結果：新增 8 項測試、Phase 1 既有 9 項及管理員／AI 題庫／PDF 匯入相關 19 項皆通過，共 36 項；3 項須外部資料庫的既有測試刻意停用，避免正式資料寫入。新增匯入流程及既有刷題／解析瀏覽器流程皆通過。曾遇本機 Turbopack 暫存測試路由快取錯誤，清理本工作目錄的 `.next/dev` 後重跑通過，未修改正式設定。

正式資料庫只做 READ ONLY 前置檢查：Phase 1 所需欄位已存在。正式站不執行匯入測試；真實教材內容正確性仍需管理員核對後才發布。
