# Safari 帳號／Session 相容性檢查

日期：2026-09-28。專案：Teacherbada/vetexam。

修復基準：`origin/main` / `d770dfcdd1e7b2d2bce63bb226425ed9e80a9176`。
修復分支：`fix/auth-session-compat`，目錄 `.worktrees/auth-session-compat`。
原本根目錄 main 為 `1292499f2c31d39467e8c76b0fcef02b2cb6eb7b`，落後遠端且有未提交工作，因此保留原目錄，使用隔離 worktree。未 push、未部署。

## 結論與證據界線

已重現並修正一條會讓整個首頁（包含帳號區域）出錯的相容性路徑：

1. `useHomeAvailability`、`WeeklyMostMissed` 在 React effect 內、建立 fetch Promise 之前執行 `AbortSignal.any([…, AbortSignal.timeout(…)])`。
2. 停用 `AbortSignal.any` 後，原始版本兩處都同步拋出 `TypeError: AbortSignal.any is not a function`，後面的 Promise `.catch()` 無法捕捉，影響頁面與帳號顯示。
3. [MDN 相容性資料](https://github.com/mdn/browser-compat-data/blob/main/api/AbortSignal.json) 記錄 `any()` 自 Safari 17.4／Chrome 116 起支援。因此 Safari 16.4–17.3 即使在 Next.js 支援範圍內，也可能触發這條路徑；舊 Chrome 同樣可能受影響，非 macOS 專屬問題。
4. `readAdminStatus` 直接建立 `AbortSignal.timeout` 也存在相同同步例外風險；改用既有 AbortController + 可清除 timer。
5. 首頁直接讀取 localStorage／JSON，storage 拒絕存取或 JSON 損壞也可能中斷 effect。加入保護，帳號仍以 Better Auth session 為準。
6. session hook 的 `error` 原本未處理，可能顯示登入按鈕，LearningSync 也可能錯誤切換成訪客。現在區分 loading、authenticated、unauthenticated、error；錯誤有沿用既有樣式的重試按鈕。

使用者目前僅確認「macOS Safari」，沒有版本、故障 Network 紀錄或 Mac 實機。因此上述是已驗證的程式缺陷／可能成因，**尚不能宣稱就是該使用者的唯一 root cause，或 Mac 已修復**。

## Authentication／Cookie 檢查

- 瀏覽器 `auth-client` 以 `window.location.origin` 呼叫同源 `/api/auth/*`，原本已有 `credentials: include`。此次只補 `cache: no-store`。
- `/api/subscription`、`/api/admin/status` 是相對 URL；fetch 的預設 same-origin credentials 已會帶 cookie。admin client 額外明示 same-origin，沒有新增 cross-origin request。
- `lib/auth.ts` 使用 `BETTER_AUTH_URL || NEXT_PUBLIC_BETTER_AUTH_URL`；未覆写 trustedOrigins，Better Auth 預設信任 baseURL。沒有設定 cookie Domain、crossSubDomainCookies 或 SameSite=None。
- 使用 lockfile 鎖定的 Better Auth **1.6.26**、原始 `lib/auth.ts` 設定及純記憶體 adapter 測試：当 baseURL 為 `https://vetexam-tw.vercel.app`，登入會產生 `__Secure-better-auth.session_token`，屬性為 Secure、HttpOnly、SameSite=Lax、Path=/、Max-Age=2592000（30 天），沒有 Domain。重複帶 cookie 查 session 成功；未帶 cookie 為 null；外部 origin／callback 被 403 拒絕。
- 測試沒有建立正式帳號、沒有連線或修改 production 資料庫。伺服器邏輯測試不代表 Safari 實際接受 Set-Cookie。
- 登入使用 rememberMe=true，成功後導向相對路徑 `/`；註冊同樣使用相對導向。沒有獨立 OAuth callback 設定。
- 沒有發現以 localStorage/sessionStorage 當作唯一登入來源。LearningSync 的 storage 用途是學習資料與遷移，並非 session token。
- 首頁 session 在 client hook 初始化；server 初始狀態為 loading，沒有另注入不同的 server user。Windows Chrome fixture 流程未出現 hydration pageerror。server API 繼續將 request.headers 傳給 Better Auth。
- [Better Auth cookie 文件](https://better-auth.com/docs/concepts/cookies) 說明 Safari 會阻擋第三方 cookie；此專案現有同源部署沒有發現這種架構。尚未取得故障 Mac 的實際 request，不能排除使用者造訪其他 host、瀏覽器限制或 cookie 被移除。

### Production 唯讀觀察

對 `https://vetexam-tw.vercel.app` 發送未帶 cookie 的 GET：

| 路徑 | 實際結果 | 修改前 Cache-Control |
|---|---|---|
| `/api/auth/get-session` | 200，null | no-store |
| `/api/debug/session` | 200，loggedIn=false | public, max-age=0, must-revalidate |
| `/api/subscription` | 401，user=null | private, no-store |
| `/api/admin/status` | 401，authenticated=false | public, max-age=0, must-revalidate |

以上為正常匿名結果，沒有 redirect 或 500；不是 Mac 已登入測試，也不能用於證明 CORS／cookie 傳送正常。新增 private,no-store / Vary:Cookie 是明確禁止帳號相關回應被共用或瀏覽器重用；沒有證據證明原快取政策就是該使用者故障根因。

### Vercel 環境變數：尚待核對

本次没有取得 Vercel Production environment／deployment logs 的存取，沒有更改環境變數。僅讀取本機兩個公開 URL 變數，皆為 `http://localhost:3000`，屬開發設定，不能推論 production 也錯設。

Production 應核對：

```
BETTER_AUTH_URL=https://vetexam-tw.vercel.app
NEXT_PUBLIC_BETTER_AUTH_URL=https://vetexam-tw.vercel.app
```

確認作用環境為 Production、沒有 localhost／舊 domain／錯誤 subdomain；effective trusted origin 應為同一 origin，callback 回到同源 `/`。`BETTER_AUTH_SECRET` 應穩定存在；不要為診斷更換 secret。若改 build-time 公開變數需重新部署。此次未自行更改 Cookie / SameSite / Secure / Domain / Auth 核心設定。

## 修改檔案

| 檔案 | 內容 |
|---|---|
| `components/dashboard/useHomeAvailability.ts` | 移除首頁 mount 時必須有 AbortSignal.any/timeout 的要求；保留 8 秒 timeout、卸載取消、成功／錯誤／重試行為。 |
| `components/dashboard/WeeklyMostMissed.tsx` | 同上，只改請求生命週期，沒有改題目、UI 或挑戰功能。 |
| `lib/admin-status-client.ts` | 用 AbortController + timer，保留同帳號並行請求去重，完成時清除 timer。 |
| `app/page.tsx` | session 四狀態、錯誤重試、storage 例外保護；沒有改首頁設計、導覽或樣式。 |
| `components/LearningSync.tsx` | session 尚未確定／失敗時不切換為訪客。 |
| `lib/auth-client.ts` | session/auth fetch 加 no-store，保留原同源及 credentials。 |
| `lib/auth-diagnostics.ts` | 固定事件名稱與安全 metadata，僅 stage、HTTP status（若有）、hasSessionCookie 布林值。 |
| `app/api/auth/[...all]/route.ts` | 沿用 Better Auth handler；記錄 get-session 空值／錯誤及其他 auth HTTP 錯誤，保留 Set-Cookie，禁止快取，未捕捉例外回 503。 |
| `app/api/admin/status/route.ts` | session 錯誤回 503、增加安全 log 與禁止快取；admin 判定不變。 |
| `app/api/debug/session/route.ts` | session 與 subscription 失敗分階段記錄；已驗證 session 但 subscription 失敗時保留 loggedIn=true；不回傳原始 exception。 |
| `lib/subscription.ts` | 分辨 session 失敗／缺少 user／subscription query 失敗；查詢內容及 PRO 計算規則不變。`/api/subscription` 原有 401／503 契約不變。 |
| `tests/auth-session.test.mjs` | 相容性、timeout／卸載、session 狀態、API 錯誤、cookie 保留及 log 不洩漏測試。 |
| `tests/auth-cookie.test.mjs` | 真實 Better Auth + memory adapter 的登入／session／HTTPS cookie／origin／callback 測試。 |
| `tests/auth-session-browser.mjs` | Windows Chrome fixture regression；明確記錄 cookie 持久化限制。 |
| `tests/subscription.test.mjs` | 載入新 diagnostics helper，保留既有測試斷言。 |
| `docs/AUTH_SESSION_COMPATIBILITY.md` | 本報告及實機驗收清單。 |

未修改資料庫 schema、subscription/PRO 規則、登入頁設計或 Auth 核心。沒有 user-agent 分流。

## Log 判讀

- `AUTH_SESSION_FETCH_FAILED`：Better Auth 查 session 拋例外或 HTTP 失敗。
- `AUTH_SESSION_MISSING`：查詢成功但無 session（匿名訪客也正常產生，採 info）。
- `USER_FETCH_FAILED`：回傳非空 session 結構卻沒有 user.id。
- `SUBSCRIPTION_FETCH_FAILED`：session 已取得後，subscription 查詢失敗。
- `AUTH_REQUEST_FAILED`：其他 Auth endpoint HTTP 錯誤，含 403，可回查同一 Vercel request。

沒有輸出 password、完整 cookie、token、secret、email 或原始 Error。`hasSessionCookie=true` 只代表送入同名 cookie，不證明有效、未過期或使用正確 secret。瀏覽器離線／請求未抵達伺服器的失敗不會有 Vercel request log；頁面會顯示 error 與重試。

## 測試結果與限制

- `node --test tests/auth-cookie.test.mjs tests/auth-session.test.mjs`：7/7 通過。
- 全部既有單元測試加此次測試：180 項，159 通過、20 跳過、1 既有失敗。失敗為 subscription.test 的 manual import mock 缺 `@/data/exam-chapters`，已在未修改的同一基準版本重現。跳過項目需要獨立 DB fixture；未用 production DB 執行寫入測試。
- 變更檔案 eslint：通過。全專案 lint 原有錯誤（PDF API、腳本等），未擴大範圍修理。
- `npx tsc --noEmit`：通過。
- `npm run build -- --webpack`：通過（Next 16.2.12；本機測試使用假的 DB URL，未連正式 DB）。
- `npm ci`：既有 lockfile 的 optional canvas 套件與 manifest 不一致而失敗。沒有修改依賴或 lockfile；驗證使用現有依賴，Better Auth 另外固定至 lockfile 的 1.6.26，最後 build/browser/cookie 測試均使用此版本。
- Windows Chrome **153.0.8010.53**、本機 production build、攔截 API fixture：loading 不顯示未登入、首次 fixture 登入、refresh、六頁 session request、503 與重試、admin/subscription 503 不抹除帳號、storage blocked、缺少 AbortSignal.any/timeout 全數通過，無 pageerror。
- 自動化 Chrome persistent profile 關閉重開後，fixture cookie 沒有保留下來。測試明確輸出 `nativeProfileCookiePersistence:false`，後續六頁檢查使用明示還原的 fixture cookie；**不能算關閉瀏覽器重開驗證通過**，也不能證明產品本身持久化有問題。
- **無 macOS Safari／macOS Chrome 實機、無真實測試帳號。因此三種環境都尚未完成 production 真實登入全流程驗收。**

## 待實機驗收（Safari、Mac Chrome、Windows Chrome 各執行一次）

1. 記錄 OS／瀏覽器版本、網址必須是 production 同一 host。
2. 首次登入後查看 get-session：有 user.id；確認 HttpOnly cookie 已儲存且含 Secure、Lax、Path=/、未設 Domain、有持久化到期時間。不要複製 cookie 值。
3. 重新整理、完整關閉瀏覽器後重開，確認 session 仍有效。
4. 逐一開 `/`、`/subjects`、`/questions`、`/favorites`、`/wrong`、`/analysis`，確認 session 與帳號歸屬不消失。
5. 記錄 `/api/auth/get-session`、`/api/debug/session`、`/api/subscription`、`/api/admin/status` 的 HTTP 狀態；只回報 cookie 是否存在、session/user 是否為 null，不分享原始 session response 或 cookie。
6. 對照 Vercel 的固定事件與 stage。區分無 cookie、session 驗證失敗、subscription 故障、403 origin 問題，以及瀏覽器 JS 例外。

完成上述後，才能確認原回報的 Mac 故障是否完全排除。

## 後續：首頁讀取帳號超過五分鐘

第一輪修復 `837a396` 已部署，使用者回報問題仍存在。朋友直接開啟 `/api/debug/session` 很快得到 `loggedIn:false`，直接開啟 `/api/auth/get-session` 很快得到 `null`。這兩項是正常匿名回應，不能再將故障直接歸因伺服器 session 查詢卡死；需區分頁面內 fetch 被阻擋、client 初始化／hydration 未完成、瀏覽器相容性或資源載入失敗。瀏覽器版本仍待提供。

另已重現一項會造成無限等待的獨立缺口：目前沒有 session deadline，且 Better Auth 1.6.26 的 session atom 自帶 AbortSignal，better-fetch 因此略過一般 timeout 設定。此次透過既有 `customFetchImpl` 擴充點，只為 `/api/auth/get-session` 增加 15 秒 deadline，涵蓋 response headers 與 body，保留上游取消訊號。逾時交由原 session hook 設定 error，首頁顯示「讀取帳號逾時，請重試」，不當成登出、不改 cookie、不重寫 Auth。其他登入／註冊 request 原樣透傳。

檔案：`lib/auth-session-fetch.ts`、`lib/auth-client.ts`、`app/page.tsx`、`tests/auth-session-timeout.test.mjs`、`tests/auth-session-browser.mjs`、本報告。沒有變更 `lib/auth.ts` 或資料庫 timeout 設定。

驗證：新增三項測試以真實 Better Auth 1.6.26 session atom 檢查卡住的 headers/body、取消、HTTP 狀態／body 保留、已登入資料保留及重試成功；Auth 相關共 10 項通過。Windows Chrome fixture 模擬未回應的 session，約 15 秒後出現 timeout 提示，重試恢復帳號，無 pageerror。Build、typecheck、變更檔案 lint 通過。全部單元測試 183 項：162 通過、20 跳過、1 項相同既有失敗。

限制：若瀏覽器根本沒有執行頁面的 JavaScript，client deadline 也無法啟動。因此這是已驗證的等待上限與錯誤處理修復，**不能據此宣稱朋友的初始化故障已解決**。下一步需要 Safari／Chrome 的實際版本及更新後症狀。
