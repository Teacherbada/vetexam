# 國考教練 2.0：Phase 0–2

## 基準與保護

2026-10-17 已核對 GitHub `Teacherbada/vetexam` main 與 fetch SHA：`cb2393826e1db01a423d75ee8494f6a950bce92b`。根目錄 main 有大量既有未提交修改，完全保留；本次位於獨立 `.worktrees/coach-v2`、`feat/coach-v2` 分支。

## Phase 0：實際現況

- 已存在學習模式、自訂計畫、初始診斷、弱點確認、補強、3／7 天章節追蹤、每日任務，以及一般練習 FSRS 到期複習。不能視為尚未開發。
- `study_plans.daily_question_target` 保存每日設定；`daily_tasks` 的 `(user_id,local_date)` 唯一鍵固定當天安排；`daily_task_items` 連結 `diagnostic_items` 的題目／答案快照與實際作答，沒有另建第二套答題資料。
- 原每日任務把一般、弱點及追蹤混成一串；缺少分項入口、理由快照、當次章節回饋。原 POST 每次進入已能重用既有任務，但新會員可能直接收到一般練習。
- `question_answer_stats` 是首次作答；`practice_attempts` 是一般練習事件；教練紀錄在 `diagnostic_items`。不能把三者直接相加當成不同題目的樣本數。
- 權限重用 Better Auth session、伺服器 user ID、同來源驗證、1 KB 白名單 payload、transaction 與 study_plans 列鎖；不新增登入方式。
- 正式資料庫僅唯讀查核：study_plans 1、daily_tasks 3、daily_task_items 60、diagnostic_sessions 6、diagnostic_items 180、practice_attempts 24、question_memory_state 24；公開 questions 1,040 題，其中 755 題有非空章節。實際分析還會驗證章節屬於官方分類。
- 原紀錄必須保留。所有寫入測試均使用本機隔離 PGlite，沒有對正式紀錄進行測試寫入。

## 已完成的 Phase 1

入口仍為 `/study-plan`，國考教練模式第一區顯示台北日期、今日建議、實際進度及一鍵開始；模式設定收合，既有自訂計畫、補強與初始診斷入口保留。收合的舊診斷／補強卡片按需掛載，避免首次進入就執行無關查詢。

新建的每日任務保存三個分項：

| 任務 | 實際依據與分配 |
| --- | --- |
| 弱點特訓 | 最近 30 天每題最新表現，章節至少 5 道不同題目、科目至少 10 題且正確率低於 70%；排序參考重複錯誤。預留目標約 35%，不足優先補同科章節 |
| 記憶複習 | 既有到期章節追蹤、FSRS 到期訊號、最近仍答錯的題目；預留約 25%，優先同章節其他題目，不宣稱相同考點 |
| 綜合挑戰 | 剩餘配額，平衡科目、優先未做或較久未做題目，最近 7 天重題排後 |

比例集中於 `COACH_RULES`，題數來自既有 5–60 題每日設定，不固定為 15／8／10。一天內題目 ID 不重複，所有分項合計不超出每日設定。沒有足夠弱點或複習線索時如實顯示「今日未安排」，將可用配額轉至綜合挑戰；題庫不足則縮減並說明，不補 AI／私人題目。

沒有完成初始診斷、且近 30 天未達 12 道不同題目／3 科資料的帳號，優先顯示既有初始診斷與可恢復進度。診斷完成後即使章節樣本不足，也可先做綜合挑戰，繼續建立分析，不假造弱點。

每個新分項重用獨立的 daily diagnostic session，既有 follow_up session 仍直接連結；自由切換分項不改題目，不繞過各分項內的順序驗證。任務理由、範圍、題目位置及規則版本保存於 `daily_tasks.coach_plan`。GET 不重抽；POST 在既有列鎖與唯一鍵下重用當天日程。

選答案仍是原單選介面，包含多個官方接受答案的判定。送出後由原 answerDiagnostic／answerFollowUp 寫入；重送同答案回傳既有結果，改已存答案或跨帳號被拒絕。離開、重新整理、另一個裝置可由 DB 恢復。頁面重新取得焦點及台北午夜會讀取最新狀態。

舊任務 `coach_plan IS NULL` 保留原有順序、ID 與進度，不為了三張卡片重抽。次日才建立新版日程；跨日舊未完成任務沿用既有 expired 政策，保存歷史並拒絕往昨天任務新增答案。

## 已完成的 Phase 2

- 每項完成後顯示當次題數、答對數、正確率、表現較佳範圍、需要再確認的章節，以及下一次複習建議。
- 當次某範圍至少 3 題且 80% 以上，才列為「本次表現較佳」；少量錯題只列為複習線索。不到 5 題的回饋明說樣本少，不宣稱進步或精熟。
- 回饋完全由已保存作答計算，不呼叫 AI，不從 Markdown 推測答案。已完成任務可展開官方答案及當下仍已發布的精選解析；未作答題目不回傳答案或解析。
- 全部實際安排題目完成後顯示今日成果與明日方向；明日實際選題仍以當時最新紀錄為準，不預先承諾固定題目。
- 本週統計以台北週一至今實際回答時間計算，依 session/item 去重；同一到期追蹤若跨日連結，不重複計次。範圍僅每日教練任務，不冒稱所有學習活動。

## Migration、部署與回復

新增 `migrations/20261017_coach_daily_plan.sql`，只加一個 nullable JSONB 欄位 `daily_tasks.coach_plan`。沒有新資料表、沒有回填、沒有刪除／更新既有題目或學習資料；NULL 保留舊流程。

`node scripts/migrate-coach-v2.mjs` 預設僅列計畫、不連 DB。正式部署前，先建立資料庫備份／還原點，再以 `--apply --backup .tmp/<新檔名>.json --env-dir <環境檔目錄>` 明確套用。Runner 先備份學習計畫、每日任務、診斷與作答快照；transaction 內前後比較原有完整紀錄，任何不符回滾。此 JSON 是本次範圍備份，不能替代全庫備份；勿提交 Git。

必須先 migration 再部署程式。失敗時回滾 transaction；程式需回退時保留新增欄位與日程、作答歷史，舊版仍可按原整串順序續作，不刪除新版分項 session。

2026-10-17 使用者明確授權正式部署。已執行上述 runner，將五張學習資料表完整備份至工作樹 `.tmp/coach-v2-before-production-20261017.json`，於交易內新增欄位並確認所有原有紀錄完全一致後提交。備份為本次學習資料範圍，不是全庫還原點。程式採既有 main → Vercel 流程；實際部署成功與否以該 commit 的 Vercel 狀態及部署後唯讀驗證為準。

## 驗證

- 單元／整合與相關回歸：71 項，62 通過、0 失敗、9 項需要外部資料庫的 opt-in 測試未啟用。
- 新增 9 組隔離 PostgreSQL 測試：新會員診斷、個人化選題、分項順序與恢復、跨帳號、重送、交易回滾、來源隔離、去重證據、題庫不足、舊任務、午夜邊界、模式與設定相容、實際 follow_up 排程、跨日週統計去重。已保存日程讀取不超過 10 次固定查詢，無逐題查詢。
- 實際 Next.js 頁面 + 既有 API 程式連接隔離 PGlite 的 E2E：診斷、三項任務、兩個瀏覽器 context 接續、回應中斷後相同答案重試、回饋、重載與三種寬度。沒有以假卡片替代任務後端。
- 手機／平板／桌面 375／768／1280：無水平溢出；截圖目視檢查。登入身份由測試 fixture 提供，未使用正式會員登入或寫入。
- TypeScript、範圍 ESLint、`npm run build`、`git diff --check` 通過。建置只有 worktree 多份 lockfile 的既有提示，未改無關設定。
- 回歸中修正兩個舊測試 loader 未載入既有答案／解析 helper 的問題；只改測試載入方式，不改 AI 或記憶功能。

執行：設定 `PGLITE_MODULE` 指向本機 PGlite、`PLAYWRIGHT_MODULE` 指向本機 Playwright，再執行 `node --test tests/coach-v2.test.mjs` 與 `node tests/coach-v2-browser.mjs`。外部資料庫寫入旗標保持關閉。

## 檔案與影響

- `lib/coach-daily.ts`：可測試的任務分配、可靠樣本門檻及回饋。
- `lib/coach-daily-service.ts`：集合讀取近期實際作答、初始診斷進度。
- `lib/daily-task-service.ts`、`lib/daily-task.ts`：重用 daily API／session，新增安排快照、分項作答及回饋資料。
- `lib/diagnostic-service.ts`：在原公開題目選取及建立快照時明確檢查 `kind='exam'`；不改評分、教練補強判定或 FSRS。
- `app/study-plan/daily/CoachToday.tsx`、`coach-today.module.css`：今日任務與完成回饋，沿用既有品牌／按鈕／卡片／Markdown。
- `app/study-plan/daily/DailyTask.tsx`：串接新版分項、續作、跨裝置刷新，保留舊日程 UI。
- `app/study-plan/ModeSelector.tsx`、`page.tsx`：教練優先、設定收合與既有診斷／補強按需載入。
- `app/study-plan/diagnostic/Diagnostic.tsx`：診斷完成後加回今日教練的入口。
- 上述 migration、runner；`tests/coach-v2.test.mjs`、`tests/coach-v2-browser.mjs`、`tests/helpers/coach-v2-fixture.mjs`。
- `tests/daily-task.test.mjs`：接上新版相依與測試 schema；`tests/ai-practice-isolation.test.mjs`、`tests/memory-test-loader.mjs`：載入既有 helper。
- 本文件。

未修改首頁、國考刷題 UI、獸醫練功房、後台、題目內容、會員、訂閱或支付。日程選題改版會影響之後新建每日任務的題目組合，這是本次預期行為；既有正式資料安全仍須在實際部署前後核對，不能以隔離測試代替。

## 尚未加入／限制

- Phase 3 今天很忙、本週優先科目、更深入弱點追蹤尚未加入。
- 原有章節間隔追蹤與 FSRS 保留。新版每日複習使用其訊號，不另創 FSRS 參數或批次回填舊卡；教練作答仍保存於 diagnostic_items，不偽裝為一般練習事件。
- 章節不是精確考點；沒有可靠標籤時不推斷相同考點。
- 沒有做正式登入會員寫入測試、正式流量壓測或真正兩條遠端 PostgreSQL 連線競爭測試。已有列鎖與唯一鍵機制沿用，隔離測試驗證重複開始、兩個瀏覽器裝置及重送語意。
