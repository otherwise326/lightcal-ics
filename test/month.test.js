import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthGrid, nextYearMonth, taipeiToday, yearMonthLabel } from '../src/domain/month.js';

test('G2 month helpers navigate across years and build a stable six-week grid', () => {
  assert.equal(nextYearMonth('2026-12', 1), '2027-01');
  assert.equal(nextYearMonth('2026-01', -1), '2025-12');
  assert.equal(yearMonthLabel('2026-09'), '2026 年 9 月');
  assert.equal(taipeiToday('2026-08-31T16:30:00.000Z'), '2026-09-01');
  const cells = buildMonthGrid('2026-09', [
    { calendarProfileId: 'work', presetId: 'day', date: '2026-09-01' },
    { calendarProfileId: 'work', presetId: 'night', date: '2026-09-01' },
    { calendarProfileId: 'other', presetId: 'off', date: '2026-09-01' },
  ], { calendarProfileId: 'work', today: '2026-09-01' });
  assert.equal(cells.length, 42);
  assert.equal(cells[0].localDate, '2026-08-30');
  assert.equal(cells.at(-1).localDate, '2026-10-10');
  const day = cells.find((cell) => cell.localDate === '2026-09-01');
  assert.equal(day.isToday, true);
  assert.equal(day.assignments.length, 2);
});
