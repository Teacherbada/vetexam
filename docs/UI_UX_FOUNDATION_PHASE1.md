# VetExam UI/UX Foundation Phase 1

## 基準與範圍

- GitHub `Teacherbada/vetexam` main：`fac7bb37e4c09b666a8fe7c0fb2c6ca20b67d5ee`，以 `git ls-remote origin refs/heads/main` 核對。
- 分支：`feat/ui-foundation-phase1`；獨立 worktree，未混入原工作目錄既有未提交變更。
- 僅 `/analysis`、`/study-plan`、`/review` 採用。既有共享 `analysis.module.css`、`study-plan.module.css`、`globals.css`、`home.css`、`quiz.module.css` 保持基準原樣。
- 不新增產品功能；只有 JSX 排版、呈現用 class、樣式與驗證文件。

## 官方 UI 研究與 license

研究日期：2026-09-25。未安裝任何 UI 套件，未複製第三方原始碼；以下為視覺與語意模式參考。新增 CSS 與 PageHeader 由本專案自行實作。

| 專案 | 官方資料與授權 | 本次採用／取捨 |
| --- | --- | --- |
| shadcn/ui | [Components](https://ui.shadcn.com/docs/components)、[MIT](https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md) | 研究 Card、Button、Badge、Progress、Tabs、Breadcrumb、Skeleton、Empty、Dialog、Drawer、Sheet、Tooltip、Data Table。採用一致 card 邊界、標題／描述階層、明確 focus、空狀態與主要動作的呈現原則；保留原生 button/link/select/details。沒有為本次不需要的互動建立元件。 |
| Origin UI | [官網現導向 coss/ui](https://originui.com)、[原始庫 AGPL-3.0](https://raw.githubusercontent.com/origin-space/originui/main/LICENSE) | 研究 input/select、filter、segmented control、search、pagination、toolbar 的分組模式；頻率篩選沿用原生 select 和 aria-pressed buttons，增加可換行的視覺群組。不複製 Origin/coss 程式碼。 |
| Tremor | [Card](https://www.tremor.so/docs/ui/card)、[Progress Bar](https://www.tremor.so/docs/visualizations/progress-bar)、[Area Chart](https://www.tremor.so/docs/visualizations/area-chart)、[License](https://raw.githubusercontent.com/tremorlabs/tremor/main/LICENSE) | 研究 dashboard 的總覽→分科→下一步、統計數字階層、圖表與進度呈現。原始庫 Apache-2.0，列有部分元件 MIT notices。只借鑑版面，保留既有 SVG ring，不新增 chart library 或新圖表。 |
| Magic UI | [Number Ticker](https://magicui.design/docs/components/number-ticker)、[MIT](https://raw.githubusercontent.com/magicuidesign/magicui/main/LICENSE.md) | 研究數值轉場；本次不引入 number animation 或 Motion dependency。 |
| Kokonut UI | [Installation](https://kokonutui.com/docs)、[AI State Loading](https://kokonutui.com/docs/ai/ai-loading)、[MIT](https://raw.githubusercontent.com/kokonut-labs/kokonutui/main/LICENSE) | 研究狀態切換的輕量回饋；不採用 spinner/log cycling 或其他裝飾動畫。 |

實際 adapted：VetExam 自己的既有 card／ring／progress 樣式與頁面結構。第三方 copied code：無。新增 dependencies：**0**；package.json、package-lock.json 未改。

## Foundation 規則

`components/ui/foundation.module.css` 只在選定三頁 root 啟用，不變更 `:root`。

| 類別 | 規則 |
| --- | --- |
| Typography | page title 28–34px／1.25；section title 22px（手機 20）；card title 18px；body 16px／1.65；secondary 14px；caption 12px；統計數字 tabular-nums |
| Width | 共用上限 token 1160px；review 閱讀欄刻意維持 840px，避免 dashboard 化 |
| Spacing | section 32px（手機 24）；grid gap 16px；card padding 24px（手機 20）；page padding 24px（手機 16） |
| Radius | button/input 10px；card/modal 16px；badge pill。modal token 僅保留規則，未新增 modal |
| Border/shadow | 1px `#dce3dd`；card `0 1px 3px rgb(38 51 46 / 4%)`；互動 focus 使用 3px `#3f725f` |
| State colors | success `#356748/#eaf5ee`；warning `#73551d/#fbf3df`；danger `#a44343/#fbecec`；info `#305f7b/#edf4f8`；neutral `#56645c/#f1f3ed`（文字／底色） |
| Motion | 僅既有 progress fill 200ms；reduced-motion 關閉三頁內 transition/animation；無新裝飾動畫 |

科目 palette 完全未改。state color 不取代科目色。主要按鈕文字／底色對比 5.55:1，secondary／頁底 5.69:1，以上五種 state 文字／底色均 ≥5.29:1。這是本次 tokens 的檢查，非宣稱全站 WCAG 認證。

最小 reusable UI：只有 `PageHeader`（三頁皆使用）與 opt-in foundation CSS。沿用既有 `StudyIcon`、`ProgressBar`、`QuestionCard`，不新增沒有實際跨頁需求的 Card/Badge/StatCard/Skeleton 包裝。

## Before / After

| 頁面 | Before | After |
| --- | --- | --- |
| `/analysis` | 字級、卡片 padding 不一；近期統計 3+1 排列；手機卡片擠在兩欄 | 總覽／科目／排名／建議／趨勢／頻率分組保留；字級與邊框一致；趨勢 4/2/1 欄；手機科目卡單欄、ring 與說明並排；頻率 toolbar 可換行 |
| `/study-plan` | 模式狀態與說明先於今日任務；到期複習在模式介紹之後；首頁 CSS 影響圓角 | 現有今日任務或自訂進度預覽置前，接到期複習、補強／診斷 disclosure、模式介紹；保留所有介紹與切換操作；本頁局部 CSS |
| `/review` | 待複習數字混在普通段落，CTA 左側排列 | 今日待複習數字放大；現在可複習／未來七天為次要文字；CTA 居中且至少 44px；保持單一簡單卡片 |

數值、文字狀態判定、連結目標、條件渲染、事件處理與 API 請求不變。`DailyTask` 自身包含的補強預覽仍保留原順序與行為；本次沒有改其內部邏輯。

## 驗證

- 七種寬度：320 / 375 / 430 / 768 / 1024 / 1280 / 1440。
- 三頁相同隔離 fixtures 的 before／after full-page 截圖；另有 after viewport 截圖。
- `tests/ui-foundation-browser.mjs`：無水平 overflow、page padding ≥16px、無 client page error、頁內 keyboard focus、44px 操作目標、原生 details Enter 開關、filter Enter 切換 aria-pressed、progress 可見且為 40%、reduced-motion。
- Production 截圖驗證修正新分析 CSS 從基準帶入的 BOM，避免正式 CSS 串接後第一條 page padding/background selector 失效；原共享 CSS 未改。
- 新增／修改 TSX 和測試檔 targeted ESLint 通過；沒有修 scope 外 lint。
- Production `npm run build` 通過。建置需 DATABASE_URL 存在，因此使用 `127.0.0.1:1` 的不可連線 fixture URL 與假 auth secret，沒有載入真實環境檔。建置有既有 workspace root 警告及預期的 Better Auth DB schema 連線警告；不是正式 DB 整合驗證。
- 現有 Phase 1–8、分析、FSRS／Review、learning suites：**57 pass / 0 fail / 11 skipped**。11 項需 DB 的整合測試未啟用，未對真實 DB 執行 migration 或 fixture 寫入。
- 現有 10 組 browser suites 通過：study-plan、diagnostic、confirmation、reinforcement、follow-up、daily-task、custom-plan、notes、due-review、account-learning。皆使用本機伺服器與 mock；既有 suite 未攔截的 API 只能遇到不可連線 fixture DB。
- 原始共享 CSS 與 package files 對照基準一致；三頁的 JSX return 之前 business logic 對照基準一致。

本機 artifacts（不納入產品 bundle）：`.tmp/ui-foundation/comparison.html`、`.tmp/ui-foundation/before/`、`.tmp/ui-foundation/after/`、`.tmp/regression.log`、`.tmp/build.log`、`.tmp/*-browser.log`。

重跑方式：設定 `PLAYWRIGHT_MODULE` 指向環境既有 Playwright（不新增專案 dependency），`TEST_BASE_URL` 指向本機 production server，執行 `node tests/ui-foundation-browser.mjs`。`UI_PHASE=before` 可在基準 checkout 產出相同 fixtures 的 baseline。

## 修改檔案

- `components/ui/PageHeader.tsx`
- `components/ui/foundation.module.css`
- `app/analysis/page.tsx`
- `app/analysis/Trends.tsx`
- `app/analysis/Frequency.tsx`
- `app/analysis/foundation-analysis.module.css`
- `app/study-plan/page.tsx`
- `app/study-plan/ModeSelector.tsx`
- `app/study-plan/foundation-study-plan.module.css`
- `app/review/DueReview.tsx`
- `app/review/review.module.css`
- `tests/ui-foundation-browser.mjs`
- `docs/UI_UX_FOUNDATION_PHASE1.md`

## 明確未修改

題庫／作答邏輯、FSRS、due scheduling、weakness calculations、accuracy/ranking/minimum sample、Frequency/Trends calculations、subject palette、practice links、Coach／Daily tasks／custom plan calculations、PDF parser/image extraction、AI chapter classification、Notes logic、Auth、Subscription/Billing/PRO、DB schema、API behavior、Admin、Homepage、Questions、Favorites、Wrong、question contents。

沒有 DB migration，沒有真實使用者資料修改，沒有發布／部署。最終 commit 由本分支 `git rev-parse HEAD` 取得，並於交付訊息列出，避免文件自我引用 commit SHA。
