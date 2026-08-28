# LightCal ICS

這是 Apple Calendar 批次輸入工具的獨立 code workspace。

專案事實與唯一現況不在本檔重複維護；開始工作前請依序閱讀：

1. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/INDEX.md`
2. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/INDEX.md`
3. `/Users/vidan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vidan/Projects/LightCal ICS/STATUS.md`

舊 LightCal 只作程式參照，不直接修改：

`/Users/vidan/Documents/Codex/2026-08-21/lightcal-html-css-vanilla-js-vue/`

G0 三事件 `.ics` 與 Apple Calendar 實機 Gate 已通過。現在的下一個切片是 G1：純 domain 與 ICS 契約。

G1 嚴格範圍：

- 定義 calendar profile、全天 preset、reminder、assignment 與 export request 的 versioned schema。
- 支援同一天多個不同事件、同 preset／日期 toggle、跨月 assignment 與 inclusive 輸出範圍。
- 班表一律輸出全天 `VALUE=DATE`；提醒為不提醒、當天 `HH:mm` 或前一天 `HH:mm`，轉成 absolute `VALARM`。
- 預設檔名為 `行事曆名_YYYYMMDD-YYYYMMDD.ics` 且可安全修改。
- 先寫純模組與 tests；不要提前做 UI、PWA、publisher、GitHub remote／Pages、token、Cloudflare 或外部部署。

G1 完成條件以 Obsidian `STATUS.md` 為準；完成後更新 STATUS、提交 Git，再停止本 session。

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
