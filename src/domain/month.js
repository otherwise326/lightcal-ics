import { addDays, validLocalDate } from './schedule.js';

const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export function validYearMonth(value) {
  if (!YEAR_MONTH_PATTERN.test(value ?? '')) return false;
  const [year, month] = value.split('-').map(Number);
  return year >= 1 && month >= 1 && month <= 12;
}

export function taipeiToday(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.valueOf())) throw new Error('invalid_now');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date);
}

export function nextYearMonth(yearMonth, amount) {
  if (!validYearMonth(yearMonth) || !Number.isInteger(amount)) throw new Error('invalid_year_month');
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7);
}

export function yearMonthLabel(yearMonth) {
  if (!validYearMonth(yearMonth)) throw new Error('invalid_year_month');
  const [year, month] = yearMonth.split('-').map(Number);
  return `${year} 年 ${month} 月`;
}

export function buildMonthGrid(yearMonth, assignments = [], { calendarProfileId, today = taipeiToday() } = {}) {
  if (!validYearMonth(yearMonth)) throw new Error('invalid_year_month');
  if (!validLocalDate(today)) throw new Error('invalid_today');
  const first = `${yearMonth}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -weekday);
  const byDate = new Map();
  for (const assignment of assignments) {
    if (calendarProfileId && assignment.calendarProfileId !== calendarProfileId) continue;
    const list = byDate.get(assignment.date) ?? [];
    list.push(assignment);
    byDate.set(assignment.date, list);
  }
  return Array.from({ length: 42 }, (_, index) => {
    const localDate = addDays(start, index);
    return {
      localDate,
      day: Number(localDate.slice(8, 10)),
      inMonth: localDate.startsWith(yearMonth),
      isToday: localDate === today,
      assignments: byDate.get(localDate) ?? [],
    };
  });
}
