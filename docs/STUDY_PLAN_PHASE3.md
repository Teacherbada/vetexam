# 國考教練 Phase 3：弱點確認與分析

基底：GitHub main `bb2213d0abd8fa8e3d592e4bb27f624760deac71`，已發布 Phase 2。
使用者已確認範圍，包含延伸診斷 session 類型與調整原本每人一份診斷的唯一限制。

## 功能與入口

初始診斷結果的「繼續弱點確認」連至 `/study-plan/confirmation`。
完成初始診斷後，依初始結果挑選最多兩個需要進一步確認的科目（樣本不足者排除，正確率低於 80%，優先較低者）。
每科最多 20 題。每題沿用診斷的伺服器判分、原子儲存、重送保護及跨裝置續作。
完成後顯示科目及章節分析，最高優先建議最多兩項。可以自願再做一輪確認；有未完成確認時會直接續作。
目前沒有目標科目、沒有可用不同題目、尚未完成初始診斷、未登入或切至自訂模式，都有明確狀態，不建立空白測驗。

## 變更檔案

修改既有：

- `app/study-plan/diagnostic/Diagnostic.tsx`：啟用確認入口，讓既有作答 UI 支援確認類型，保留初始診斷介面。
- `lib/diagnostic.ts`：增加診斷類型。
- `lib/diagnostic-service.ts`：初始查詢限定 initial，抽出共用候選題與快照建立；讀取／作答依類型隔離。
- `tests/diagnostic.test.mjs`、`tests/diagnostic-browser.mjs`：新 migration 相容性及已啟用入口回歸。

新增：

- `lib/weakness.ts`：集中設定、確認抽題、去重、近期樣本分析與優先排序。
- `lib/confirmation-service.ts`：確認前置條件、多輪建立、續作、證據查詢。
- `app/api/study-plan/confirmation/route.ts`：GET 讀取、POST 建立／續作、PUT 儲存。
- `app/study-plan/confirmation/page.tsx`、`WeaknessOverview.tsx`、`weakness.module.css`：確認頁與可展開的科目／章節資料。
- `migrations/20260915_diagnostic_confirmation.sql`、`scripts/migrate-diagnostic-confirmation.mjs`：資料模型延伸、試跑與套用。
- `tests/weakness.test.mjs`、`tests/confirmation-browser.mjs`：規則、API、PostgreSQL 與畫面驗證。
- 本文件。

未修改首頁、home.css、globals.css、一般刷題、舊 `/analysis`、正式分類、登入註冊、PDF、付款／PRO、管理員權限、收藏或錯題本。工作區其他未提交修改不納入發布。

## 資料庫

沿用 `study_plans`、`diagnostic_sessions`、`diagnostic_items`、`question_answer_stats`，不新增資料表或重建作答歷程。

`diagnostic_sessions` 新增：

- `kind`：預設 initial，舊紀錄自動維持初始診斷；新確認使用 confirmation。
- `parent_session_id`：確認連至既有初始診斷。

先建立「每人只有一份 initial」partial unique index，再移除舊的全類型 user_id 唯一限制。
另限制每人最多一份未完成 confirmation，並以複合 FK 保證 parent 屬於同一個使用者。
原有 session ID、題目、作答及完成狀態保留；明細表無欄位變更。
既有資料庫 migration 試跑時 session/item 均為 0；保留有作答資料的情境另以 PostgreSQL TEMP fixture 驗證。

初始 API 永遠僅取得／作答 initial，確認 API 僅處理 confirmation。沿用 study_plans row lock 序列化建立、作答及模式切換。
相同答案重送不重複計分；不同帳號、不同診斷類型及跳題均拒絕。完成一輪後才可以建立下一輪，舊結果不刪除。

## 確認抽題

- 正式六科與章節直接沿用 `data/exam-chapters.ts`。
- 僅使用公開且可判分的題目；近期七天已作答題目暫時排除，七天以前可再作為 fallback。
- 未作答優先於做過的題目，包括未分類題目。
- 同優先層盡量每章收集五道不同題目，優先樣本不足章節，再補至每科最多 20 題；科目間交錯排列。
- 題目不足採實際題量、不重複塞題、不把缺題當錯誤。沒有候選題時不建立空 session，保留既有結果。
- 正式題庫開發前六科各 80 題，但僅病理兩題已分類。這限制章節確認能力；不自動分類、猜測章節或改寫題庫。

## 分析規則

設定集中於 `WEAKNESS_CONFIG`：

- 最近 30 天已完成診斷／確認的作答，加上既有一般首次作答紀錄。
- 同一道來源題目只採最新一筆；重做不增加樣本數。未完成確認不改變已完成診斷的分析。
- 同時顯示整體正確率與最近最多十道不同題目的正確率，狀態依兩者較低值判斷。
- 科目至少十道不同題目；章節至少五道，其中至少三道來自已完成的弱點確認。
- 不足門檻為「資料不足」；80% 以上「掌握良好」、60–79%「需要複習」、低於 60% 且近期至少兩道不同題目答錯為「優先加強」。
- 單題答錯、同題反覆答錯、僅有初始診斷章節樣本，都不能直接判定章節弱點。
- 章節優先排序依狀態、近期正確率、不同錯題數與樣本數，最多推薦兩項；其他章節在各科展開後查看。
- 未分類／不符合正式分類的題目只納入科目統計，不納入任何章節。
- 沒有優先建議時區分「資料不足」與「有足夠資料但無需列為優先」；不宣稱精通或長期掌握。

已知限制：一般刷題仍只有首次統計，無法得知每次重做時間；不把可能受答案校正影響的 updated_at 當最近作答時間。診斷則以保存的快照分類與判分為準，不追溯套用後續題庫修改。
本階段不建立 mastery score、補強任務、3/7 天排程、筆記、AI、自訂進度排程，也不改變一般刷題安排。

## 驗證

- `npm run build` 與相關 TS／TSX ESLint 通過。
- `WEAKNESS_DB_TEST=1 DIAGNOSTIC_DB_TEST=1 node --test tests/weakness.test.mjs tests/diagnostic.test.mjs`：14/14 通過。
- PostgreSQL TEMP fixture 驗證：保留舊初始紀錄、migration 可重跑、初始唯一／確認單一進行中限制、parent 帳號隔離、未完成初始／自訂模式拒絕、20 題確認、跨交易續作、重送、結果去重、下一輪10題、初始 API 不被確認污染。連線結束清除 TEMP 資料，不新增正式帳號或題目。
- 規則測試涵蓋：單題／同題重做／初始樣本不足保護、60/80% 邊界、近期表現與過期資料、未分類、兩項優先上限、未作答優先與七天內重題排除。
- 確認與原診斷 Edge headless fixture 流程通過，含失敗重試、續作、完成、缺題、權限與 320／375／768／1280px 排版。首頁既有 guest/user/admin 及六種寬度回歸也通過。
- 畫面紀錄：`.tmp/confirmation-artifacts/`。

## 部署

依序先 migration 後程式部署；調整資料模型時舊版仍可建立 initial，新 confirmation 由新版開放。

```sh
node scripts/migrate-diagnostic-confirmation.mjs
node scripts/migrate-diagnostic-confirmation.mjs --apply
```

第一個指令會連續執行兩次、核對 session/item 數量後 rollback；只有 `--apply` 才 commit。腳本有 lock timeout 及 statement timeout，失敗不保留部分變更。
