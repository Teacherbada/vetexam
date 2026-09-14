# Phase 7：自訂進度模式完整化

基準：GitHub `main`／Phase 6 `a17f2eefb64a698218842c1e06bf8e638a140ad1`。
實作前已 fetch 並確認本機與遠端相同，閱讀相關 Next.js 16 本機文件、Phase 1～6 服務與 migrations，唯讀確認正式 DB。
工作區另有登入、訂閱、付款等未提交修改，本階段發布不包含它們。

## 1～2. 修改與新增檔案

修改：

- `app/study-plan/ModeSelector.tsx`：自訂模式顯示設定與進度卡。
- `lib/diagnostic.ts`：新增 `custom` session kind。
- `lib/diagnostic-service.ts`：共用快照與作答支援 custom；預設仍為 coach，現有呼叫行為不變。
- `lib/daily-progress-client.ts`：輸入型別縮小為 owner／receipts，沿用既有瀏覽器進度與錯題同步。

新增：

- `lib/custom-plan.ts`：正式範圍驗證、民國日期轉換、剩餘天數與題數估算、回應型別。
- `lib/custom-plan-service.ts`：持久化計畫、範圍清單、每日出題、作答、歷史與暫停。
- `app/api/study-plan/custom/route.ts`：GET 讀取、POST 預覽／開始、PUT 儲存、PATCH 作答／暫停。
- `app/study-plan/custom/{page.tsx,CustomPlan.tsx,custom.module.css}`：設定、預估、進度、歷史及作答畫面。
- `migrations/20260919_custom_plans.sql`、`scripts/migrate-custom-plans.mjs`。
- `tests/custom-plan.test.mjs`、`tests/custom-plan-browser.mjs`、`tests/custom-plan-production.mjs`。
- 本文件。

## 3～6. DB 與設定保存

新增三張表：

| 表 | 用途 |
| --- | --- |
| `custom_plans` | 每個帳號唯一計畫；config、active／paused／completed、建立／完成日期、範圍更新日期 |
| `custom_plan_questions` | 範圍清單：原始 question ID、正式 subject／chapter、是否先前做過、目前是否在範圍內；不存答案 |
| `custom_daily_tasks` | user＋台北日期＋plan 唯一每日任務，保存當日題數、設定快照及既有作答 session ID |

不增加既有表 column。只擴充 `diagnostic_sessions` 的 kind constraint，允許 `custom`。
新表以複合外鍵確保 plan、session 所屬帳號一致。

每日題數、日期與偏好保存於 `custom_plans.config`：

```json
{
  "target": 30,
  "deadline": "2026-09-23",
  "preferUnanswered": true,
  "scope": [{"subject": "獸醫病理學", "chapters": ["腫瘤"]}]
}
```

題數 1～200，提供 10／20／30／50 快選；target 可 null，但必須設定日期。
畫面輸入與輸出均採民國日期；API／DB config 使用 ISO 日期字串。
正式 subject／chapter 僅使用 `data/exam-chapters.ts`，不新增 mapping。
同科 chapters 為空陣列表示整科，包含尚未分類但可作答的題目；指定章節僅精確匹配，不納入未分類題。

## 7. 真實題量與進度

沿用公開、有效題幹、有效答案及選項的題目篩選，不使用 `question_sets.total_questions`。
先精確篩選使用者 scope，再依偏好排除先前已做過的題目。
預設勾選「優先安排未做過題目」，V1 語義為排除先前已作答題目；取消可納入舊題，但每個計畫的每題仍只完成一次。

整體進度分母為目前範圍內的計畫目標題目，分子為已在本計畫完成的不同題目。
歷史題目曾完成後即使來源刪除，仍保留該完成紀錄與相符範圍的分母。
修改範圍後，畫面另列「累計完成」與全部計畫作答正確率，避免將範圍外歷史誤認為被清除。
近期每日紀錄顯示最近 14 天有建立任務的紀錄；DB 保留全部歷史。

正式題庫檢查時共 480 題，僅病理 2 題已分類。章節無題或已無待練習題時顯示空狀態，不造題、不借其他章節補滿、不建立空 session。

## 8～9. 估算與落後進度

- 剩餘有效日：截止日期減台北今日，再加 1；過期取 0。
- 系統建議：剩餘題目 ÷ max(有效日,1)，無條件進位。
- 預估需要天數：剩餘題目 ÷ 每日目標，無條件進位。
- 明確設定 target 時永不自動改寫；低於所需速度顯示建議／延長日期提示。
- 只有日期時，每天以當下建議建立任務，最多 200 題；若建議超過上限，提醒延長日期。
- 未完成題目仍留在剩餘池，隔日重新按固定目標排題，不把昨天缺額直接加到今日目標。
- 日期已過不停止或刪除計畫，可繼續練習並修改截止日期。

## 10～12. 同日固定、編輯、暫停與模式切換

所有寫入先鎖定既有 `study_plans` 帳號列，與模式切換共用鎖；DB 額外保證同 user＋local_date＋plan 唯一。
重複開始只讀回原 session；答案以 session／position 保存，相同答案重試不重計，不同答案重試回 409。
每日任務的題目與順序為建立時的快照；重整、登入、修改目標或 scope 不重抽今日題目。
舊日任務不再接受作答，但保留未完成比例與答案；新日從剩餘範圍建立新任務。

儲存設定保留同一 plan ID，重新計算目前範圍，從後續每日任務使用新設定。今日既有題目仍可完成，即使已不在新範圍。
自動納入新增題目在下一個台北日更新範圍池；使用者主動儲存設定則重新估算當下題庫，但也不改動既有任務。
V1 每個帳號維持一個可編輯計畫；提供暫停／恢復，沒有刪除歷史或多計畫介面。
暫停會阻止產生新任務及作答。切換 coach 不刪除或改寫 custom plan；所有 custom 寫入需 custom mode，切回可續作。
目標全部完成時保存完成日期；之後新日納入新題或擴充範圍時可回到進行中，歷史答案不清除。

## 13. Phase 6 與 answer history 的重用

共用 `diagnosticCandidates`、`createDiagnosticSession`、`answerDiagnostic`、既有題目快照、`question_answer_stats` 首答規則、ProgressBar 與 confirmed-receipt 瀏覽器同步。
答案只存 `diagnostic_items`，不另建答案表。

Phase 6 的 `daily_tasks` 以 user＋日期唯一，並含 follow-up 來源連結；custom 的唯一性需要再包含 plan。
為保持教練資料結構與排題核心不變，custom 只新增每日任務索引表，連結同一套 session／items；未改動 Phase 6 的配比、選題、follow-up 或弱點核心。
自訂模式不呼叫弱點、補強或 follow-up 排題服務，不會依分析擴充使用者 scope。

## 14. 驗證

- 自訂規則／API／PostgreSQL 4 組測試通過：日期與正式分類、實際題量、首答排除、跨交易續作、重試、帳號隔離、同日固定、編輯、暫停、模式切換、跨日、新增題、完結與空範圍。
- 既有回歸 41 項通過，2 項既有額外 DB 測試未啟用；已啟用診斷、弱點、補強、追蹤及每日任務的 5 組 PostgreSQL 測試。
- 自訂瀏覽器：建立、精確章節、預估、30 題完整流程、12／30 reload、修改、暫停、模式切換、錯誤重試、錯題及日進度去重；320／375／768／1280 無橫向溢出。
- 既有 daily、reinforcement、follow-up、diagnostic 瀏覽器回歸通過。
- TypeScript 與本次變更 ESLint 通過。
- 以 `main` 乾淨副本加上本次限定檔案執行 production build 通過，排除工作區其他未提交修改。
- 遷移在正式 DB 交易中執行兩次後回滾試跑通過，原有資料筆數不變。正式套用使用同一腳本 `--apply`。
- DB 測試採直接連線的 TEMP fixtures，避免 Neon transaction pooling 共用暫存表。

## 15. Scope

未修改首頁、PDF、國考題庫、手動題庫、Auth、Subscription、PRO、Admin、Favorites、Wrong、題目內容、官方章節或一般刷題流程。
未加入 AI、筆記、排行、獎勵或複雜排程。既有教練服務僅共用執行器增加 custom kind 與對應 mode guard，教練預設分支及選題算法保持不變。
