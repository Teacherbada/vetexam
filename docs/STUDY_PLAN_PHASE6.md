# Phase 6：國考教練每日任務

基準為 Phase 5 `1c1aefe4f0d77d968742def39c49ed4929ca88ed`。開始前已 fetch GitHub main 並確認正式 schema；原工作區的支付及其他未提交修改不納入本次提交。

## 每日入口與目標

國考教練 `/study-plan` 顯示「今日學習」、進度與開始／繼續 CTA；`/study-plan/daily` 為獨立作答頁。進入教練或每日頁時呼叫 POST 確保今日任務存在，同日已存在即回傳原題單，不重抽。

原有 `data/tasks.ts` 的 dailyGoal 是首頁固定值 20，並非帳號每日設定。新增 `study_plans.daily_question_target`，未設定時沿用該值作預設。可設定 5～60 題；修改設定不重建今日已存在的題單，會用於之後新建任務。

原首頁的 todayProgress 是瀏覽器內一般作答累計，沒有題單或跨裝置持久化，不能作為指定每日任務的完成度。每日卡片依既有作答明細計算自己的題單進度；同時透過既有 `saveProgress`、`addDailyProgress`、`saveWrongQuestion` 同步至原瀏覽器進度與錯題本，不重寫首頁或 Wrong 頁。

日期沿用專案已有的台北時間基準（既有 weekly stats 使用 Asia/Taipei），由 PostgreSQL `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date` 決定。沒有使用舊首頁的 UTC date 來識別每日任務，也沒有重寫全站時間系統。

## 儲存結構

新增兩張輕量表：

- `daily_tasks`：id、user_id、local_date、target_count、status、created_at、completed_at。unique `(user_id,local_date)` 讓同日包含已完成任務也只有一份。
- `daily_task_items`：task_id、user_id、position、source、source_question_id、session_id、item_position、follow_up_id。這是題單關聯，不保存第二份答案。

新增一個既有欄位：`study_plans.daily_question_target`，可為 null 以沿用集中預設。

`diagnostic_sessions.kind` 增加 daily。normal／weakness 使用既有診斷 session 及題目快照；follow_up 直接指向 Phase 5 原 session/item。所有答案、正誤、作答時間仍只有 `diagnostic_items` 中的一份，首答仍寫入 `question_answer_stats`，沒有 daily_task_answer 表。

來源在後端標為 normal／weakness／follow_up；題目畫面只顯示題目、選項、題序，不顯示來源或目前弱章節。尚未作答時 API 不提供正解，已作答 receipts 才提供確認後結果，以同步舊錯題本。

## 配額與選題

集中設定在 `lib/daily-task-config.ts`：

| 設定 | V1 |
| --- | --- |
| `DEFAULT_DAILY_QUESTION_TARGET` | 沿用 dailyGoal.target，目前 20 |
| `DAILY_TASK_NORMAL_RATIO` | 0.6 |
| `DAILY_TASK_WEAKNESS_RATIO` | 0.27 |
| `DAILY_TASK_REVIEW_RATIO` | 0.13 |
| `MAX_WEAKNESS_RATIO_PER_DAILY_TASK` | 0.35 |
| `MAX_CHAPTER_RATIO_PER_DAILY_TASK` | 0.4 |
| `DAILY_TASK_RECENT_DAYS` | 7 |
| `DAILY_TASK_TIME_ZONE` | Asia/Taipei |

以 30 題為例：最多先保留 4 題追蹤、8 題弱點，其餘一般進度。若只取得 2 題追蹤，會補成 20 題一般＋8 題弱點＋2 題追蹤。沒有弱點或追蹤時，空出的配額由一般題補足；沒有證據就不建立 weakness 類型。

1. 先取已到期的 follow-up，續作優先、其餘依 due_at。整組剩餘追蹤題能放入配額才納入，不切斷一組測驗。低題數目標的追蹤保留額至少容納既有一組 2 題。
2. 從 active／queued 補強或 Phase 3 已合格的弱章節挑 weakness。short_term／stable 不加重弱點配額，仍可正常抽到一般題。
3. 剩餘題數以正常題補足。先避開近期作答／分配過的題，再優先未作答、較久以前的題；同時平衡當日科目、不同章節及累積科目覆蓋。同等情況取使用次數較少者，再隨機決定。

僅取公開可評分題。來源建立快照時重新驗證分類與公開性。每日題單以 source_question_id 去重，DB unique `(task_id,source_question_id)` 再保護；normal／weakness 不重複已保留的 follow-up 題。

各 session 內題序保持原作答順序，再依剩餘題量隨機穿插各 session，不會因混題而跳過共享測驗的前題。存檔後每日題序固定。

單一已分類章節最多占目標 40%，包含保留追蹤題，避免 weakness 配額之外再被 normal 大量填入。未分類題不當作同一個章節限額，也不構成章節弱點。

題目不足時依未作答／較久作答／較少使用／近期最後的原則回用舊題。若整體題庫或章節分布仍不足，保存實際取得數量並顯示缺口，不以缺題計零分，不為填滿目標繞過章節上限。零題不建立空任務，可稍後重試。

## 共用 follow-up 與 mastery

每日組題可以在 active reinforcement 存在時納入 due follow-up，不阻擋每日練習。這個內部整合選項不接受客戶端傳入；獨立追蹤 API 的既有規則保留。

每日作答到 follow_up 題時直接呼叫既有 `answerFollowUp`，因此第一階段通過排第二階段、最後階段通過為 stable、失敗回 queued 的邏輯不重寫。獨立追蹤頁仍可使用，與每日任務看到同一份答案，已答題會自動跳過，不再考第二次。

當日在題單建立後才到期的追蹤不插入已固定題單；可以從原入口完成，或等待下次建題時納入。隔天尚未完成的追蹤也只納入其未答部分。

一般每日答案以既有 Phase 3 有效樣本規則提供 evidence，同題仍去重、沿用樣本門檻；不把每日題當成完成弱點確認，也不直接給 stable。follow-up 與立即驗證仍是分開的歷史事件。單日正確率只是當日表現。

## 續作、隔日與錯題

每日建立／作答／設定沿用 study_plans 列鎖與交易；同日反覆 POST 返回相同任務，same-answer retry 不重複計分，改答案或跨帳號存取拒絕。

當日進度由 daily_task_items 關聯的 diagnostic_items 計算。若在獨立追蹤頁先回答，重新載入每日任務即可看到進度；完成狀態在每日確保／作答交易同步，completed_at 取實際最後作答時間。

隔天先同步已全部作答的完成任務，再把其餘舊 active 標 expired，保留題單及已作答歷史。新一天只依當日目標建立新任務，不加成 60／90 題；昨天未答題會因近期已分配紀錄而降優先，不會一直卡住。舊頁跨日送出會要求重新載入。

伺服器作答紀錄是跨裝置進度依據。舊錯題本與首頁進度仍維持現有瀏覽器儲存方式；每日頁把已確認 receipts 經原有 helper 寫入，使用帳號＋session/item 去重，重整不重複累加。使用者手動移除錯題後不因同份 receipts 重整而加回。瀏覽器儲存失敗不影響 DB 答案，畫面會說明本機同步失敗。本次不擴大成跨裝置 Wrong 系統。

## UI 與 API

今日卡片為教練主要入口，仍有未完成補強時另顯示簡短章節／狀態與續作按鈕。原先補強分析與初始診斷移至可展開的次要區塊，原頁面及路徑保留。一般自由刷題、全站首頁、目標卡片的其他內容不修改。

完成頁顯示實際題數、今日正確率、分類表現與完成的追蹤數；有 active 補強給續作、有學習建議則提供入口，否則告知今日已完成，不強迫追加大量題目。

新增 `/api/study-plan/daily`：GET 讀取、POST 建立或續用、PATCH 設定目標、PUT 作答。沿用 session 身份、來源檢查、1KB JSON 上限、嚴格欄位驗證、private/no-store 與不暴露內部錯誤的回應。

## 檔案清單

新增：

- `lib/daily-task-config.ts`、`lib/daily-task.ts`：集中設定、型別、選題／日期與混題規則。
- `lib/daily-task-service.ts`、`lib/daily-progress-client.ts`：交易、題單與既有本機進度同步。
- `app/api/study-plan/daily/route.ts`。
- `app/study-plan/daily/page.tsx`、`DailyTask.tsx`。
- `migrations/20260918_daily_tasks.sql`、`scripts/migrate-daily-tasks.mjs`。
- `tests/daily-task.test.mjs`、`tests/daily-task-browser.mjs`。
- 本文件。

修改：

- `app/study-plan/ModeSelector.tsx`：每日卡片與原入口收合區塊。
- `lib/diagnostic.ts`、`lib/diagnostic-service.ts`：支援 daily snapshot 與指定 session 讀取，不改一般 quiz。
- `lib/confirmation-service.ts`：每日答案依既有規則進入有效證據，保留其他階段語意。
- `lib/follow-up-service.ts`：每日整合的內部開始選項，沿用原作答／結果流程。
- `tests/diagnostic-browser.mjs`、`tests/reinforcement-browser.mjs`、`tests/follow-up-browser.mjs`：回歸測試從收合區塊進入原流程，並隔離每日 API fixture。

## 驗證與發布

```powershell
$env:DAILY_TASK_DB_TEST='1'
$env:FOLLOW_UP_DB_TEST='1'
$env:REINFORCEMENT_DB_TEST='1'
$env:WEAKNESS_DB_TEST='1'
$env:DIAGNOSTIC_DB_TEST='1'
node --test tests/daily-task.test.mjs tests/follow-up.test.mjs tests/reinforcement.test.mjs tests/weakness.test.mjs tests/diagnostic.test.mjs
node --test tests/study-plan.test.mjs tests/question-stats.test.mjs tests/exam-chapters.test.mjs
```

29 項規則／API／PostgreSQL 測試全數通過，含 30 題組成、due 優先、8 題 weakness、無弱點／追蹤補足、6 科平衡、章節上限、去重、fallback、12/30 跨交易續作、獨立追蹤共用、設定不重抽、跨日不累積、權限、首答／弱點證據及 Phase 1～5 回歸。另 12 項模式與一般題庫檢查通過；另外兩項非本階段 DB 測試未啟用。所有資料庫 fixture 使用獨立直連與暫存表。

瀏覽器：設定 `PLAYWRIGHT_MODULE`、`TEST_BASE_URL` 後執行 `tests/daily-task-browser.mjs`。30 題、12/30 續作、錯誤重試、舊錯題本可見、local progress 不重計、無每題來源提示及 320／375／768／1280px 通過。原診斷／補強／追蹤 browser regression 也通過。截圖保留於 `.tmp/daily-task-artifacts`。

`npm run build` 與修改範圍 ESLint 通過，發布再以 scoped commit 的乾淨 archive 建置及檢查手機畫面。正式驗證僅檢查公開頁及權限，不建立虛構學習紀錄。

`node scripts/migrate-daily-tasks.mjs`：public schema、交易內連續執行兩次 migration、比對既有筆數並回滾；`--apply` 才提交。演練保留正式 1 筆 study plan，診斷／追蹤資料筆數不變。

未修改 Auth、Subscription、PRO、Admin、PDF、題目／解析、正式分類、Favorites／Wrong 頁面或一般刷題行為；僅從新每日流程呼叫既有儲存 helper。沒有完整自訂進度、筆記、通知、AI、streak、勳章或 XP。
