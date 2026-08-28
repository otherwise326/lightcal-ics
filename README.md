# LightCal ICS

這是 Apple Calendar 批次輸入工具的獨立 code workspace。

專案事實與唯一現況不在本檔重複維護；開始工作前請依序閱讀：

1. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/INDEX.md`
2. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/INDEX.md`
3. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/STATUS.md`

舊 LightCal 只作程式參照，不直接修改：

`/Users/vidan/Documents/Codex/2026-08-21/lightcal-html-css-vanilla-js-vue/`

第一個工作切片只做 G0 三事件 `.ics` 產生與實機匯入 Gate；不要搬入 Firebase、Firestore、Worker、outbox、Push、Queue 或 admin。

## G0 本機操作

```bash
npm install
npm test
npm run build
npm run dev
```

- `src/domain/ics.js` 是不依賴 UI 的純 ICS generator。
- `npm run generate:g0` 會產生 `public/lightcal-ics-g0-three-events.ics`。
- 測試檔只應匯入專用測試 calendar；重複匯入行為不視為 Apple 保證。
