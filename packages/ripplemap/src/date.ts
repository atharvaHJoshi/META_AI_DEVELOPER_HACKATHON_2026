/** UTC-safe working-day date helpers. Weekends are excluded; holidays are not modelled. */

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function nextWorkingDay(date: Date): Date {
  const next = new Date(date.getTime());
  while (isWeekend(next)) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addWorkingDays(date: Date, days: number): Date {
  let remaining = Math.abs(days);
  const direction = days < 0 ? -1 : 1;
  const next = new Date(date.getTime());
  while (remaining > 0) {
    next.setUTCDate(next.getUTCDate() + direction);
    if (!isWeekend(next)) remaining -= 1;
  }
  return next;
}

export function calendarDaysBetween(from: string | Date, to: string | Date): number {
  const start = typeof from === "string" ? parseIsoDate(from) : from;
  const end = typeof to === "string" ? parseIsoDate(to) : to;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function workingDaysBetween(from: string | Date, to: string | Date): number {
  const start = typeof from === "string" ? parseIsoDate(from) : from;
  const end = typeof to === "string" ? parseIsoDate(to) : to;
  if (end.getTime() <= start.getTime()) return 0;
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() < end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor)) count += 1;
  }
  return count;
}

export function countWorkingDaysInclusive(from: string | Date, to: string | Date): number {
  const start = typeof from === "string" ? parseIsoDate(from) : from;
  const end = typeof to === "string" ? parseIsoDate(to) : to;
  if (end.getTime() < start.getTime()) return 0;
  let count = 0;
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
