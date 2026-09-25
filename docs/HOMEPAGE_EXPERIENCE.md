# Homepage Experience — explanation, hierarchy and subtle motion

1. **基準 SHA**：`6f08fb5e94d57cf4b4a05f4659a05ff2835ed678`（`style: unify remaining user pages with UI foundation`）。開始與提交前 fetch 確認 origin/main。隔離 worktree `.worktrees/home-experience`、branch `feat/home-experience`；原目錄未提交修改未動。

2. **新增首頁 section**：Hero 後的「VetExam 怎麼陪你準備國考？」四步流程，流程下的產品定位說明；Hero 右側「今日學習狀態」使用首頁原有資料。StudyCompanions 縮為 88px 裝飾，國考倒數與可編輯日期仍保留。沒有新增 due API：首頁原本未取得 due count，這次不顯示該數字。

3. **功能說明文案**：

   - 01 刷題：從歷屆獸醫師國考題開始練習。
   - 02 找出弱點：依科目、章節與近期作答表現找出需要加強的部分。
   - 03 安排複習：利用既有弱點補強與記憶排程，安排適合再次練習的題目。
   - 04 持續追蹤：透過學習紀錄、正確率與近期趨勢看見自己的進步。
   - 定位：「你不用自己決定今天該讀什麼。」／「VetExam 會根據你的作答紀錄，整理今日任務、弱點與到期複習，讓每一次刷題更有方向。」
   - 明示：「這是產品能力說明。登入並累積作答紀錄後，可在學習計畫查看適用的任務與複習；尚未作答或紀錄不足時，先從刷題或初始診斷開始。」保留原 Hero 文案／開始刷題 CTA，不將能力描述冒充即時結果。

4. **Motion**：流程 section 與既有 widgets 首次進入 viewport 使用 opacity 0→1、translateY 12px→0，350ms；首頁進度條使用 scaleX 0→1、400ms，不改 value/width/aria-valuenow。Feature/subject cards hover 上移 2px、淡邊框／陰影、icon 1.03 倍、箭頭右移 2px，180ms，僅 hover-capable 裝置啟用。數字及既有正確率 ring 維持實際最終值，不新增 count-up 迴圈。無背景動畫、glow、tilt、輪播、interval、長時間 RAF。

5. **Dependency**：零新增／升級，package.json / lockfile 未變。沿用 Phase 1–3 tokens、StudyIcon、ProgressBar、Empty/Loading presentation；沒有复制第三方套件碼，也沒有新增另一套 design system。以既有 React、CSS keyframes/transitions、原生 IntersectionObserver 完成。

6. **Reduced motion / fallback**：motion 規則只在 `prefers-reduced-motion: no-preference` 生效；reduce 直接保留最終文字、寬度與位置，既有 foundation 同時停用動畫／transition。使用中切換 reduce 會 disconnect observer、清除 pending；缺少 observer 或 JavaScript 時內容預設可見。focusin 會立即揭露鍵盤焦點所在 section。

7. **Mobile before / after**：原 Hero 大插圖改為緊湊狀態與倒數；新使用者看到既有「你的第一步，從這裡開始」說明，不顯示 Hero 零值儀表。有紀錄時呈現今日完成／既有目標及學習紀錄入口。流程在 320/375/430 為垂直 01↓02↓03↓04；卡片自然單欄，保留六科配色、搜尋與全部入口。

8. **Desktop before / after**：Hero 兩欄；768px 以上四步水平流程。說明流程以 plain section/divider 呈現，定位文字用淡底；功能與題庫移除外層大白卡。新預設順序：Hero（含倒數）→流程→今日目標→核心功能→學習進度與小成就→題庫→章節資訊→熱門錯題→Footer。僅調整 HomeLayout 的預設排序與原版面分支；既有讀取／儲存／隱藏／還原／拖曳／鍵盤排序函式未改。已有 localStorage 排序／隱藏設定照原值顯示，不自動寫入或遷移；使用者主動「恢復預設版面」才採新排序。max-width 仍為 1160px。

9. **Performance impact**：同模式 production HTML 引用資產、逐檔 gzip 比較：JS 216,953→219,494 bytes（+2,541）；CSS 27,307→27,528 bytes（+221）。此為本機資產量測，非正式站 CWV。首頁動態共用一個 observer，僅觀察 section/widget/progress，不逐張 feature/subject card 建 observer；已出現元素 unobserve，全部完成時 disconnect，卸載清理。無動畫用 setState、timer、RAF loop；數字一直可讀。首頁原計算與 effects 由 AST 逐項確認相同，唯一新增呼叫是 presentation hook。API 種類與基準一致，無新增 due/daily/AI 請求。

10. **Accessibility / semantics**：新增內容使用 section、h2、h3、p、ol/li；各 section 有標題關聯；步驟箭頭與插圖 aria-hidden；進度條沿用可存取名稱與最終值。保留 focus-visible、mobile native details、原倒數 label 與可點擊目標。不以 hover 作為唯一操作提示；reduce 下無位移。新定位文字直接說明登入與資料需求。驗證為瀏覽器／鍵盤檢查，非完整螢幕閱讀器或 WCAG 認證。

11. **Tests**：

   - PASS `tests/home-experience-browser.mjs`：guest/user/admin × new/existing，共六種狀態 × 八種寬度；320/375/430/768/1024/1280/1440/1920 無橫向 overflow。基準與修改後保留各 24 張完整頁面截圖（guest new/existing、user existing，各八尺寸）。
   - PASS 原倒數日期變更與保存、六科搜尋及空結果、熱門錯題作答／解析／Escape／焦點回復、登入／登出狀態顯示、Admin PDF nav、IG／無電話、舊排序／隱藏／恢復預設。
   - PASS 新流程欄位、實際 Hero 7/20→35% fixture、零紀錄 Hero 不顯示 progressbar、同步錯誤不冒充個人結果、reduced-motion、unsupported observer、無 JS 內容可見。
   - PASS observer instrumentation：同時最多一個首頁 motion observer；首次有動畫、重複捲動不重播、完成後沒有 running animations；hover -2px 與 focus outline；使用中切換 reduce 停用並清理。
   - PASS 原 `option-distribution-browser.mjs`（含首頁熱門錯題）、`diagnostic-browser.mjs`（含 guest/user/admin homepage）、`ui-foundation-browser.mjs`（Analysis/Study Plan/Review）回歸。
   - Targeted ESLint：新增檔案與 HomeLayout 無問題；app/page.tsx 仍有原本的 `setIsAdmin(false)` / `react-hooks/set-state-in-effect` 一項，AST 證明該 effect 未改，不修範圍外 lint。`git diff --check` PASS。
   - 所有互動測試使用隔離 browser storage / API fixtures，不使用正式帳號，不寫正式資料。未重新執行與本次首頁 presentation 無關的 DB 整合測試。

12. **Production build**：`npm run build` PASS，Next 16.2.12；TypeScript 通過，45 個靜態頁面產生成功。使用不可連線 localhost fixture DATABASE_URL；保留 Better Auth 的 baseURL/schema 驗證警告與隔離 worktree 多 lockfile 警告，不以正式 DB 消除。

13. **未修改的功能**：FSRS、due scheduling、weakness、Study Plan、Daily goal/progress calculations、chapter frequency、weekly most-missed 選題／ranking／門檻、作答／answer statistics、Auth/session/logout、Subscription/Billing、PDF、Admin、Notes、DB/schema、API semantics。保留 Countdown、subject search、六科、WeeklyMostMissed、HomeChapterStats、Progress、Goal、Achievement、Account/Admin nav、Footer/IG/Threads/Privacy。無 AI、虛假統計、使用者資料修改、migration、全 repo formatting 或其他頁面修改。

14. **最終 commit**：見交付訊息；也可 `git log -1 --format=%H -- docs/HOMEPAGE_EXPERIENCE.md` 取得。本次完成本機提交，未部署。

產品檔案僅五個：修改 `app/page.tsx`、`app/home-foundation.module.css`、`components/dashboard/HomeLayout.tsx`；新增 `components/dashboard/HomeJourney.tsx`、`components/dashboard/useHomeMotion.ts`。另新增本報告與 `tests/home-experience-browser.mjs`。共享 `home.css`、StudyUI、其他頁面、lib/data/API/package files 未變。

本機證據：`.tmp/home-experience/comparison.html`、`before/`、`after/`（含 motion.json / requests.json / reduced / no-observer 圖）、`performance.json`、`.tmp/build.log`、`.tmp/lint.log`。測試設定 `PLAYWRIGHT_MODULE` 與 `TEST_BASE_URL` 後執行 `node tests/home-experience-browser.mjs`；基準使用 `UI_PHASE=before`。截圖與臨時驗證程式不納入 commit。
