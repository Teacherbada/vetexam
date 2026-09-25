# VetExam UI/UX Foundation Phase 3

1. **基準 SHA**：`a01b0fb3fd1b5bf637fe9da28a878e870b953a76`。開始與提交前均 fetch 並確認 origin/main；使用隔離 worktree `.worktrees/ui-foundation-phase3` / `feat/ui-foundation-phase3`。原工作目錄既有未提交修改未動。

2. **重用 Phase 1 / 2**：原 `foundation.module.css` tokens、`PageHeader`、`LoadingState` 靜態 Skeleton、`EmptyState`、`StudyIcon`、原有 `ProgressBar`；Wrong Test 重用 Phase 2 `focus.module.css`。未另建 design system。本次沒有直接複製第三方原始碼，延續前兩階段已研究的 shadcn/ui、Origin UI 與 dashboard 視覺規則；沒有引入 Magic UI / Kokonut 動畫。

3. **頁面範圍**：首頁、Subjects、Favorites、Wrong、正式入口仍在使用的 Wrong Test、Notes list/detail、Login、Register。筆記 new/edit、其他產品頁面與全域 layout 未修改。

4. **新增／修改檔案**：

   - 新增：`app/home-foundation.module.css`、`app/notes/foundation-notes.module.css`、`components/ui/page-layout.module.css`、`tests/ui-foundation-phase3-browser.mjs`、本報告。
   - 修改頁面：`app/page.tsx`、`app/subjects/page.tsx`、`app/subjects/subjects.module.css`、`app/favorites/page.tsx`、`app/wrong/page.tsx`、`app/wrong-test/page.tsx`、`app/login/page.tsx`、`app/register/page.tsx`、`app/notes/page.tsx`、`app/notes/[id]/page.tsx`。
   - 修改相關元件：`app/notes/NoteCard.tsx`、`app/notes/NoteDetail.tsx`、`app/notes/NotesList.tsx`、`components/review/ReviewUI.tsx`、`components/review/review.module.css`、`components/dashboard/HomeChapterStats.tsx`、`components/dashboard/WeeklyMostMissed.tsx`。
   - `.tmp/`、`.artifacts/` 為本機驗證產物，不納入 commit；沒有測試 fixture route 進入產品。

5. **Dependencies**：零新增、零升級；package.json / lockfile 未修改。使用既有 React、CSS Modules、原生 dialog、既有測試環境。

6. **Homepage before / after**：原本頁寬 1560px、密集六欄入口、較小次要文字與不同圓角，改為 1160px 上限、桌面三欄／手機一至二欄與窄螢幕橫排入口。Hero 主標題層級、卡片留白、統計次要文字與 CTA 統一；保留原插圖、文案、所有 widget、倒數、每日目標、既有小成就及自訂首頁功能。API mock 下比對全部 anchor href 與文字相同；guest/user/admin 入口權限回歸通過。

7. **Subjects before / after**：六科原配色完整保留；卡片統一字級、間距、radius/shadow。設定視窗改為原生 dialog，改善鍵盤焦點限制、Escape 與關閉後回到原卡片；窄螢幕順序／模式選擇改單欄。章節名稱、群組、數量與 URL 篩選參數不變。

8. **Favorites / Wrong before / after**：共用 820px 題目閱讀寬度、PageHeader、題幹／選項／解析分隔與空狀態。收藏使用 heart +「已收藏」info badge；錯題使用 wrong icon +「錯題」warning badge。錯題筆記與移除按鈕保留。Wrong Test 套用既有 Focus First 題目／答案視覺，未改選題、判分、下一題或錯題清除。

9. **Notes before / after**：統一分類按鈕、filters、分頁、卡片、loading/empty/error。官方 badge 使用 success 底色與描邊，社群使用 neutral；保留未經官方審核文字。詳細頁外框以 76ch 加頁面 padding 限寬，扣除卡片 padding 後本文約 70ch；行高 1.9。保留作者、日期、科目、章節、helpful、收藏與 owner edit；收藏圖示沿用 StudyIcon。

10. **Auth before / after**：原灰底藍色表單改為既有 foundation 視覺，表單上限 440px；labels 與 inputs 關聯、errors 使用 alert、主要按鈕與次要連結一致。既有 required、minLength、密碼確認、Better Auth 呼叫與成功回首頁不變。fixture 驗證登入／註冊錯誤、成功導向、密碼不一致不發送請求。

11. **Navigation / Footer**：首頁桌面導覽獨立一列，保留所有原入口與順序；手機沿用既有 details 選單，加大觸控區、限制選單高度並允許捲動。未重做 IA。客服 email、IG/Threads `vetexam.tw`、政策連結均保留，無電話。指定頁面的浮動 Feedback/Admin link 以 scoped sibling CSS 放回文件流，避免遮住內容；共用元件及其他頁面未變更。

12. **Mobile / desktop validation**：320 / 375 / 430 / 768 / 1024 / 1280 / 1440 / 1920，11 個畫面共 88 個尺寸組合；before/after 各 88 張，另有 loading/error/empty 截圖。檢查文件與 dialog 無橫向 overflow、可見 button/input/select/textarea/summary 高度至少 44px（檢查允許小數像素誤差）、對話框內捲動。截圖已人工抽查桌面與手機，1920px 有 max-width；保留完整 gallery 與 PNG。

13. **Accessibility**：原生 dialog Tab 焦點限制、Escape/按鈕關閉與焦點回復；手機選單鍵盤開／關／跳頁；表單可用 label 定位；分類 aria-current、選項 aria-pressed；保留 focus-visible 與 reduced-motion。沒有新增動畫。主要文字 token 色彩對比：primary/white 5.55、secondary/white 5.95、success 5.90、warning 6.23、danger 5.29、info 6.20、neutral 5.57。六科 palette 不變。本次是瀏覽器及 token 檢查，非完整螢幕閱讀器或全站 WCAG 認證。

14. **Performance**：未改 server/client 邊界、未增加套件／effects／JS hover。對比相同 build 模式 HTML 引用的初始 scripts，逐檔 gzip bytes 增量：Home +332、Subjects -67、Favorites +121、Wrong +124、Wrong Test +2045、Notes list +1822、detail +1792、Login +134、Register +159。這是資產比較，不是網路環境下 Core Web Vitals 測量。

15. **Tests**：

   - PASS 新 Phase 3 browser：11 views × 8 widths、觸控高度、手機選單、章節 query、dialog 焦點、錯題筆記／移除／兩題判分及完成、收藏顯示與由原作答入口取消、Auth errors/success/validation、empty/loading/error、reduced-motion。
   - PASS 原 Notes browser：官方/社群、私人/公開、draft/publish、XSS/plain text、篩選、收藏/helpful、權限變更與 owner edit/delete、related notes、四種寬度。全部為 API fixture。
   - PASS 原 exam-chapters、account-learning、due-review、study-plan、diagnostic、confirmation、reinforcement、follow-up、daily-task、custom-plan browser suites。
   - PASS 原 option-distribution（含首頁挑戰題）、Phase 1 UI foundation 三頁、Phase 2 questions 部分（七寬度、圖片 dialog、鍵盤、下一題、reduced-motion）。未重新跑 Admin 專用 fixture，Admin 程式未變。
   - `node --test tests/*.test.mjs tests/pdf-page-auth.test.cjs`：159 tests，138 pass / 1 fail / 20 skipped。唯一 failure 是原 `subscription.test.mjs` manual import mock 的 `Unexpected import: @/data/exam-chapters`；在未修改的 a01b0fb3 重跑得到相同失敗。DB 整合測試維持原環境 skip，未接正式 DB。
   - Targeted ESLint：7 個既有錯誤（homepage 的 effect setState、favorites/wrong/wrong-test 的 any/effect setState），同一批檔案在 baseline 也是 7 個；不修 scope 外 lint。
   - AST scope audit：15 個 TSX 的 hooks、既有事件處理與輔助函式相同，例外只限 Subjects dialog 關閉／焦點回復。git diff --check 通過。

16. **Production build**：最終 `npm run build` PASS（Next 16.2.12，TypeScript 與 45 個靜態頁面產生成功）。測試使用不可連接的 localhost fixture DATABASE_URL；Better Auth 顯示無法驗證 DB schema 與 baseURL 未設定警告，未以正式資料庫消除警告。多 lockfile 工作目錄警告不屬產品變更。

17. **沒有修改**：Question selection、answers/explanation contents、stats/ranking/minimum samples、weakness、FSRS/due scheduling/Review、Study Plan/Coach/Daily Tasks/Custom Plan、PDF parser/images、chapterGroups/classification、Notes 資料模型/權限/helpful/favorite 邏輯、Favorites/Wrong 資料操作、Auth/session/redirect/validation、Subscription/Billing/PRO、Admin/API/AI、資料庫 schema。`lib/`、`data/`、`app/api/`、migrations、package files、全域 layout/home.css/foundation tokens 皆無差異。無 DB migration，無使用者資料修改，無 unrelated refactor 或全 repo formatting。

18. **最終 commit**：本報告與上述變更一同提交；精確 SHA 由交付訊息提供，也可執行 `git log -1 --format=%H -- docs/UI_UX_FOUNDATION_PHASE3.md` 取得。本階段只完成本機 commit，尚未推送／部署。

沿用規則：page max 1160px；題目閱讀 820px、筆記約 70ch、Auth 440px 有用途差異。title 28–34px、section 22/20px、card 18px、body 16px、secondary 14px、caption 12px；section 32/24px、grid 16px、card padding 24/20px、page padding 24/16px；button/input 10px、card/modal 16px、badge pill；border #dce3dd、shadow 0 1px 3px /4%。均由既有 tokens 提供。

本機證據：`.tmp/ui-phase3/comparison.html`、`before/`、`after/`、`bundle-comparison.json`、`contrast.json`、`.tmp/scope-audit.json`、`.tmp/build.log`、`.tmp/unit-tests.log`、`.tmp/lint.log`。重跑瀏覽器：設定 `PLAYWRIGHT_MODULE`（現有環境路徑）與 `TEST_BASE_URL` 後執行 `node tests/ui-foundation-phase3-browser.mjs`；`UI_PHASE=before` 用於未修改基準 server。
