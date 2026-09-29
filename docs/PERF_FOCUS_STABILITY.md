# VetExam focus refresh：Phase 1

使用者在 baseline 回報後指示直接套用正式站。本次發布僅調整被動 focus 重讀，不更動 UI、初始 full learning、題庫、答案保存、auth、public cache、DB schema 或 infrastructure。

## 變更

- `components/LearningSync.tsx`：focus 使用 freshness 判斷；online 保留原始 retry。
- `lib/learning-client.ts`：完整讀取成功後記錄時間。五分鐘內，只有 owner 正確、狀態 ready、同一台灣日期、無 migration failure 且 outbox 為空時才略過 focus 的 full GET。過期與失敗會重試；同 generation 的同時 focus 合併。帳號切換清除 freshness，late response 保留原有 generation 防護。
- `tests/learning-focus.test.mjs`：新增八項同步行為測試，包括 pending 答案、失敗保留／重試、online／manual、立即作答、跨日、時鐘回退、migration 與帳號隔離。

這不是新增私人 HTTP cache；所有 learning/session/admin 的既有 private no-store 均保持。其他分頁或裝置更新的資料，在本分頁已成功讀取的五分鐘窗口內可能暫不反映，之後 focus 才更新；本頁送答案、online 及手動 retry 不受此門檻限制。

## Before / After

在相同假資料／fetch 環境執行 baseline `047c5e258805825cba3851ac33a15feb3207e99c` 與目前實際 learning-client 程式：初始化 full GET 均為 1 次；隨後連續五次 fresh focus 的 full GET 由 **5 次降為 0 次**。這是隔離程式行為量測，不是正式帳號的瀏覽器 waterfall，也不是網站載入時間改善百分比。

## 驗證

- `node --test tests/learning-focus.test.mjs tests/home-read.test.mjs tests/account-learning.test.mjs tests/auth-session.test.mjs tests/auth-session-timeout.test.mjs`：27 passed、0 failed、1 skipped（未提供 PostgreSQL 測試環境）。
- `npm run build`：成功，TypeScript 與 45/45 static pages 通過。使用 build placeholder，未使用正式 DB 密鑰。
- `npm run lint -- --format json --output-file .tmp/perf-stability/lint-after.json`：仍有 baseline 的 73 errors／8 warnings；此次修改及新增測試檔均 0 errors／0 warnings。沒有將既有 lint 修復混入發布。
- `git diff --check`：通過。
- 正式帳號登入／登出、瀏覽器 focus、圖片題與 mobile 互動未驗；已以隔離測試驗證此次變更的同步行為，不能把它當作完整 Production UI 驗收。

## 發布與回復

發布前 main／rollback baseline：`047c5e258805825cba3851ac33a15feb3207e99c`。以正常 fast-forward push 發布，不使用 force push，不修改原始工作目錄的未提交工作。上線後另確認該 commit 的 Vercel status、正式網域 bundle 與公開 API。

若此項出現 regression，revert 此次單一 commit 即可恢復原 focus 行為，無需 DB migration 或資料回復。
