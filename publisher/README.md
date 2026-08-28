# LightCal ICS publisher core

`publisher/index.js` 是 G4 的 runtime-neutral core。G5 新增的 `publisher/worker.js` 是 Cloudflare Worker HTTP adapter，`publisher/github.js` 是唯一 GitHub Contents API client。三層保持分離，client request 永遠不能指定 GitHub owner、repository、branch、path、public URL 或 credential。

## 固定契約

- request body 必須且只能有 `filename` 與完整 `ics` 兩個欄位；不接受 owner、repository、branch、path 或 public URL。
- `filename` 必須是安全且已正規化的單一 `.ics` 檔名，最長 180 UTF-8 bytes，不得包含目錄分隔符。
- `ics` 最多 256 KiB；必須使用 CRLF、每個 physical content line 不超過 75 bytes，且是包含至少一個 `VEVENT` 的完整 `VCALENDAR`。
- 每個 `VEVENT` 必須有唯一非空 `UID`、`DTSTART`、`DTEND` 與 `SUMMARY`；僅接受目前 LightCal generator 會產生的 component 集合。
- public ICS repository、branch、output prefix 與 HTTPS public base URL 都是 server-side fixed policy。policy 另要求 App code repository 與 public ICS repository 不得相同。
- GitHub credential 不屬於 core config，也不得由 client request 傳入。G5 adapter 只能從所選 runtime 的 server-side secret 建立 GitHub client。
- GitHub Contents create 不帶 SHA；replace 必須帶目前 SHA。遇到一次 `409` 會重新讀取並以新 SHA 重試一次，再衝突就明確回傳 `publisher_write_conflict`。
- 回傳的 `publicUrl` 只由固定 public base URL、固定 prefix 與 encode 後的 filename 組成，因此同一檔名 create／replace 都維持穩定 URL。

## GitHub client port

注入的 client 只需實作：

```js
getContent({ owner, repo, path, ref }) // 404 轉為 null；存在時回傳 { sha }
putContent({ owner, repo, path, branch, message, contentBase64, sha? }) // 回傳 { sha }
```

adapter 必須保留 GitHub HTTP status 供 core 分類，但不得把 upstream body、request headers 或 credential 放入對外錯誤。`401`／`403` 統一映射為 `publisher_upstream_unauthorized`；其他 upstream error 統一映射為 `publisher_upstream_failed`。

## G5 HTTP adapter

- 唯一路由為 `POST /v1/publish`；`OPTIONS` 只服務固定 App origin 的 CORS preflight。
- `Origin` 固定為獨立 PWA origin `https://lightcal-ics.pages.dev`；只接受 `application/json`、raw JSON body 最多 320 KiB，core 再強制 ICS 本體最多 256 KiB。
- client authentication 使用 `Authorization: Bearer <device token>`。Worker 只保存 `SHA-256(device token)` secret，使用 constant-time digest comparison；PWA 只把 raw token 保存在獨立的 device-local record。
- pre-auth 以來源 IP 限制 30 requests／60 秒；通過認證後以單一 client identity 限制 10 publishes／60 秒。`POST /v1/status` 另允許 60 checks／60 秒，由 Worker server-side 比對 GitHub Pages 內容，避免瀏覽器跨 origin CORS。rate limit 是 abuse control，不是精準 accounting。
- 所有對外 error body 只有 allowlisted error code；不回傳 request body、Authorization、GitHub response body、headers 或 injected error object。
- GitHub client 使用 server-side `GITHUB_TOKEN`，GET 404 正規化為 null；PUT create／replace 只回傳 content SHA 給 core。

`wrangler.jsonc` 的 fixed policy 已鎖定：

```text
App repository:    otherwise326/lightcal-ics
Output repository: otherwise326/lightcal-ics-public
Branch:            main
Output prefix:     ics
Public base URL:   https://otherwise326.github.io/lightcal-ics-public
Worker name:       lightcal-ics-publisher
PWA origin:        https://lightcal-ics.pages.dev
```

## Secrets 與部署邊界

正式 Worker 只需要兩個 secrets：

- `GITHUB_TOKEN`：fine-grained PAT，只選 `otherwise326/lightcal-ics-public`，repository permission 只有 Contents read/write；production PAT 依 Vidan 明確決定採 `No expiration`，若疑似外洩須立即 revoke／rotate。
- `PUBLISHER_CLIENT_TOKEN_SHA256`：32-byte random base64url device token 的 lowercase SHA-256 hex；raw device token 不進 Worker config、Git、log 或 STATUS。

Secrets 必須使用 Cloudflare dashboard 或 Wrangler 的互動式 secret prompt 建立，不得寫進 `wrangler.jsonc`、`.env`、`.dev.vars`、shell command argument 或 GitHub repository。正式 action-time 順序：

1. 確認 Cloudflare account 與 workers.dev subdomain。
2. 建立兩個 GitHub repositories；公開 ICS repo 啟用 GitHub Pages，PWA build 部署到獨立 Cloudflare Pages project `lightcal-ics`。
3. 以 Wrangler 的 interactive secret input 加入兩個 secrets，再 deploy；缺任一 secret 時 adapter 必須 fail closed。
4. 跑 auth／CORS／GitHub create-replace／server-side status production probes，再從 production PWA 發布測試 `.ics`；iPhone Home Screen 與 Apple Calendar 實機匯入保留給 G6。

`.env.example` 只示範非機密的 public Worker endpoint。local test credential 也不得沿用到 production。

## 尚未跨越的外部邊界

GitHub Pages project sites 共用 `otherwise326.github.io` origin，而該帳號已有其他 Pages 專案；PWA 不部署在這個共用 origin，以免其他 project site script 讀取 device-local token。source 仍位於 GitHub App repo，production PWA 改用獨立 `lightcal-ics.pages.dev` origin；公開 ICS repo 不保存任何 credential。
