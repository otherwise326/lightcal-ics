# LightCal ICS publisher core

`publisher/index.js` 是 G4 的 runtime-neutral 本機契約。它不是 HTTP server，也不包含部署設定或 credential loader；G5 選定常駐環境後，外層 adapter 才能把已認證的 request 與 GitHub client 接到這個 core。

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

## G4 邊界

本切片沒有建立 HTTP route、client authentication、GitHub token／repository／Pages、Worker、DNS、secret 或任何網路連線。publisher client authentication、rate limiting、CORS／CSRF、server-side secret binding、logging 與 production monitoring 必須在 External approval Gate 決定 runtime 後再具體化，不能由本契約猜測。
