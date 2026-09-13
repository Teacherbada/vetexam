# 國考題章節分類 V1

基底：GitHub main `e3d637cea9ed712f262b9a176f8cf232fc1d428b`，與開發前 HEAD 一致。
遵守本次使用者提供的 Project Constitution；登入、付款等原有未提交變更未修改。

## 資料庫與部署

已唯讀確認 Neon：科目為 `questions.subject`；年份為 `question_sets.exam_year`，`questions` 原本沒有章節欄位。
經使用者授權，已於 2026-09-13 套用正式 Neon migration，再進行程式部署：

```sql
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS chapter text NULL;
```

沒有 default、backfill 或題目 UPDATE；舊題保持 NULL，後續既有匯入省略此欄位時也維持 NULL。
套用後已確認欄位為 nullable text，題數仍為 400，已分類題數為 0。其他環境部署前也需先完成 migration。

`chapter` 儲存固定設定中的完整章節名稱，例如「腫瘤」，與 `questions.subject` 一起識別分類。
病理「通論／各論」是固定呈現群組，不存入 chapter 字串。不把群組與章節拼成階層路徑，未來可另加子章節／topic 欄位，本次不實作多層 taxonomy。

## 固定章節與介面

`data/exam-chapters.ts` 集中管理六科章節、順序、病理群組與科目／章節驗證。
六科章節數依序為 16、13、10、3、1、5，完全採本次指定內容。
普通疾病學只有三個第一層章節；傳染病學只有「傳染病學」。

共用 `ChapterPicker` 沿用 study-button 與既有色彩／圓角／focus 樣式，以可展開清單提供完整換行。
選項永遠從固定設定讀取，不從題庫取 DISTINCT，也不因 0 題隱藏。
兩個入口切換科目時都重設「全部章節」。設定頁沿用既有「符合條件共有 X 題」；不新增每個選項的題數統計。

## 既有資料流程

- `/subjects`：既有多組條件增加可省略的 `chapter`，連同科目、年份陣列、題數傳入原 `/questions` 頁。
- `/api/quiz?scope=public`：每組先驗證章節屬於科目，非固定章節／錯科章節回 400；指定時才加入參數化 `q.chapter = ...`。章節省略、NULL、空字串皆不加篩選，保留舊題與既有排序、題數、去重及單題入口。
- `/api/quiz?scope=public&settings=1&chapters=1`：保留舊 `availability`，額外回傳公開題的 `chapterAvailability`（科目／年份／章節題數）；沒有 `chapters=1` 時回應不變。題數不是 taxonomy 的來源。
- `/questions/search`：既有 GET 表單、URL、分頁加入 `chapter`；查詢依科目及既有年份規則組合章節條件。年份仍支援既有民國／西元匹配；刷題仍使用原年份多選方式。
- 不新增資料寫入 API、不修改既有題目、不加入自動分類。

## 驗證

- `npm run build`：成功，包含 TypeScript 與 37 個靜態頁產生。
- `node --test tests/*.test.mjs tests/*.test.cjs`：62 通過、10 跳過、0 失敗；跳過案例需要外部 DB／供應商測試配置。
- `CHAPTER_DB_TEST=1 node --test tests/exam-chapters.test.mjs`：4/4 通過。實際 PostgreSQL 暫存表驗證 migration 可重跑、NULL 舊題、組合條件、零題、私人隔離、去重與統計；結束 rollback，未修改正式題庫。
- 本次 TS／TSX 與測試檔的 ESLint 通過。
- `npm run lint`：失敗，既存 1,700 errors、22,376 warnings；與 `QUESTION_SEARCH_V1.md` 紀錄一致，不擴大修改範圍。
- `tests/exam-chapters-browser.mjs`：Edge headless 搭配 build 後本機服務與 UI fixture 通過。涵蓋六科清單、病理分組、切科重設、章節與年份題數、全部章節、零題空狀態、刷題 URL、搜尋 GET 表單；320／375／768／1280px 無水平溢出，無 page errors。
- UI 測試使用攔截的設定／刷題資料，搜尋驗證表單送出參數；實際 SQL 另由 PostgreSQL 整合測試驗證。沒有將正式題庫分類以供測試，也未測實體 iOS／Android。
- 截圖：`.tmp/chapter-artifacts/settings-375.png`、`.tmp/chapter-artifacts/search-375.png`。

## 刻意未修改

Auth、登入註冊、會員訂閱、Payment、PRO、PDF 上傳／解析、收藏、錯題、分析、首頁、管理員權限、題幹、答案、解析，以及非公開刷題分支全部保留。未改動原有未提交檔案，未新增依賴、AI、分類寫入介面或下一階段功能。
