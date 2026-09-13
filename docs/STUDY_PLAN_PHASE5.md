# Phase 5：間隔追蹤與掌握穩定

基準：Phase 4 `dde993ea364c573520c0e54cb209b8fe610dea36`。開始前已 fetch GitHub main，確認正式 schema、補強／診斷資料現況與原有未提交修改。僅納入本階段追蹤功能及必要整合。

## 流程與時間

立即驗證通過 → 短期掌握 → **3 天後**第一階段追蹤 → 通過仍為短期掌握 → 從**實際完成時間再隔 7 天**建立第二階段 → 通過為掌握穩定。

第二階段不是固定在最初補強後第 7 天；準時完成第一階段時，第二階段約在最初補強後第 10 天。逾期不取消、不扣分，仍可完成；下一階段從實際完成時間計算。

集中設定在 `lib/follow-up-config.ts`：

| 設定 | V1 |
| --- | --- |
| `FOLLOW_UP_INTERVALS_DAYS` | `[3, 7]` |
| `FOLLOW_UP_QUESTION_COUNT` | `2` |
| `FOLLOW_UP_MIN_QUESTIONS` | `2` |
| `FOLLOW_UP_PASS_THRESHOLD` | `0.8` |
| `FOLLOW_UP_RECENT_DAYS` | `7`，只用於避開近期原題 |
| `MAX_DUE_FOLLOW_UPS_PER_SESSION` | `1` |

每輪排程保存 intervals 快照，測驗保存 threshold、minimum 與重複題 ID。更改集中設定只影響新排程／新測驗，不改寫已完成事件。階段數依保存的 intervals 長度判斷，因此新週期改成 `[2, 5, 14]` 不必修改 UI 或 API 的階段判斷。

日期由伺服器／PostgreSQL 決定，使用 TIMESTAMPTZ 與每一天 24 小時的實際間隔。客戶端不能提交時間或提早開始。

## 儲存與唯一性

新增一張 `chapter_follow_ups`，包含 id、user_id、subject、chapter、reinforcement_task_id、review_attempt、stage、due_at、status、completed_at、result、intervals、session_id、created_at。

不新增既有資料表欄位。`diagnostic_sessions.kind` 增加 `follow_up`，重用既有 reinforcement_task_id 與 verification_metadata；題目快照、答案、正誤、時間仍寫入 `diagnostic_items`。原有首答統計語意不變，追蹤結果不改寫 Phase 3 歷史分析。

`reinforcement_tasks.status` 僅增加：

- `stable`：掌握穩定。
- `queued`：需要再次補強，尚未成為主要進行中任務。

資料庫保存的追蹤 status 為 pending／completed／failed／cancelled；`due` 在讀取時由 `pending AND due_at <= CURRENT_TIMESTAMP` 推導，不依賴 cron，也不會因使用者未登入而漏標。`follow_up_due_idx` 可供未來每日任務查詢到期項目。

防重複：

- unique `(reinforcement_task_id, review_attempt, stage)` 防同一複習週期、同階段重建。
- partial unique `(user_id, subject, chapter) WHERE status='pending'` 防同章節多個尚未完成追蹤。
- session_id unique；複合外鍵保證 task、session 與使用者一致。
- 主要補強 partial unique index 仍限制每人一個 reviewing／reviewed／verifying／needs_work／deferred。queued 不占用主要任務，避免追蹤失敗時與另一個補強衝突。
- 所有排程建立、開始、作答、結果轉換沿用 study_plans 列鎖及交易。最後一題、追蹤結果、下一階段／章節狀態一起提交。
- 重複開始回傳同一 session；同答案重送不重複計分或排程；不同答案拒絕覆寫。

## 選題與不足處理

只從公開、可評分、相同正式 subject＋chapter 取題；建立快照時重新驗證分類及公開性。沒有混入一般刷題，也不修改一般題庫的抽題規則。

以近期出現／作答資料、此補強任務的立即驗證及前次追蹤 ID、使用次數建立排序。先避開近期原題與前次驗證／追蹤題，在可用範圍內優先未作答題；已作答題取較久以前的題，同等時間優先使用次數較少的題目。最後才回用近期題。隨機平手順序避免固定每次抽相同順序；同一次測驗不重複同一 ID。

題庫充足時，第一／第二階段優先不同題。題庫不足可使用舊題，repeated_question_ids 記錄於 session metadata，結果保存 reused 數量。沒有建立 confidence score。

零題：不建立空 session，保留到期任務並提示稍後再試。一題：允許完成，但低於最低樣本，不標掌握穩定，結果明示資料不足並回補強佇列。兩題：需 2/2 通過；1/2 顯示「這個章節目前仍有些不穩定」，以答對題數呈現，不做精確掌握百分比解讀。

## 狀態、失敗與歷史

第一階段通過：follow-up completed，任務保持 short_term，排下一階段。最後階段通過：任務 stable。穩定只影響國考教練新補強建議，一般刷題仍可出現該章節；未加入自動動態降級機制。

任一階段未通過：保存 failed 與實際結果，任務標 queued；未完成的同週期追蹤取消但不刪除。國考教練先讓既有 active 補強完成，再處理到期追蹤，最後顯示再次補強／新弱點建議。

使用者開始再次補強時，重用原 reinforcement task 並增加 review_count，回 reviewing，必須重新回報完成複習與通過立即驗證。沿用既有任務避免重複；新週期可以重新建立第一階段追蹤。原始診斷、每輪 verification、先前追蹤成功／失敗都保留成獨立 session／事件，不以新分數覆蓋舊分數。

## 畫面與 API

`/study-plan` 與既有分析頁的補強卡片共用相同優先序：主要 active reinforcement → 到期追蹤（一次一個，續作優先，否則依 due_at）→ queued／新弱點。

`/study-plan/follow-up` 顯示待追蹤時間、到期開始、逐題儲存進度、結果與各週期追蹤紀錄；支援 `?id=` 查看特定歷史事件。離開後重新登入可從 DB 續作。沿用現有卡片、按鈕、題目選項、圖片及進度條樣式。

新增 `/api/study-plan/follow-up`：GET 讀取、POST 開始、PUT 作答。身份取自現有 session，拒絕跨來源寫入、客戶端 user_id／分數與無效 ID，JSON 上限 1KB，回應 private/no-store，資料庫錯誤不暴露內部資訊。

## 檔案清單

新增：

- `lib/follow-up-config.ts`、`lib/follow-up.ts`：設定、型別與選題。
- `lib/follow-up-store.ts`、`lib/follow-up-service.ts`：排程／到期查詢及測驗交易。
- `app/api/study-plan/follow-up/route.ts`。
- `app/study-plan/follow-up/page.tsx`、`FollowUp.tsx`。
- `migrations/20260917_follow_ups.sql`、`scripts/migrate-follow-ups.mjs`。
- `tests/follow-up.test.mjs`、`tests/follow-up-browser.mjs`。
- 本文件。

修改：

- `lib/diagnostic.ts`、`lib/diagnostic-service.ts`：讓既有 session／snapshot／答題流程支援 follow_up。
- `lib/reinforcement.ts`、`lib/reinforcement-service.ts`：通過時排程、stable／queued、續用既有任務與首頁到期資料。
- `app/study-plan/reinforcement/Reinforcement.tsx`：必要追蹤入口及目前狀態呈現。
- `tests/reinforcement.test.mjs`：Phase 4 回歸測試加入新排程依賴與 schema。

## 驗證與 migration

```powershell
$env:FOLLOW_UP_DB_TEST='1'
$env:REINFORCEMENT_DB_TEST='1'
$env:WEAKNESS_DB_TEST='1'
$env:DIAGNOSTIC_DB_TEST='1'
node --test tests/follow-up.test.mjs tests/reinforcement.test.mjs tests/weakness.test.mjs tests/diagnostic.test.mjs
node --test tests/study-plan.test.mjs tests/question-stats.test.mjs tests/exam-chapters.test.mjs
```

23 項規則、API 與 PostgreSQL 測試通過，涵蓋排程起點、尚未到期、逾期、兩階段通過、重送、跨帳號、精確章節、不同題、重題與零／一題不足、回補強佇列、唯一 active、歷史不變及 Phase 1～4 回歸。另 12 項模式、首答及一般題庫回歸通過；另兩項無關 DB 測試未啟用。整合測試使用獨立 Neon 直連與 session 暫存表，不寫正式使用者紀錄。

瀏覽器測試設定 `PLAYWRIGHT_MODULE` 與 `TEST_BASE_URL` 後執行 `tests/follow-up-browser.mjs` 及既有 `tests/reinforcement-browser.mjs`。兩者皆通過；涵蓋等待／到期、續作、兩階段結果、錯誤恢復與首頁優先序，320／375／768／1280px 無水平溢出或頁面 JS 錯誤。完整登入流程以 fixture 驗證，正式站檢查公開頁面及未登入權限。

`npm run build`、修改範圍 ESLint 通過。發布另以 scoped commit 的乾淨 archive 建置與手機檢查，避免依賴原工作區未提交修改。

`node scripts/migrate-follow-ups.mjs`：transaction 內雙次 migration，驗證既有 task/session/item 數不變，並回滾。加 `--apply` 才提交。腳本明確使用 public schema、lock timeout，並依集中設定為既有 short_term 任務補建第一階段，due_at 從原 verification_completed_at 起算。開始本階段時正式 task/session/item 皆為 0，沒有重複既有資料或待補建任務。

未修改首頁其他內容、自訂進度、一般刷題、PDF、手動題庫、解析、收藏、錯題、Auth、Subscription、PRO、Admin、題目或正式章節分類；原有未提交變更不納入本次 commit。沒有每日任務、通知、筆記系統、AI 或複雜 mastery score。
