# VetExam UI/UX Foundation Phase 2

## 1. 基準與範圍

基準：`223475dff94138ad8c4dee57e512d31c71c9da07`，`style: establish scoped UI foundation for learning pages`。開始前 fetch 並確認 origin/main；從該 SHA 建立 `feat/ui-foundation-phase2` 獨立 worktree。原工作目錄的未提交修改未動。

僅修改 `/questions` 練習／模擬考呈現、`/pdf` 匯入確認 UI、Admin 的 client UI、必要 UI 元件及測試文件。`/questions` 尚未開始時仍交給既有 SubjectsPage。`/admin/feedback` 原本轉址到 reports，轉址與所有 server guards 保留。

## 2. 沿用 Phase 1

- `components/ui/foundation.module.css` 原檔不變：Typography、spacing、radius、border、shadow、state colors、focus、reduced-motion。
- `PageHeader` 用於 PDF 與 Admin；既有 `StudyIcon` 與 `ProgressBar` 繼續使用。
- `QuestionCard` 的樣式及圖片採父頁 opt-in 注入；預設仍使用原 quiz CSS。新 CSS 不透過共用 QuestionCard 載入至 review／favorites／wrong 等頁。
- 新建小型 `LoadingState`／`EmptyState`、`ImageViewer`、`AdminShell`／`TableRegion`；皆有多處實際使用。不新增 generic table framework。

## 3. 修改／新增檔案

修改：

- `app/questions/page.tsx`
- `components/questions/QuestionCard.tsx`
- `app/pdf/page.tsx`、`app/pdf/ReviewImages.tsx`
- `app/admin/AdminDashboard.tsx`、`app/admin/SystemHealth.tsx`
- `app/admin/questions/QuestionsAdmin.tsx`
- `app/admin/users/Users.tsx`、`app/admin/reports/Reports.tsx`
- `tests/admin-questions-browser.mjs`（可使用本機 production fixture；default 原有 guard 檢查保留）
- `tests/due-review-browser.mjs`（alert selector 限定 main，避開 Next route announcer）
- `tests/pdf-review-browser.mjs`（七種寬度、解析次數與各階段截圖）

新增：

- `app/questions/focus.module.css`
- `app/pdf/foundation-pdf.module.css`、`app/pdf/ReviewQueue.tsx`
- `components/ui/AdminShell.tsx`、`components/ui/admin.module.css`
- `components/ui/ContentState.tsx`、`components/ui/content-state.module.css`
- `components/ui/ImageViewer.tsx`、`components/ui/image-viewer.module.css`
- `tests/ui-foundation-phase2-browser.mjs`、`tests/ui-phase2-fixture.mjs`
- 本文件。

## 4–6. Before / After

| 頁面 | Before | After |
| --- | --- | --- |
| Questions | 科目與收藏先於題目；原始圖片無放大；選項與詳解層級較接近 | 題號／細進度置前；820px 閱讀欄，20–24px 題幹／1.85 行高；圖片完整 contain、預覽最高 400px、原生 modal 放大；選項正確／錯誤以文字與邊框識別；未選中的正解以 success outline；收藏放到解析後 |
| PDF | 三個工作步驟；待確認題號清單；信心僅數值 | 以既有狀態呈現「上傳→解析→確認→完成」；原生 file input 支援點選／拖入，檔案名稱與容量；真實題目數／需確認／圖片／缺答案摘要；既有信心門檻加文字標記；上一個／下一個待確認及剩餘數；圖片可放大，原本移除／重排／改配保留；手機操作列進入文件流避免蓋住編輯欄 |
| Admin | 各頁 header／表格／載入不同；數值呈現為普通粗體；批次操作先於搜尋 | 共用 header、navigation、stat 外觀、表格 region；搜尋先於批次操作；可見 form labels、狀態 badge、空／載入／錯誤與重試；手機多欄資料表局部橫向捲動，頁面本身不溢出 |

僅這些頁面的全域浮動回報／管理入口以 scoped sibling selector 放到正文之後，保留連結與功能，避免遮住作答選項及確認按鈕。

PDF 四個視覺里程碑不取代原 step 1/2/3：step 1 idle 為上傳，step 1 loading 為解析，原 step 2/3 為確認，completedImport 為完成。分類／確認流程不變。ReviewQueue 使用既有 `!reviewed && (confidence < 90 || warnings.length > 0)` 待确认條件，分類 filter 沿用 warnings；70／90 門檻、assessQuestion 與 readyForReview 未改。只增加導覽用 selected ID。

## 7. Dependencies、來源與 tokens

新增 dependency **0**。package.json／lockfile 不變；沒有安裝 Radix、TanStack、圖表、動畫或 image library。第三方 copied code：**無**。實際 adapted 的是專案自身 quiz／PDF CSS、既有 JSX 與 Phase 1 primitives。

延續 Phase 1 研究並再次閱讀官方來源：

- [shadcn Data Table](https://ui.shadcn.com/docs/components/data-table)、[Dialog](https://ui.shadcn.com/docs/components/dialog)、[MIT license](https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md)：參考工具列／表格層級與 modal 可用性，沒有引入其依賴。
- [Origin UI（現導向 coss/ui）](https://originui.com)、[原 Origin repository license](https://raw.githubusercontent.com/origin-space/originui/main/LICENSE)：compact filters／toolbar 視覺研究；該原 repository 目前是 AGPL-3.0，不複製其程式碼。
- [Tremor 官方文件](https://www.tremor.so/docs/getting-started/installation)、[Apache-2.0 license](https://raw.githubusercontent.com/tremorlabs/tremor/main/LICENSE)：只參考數值卡／compact dashboard 排列，不新增圖表。

維持 Phase 1 title 28–34、section 22（手機20）、card18、body16、secondary14、caption12；section32（手機24）、gap16、page padding24（手機16）、card24（手機20）；button/input radius10、card/dialog16、badge pill；單一 border/shadow/state tokens。Admin 為高密度用途用20／16px卡片 padding；刷題手機卡片水平16px。未更改科目 palette。只有既有進度 200ms transition，沒有裝飾動畫。

## 8. Mobile／截圖

Questions、PDF 上傳／審核、四個 Admin UI：320 / 375 / 430 / 768 / 1024 / 1280 / 1440，全數無 page 水平 overflow。包含長中文題幹、A–E圖片題、A–D普通題、答對／答錯／解析、下一題與 viewport 切換；仍只有一組當前選項，沒有 question stacking。

本機截圖：`.tmp/ui-phase2/before/`、`.tmp/ui-phase2/after/`、`.tmp/ui-phase2/pdf-before/`、`.tmp/pdf-review/`。可開 `.tmp/ui-phase2/comparison.html` 比較手機375／桌面1280。Questions before／after 為 production；Admin/PDF baseline 為修改前 dev，因此 baseline 可能包含 Next dev indicator；after 都用 production build 與 mock 資料。開發版截圖期間曾遇熱更新錯誤，完成驗證以 production runs 為準。

## 9. Accessibility

- 語意 button、既有選項 aria-pressed／disabled、答案 role=status 不變；正誤有 icon、文字及邊框。
- controls min44px；Next 按鈕中心 hit test 不被遮住；Tab／Enter／Space 操作通過。
- focus-visible 3px；表格可鍵盤聚焦／橫向捲動；th scope=col；label／aria-label。
- 原生 dialog showModal，單一 close 按鈕的 Tab／Shift-Tab 循環；ESC；關閉後回到原觸發按鈕。
- reduced-motion 下 progress transition 為0s；Skeleton 靜態不閃動。
- 沿用 Phase 1 已檢查之 state 配色及5.55:1主要按鈕對比；未宣稱全站 WCAG 認證。

## 10. Performance

不增加 dependency、chart、資料查詢或解析工作。ImageViewer 只有自己的 modal UI state；preview lazy loading，modal 大圖只在開啟時掛載。PDF 原 IntersectionObserver／image queue／combineImages／callbacks 保留；測試中編輯、重排、改配直到匯入，PDF parse **1次**、image extraction **1次**、AI **0次**。摘要只遍歷現有題目陣列；沒有新 state machine。Admin 仍使用原有 pagination／100題頁大小，沒有擴大載入數量。未做完整 bundle byte 或 React profiler 基準量測。

## 11. Tests

- `node --test tests/*.test.mjs tests/pdf-page-auth.test.cjs`：**138 pass / 1 fail / 20 skipped**。包含 Phase 1–8、FSRS／due、PDF layout／batches、Admin、選項／題目等既有 suites。
- 唯一 unit failure：`subscription.test.mjs` 的 manual import mock 缺少 `@/data/exam-chapters`；在未修改的223475df重跑，同樣失敗。未修 scope 外測試／產品邏輯。20個 DB integration tests 未啟用。
- 通過16組本機 browser suites：study-plan、diagnostic、confirmation、reinforcement、follow-up、daily-task、custom-plan、notes、account-learning、ui-foundation（Phase 1三頁）、due-review、option-distribution、pdf-batches、pdf-review、admin-questions（mock UI模式）、ui-foundation-phase2。
- PDF browser 覆蓋 upload／processing／success／低信心／圖片／edit／人工確認／classification later／completion，驗證匯入 payload、file hash、圖片無損合併80×106與原回歸一致。
- Admin mock suite 覆蓋 A–D鍵盤／返回題號、貼上僅預覽、明確統計確認、序列長度 guard、單題ID編輯、缺答案practice／exam。原 default 真實server guard檢查被假DB的 Better Auth schema lookup阻擋；未用正式DB補跑。server guards檔案未變。
- 額外舊 `chapter-classification-browser` 停在期待直接顯示分類panel；與目前V2人工確認步驟不相容，baseline同樣失敗。`question-stats-browser` 需要本機真實題庫資料，假DB下無法執行。沒有將這兩項列為通過。
- 新增／修改程式 targeted lint（不含PDF頁既有錯誤）0 errors、3個 img warnings；PDF頁維持既有set-state-in-effect及no-explicit-any兩項errors、hook dependency warning。未修未動邏輯。
- 差異稽核：42個非JSX函式、14個effect／callback與基準完全一致。foundation tokens、共享quiz/pdf CSS、packages完全一致。API／lib／data／schema／migration diff皆空。

重跑UI：設定 `PLAYWRIGHT_MODULE` 指向環境既有Playwright，`TEST_BASE_URL` 指向本機server。`node tests/ui-phase2-fixture.mjs --setup` 只在本機建立Admin client fixture；build/start後執行UI suites；`ADMIN_UI_BASE_URL` 可讓既有Admin suite使用該fixture。最後必須 `node tests/ui-phase2-fixture.mjs --cleanup` 並重新build，確保產物不含繞過server guard的測試route。本次已移除fixture後完成最終build。

## 12. Production build

`npm run build` 通過；使用不可連線的 `127.0.0.1:1` fixture DB URL與假auth secret，不讀取正式env。Next workspace root、Better Auth baseURL／schema檢查警告保留。最終build不含UI fixture route；沒有migration／正式資料操作。建置記錄 `.tmp/build-final.log`。本次交付為本機commit，未部署新階段至正式站。

## 13. 明確未修改

question selection、answer checking、learning records、FSRS、due scheduling／engine、study plan、weakness、reinforcement、daily tasks、custom plan；PDF parser、image extraction、confidence algorithm、chapter classifier／official mapping；Notes、favorites／wrong邏輯；Auth／server guards、DB／schema／migration、Subscription／Billing／PRO、API semantics、Homepage、official question contents、subject palette。沒有使用者資料修改，沒有 unrelated refactor 或 repository 全面格式化。

## 14. 最終 commit

最終SHA於交付訊息提供（避免commit文件自我引用）；分支 `feat/ui-foundation-phase2`。
