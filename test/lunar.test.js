import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLunarRule,
  lunarDateLabel,
  lunarRuleLabel,
  projectLunarOccurrences,
} from '../src/domain/lunar.js';
import { buildScheduleExport, createCalendarProfile, mergeAssignments } from '../src/domain/schedule.js';

test('lunar yearly conversion produces a checkable Gregorian event list', () => {
  const occurrences = projectLunarOccurrences({
    frequency: 'yearly', month: 8, day: 15,
    startDate: '2026-01-01', endDate: '2026-12-31',
  });
  assert.deepEqual(occurrences, [{
    date: '2026-09-25', lunarMonth: 8, lunarDay: 15, leapMonth: false, label: '農曆八月十五',
  }]);
  assert.equal(lunarDateLabel('2026-09-25'), '農曆八月十五');

  const profile = createCalendarProfile({ id: 'family', name: '家庭', presets: [{ id: 'festival', title: '中秋' }] });
  const assignments = mergeAssignments([], occurrences.map(({ date }) => ({ calendarProfileId: 'family', presetId: 'festival', date })));
  const exported = buildScheduleExport({
    calendarProfile: profile,
    assignments,
    request: { calendarProfileId: 'family', startDate: '2026-01-01', endDate: '2026-12-31' },
    generatedAt: new Date('2026-08-28T04:00:00.000Z'),
  });
  assert.deepEqual(exported.events.map(({ title, startDate }) => [title, startDate]), [['中秋', '2026-09-25']]);
  assert.match(exported.ics, /DTSTART;VALUE=DATE:20260925\r\n/u);
});

test('lunar monthly conversion includes leap months while yearly excludes them', () => {
  const monthly = projectLunarOccurrences({
    frequency: 'monthly', day: 1,
    startDate: '2025-06-01', endDate: '2025-08-01',
  });
  assert.deepEqual(monthly.map(({ date, leapMonth }) => [date, leapMonth]), [
    ['2025-06-25', false],
    ['2025-07-25', true],
  ]);
  const yearly = projectLunarOccurrences({
    frequency: 'yearly', month: 6, day: 1,
    startDate: '2025-06-01', endDate: '2025-08-01',
  });
  assert.deepEqual(yearly.map(({ date }) => date), ['2025-06-25']);
});

test('lunar rules reject invalid dates and ranges over the inclusive 30-year boundary', () => {
  assert.deepEqual(createLunarRule({ frequency: 'monthly', day: 15 }), { frequency: 'monthly', day: 15 });
  assert.equal(lunarRuleLabel({ frequency: 'yearly', month: 8, day: 15 }), '農曆每年 8 月 15 日（不含同名閏月）');
  assert.throws(() => createLunarRule({ frequency: 'monthly', day: 31 }), /invalid_lunar_day/u);
  assert.throws(() => projectLunarOccurrences({ frequency: 'monthly', day: 1, startDate: '2026-09-01', endDate: '2026-08-01' }), /invalid_lunar_range/u);
  assert.throws(() => projectLunarOccurrences({ frequency: 'monthly', day: 1, startDate: '2024-02-29', endDate: '2054-03-01' }), /lunar_range_too_long/u);
});
