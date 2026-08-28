# LightCal ICS

這是 Apple Calendar 批次輸入工具的獨立 code workspace。

專案事實與唯一現況不在本檔重複維護；開始工作前請依序閱讀：

1. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/INDEX.md`
2. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/INDEX.md`
3. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/STATUS.md`

舊 LightCal 只作程式參照，不直接修改：

`/Users/vidan/Documents/Codex/2026-08-21/lightcal-html-css-vanilla-js-vue/`

G0 Apple Calendar 實機 Gate、G1 純 domain／ICS 契約、G2 iPhone-first 本機排班流程、G3 離線 PWA app shell 與 G4 本機 publisher 契約皆已通過。當前 Gate、完成狀態與禁止提前實作的範圍只以 Obsidian `STATUS.md` 為準。

## 本機操作

```bash
npm install
npm test
npm run build
npm run dev
```

- `src/domain/ics.js` 是不依賴 UI 的純 ICS generator。
- `publisher/index.js` 是不依賴 HTTP runtime 的 G4 publisher core；契約與外部邊界見 `publisher/README.md`。
- `npm run generate:g0` 會產生 `public/lightcal-ics-g0-three-events.ics`。
- 排班草稿只存在目前裝置的 versioned local storage；匯入後仍以 Apple Calendar 為唯一 source of truth。
- 測試檔只應匯入專用測試 calendar；重複匯入行為不視為 Apple 保證。
