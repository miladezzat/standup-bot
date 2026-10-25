import { eachDayOfInterval, format, parseISO } from 'date-fns';
import { METRICS_HOLIDAYS, WORKING_DAYS } from '../config';

export interface MetricEntry {
  date: string;
  yesterday: string;
  today?: string;
  blockers?: string;
  isDayOff?: boolean;
  dayOffStartTime?: string;
  dayOffEndTime?: string;
  yesterdayHoursEstimate?: number;
  todayHoursEstimate?: number;
}

const EMPTY_TEXT = /^(?:none|n\/?a|nothing|no(?: (?:tasks?|updates?|blockers?)(?: today)?)?|day off|ooo|out of office)[.!\s]*$/i;

// Tasks are reported text items, not verified issue completions. Only line prefixes
// are stripped: hyphens in issue IDs, URLs and prose do not create extra tasks.
export function parseReportedTasks(text = ''): string[] {
  return text.split(/\r?\n/)
    .map(line => line.trim().replace(/^(?:[-–•*]|\d+[.)])(?:\s+|$)/, '').trim())
    .filter(line => !!line && !EMPTY_TEXT.test(line));
}

export function countReportedTasks(text = ''): number {
  return parseReportedTasks(text).length;
}

export function isFullDayOff(entry: MetricEntry): boolean {
  if (!entry.isDayOff) return false;
  if (!entry.dayOffStartTime || !entry.dayOffEndTime) return true;
  const minutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };
  return minutes(entry.dayOffEndTime) - minutes(entry.dayOffStartTime) >= 8 * 60;
}

export function completedTasks(entry: MetricEntry): number {
  return isFullDayOff(entry) ? 0 : countReportedTasks(entry.yesterday);
}

export function reportedHours(entry: MetricEntry): number {
  const hours = entry.yesterdayHoursEstimate;
  return !isFullDayOff(entry) && typeof hours === 'number' && Number.isFinite(hours) && hours > 0 ? hours : 0;
}

export function hasBlockers(entry: MetricEntry): boolean {
  const text = entry.blockers?.trim();
  return !isFullDayOff(entry) && !!text && !EMPTY_TEXT.test(text);
}

export function workingDates(start: string, end: string): string[] {
  if (start > end) return [];
  return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) })
    .filter(day => WORKING_DAYS.includes(day.getDay()))
    .map(day => format(day, 'yyyy-MM-dd'))
    .filter(day => !METRICS_HOLIDAYS.includes(day));
}

export function submissionRate(entries: MetricEntry[], start: string, end: string) {
  const days = workingDates(start, end);
  const leave = new Set(entries.filter(isFullDayOff).map(s => s.date));
  const expected = days.filter(day => !leave.has(day));
  const submitted = new Set(entries.filter(s => !isFullDayOff(s)).map(s => s.date));
  const count = expected.filter(day => submitted.has(day)).length;
  return { expected: expected.length, count, rate: expected.length ? count / expected.length : 1 };
}
