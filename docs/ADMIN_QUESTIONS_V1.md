# 管理員題目維護中心 V1

## 開發基準與現況查核

- 2026-09-12 已執行 `git fetch origin main`。
- `HEAD` 與 `origin/main` 同為 `e40c53d5b9f8ecf76ad1718d251cf72b65315a05`。
- 使用本地 Next.js 16.2.12 隨套件提供的 Route Handlers、Server/Client Components 文件。
- 已保留工作區原有付款、訂閱與其他頁面修改，未提交、推送或部署。
- 正式資料庫僅做唯讀查核；未填入、猜測或修改任何正式答案。整合測試使用隨機隔離 schema，交易最後全部 ROLLBACK。

`questions.answer` 已存在，型別是 `text NOT NULL`。資料問題是空字串，不是缺欄位，也不是只被 UI 隱藏。

| 範圍 | 全部題目 | answer NULL | 空白答案 | 非空、非 A–D 答案 | 第五選項 | 缺少詳解 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 公開 | 320 | 0 | 320 | 0 | 0 | 320 |
| 私人 | 80 | 0 | 80 | 0 | 0 | 80 |
| 合計 | 400 | 0 | 400 | 0 | 0 | 400 |

當時 `question_answer_stats` 共 0 筆，`selected_answer IS NULL` 共 0 筆。另查到 **10 組同一題庫內的重複題號**，所以不能假設 `(question_set_id, question_number)` 已有唯一約束。頁面的品質數字由資料庫即時計算，不使用上述查核快照作為 UI 資料。

## 入口、搜尋與權限

- 管理頁：`/admin/questions`，由既有 `/admin` 導覽進入。
- 搜尋 API：`GET /api/admin/questions`。
- 批次與單題 API：`POST /api/admin/questions/bulk-answers`，`action` 為 `preview` 或 `apply`。
- 頁面沿用 `requireAdminPage()`；每個 API 請求沿用 `requireAdmin()`，以 Better Auth session user ID 比對 `ADMIN_USER_ID.trim()`。
- 非管理員 API 回傳 403；未登入頁面導向登入，非管理員頁面導向首頁。
- JSON 回應標示 `Cache-Control: private, no-store`。寫入與預覽檢查同源、JSON 類型與 64 KiB 串流大小限制；不接受前端自稱 `isAdmin`。
- 搜尋支援題目 ID、題號、原始儲存年份、完整科目名稱、題目文字關鍵字、題庫與答案／官方詳解品質。每頁 100 題。
- 單題可以查看年份、科目、題幹、A–D（存在時亦顯示 E）、原答案與官方詳解。本階段只編輯正確答案。

## 三種批次輸入與唯一配對

1. **鍵盤**：滑鼠 A–D 按鈕、A/B/C/D 快捷鍵、自動跳至下一個可編輯題、↑/↓、上一題／下一題、點題號回頭修正、清除草稿。只更新本次填寫的答案。
2. **答案表**：每行一題，支援 `1 A`、Tab、`1.A`、`1、A`、`1:A`；容忍周圍空白、CRLF/LF 與小寫字母。不做寬鬆猜測。非法、重複或多餘內容明確列錯，禁止套用。
3. **連續字串**：支援 `ACBD` 與空白分隔；顯示預期題數、實際字元數。長度必須與 DB 實際題數完全相同，DB 題號也必須恰好是 `1..N` 且沒有重複或缺號；否則禁止套用。

批次必須包含 `question_set_id`；依題庫 ID + 題號尋找**恰好一筆**題目，再以題目主鍵 ID + 題庫 ID UPDATE。重複題號或找不到題號不會更新。單題模式同時要求 `question_set_id` + `question_id`，因此可安全處理同一題庫內重複題號。

V1 單次最多 1000 題。新答案只接受 A–D，轉大寫。原答案為特殊格式、存在第五選項、或 A–D 選項不完整的題目，標為「此題答案格式需要人工確認」並略過，單題亦不強制覆蓋。

## 預覽、確認與過期資料

- 原答案 NULL／空白 →「新增」。
- 正規化後相同 →「相同」，不做 UPDATE，也不碰該題統計。
- 原答案不同 →「答案將修改」，醒目列出原答案、新答案與統計影響。
- 顯示解析成功、解析錯誤、找不到／重複題號、略過數量與新增／修改／相同摘要。
- 預覽本身是唯讀、repeatable-read 交易。
- Server 使用既有 `BETTER_AUTH_SECRET` 簽署預覽，綁定管理員 ID、輸入、題庫內容、配對結果及受影響統計筆數，有效 15 分鐘。
- 套用時重新建構預覽並驗證簽章；題目或筆數變更、token 過期／偽造時拒絕，要求重新預覽。
- 編輯輸入或切換模式會清除舊預覽與確認勾選。只有「確認套用答案」會寫入 DB。

## 答案與統計的一致性

`question_answer_stats` 已有 `selected_answer`，不需要新增欄位。

答案新增或更正時，先計算該題統計：

- `selected_answer` 是 A–D：以 `selected_answer = new_answer` 重算 `is_correct`，更新原有 stats `updated_at`；不改首次作答時間與選項。
- `selected_answer` 為 NULL 或無效：不能可靠重算。列出清除筆數，必須另外勾選明確的清除確認，之後重新累積。
- 任何受影響統計都需要勾選重算確認；有需清除的資料時還需要第二個確認。沒有確認，Server 也會拒絕。
- 新增原本空白的答案也檢查歷史統計，不假設一定沒有舊紀錄。

使用既有 `pg` driver 的 `BEGIN / COMMIT / ROLLBACK`。更新答案、重算、必要清除在同一交易內完成，任何 DB 例外全部回滾。

維護交易先對 stats、questions 取得 `SHARE ROW EXCLUSIVE` 鎖，再讀取並驗證預覽。一般作答端先在自己的交易中取得 stats `ROW EXCLUSIVE` 鎖，**下一個 SQL statement** 才讀答案並寫入首次統計。這避免維護交易完成後，排隊中的作答用舊 statement snapshot 寫入過時正誤。一般作答的鎖彼此相容；維護操作期間可能短暫等待。lock timeout 5 秒、statement timeout 15 秒，失敗回傳錯誤，不回報部分成功。

V1 採短時間表級維護鎖，以目前小型題庫為取捨；題庫規模或寫入流量大幅增加後，可再評估更細粒度協調。沒有完整 audit log；`questions` 原本沒有 `updated_at`，本階段不為此增加 migration。

## 正式刷題的最小答案安全修正

原有 Server 首次統計 INSERT 已排除 NULL／空白／非法答案；保留並補查正解選項內容確實存在。

原有 `/questions` 前端仍把空答案判為答錯，現已修正：

- 練習與模擬考顯示「本題正確答案尚未設定，不計入作答統計」。
- 不寫入本機正確率／錯題紀錄，也不送該題 Server statistics。
- 不標示錯誤選項、不顯示該題選項正確性統計；總分分母排除不可判分題。
- 最多人答錯、每週排行榜與選項分布 SQL 排除空白／非法答案，避免舊資料被展示為有效統計。
- 首頁與魔王題 UI、PDF、收藏、錯題、訂閱功能未重設計。

## 測試與 Build

- `npm run build`：**通過**，含 `/admin/questions` 與兩個 admin API；沒有保留瀏覽器測試用暫存 route。
- `npx tsc --noEmit`：**通過**。
- `node --test tests/*.test.mjs tests/*.test.cjs`：64 個測試，56 通過、0 失敗、8 個環境選擇性測試略過。
- 題目維護、既有首次統計、選項分布三套 PostgreSQL 整合測試另行啟用執行：均通過，包含跨題庫、單題 ID、查詢／篩選、重算、NULL 舊紀錄確認、過期預覽、注入 DB 中途錯誤的回滾，以及缺答案不寫統計。
- 瀏覽器測試：通過匿名真實 server guard、A/C/B/D 連續輸入、回到第 2 題修改及清除預覽、兩階段統計確認、字串數量阻擋、貼表、單題 ID、320/375/768/1280px 不溢出、練習／模擬考空答案安全。無 browser page error。
- `npm run lint`：**未全綠**。原工作區既有 `.security-audit` 產生檔及既有頁面等共報 1700 errors、22376 warnings。本次所有新增／修改範圍另跑 ESLint **通過**，未為此擴大重構。
- 變更範圍 `git diff --check`：通過。

唯讀重查：`node scripts/audit-question-answers.mjs`。

整合測試：設定 `ADMIN_QUESTIONS_DB_TEST=1`、`STATS_DB_TEST=1`，執行 `node --test tests/admin-questions.test.mjs tests/question-stats.test.mjs tests/option-distribution.test.mjs`。

瀏覽器測試：`node tests/admin-questions-browser.mjs`；若 Playwright 沒有安裝於專案，使用 `PLAYWRIGHT_MODULE` 指定既有模組路徑。使用本機 3107 port，全部資料 API 使用測試 fixture，不新增真實登入帳號或正式題目。

## Git diff 檔案清單

修改 5 個既有檔案，共 30 行新增、17 行移除：

- `app/admin/AdminDashboard.tsx`：題目維護入口。
- `app/api/stats/answers/route.ts`：首次統計交易與維護鎖協調。
- `app/questions/page.tsx`：空答案不判錯／不統計。
- `lib/question-stats.ts`：答案選項與排行安全防護。
- `tests/question-stats.test.mjs`：沿用測試配合交易介面。

新增 14 個檔案：

- `app/admin/questions/page.tsx`
- `app/admin/questions/QuestionsAdmin.tsx`
- `app/admin/questions/questions.module.css`
- `app/api/admin/questions/route.ts`
- `app/api/admin/questions/bulk-answers/route.ts`
- `lib/admin-question-input.ts`
- `lib/admin-question-http.ts`
- `lib/admin-questions.ts`
- `lib/question-answer.ts`
- `lib/question-transaction.ts`
- `scripts/audit-question-answers.mjs`
- `tests/admin-questions.test.mjs`
- `tests/admin-questions-browser.mjs`
- `docs/ADMIN_QUESTIONS_V1.md`

沒有新增套件或 migration。瀏覽器截圖位於本機 `.tmp/admin-question-artifacts/`，不屬於功能程式碼。

## 下一階段評估（未實作）

現有 API **尚不足以完整提供一般使用者的「搜尋＋獨立詳情＋作答＋官方／社群解析」**：

- `/api/quiz?scope=public&questionId=...` 已可取得單一公開題目和官方 `explanation`，足以作為詳情讀取的既有基礎。
- `/api/stats/answers` 已可提交首次選項並由 Server 計算統計，但不回傳判分結果，並非完整的 Server 判分 API。
- `/api/questions` 主要是科目取題；本次搜尋 API 只供管理員，不能直接向一般使用者開放。一般使用者尚缺帶可見性控管的關鍵字／條件搜尋 API。
- 未找到可供一般使用者讀取社群解析的 API；admin reports 是回饋管理，不是社群解析。
- 既有 quiz／questions／question-set 讀取 API 原本就會回傳答案與官方詳解。本次未新增任何公開 admin 答案下載能力，也未重寫既有刷題 API 協定；若下一階段要求作答前的答案保密，需另設計 Server 判分與作答後揭露。

本階段到此停止，未建立下一階段搜尋或獨立詳情頁。
