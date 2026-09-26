# Homepage Layout Repair + Customization Controls UX

基準：`3190acf1e6edbdefdc81fc1e5b7fd102dc05ae6d`。獨立分支 `feat/home-layout-repair`；沒有混入根工作目錄或其他 worktree 的修改。

## 原因與修改

- 重疊原因：非編輯模式仍 render 關閉按鈕；absolute 操作列與手機負位移疊在卡片內容上。
- 版面原因：預設／自訂分成兩套樹，倒數依位置抽入 Hero；其他非 features/subjects widgets 被任意兩兩排列並拉高卡片。
- 操作列改為內容上方正常文流的獨立 toolbar，可換行。拖曳、上移、下移、文字「隱藏」皆只在 editing 時 render。完成自訂後 DOM 中沒有 controls。
- 編輯說明列包含固定區域提示、已隱藏清單與恢復預設。隱藏通知使用 static，不覆蓋導覽或內容。
- Hero／今日學習狀態固定為桌面兩欄、手機單欄；Journey 固定保留，三者不進入 widget metadata。國考倒數移至 Journey 後的 widgets。
- 保留綠色／白色／中性色、科目色盤、字體與圓角；features、subjects、Journey 維持 plain section。

## Metadata 與順序

| 順序 | Widget | size | 配對 |
| --- | --- | --- | --- |
| 1 | 國考倒數 | full | 獨立區塊 |
| 2 | 今日目標 | half | learning |
| 3 | 我的學習進度 | half | learning |
| 4 | 功能介紹 | full | 無 |
| 5 | 題庫入口 | full | 無 |
| 6 | 各章節歷屆題量 | full | 無 |
| 7 | 每週／隨機挑戰 | full | 無 |
| 8 | 學習小成就 | half | 無，單獨顯示全寬 |

各 widget `hideable: true`。只有相鄰、half 且相同非空 pairGroup 的 widgets 並排；其餘全寬。DOM 與視覺排序一致，不使用 dense packing 或固定卡片高度。1023px 以下 widgets 全部單欄。

沿用 `vetexam.home.layout.v1`，有效既有順序／隱藏設定保留，初次載入不寫回。未知 ID、重複 ID、遺漏項目與無法解析的 JSON 安全處理；所有 widgets 隱藏時仍可恢復且核心介紹保留。

## 驗證

- `tsc --noEmit --incremental false`、HomeLayout ESLint、`git diff --check` 通過。
- `tests/home-layout-browser.mjs`：320、375、430、768、1024、1280、1440、1920；預設及既有自訂版面、編輯開關、無溢位、toolbar 不重疊、44px 觸控目標、keyboard focus、移動／重新載入、拖曳、隱藏／復原／恢復預設、異常儲存資料通過。
- `tests/home-read-browser.mjs`：guest/account/cache/migration/outbox/offline、session/admin dedupe、Quick 20／題量不足、weekly／random fallback／empty／E 選項 dialog 與 subjects 設定回歸通過。
- `tests/home-experience-browser.mjs`：六種使用者狀態 × 八種寬度、導覽／admin、倒數、搜尋、weekly、舊版面、reduced motion、缺少 observer、無 JavaScript、同步錯誤通過。更新新預設順序並補齊基準已採用的 learning-summary fixture；產品資料流程不變。
- `next build --webpack`：編譯、TypeScript、45 個靜態頁面產生完成，production server 啟動成功；以上三組瀏覽器測試均對 production build 執行並通過，沒有捕捉到 JavaScript pageerror。
- Accessibility：每個操作均有 label、拖曳 title、上下移替代操作、首尾 disabled 樣式；移動保留焦點，隱藏移至相鄰操作列，恢復移至該 widget。沿用 focus-visible、skip link 與 reduced-motion 行為。
- 瀏覽器 API 全部使用 fixture，不寫正式 DB。建置使用不可連線 fixture DB，Better Auth schema check 警告與本次 UI 修改無關。

## 截圖

同一 fixture、viewport，before 為修改前基準，after 為 production build：

| Viewport | Before | After | Editing |
| --- | --- | --- | --- |
| Desktop 1440 | [before](../.tmp/home-layout/before/default-1440.png) | [after](../.tmp/home-layout/after/default-1440.png) | [toolbar](../.tmp/home-layout/after/toolbar-1440.png) |
| Mobile 375 | [before](../.tmp/home-layout/before/default-375.png) | [after](../.tmp/home-layout/after/default-375.png) | [toolbar](../.tmp/home-layout/after/toolbar-375.png) |

同目錄另有 hero、weekly、整頁 editing 截圖與 validation.json；截圖為本機工作產物，未提交二進位檔。

## Scope guard

產品修改只有 `HomeLayout.tsx`、`home.css`、`home-foundation.module.css`。`app/page.tsx`、HomeJourney、useHomeMotion、WeeklyMostMissed 未修改。

未變更：首頁資料／performance cache／learning summary／account matching／Auth／Admin status、Questions／Quick 20／Weekly fallback、FSRS／Study Plan／Analysis／PDF／Notes、DB／API／Subscription／Billing／Admin／global design system。沒有新增依賴、修改環境檔或執行 DB mutation。
