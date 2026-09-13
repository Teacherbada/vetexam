# 題目搜尋與獨立詳情頁 V1

開發基底：GitHub `Teacherbada/vetexam` main，`cf5abe73eee1d120c68a58bae35c2396fe23af21`（已用 `git ls-remote` 核對）。

## 範圍與現況差異

新增 `/questions/search`、`/questions/[id]`；原 `/questions` 刷題頁保持原用途。科目頁新增搜尋入口。

此 SHA 沒有社群詳解、Helpful、editor 或相應 API；`docs/OPTION_DISTRIBUTION_V1.md` 亦明確記錄未實作。因此未建立第二套社群系統，需求中的社群載入、最佳解析、撰寫／編輯、登入導向和 Helpful 仍待既有實作提供後整合。不能視為全部需求已完成。

現有 `/api/stats/answers` 原本只接受統計提交，並非回傳正誤的 API。本次新增 opt-in `?reveal=1` 模式，沿用 `usableAnswer` 與 `recordFirstAnswers`，不改舊呼叫的 response contract。

## 搜尋與資料取得

URL：`/questions/search?q=Addison&subject=獸醫病理學&year=115&number=37&page=2`。可選 `set` 指定題庫 ID；目前沒有額外題庫選單。

`lib/question-search.ts` 保存完整 SQL：題幹及 option_a/b/c/d 使用參數化 `ILIKE`，逸出 `%`、`_`、反斜線，使輸入視為文字。科目、年份、題號、題庫均在 PostgreSQL 過濾；年份同時匹配民國／西元。只讀 `visibility='public'`。

每頁 20 題，`LIMIT 21 OFFSET (page-1)*20`，第 21 筆只判斷下一頁、不回傳頁面；依年份、題號、唯一 ID 排序。頁碼上限 10,000、關鍵字上限 200 字。不帶有效條件時不查題庫。結果只讀 ID、年份、科目、題號與 160 字摘要，不讀答案、解析、社群或逐題統計。

既有 DB index 已核對：questions 主鍵、question_set_id、(question_set_id,question_number)；question_sets 有 exam_year、(exam_subject,exam_year) 等。現有 B-tree 能輔助年份、題庫與題號過濾，不能加速前置 `%` 的 ILIKE。Beta 題量先採有限分頁，不新增 migration；資料成長時以 EXPLAIN ANALYZE 評估 pg_trgm GIN 和 subject index，再決定是否建立。LIMIT 限制輸出，並不代表避免所有掃描。

詳情 Server Component 透過 `getPublicQuestion` 讀單一公開 ID，以 React cache 在同次 render 共用 metadata/page 讀取。白名單投影只傳基本資料、選項及 hasAnswer；答案與解析不在 initial HTML/RSC props。不存在、超界、非整數或私人 ID 回 404，DB 故障使用一般錯誤頁，不回傳 DB 訊息。

## 作答與分享

點選選項後向既有 `/api/stats/answers?reveal=1` POST `{answers:[{question_id,selected_answer}]}`，server 驗證 origin、payload、session、公開權限、選項及可用答案。僅接受單題；回應 `private, no-store`。交易先取得既有統計鎖，防止管理員答案修正與判答讀取交錯。

登入者仍透過 `ON CONFLICT(user_id,question_id) DO NOTHING` 寫首次統計；重答只回傳本次結果，訪客完全不寫統計。沿用原 localStorage 進度／錯題函式，未重構收藏。可用答案缺失（NULL、空白、無效或對應選項空白）不判分、不寫統計，顯示「本題正確答案目前正在整理中。」並連到既有 `/feedback`。

作答後顯示正誤、選答、正解及 `questions.explanation`，空解析顯示「目前尚未建立官方解析。」重用 `OptionDistribution`；低於既有 5 筆門檻不顯示比例。社群系統缺少，未放置無法運作的 editor CTA。

複製連結優先使用 `NEXT_PUBLIC_SITE_URL`，其次 `VERCEL_PROJECT_PRODUCTION_URL`、`BETTER_AUTH_URL`；只接受 HTTPS，拒絕 localhost。部署時應將正式 origin 設於 `NEXT_PUBLIC_SITE_URL`，避免 auth URL 使用 preview 網域。未設定可用 origin 時不顯示複製按鈕；剪貼簿受限時提供可選取的完整連結。

SEO title 包含年份、科目、題號；description 只含題幹摘要，canonical 使用同一正式 URL。私人題不在此 route 提供，404 metadata 設 noindex；搜尋結果頁 noindex/follow。

本次新頁面不透過舊 `/api/quiz` 或 `/api/questions` 取得資料。舊刷題 API 原本仍會回傳答案，此次依保留既有刷題行為的要求未重構；因此此處的「作答前不洩漏」指新頁面與其初始資料流，不代表整站答案 API 已全面封鎖。

## 檔案與驗證

修改：`app/api/stats/answers/route.ts`、`app/subjects/page.tsx`、`tests/question-stats.test.mjs`。

新增：`lib/question-search.ts`、`lib/public-questions.ts`、`lib/question-detail-answer.ts`、`app/questions/search/page.tsx`、`app/questions/search/search.module.css`、`app/questions/[id]/page.tsx`、`app/questions/[id]/QuestionDetail.tsx`、`app/questions/[id]/not-found.tsx`、`app/questions/error.tsx`、`tests/question-search.test.mjs`、`tests/question-search-browser.mjs`、本文件。工作區先前已有的付款、登入等異動未納入本次功能。

- `npm run build`：通過，新增兩個動態 route。
- `npx tsc --noEmit`：通過。
- 全部既有與新增單元測試：59 通過、9 個需外部配置的案例跳過，0 失敗。
- `SEARCH_DB_TEST=1 node --test tests/question-search.test.mjs`：4/4 通過，包含隔離 PostgreSQL schema，最後 rollback。覆蓋中英文／選項搜尋、民國年、科目、分頁、空結果、私人隔離、訪客不寫、首次寫入、重答去重、缺答案與空解析。
- 本次修改 TS/TSX 與測試檔案 ESLint：通過。
- 全專案 `npm run lint`：失敗，24,076 個既存問題（1,700 errors、22,376 warnings），包含暫存／稽核檔與舊程式。未擴張範圍修復。
- Edge 瀏覽器：真實搜尋、年份／科目、分頁／返回、缺答案、404／私人隔離、initial HTML 欄位檢查通過；作答 UI 使用臨時 fixture 與攔截 API，正誤／解析、低樣本分布、真實剪貼簿複製均通過。搜尋及詳情在 320/375/768/1280px 無水平溢出、無 browser errors。測試後刪除臨時 route。截圖：`.tmp/search-artifacts/search-375.png`、`detail-375.png`。未測實體 iOS Safari 或 IG／LINE 內建瀏覽器。
- 真實 DB「腎上腺」有 8 筆、「Addison」有 0 筆，畫面與 SQL 筆數一致；英文命中另由 PostgreSQL fixture 驗證。真實 DB 未找到可判答的公開題，未修改正式答案；登入首次統計／重答以隔離 DB 測試驗證，未建立真實帳號。

## 下一階段評估（未實作）

保留 `questions.explanation` 作總解析，完全不搬移或覆寫舊值。最小 additive schema 可加 nullable `option_explanations jsonb`（A/B/C/D 字串）與 `explanation_sources jsonb`（標題、URL 陣列），舊題維持 NULL。讀取相容：總解析仍讀既有 explanation，只有存在新欄位時顯示逐選項與來源。寫入端驗證固定 keys、字串長度、HTTP(S) URL，並沿用管理員權限。若未來需要作者、審核或版本追蹤，再考慮獨立解析表，不在本階段新增欄位。
