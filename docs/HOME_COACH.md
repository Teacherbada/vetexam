# 國考教練首頁整合

## 基準與保護範圍

2026-10-17，GitHub `Teacherbada/vetexam` main：`0e96151572670bd421289db2bf478335ff7fd4ce`。根工作目錄有既有未提交修改，完整保留；本次在 `.worktrees/home-coach` / `feat/home-coach` 工作。修改前已讀完整首頁、HomeLayout、教練任務、作答／學習摘要與此版本 Next.js server/client、headers、route handler 文件。

首頁原始預設順序為：今日目標、到期複習、國考倒數、選擇題庫、學習進度、章節題量、本週錯題、功能介紹、學習成就。使用者的 `vetexam.home.layout.v1` 排序及隱藏設定不變。原本主介紹、插圖、學習狀態、介紹區及其他卡片相對順序全數保留。

## 行為與操作

- 訪客、無計畫、自訂計畫：不插入任何卡片、placeholder 或額外間距。
- 已選國考教練：在原主介紹／插圖之後、今日學習狀態之前，插入「今日國考教練」。顯示三個分項、實際已答／未答、今日總練習及指定複習進度。
- 「繼續練習」直達 `/study-plan/daily?task=weakness|review|challenge` 的第一個未完成分項；精簡模式直達 `?task=busy`。各分項亦可直接進入。保留既有單選作答及解答揭露流程。
- 完成精簡版時僅顯示「今日精簡訓練完成」，正常計畫進度另列。完成完整任務後可查看既有成果與下一步建議。
- 初始資料不足時，沿用 `/study-plan/diagnostic`，不捏造弱點或題數。題目不足時顯示實際安排數。
- 「調整計畫」連回 `/study-plan`。切回自訂模式後，重新進入首頁或返回視窗時卡片消失；既有作答與每日任務仍保留。現有教練沒有獨立 pause 狀態，本次沒有新增另一套暫停設定。
- 登出／帳號改變時，資料僅能對應已確認身份；錯誤身份或失效登入不顯示前一帳號資料。沒有跨帳號 cache 或新 localStorage。

## 實作與資料語義

原 `app/page.tsx` 完整移至 `app/Home.tsx`，只增加卡片 import、prop 及插槽。新的 page 是薄 server wrapper，在初次 HTML 就確認身份及讀取摘要，避免 client 登入讀取完成後才插入整張卡。既有 homepage CSS、文字、連結及卡片內容未改。測試會逐字比對移動前後的原始首頁內容。

`GET /api/study-plan/home` 僅讀取，身份只取 Better Auth session，不接受客戶端 userId／日期。`POST` 只對已啟用教練且今日任務尚未建立者，呼叫既有 `ensureDailyTask`；沿用每日唯一鍵、計畫列鎖、同交易及既有分配規則，不另建排程器。回應 `private, no-store`，不傳回題目、答案鍵或解析。

三種數字不混用：

1. 今日總練習：台北當日、公開國考題的 practice_attempts + 已答 diagnostic_items。
2. 教練任務：今日 daily_task_items 連結之 session／position 的實際作答。
3. 指定複習：今日 review 分項（舊任務則使用 follow_up）的實際作答。

自由練習原本就寫入 practice_attempts 並供近期教練弱點分析使用。本次不修改 writer、計分或排程。自由練習即使題目 ID 相同，也不是該任務 session 的作答，不抵扣任務；相同作答 event_id 重送仍由原本唯一鍵去重。AI／私人題不計入新卡片的國考總量。

## 效能與失敗行為

- 無 cookie 訪客不呼叫身份／資料庫。無教練帳號新增一次資料 SELECT；已有任務的教練摘要為兩次固定 SELECT，不逐題查詢、不傳完整歷史。
- 此數量不包含 Better Auth 查詢及 transaction 控制語句。今日總量使用既有日期索引，有日期邊界，沒有掃描所有歷史作答後傳回前端。
- 首頁改為 request-time rendering，不再是完全靜態首頁。伺服器 bootstrap 最長等候 2.5 秒；逾時／失敗隱藏卡片，待客戶端已驗證身份後重試。這個截止時間不會取消底層 read，資料庫連線及 statement timeout 仍受既有 transaction wrapper 限制。
- 一般成功的 SSR 不立即重讀；視窗 focus、pageshow、回到可見頁面、學習同步及台北午夜會刷新。合併同時事件、同元件最多一個請求鏈，離開或換帳號中止請求；client 請求鏈 12 秒上限。
- 已有卡片更新失敗保留上次摘要並顯示錯誤與重試，不顯示假成功。沒有背景 AI 呼叫或付費 API。
- 未做正式流量壓測；登入首頁的實際 TTFB 仍須正式／預備環境監測，不能將本機 fixture 延遲當成正式效能結論。

## 修改檔案

- `app/page.tsx`、`app/Home.tsx`：薄 server 入口及完整保留的原 client 首頁。
- `components/dashboard/HomeLayout.tsx`：一個可選插槽，排序程式不變。
- `components/dashboard/HomeCoachCard.tsx`、`home-coach.module.css`：新卡片、身份隔離、刷新與局部樣式；重用 StudyUI、study-card、study-button。
- `lib/home-coach.ts`、`home-coach-service.ts`、`home-coach-server.ts`：摘要型別、唯讀聚合及 SSR bootstrap。
- `app/api/study-plan/home/route.ts`：驗證身份的讀取／沿用日程建立入口。
- `tests/home-coach.test.mjs`、`tests/home-coach-browser.mjs`、本文件。

無 schema／migration、無題庫、會員資料、訂閱或後台修改。回復只需回復本功能程式，不需刪除每日任務或改資料庫。

## 驗證

所有寫入測試均使用記憶體內 PGlite；瀏覽器使用 disposable Next app 的測試身份與唯讀 SQL bridge，寫入走真實服務但只連隔離 fixture。未讀取 .env 或使用正式會員進行寫入測試。

- TypeScript、變動檔案 ESLint、`npm run build`（Next 16.2.12 Turbopack）及 webpack build 通過。工作樹多 lockfile 提示屬本機目錄結構，未為消除提示修改專案設定。
- `home-coach.test.mjs`：權限、來源拒絕、owner 隔離、診斷、唯讀 GET、日程重送、1／2 次查詢上限、自由刷題與任務分離、重送去重、真實弱點更新、精簡完成／完整未完成、AI／私人排除、台北換日、bootstrap 失敗、原首頁逐字保留。
- `coach-v2.test.mjs`、`coach-v3.test.mjs`、`home-read.test.mjs`、`account-learning.test.mjs`：26 通過、0 失敗、1 跳過。跳過項目需要獨立 PostgreSQL `TEST_DATABASE_URL`／`LEARNING_DB_TEST=1`，未指向正式 DB；本次核心 SQL 另以 PGlite 實際執行。
- 首頁視覺：訪客／自訂計畫／無計畫 × 375／1280 px × 預設／使用者自訂排序，共 12 組 before/after。完整頁面 geometry 精確相同；截圖比較只容許少於 300 個色彩通道的 1/255 抗鋸齒取整差異，不能容許版型或內容變更。輸出於 `.tmp/home-coach-browser/results.json` 及同資料夾 PNG。
- 真實 Next SSR／瀏覽器流程：卡片存在於初始 HTML、位於原介紹後與狀態卡前；延遲身份回應不插入卡片或改變與介紹間距。375／768／1280 px 無水平溢出；直接開始、作答、回首頁、重新整理、另裝置、退出教練及初始診斷。

重跑：先把上述基準 commit 的 `git archive` 解到 `.tmp/home-baseline`，指定既有 `PGLITE_MODULE` 與 `PLAYWRIGHT_MODULE` 後執行兩個新增測試。測試副本、結果及截圖不提交；測試不操作正式資料庫。

本次先交付已驗證分支；正式部署狀態以交付訊息及對應 commit 的 Vercel 結果為準，不把本機 E2E 當作正式站驗證。
