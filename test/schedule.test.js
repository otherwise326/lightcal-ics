import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  assignmentUid,
  assignmentsForExport,
  buildScheduleExport,
  createAllDayPreset,
  createAssignment,
  createCalendarProfile,
  createExportRequest,
  createReminder,
  defaultExportFilename,
  sanitizeIcsFilename,
  toggleAssignment,
} from '../src/domain/schedule.js';

const GENERATED_AT = '2026-08-28T04:00:00.000Z';
const calendarProfile = createCalendarProfile({
  id: 'work',
  name: '我的/班表:2026',
  presets: [
    { id: 'day', title: '07-16', reminder: { mode: 'sameDay', time: '06:30' } },
    { id: 'night', title: '12-22', reminder: { mode: 'previousDay', time: '23:30' } },
    { id: 'off', title: '休假', reminder: { mode: 'none' } },
  ],
});

function assignment(presetId, date, calendarProfileId = 'work') {
  return createAssignment({ calendarProfileId, presetId, date });
}

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

test('G1 schemas are versioned and reject unsupported versions or invalid reminders', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(createReminder({ mode: 'none' }), { schemaVersion: 1, type: 'reminder', mode: 'none' });
  assert.deepEqual(createAllDayPreset({ id: 'day', title: '07-16', reminder: { mode: 'sameDay', time: '06:30' } }), {
    schemaVersion: 1,
    type: 'allDayPreset',
    id: 'day',
    title: '07-16',
    reminder: { schemaVersion: 1, type: 'reminder', mode: 'sameDay', time: '06:30' },
  });
  assert.equal(calendarProfile.schemaVersion, 1);
  assert.equal(calendarProfile.type, 'calendarProfile');
  assert.equal(createExportRequest({ calendarProfileId: 'work', startDate: '2026-08-31', endDate: '2026-09-02' }).type, 'exportRequest');
  assert.throws(() => createReminder({ schemaVersion: 2, mode: 'none' }), /unsupported_schema_version/);
  assert.throws(() => createReminder({ mode: 'sameDay', time: '25:00' }), /invalid_reminder_time/);
  assert.throws(() => createCalendarProfile({ id: 'work', name: '班表', presets: [{ id: 'same', title: '一' }, { id: 'same', title: '二' }] }), /duplicate_preset_id/);
});

test('same preset/date toggles off while different presets coexist on one date', () => {
  let assignments = [];
  assignments = toggleAssignment(assignments, assignment('day', '2026-09-01'));
  assignments = toggleAssignment(assignments, assignment('night', '2026-09-01'));
  assert.deepEqual(assignments.map(({ presetId, date }) => [presetId, date]), [['day', '2026-09-01'], ['night', '2026-09-01']]);
  assignments = toggleAssignment(assignments, assignment('day', '2026-09-01'));
  assert.deepEqual(assignments.map(({ presetId, date }) => [presetId, date]), [['night', '2026-09-01']]);
});

test('assignments persist across months and inclusive export range keeps both boundaries only', () => {
  const assignments = [
    assignment('day', '2026-08-30'),
    assignment('day', '2026-08-31'),
    assignment('off', '2026-09-02'),
    assignment('night', '2026-09-03'),
    assignment('day', '2026-09-01', 'other'),
  ];
  const selected = assignmentsForExport(assignments, { calendarProfileId: 'work', startDate: '2026-08-31', endDate: '2026-09-02' });
  assert.deepEqual(selected.map(({ presetId, date }) => [presetId, date]), [['day', '2026-08-31'], ['off', '2026-09-02']]);
  const result = buildScheduleExport({
    calendarProfile,
    assignments,
    request: { calendarProfileId: 'work', startDate: '2026-08-31', endDate: '2026-09-02' },
    generatedAt: GENERATED_AT,
  });
  assert.match(result.ics, /DTSTART;VALUE=DATE:20260831\r\nDTEND;VALUE=DATE:20260901\r\n/);
  assert.equal(assignments.length, 5);
  assert.throws(() => createExportRequest({ calendarProfileId: 'work', startDate: '2026-09-02', endDate: '2026-08-31' }), /invalid_export_range/);
});

test('default and edited filenames are safe and always end in one .ics extension', () => {
  const request = { calendarProfileId: 'work', startDate: '2026-08-31', endDate: '2026-09-02' };
  assert.equal(defaultExportFilename(calendarProfile, request), '我的-班表-2026_20260831-20260902.ics');
  assert.equal(sanitizeIcsFilename('  九月/班表:*?.ICS.ics  '), '九月-班表.ics');
  assert.equal(sanitizeIcsFilename('////'), 'LightCal.ics');
});

test('schedule export emits independent all-day events with stable identity-based UIDs', () => {
  const assignments = [assignment('day', '2026-09-01'), assignment('night', '2026-09-01')];
  const request = { calendarProfileId: 'work', startDate: '2026-09-01', endDate: '2026-09-01' };
  const first = buildScheduleExport({ calendarProfile, assignments, request, generatedAt: GENERATED_AT });
  const renamed = buildScheduleExport({
    calendarProfile: { ...calendarProfile, presets: calendarProfile.presets.map((preset) => preset.id === 'day' ? { ...preset, title: '早班（新名稱）' } : preset) },
    assignments,
    request,
    generatedAt: '2026-08-29T04:00:00.000Z',
  });
  assert.equal(first.events.length, 2);
  assert.match(first.ics, /PRODID:-\/\/LightCal ICS\/\/G1\/\/ZH-TW\r\n/);
  assert.equal((first.ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal((first.ics.match(/DTSTART;VALUE=DATE:20260901/g) ?? []).length, 2);
  assert.equal((first.ics.match(/DTEND;VALUE=DATE:20260902/g) ?? []).length, 2);
  assert.deepEqual(first.events.map(({ id }) => id), renamed.events.map(({ id }) => id));
  assert.equal(first.events[0].id, assignmentUid(assignment('day', '2026-09-01')));
  assert.deepEqual(unfold(first.ics).match(/^UID:.*$/gm), unfold(renamed.ics).match(/^UID:.*$/gm));
  assert.notEqual(
    assignmentUid(assignment('c', '2026-09-01', 'a:b')),
    assignmentUid(assignment('b:c', '2026-09-01', 'a')),
  );
});

test('same-day and previous-day reminder times become absolute UTC VALARM triggers', () => {
  const result = buildScheduleExport({
    calendarProfile,
    assignments: [assignment('day', '2026-09-01'), assignment('night', '2026-09-01'), assignment('off', '2026-09-02')],
    request: { calendarProfileId: 'work', startDate: '2026-09-01', endDate: '2026-09-02', filename: '九月班表' },
    generatedAt: GENERATED_AT,
  });
  assert.equal(result.filename, '九月班表.ics');
  assert.equal((result.ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.match(result.ics, /TRIGGER;VALUE=DATE-TIME:20260831T223000Z\r\n/);
  assert.match(result.ics, /TRIGGER;VALUE=DATE-TIME:20260831T153000Z\r\n/);
  assert.doesNotMatch(result.ics, /TRIGGER:-PT/);
});

test('schedule ICS preserves escaping, CRLF-only output, and 75-byte line folding', () => {
  const longProfile = createCalendarProfile({
    id: 'long',
    name: '特殊,行事曆;名稱',
    presets: [{ id: 'long-title', title: `逗號,分號;反斜線\\ ${'很長的中文標題'.repeat(12)}` }],
  });
  const result = buildScheduleExport({
    calendarProfile: longProfile,
    assignments: [assignment('long-title', '2026-09-01', 'long')],
    request: { calendarProfileId: 'long', startDate: '2026-09-01', endDate: '2026-09-01' },
    generatedAt: GENERATED_AT,
  });
  assert.match(unfold(result.ics), /X-WR-CALNAME:特殊\\,行事曆\\;名稱/);
  assert.match(unfold(result.ics), /SUMMARY:逗號\\,分號\\;反斜線\\\\ 很長的中文標題/);
  assert.ok(result.ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75));
  assert.match(result.ics, /\r\n /);
  assert.doesNotMatch(result.ics, /(?<!\r)\n|\r(?!\n)/);
  assert.ok(result.ics.endsWith('\r\n'));
});
