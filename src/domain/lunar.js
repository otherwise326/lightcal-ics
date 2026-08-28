import lunarJavascript from 'lunar-javascript';
import { addDays, validLocalDate } from './schedule.js';

const { Solar } = lunarJavascript;
const FREQUENCIES = new Set(['monthly', 'yearly']);

function positiveInteger(value, minimum, maximum, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(code);
  return number;
}

function maxRangeEnd(startDate) {
  const [year, month, day] = startDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year + 30, month, 0)).getUTCDate();
  return `${year + 30}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function createLunarRule(input) {
  const frequency = String(input?.frequency ?? '');
  if (!FREQUENCIES.has(frequency)) throw new Error('invalid_lunar_frequency');
  const day = positiveInteger(input?.day, 1, 30, 'invalid_lunar_day');
  if (frequency === 'monthly') return Object.freeze({ frequency, day });
  const month = positiveInteger(input?.month, 1, 12, 'invalid_lunar_month');
  return Object.freeze({ frequency, month, day });
}

export function lunarDateLabel(localDate) {
  if (!validLocalDate(localDate)) throw new Error('invalid_lunar_solar_date');
  const [year, month, day] = localDate.split('-').map(Number);
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  return `農曆${lunar.getMonth() < 0 ? '閏' : ''}${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
}

export function projectLunarOccurrences(input) {
  const startDate = input?.startDate;
  const endDate = input?.endDate;
  if (!validLocalDate(startDate) || !validLocalDate(endDate) || startDate > endDate) throw new Error('invalid_lunar_range');
  if (endDate > maxRangeEnd(startDate)) throw new Error('lunar_range_too_long');
  const rule = createLunarRule(input);
  const occurrences = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const [year, month, day] = date.split('-').map(Number);
    const lunar = Solar.fromYmd(year, month, day).getLunar();
    const lunarMonth = lunar.getMonth();
    if (lunar.getDay() !== rule.day) continue;
    if (rule.frequency === 'yearly' && lunarMonth !== rule.month) continue;
    occurrences.push(Object.freeze({
      date,
      lunarMonth: Math.abs(lunarMonth),
      lunarDay: lunar.getDay(),
      leapMonth: lunarMonth < 0,
      label: `農曆${lunarMonth < 0 ? '閏' : ''}${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    }));
  }
  return Object.freeze(occurrences);
}

export function lunarRuleLabel(input) {
  const rule = createLunarRule(input);
  if (rule.frequency === 'monthly') return `農曆每月 ${rule.day} 日（包含閏月）`;
  return `農曆每年 ${rule.month} 月 ${rule.day} 日（不含同名閏月）`;
}
