export const G0_CALENDAR_NAME = 'LightCal ICS G0 測試';
export const G0_GENERATED_AT = '2026-08-28T03:00:00.000Z';
export const G0_OUTPUT_NAME = 'lightcal-ics-g0-three-events.ics';

export const G0_EVENTS = Object.freeze([
  Object.freeze({
    id: 'g0-day-shift-20260901',
    title: 'G0 測試｜一般白天班',
    description: 'LightCal ICS G0：確認一般白天班的日期、時間與 Asia/Taipei 時區。',
    startLocal: '2026-09-01T08:00',
    endLocal: '2026-09-01T17:00',
  }),
  Object.freeze({
    id: 'g0-overnight-shift-20260902',
    title: 'G0 測試｜跨午夜班',
    description: 'LightCal ICS G0：確認事件從 9/2 晚間跨到 9/3 清晨。',
    startLocal: '2026-09-02T22:00',
    endLocal: '2026-09-03T06:00',
  }),
  Object.freeze({
    id: 'g0-reminder-event-20260904',
    title: 'G0 測試｜含提醒事件',
    description: 'LightCal ICS G0：確認 Apple Calendar 顯示提前 30 分鐘提醒。',
    startLocal: '2026-09-04T09:00',
    endLocal: '2026-09-04T10:00',
    reminderMinutesBefore: 30,
  }),
]);
