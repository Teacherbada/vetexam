# 管理員人工章節分類 V1

基底：GitHub main `4989db2`。依使用者指定的 Project Constitution，只加入人工章節分類。

## 同頁使用

工具放在現有 `/pdf`「國考解析」頁底部，不新增管理頁。`app/pdf/page.tsx` 只新增元件 import 與掛載，原有函式、上傳、解析預覽、確認匯入、分批匯入及權限判定完整保留。

管理員選擇分類科目、題庫與「全部／未分類／已分類」，預設未分類；可閱讀題幹、A–D 選項（如有 E 也顯示）、答案及既有解析，從固定章節選擇後「儲存並下一題」。可略過，或從第一題重新查看。已分類模式可修改先前的章節。題號旁顯示唯一 ID 及題庫名稱，以區分不同題庫的相同題號。

分類進度依選定科目與題庫統計已分類／總題數、未分類數與百分比；全部題庫包含公開與私人題。私人題分類不改變可見性，不會因此進入公開刷題。

匯入完成後，利用現有 `currentQuestionSetId` 與科目自動選中剛匯入的題庫，管理員可在同頁接著分類。此為**先完成原匯入，再逐題補標籤**；不在 PDF 解析／匯入 payload 加入章節，也不重新匯入舊題。

## API 與資料保護

`GET /api/admin/questions/chapters` 讀分類進度及一題；參數為固定 `subject`、`status`，以及可選的 `question_set_id`、`after`（題目 ID）。使用參數化查詢、`ORDER BY q.id LIMIT 1`，儲存後以該 ID 繼續。到尾端不自動繞回，以免重複分類；可按從第一題重新讀取。

`PATCH /api/admin/questions/chapters` 僅接受：

```json
{"questionId":123,"chapter":"腫瘤","previousChapter":null}
```

GET 與 PATCH 都先呼叫現有 `requireAdmin(request)`，使用 Better Auth 伺服器 session 對照既有 `ADMIN_USER_ID`，訪客與一般使用者回 403。頁面沿用 `/pdf` 原管理員門檻，未通過者不掛載工具、不查分類資料。未建立新 admin system，未修改 Auth。

PATCH 沿用 `readAdminBody` 的 JSON、大小與來源驗證，以及 `questionTransaction` 的交易／timeout／rollback。拒絕額外欄位、無效 ID、空章節、任意章節名稱。先鎖住現有題目 row，從 DB 的 subject 驗證章節歸屬，與 `previousChapter` 比對；並行編輯衝突回 409，要求重新讀取。

唯一寫入 SQL：

```sql
UPDATE questions SET chapter=$1 WHERE id=$2;
```

沒有 INSERT、DELETE、重新匯入，也不更新 subject、ID、question_set_id、題號、題幹、選項、答案或解析。沒有新 schema／migration／mapping，無須 Neon SQL。未分類 NULL 保留，既有「全部章節」規則不變；公開題更新後，既有未快取的章節題數、刷題及搜尋讀取同一欄位。

`ChapterPicker` 增加可選 `emptyLabel`／`allowEmpty`，供管理工具顯示「請選擇章節」並禁止把「全部章節」存為分類；原刷題／搜尋的預設行為不變。六科仍只讀 `data/exam-chapters.ts`。

## 驗證

- 正式 Neon 唯讀確認：400 題、0 題已分類、chapter 為 nullable text；本次未修改正式題目。
- `npm run build`：成功。
- 全部 Node 測試：64 通過、11 個需外部配置的案例跳過、0 失敗。
- `ADMIN_CHAPTER_DB_TEST=1 node --test tests/admin-question-chapters.test.mjs`：3/3 通過。交易內暫存表驗證 NULL 分類、修改章節、分類佇列、進度與舊欄位逐欄不變；使用既有 quiz route 與 Neon SQL 編譯，確認公開章節題數增加、刷到同一 ID、改分類後移至新章節、NULL 舊題仍可刷。結束 rollback，不碰正式題庫。
- 新瀏覽器測試：真實 `/pdf` 頁搭配攔截 session／API／匯入 fixture，驗證訪客與一般使用者無工具、管理員可用、儲存下一題、失敗留在原題、已分類修改、進度、匯入後選中正確題庫及科目；320／375／768／1280px 無水平溢出。未建立真實帳號，未解析或匯入正式 PDF。
- 既有章節瀏覽器測試通過，確認共用選擇器預設行為未改。
- 新增程式、共用元件與新增測試的 ESLint 通過。
- 全專案 lint 仍有既存 1,700 errors／22,376 warnings，未擴大範圍修正。

## 範圍

新增：`app/pdf/QuestionChapters.tsx`、`app/api/admin/questions/chapters/route.ts`、`lib/admin-question-chapters.ts`、兩個 `tests/admin-question-chapters*` 測試及本文件。
修改：`app/pdf/page.tsx`（掛載工具）、`components/questions/ChapterPicker.tsx`（可選管理模式）。
沒有新增依賴或 AI；未修改會員、付款、登入、收藏、錯題、分析、首頁、管理員判定、PDF parser／upload 或原有未提交修改。使用者已授權將本次工具提交、推送並部署至正式網站；部署不需要 SQL，也不替正式题目指定章節。
