# LightCal ICS

這是 Apple Calendar 批次輸入工具的獨立 code workspace。

專案事實與唯一現況不在本檔重複維護；開始工作前請依序閱讀：

1. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/INDEX.md`
2. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/INDEX.md`
3. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/STATUS.md`

舊 LightCal 只作程式參照，不直接修改：

`/Users/vidan/Documents/Codex/2026-08-21/lightcal-html-css-vanilla-js-vue/`

G0 Apple Calendar 實機 Gate、G1 純 domain／ICS 契約、G2 iPhone-first 本機排班流程、G3 離線 PWA app shell、G4 本機 publisher 契約與 G5 production deployment 皆已通過。G6 iPhone production 實測、農曆功能與剩餘實機驗證只以 Obsidian `STATUS.md` 為準。

## 本機操作

```bash
npm install
npm test
npm run build
npm run dev
```

- `src/domain/ics.js` 是不依賴 UI 的純 ICS generator。
- `src/domain/lunar.js` 將指定國曆範圍內的農曆每月／每年規則投影成可檢查的國曆日期清單；清單確認後才合併進 assignment。
- `publisher/index.js` 是不依賴 HTTP runtime 的 G4 publisher core；契約與外部邊界見 `publisher/README.md`。
- `publisher/worker.js` 與 `publisher/github.js` 是 G5 Cloudflare Worker adapter；正式 policy 在 `wrangler.jsonc`，secrets 不得寫進 repo。
- `npm run generate:g0` 會產生 `public/lightcal-ics-g0-three-events.ics`。
- 排班草稿只存在目前裝置的 versioned local storage；匯入後仍以 Apple Calendar 為唯一 source of truth。
- 測試檔只應匯入專用測試 calendar；重複匯入行為不視為 Apple 保證。

## Production topology

- Source：`https://github.com/otherwise326/lightcal-ics`
- PWA：`https://lightcal-ics.pages.dev/`（獨立 origin，避免和其他 GitHub Pages project 共用 device token storage）
- Public ICS：`https://otherwise326.github.io/lightcal-ics-public/ics/`
- Publisher：`https://lightcal-ics-publisher.lightcal-push-feasibility-spike.workers.dev/v1/publish`

`npm run deploy:pages` 與 `npm run deploy:worker` 只供已核准的 production 維護；執行前必須確認 branch／account／secrets 與 canonical `STATUS.md`。
