# Phase 8：筆記系統 V1

基準：Phase 7／GitHub `main` `0e3ec575cfa888d5bb2849bbfc6927d7eef36073`。
開始前已 fetch 並確認本機與遠端 SHA 相同，閱讀相關 Next.js 16 本機文件、既有管理員判定、題目收藏、正式分類、弱點與補強頁。
正式 DB 原先沒有 notes 或筆記互動表，Better Auth `user.id` 是 TEXT。
工作區另有付款、訂閱等既有未提交修改，本次以乾淨 main 副本加限定檔案驗證及發布，不包含其他修改。

## 1. 修改檔案

- `app/study-plan/ModeSelector.tsx`：新增「學習筆記」連結。
- `app/study-plan/confirmation/WeaknessOverview.tsx`：有正式章節的弱點建議新增「查看相關筆記」。
- `app/study-plan/reinforcement/Reinforcement.tsx`：替換預留筆記區，保留自行複習與確認流程。
- `tests/reinforcement-browser.mjs`：預留文案斷言改為筆記空狀態，確認無筆記仍能繼續複習。

## 2. 新增檔案

- `lib/notes.ts`：共用型別、長度限制、資料驗證、正式篩選與相關連結。
- `lib/notes-service.ts`：筆記查詢、建立／編輯、soft delete、收藏及 helpful。
- `lib/notes-http.ts`：API 認證、來源與 body 驗證及錯誤回應。
- `app/api/notes/route.ts`、`app/api/notes/[id]/route.ts`。
- `app/notes/page.tsx`、`app/notes/[id]/page.tsx`、`app/notes/new/page.tsx`、`app/notes/[id]/edit/page.tsx`。
- `app/notes/NotesList.tsx`、`NoteCard.tsx`、`NoteDetail.tsx`、`NoteEditor.tsx`、`RelatedNotes.tsx`、`notes.module.css`。
- `migrations/20260920_notes.sql`、`scripts/migrate-notes.mjs`。
- `tests/notes.test.mjs`、`tests/notes-browser.mjs`、`tests/notes-production.mjs`。
- 本文件。

## 3～4. DB 與 schema

只新增三張表，不新增或修改既有表的欄位：

| 表 | 欄位與用途 |
| --- | --- |
| `notes` | UUID id；TEXT author_id FK → user.id；type、title、content、subject、chapter、visibility、status；created_at、updated_at、deleted_at |
| `note_helpful` | note_id、user_id、created_at；主鍵 (note_id,user_id) |
| `note_favorites` | note_id、user_id、created_at；主鍵 (note_id,user_id) |

筆記內容只保存文字。title 上限 120 UTF-16 字元、content 上限 15,000，API request body 上限 65,536 bytes，均由 `lib/notes.ts` constants 管理；migration 額外設資料庫長度約束。
必要索引為未刪除筆記的科目／章節／類型／狀態／建立時間、作者／更新時間、收藏的 user_id／note_id。互動表主鍵已支援 note_id 查詢與去重。
刪除設定 deleted_at，所有讀取一律排除；原有互動 relation 保留，不產生 FK 問題。

## 5. 官方與社群區分

- `official`：visibility 固定 public；status 為 draft 或 published。
- `community`：visibility 為 private 或 public；status 為 active 或 hidden。
- 官方標記「VetExam 筆記」，社群標記「社群筆記」，詳細頁明確說明使用者分享、未經官方審核。
- 類型建立後不可變更，避免將社群內容直接轉成官方背書。
- 不自動生成或填入官方內容，由管理員人工建立。

## 6～7. 讀取與編輯權限

| 情境 | 讀取 | 編輯／刪除 |
| --- | --- | --- |
| 社群 private | 只有作者，管理員也無額外讀取權 | 作者 |
| 社群 public active | 公開閱讀 | 作者 |
| 社群 hidden | 只有作者 | 作者 |
| 官方 draft | 管理員 | 管理員 |
| 官方 published | 公開閱讀 | 管理員 |
| 已刪除 | 不可讀 | 重試刪除具冪等性 |

沿用目前 `ADMIN_USER_ID` 與已驗證 session.user.id 的管理員判定，未改 Better Auth 或全站認證政策。
公開筆記沿用公開題庫可讀的方式；新增、編輯、刪除、收藏與 helpful 均需登入。
所有權限在 API／SQL 層檢查，客戶端不能指定 author_id、admin 或 user_id。
公開轉私人、hidden、取消發布或刪除後，列表、詳細頁與收藏查詢都重新檢查可讀性，舊網址與收藏 relation 不能繞過。
作者只回傳 user.name／備援顯示名稱；不回傳 author_id、email 或 auth 內部資訊。

## 8～10. Helpful 與收藏

每次 PATCH 送出明確的 `{kind,active}`，採 ON CONFLICT DO NOTHING／DELETE，重試不會反覆切換或累加。
兩張互動表以 (note_id,user_id) 主鍵防重複。操作前鎖定公開筆記列，與修改公開狀態、刪除互斥。
僅公開 active 社群／published 官方筆記可互動；私人、草稿與 hidden 不接受互動。

原本 `data/favorites.ts` 是題目物件的 localStorage 收藏。筆記需要跨登入、帳號權限及公開狀態檢查，所以新增獨立 `note_favorites`；沒有改動原題目收藏資料、頁面或語義。

## 11. 科目／章節

完全沿用 `data/exam-chapters.ts` 的 EXAM_SUBJECTS、chapterGroups、validChapter。
每篇必須選一科與該科一個主要章節。換科清除原章節，API 拒絕非正式名稱或跨科章節。
不新增 mapping、tags 或題目分類。

## 12～13. 弱點與補強串接

弱點建議使用正式 subject＋chapter 建立 `/notes?subject=…&chapter=…&sort=helpful`。
列表先官方 published，再社群；社群以 helpful 或最新排序，分頁每頁 20 篇。
補強預留區分別查詢同科同章節的官方與社群公開筆記，各顯示最多 3 篇，官方在上、社群依 helpful 排序。
沒有筆記或服務暫時無法連線時顯示說明，保留「查看相關筆記」與自行複習流程。
未增加閱讀門檻、閱讀計分、mastery 更新、view count 或事件追蹤。

## 14～15. 文字安全與 storage

textarea 編輯，React 文字節點顯示，CSS `white-space: pre-wrap` 保留換行；沒有 Markdown renderer、HTML 注入或 dangerouslySetInnerHTML。
測試中的 script、img/onerror 字串顯示為文字，不產生 img DOM，也不執行腳本。
API 只接受 JSON 許可欄位，拒絕 multipart、附件欄位、NUL 與 data URI base64。沒有上傳入口、binary column 或附件解析。
沒有新增 rich-text 套件、AI、外部 storage 或外部服務。

## 16. 驗證與 build

- `NOTES_DB_TEST=1 node --test tests/notes.test.mjs`：3 組通過，含實際 PostgreSQL TEMP fixtures；驗證私人／官方草稿、所有權、跨交易保存、去重／取消、公開轉私人、hidden、unpublish、soft delete、排序、章節與分頁。
- 規則／API 與既有 Phase 1～7 回歸共 38 項通過。此次未改教練／自訂後端，8 組條件式 DB 測試在該批次未啟用；筆記 DB 測試另行啟用並通過。
- notes 瀏覽器流程：建立私人、公開分享、編輯、官方 draft／published、收藏與 helpful、XSS、精確篩選、相關筆記、自行複習、刪除與權限變更。
- 既有 reinforcement、custom-plan、daily-task、diagnostic、follow-up 瀏覽器回歸通過。
- 手機與平板 320／375／768／1280 寬度無橫向溢出；原有首頁回歸亦涵蓋 6 種寬度。
- 本次檔案 ESLint 通過；乾淨發布副本 `npm run build` 通過。
- 遷移於正式 DB 交易中執行兩次、確認既有 users／questions／answers／plans 筆數一致後回滾，試跑通過。正式套用用同一腳本加 `--apply`。
- 發布後以 `tests/notes-production.mjs` 唯讀檢查公開列表、認證保護、空狀態、題庫與手機版；不建立正式測試筆記或使用者。

## 17. Scope

未修改首頁、全站 navigation、題目收藏、錯題、PDF、手動題庫、解析、Subscription、PRO、Better Auth、其他 Admin 功能或正式分類。
教練與自訂進度的演算法、資料結構與作答流程皆未改動；既有頁面僅增加要求的筆記入口與替換預留區。
不加入留言、追蹤、私訊、通知、AI、圖片或附件。
