import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeIcsText, generateIcs } from '../src/domain/ics.js';
import { G0_CALENDAR_NAME, G0_EVENTS, G0_GENERATED_AT } from '../src/fixtures/g0.js';

const encoder = new TextEncoder();

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

test('30 input events become one VCALENDAR with 30 independent VEVENT entries and stable UIDs', () => {
  const events = Array.from({ length: 30 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return { id: `shift-202609${day}`, title: `早班 ${day}`, startLocal: `2026-09-${day}T07:00`, endLocal: `2026-09-${day}T16:30` };
  });
  const first = generateIcs(events, { generatedAt: G0_GENERATED_AT });
  const second = generateIcs(events, { generatedAt: '2026-08-29T03:00:00.000Z' });
  assert.equal((first.match(/BEGIN:VCALENDAR/g) ?? []).length, 1);
  assert.equal((first.match(/BEGIN:VEVENT/g) ?? []).length, 30);
  assert.equal((first.match(/END:VEVENT/g) ?? []).length, 30);
  assert.deepEqual(first.match(/^UID:.*$/gm), second.match(/^UID:.*$/gm));
});

test('timed events use Asia/Taipei and preserve a cross-midnight range', () => {
  const ics = generateIcs([G0_EVENTS[1]], { generatedAt: G0_GENERATED_AT });
  assert.match(ics, /DTSTART;TZID=Asia\/Taipei:20260902T220000\r\n/);
  assert.match(ics, /DTEND;TZID=Asia\/Taipei:20260903T060000\r\n/);
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Asia\/Taipei\r\n/);
});

test('all-day DTEND is exclusive and reminders become DISPLAY VALARM entries', () => {
  const allDay = { id: 'day-off-20260905', title: '休假', allDay: true, startDate: '2026-09-05', endDateExclusive: '2026-09-06' };
  const ics = generateIcs([allDay, G0_EVENTS[2]], { generatedAt: G0_GENERATED_AT });
  assert.match(ics, /DTSTART;VALUE=DATE:20260905\r\nDTEND;VALUE=DATE:20260906\r\n/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 1);
  assert.match(ics, /ACTION:DISPLAY\r\nDESCRIPTION:G0 測試｜含提醒事件\r\nTRIGGER:-PT30M\r\nEND:VALARM/);
});

test('UTF-8 text is escaped, folded at 75 octets, and serialized with CRLF only', () => {
  const longTitle = `逗號,分號;反斜線\\換行\n第二行 ${'很長的中文標題'.repeat(12)}`;
  const ics = generateIcs([{ id: 'long-text', title: longTitle, startLocal: '2026-09-06T09:00', endLocal: '2026-09-06T10:00' }], { calendarName: G0_CALENDAR_NAME, generatedAt: G0_GENERATED_AT });
  const logical = unfold(ics);
  assert.match(logical, new RegExp(`SUMMARY:${escapeIcsText(longTitle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(ics.split('\r\n').every((line) => encoder.encode(line).length <= 75));
  assert.match(ics, /\r\n /);
  assert.doesNotMatch(ics, /(?<!\r)\n|\r(?!\n)/);
  assert.ok(ics.endsWith('\r\n'));
});

test('the G0 fixture contains exactly the three requested event shapes', () => {
  const ics = generateIcs(G0_EVENTS, { calendarName: G0_CALENDAR_NAME, generatedAt: G0_GENERATED_AT });
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 1);
  assert.match(unfold(ics), /SUMMARY:G0 測試｜一般白天班/);
  assert.match(unfold(ics), /SUMMARY:G0 測試｜跨午夜班/);
  assert.match(unfold(ics), /SUMMARY:G0 測試｜含提醒事件/);
});

test('invalid ranges and duplicate event IDs are rejected before export', () => {
  assert.throws(() => generateIcs([{ id: 'bad', title: '錯誤', startLocal: '2026-09-02T22:00', endLocal: '2026-09-02T06:00' }]), /invalid_timed_range/);
  assert.throws(() => generateIcs([
    { id: 'same', title: '一', startLocal: '2026-09-01T08:00', endLocal: '2026-09-01T09:00' },
    { id: 'same', title: '二', startLocal: '2026-09-02T08:00', endLocal: '2026-09-02T09:00' },
  ]), /duplicate_event_id/);
});
