import type { SchoolDay, Semester, TimetableSlot, WeekRule } from "../types";

/** Returns the Monday of the week containing the given date (local time). */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Local "yyyy-mm-dd" string — never toISOString() (UTC shift trap). */
export function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** ISO key of the week containing `date`, keyed on its Monday. */
export function weekKey(date: Date): string {
  return localIso(getMondayOfWeek(date));
}

export function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameWeek(a: Date, b: Date): boolean {
  return getMondayOfWeek(a).getTime() === getMondayOfWeek(b).getTime();
}

/** JS getDay() → SchoolDay key. */
export const DAY_INDEX_MAP: Record<number, SchoolDay> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

const DAY_KEYS: SchoolDay[] = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

export function schoolDayOf(date: Date): SchoolDay {
  return DAY_INDEX_MAP[date.getDay()];
}

/** 0-based index of a school day (monday = 0 … sunday = 6). */
export function schoolDayOffset(day: SchoolDay): number {
  return DAY_KEYS.indexOf(day);
}

function parseIso(s: string): Date {
  return new Date(s + "T12:00:00");
}

function weeksBetween(aMonday: Date, bMonday: Date): number {
  return Math.round((bMonday.getTime() - aMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/**
 * The teaching week number of `date` in the semester, where the semester
 * start date's week is week 1.
 * Returns 0 before the semester, or > total after the end (clamped to total).
 */
export function getWeekNumber(date: Date, sem: Semester): number {
  const startMonday = getMondayOfWeek(parseIso(sem.startDate));
  const targetMonday = getMondayOfWeek(date);
  const n = weeksBetween(startMonday, targetMonday) + 1;
  const total = totalWeeks(sem);
  if (n < 1) return 0;
  return total > 0 && n > total ? total : n;
}

/** Total number of weeks the semester spans (including the end week). */
export function totalWeeks(sem: Semester): number {
  const startMonday = getMondayOfWeek(parseIso(sem.startDate));
  const endMonday = getMondayOfWeek(parseIso(sem.endDate));
  return Math.max(1, weeksBetween(startMonday, endMonday) + 1);
}

export function isWithinSemester(date: Date, sem: Semester): boolean {
  const d = date.getTime();
  return d >= parseIso(sem.startDate).getTime() && d <= parseIso(sem.endDate).getTime();
}

/** Whether a week rule covers the given week number. */
export function weekRuleMatches(rule: WeekRule | undefined, weekNo: number): boolean {
  if (!rule) return true;
  if (rule.weeks && rule.weeks.length > 0) return rule.weeks.includes(weekNo);
  if (weekNo < rule.start || weekNo > rule.end) return false;
  if (rule.parity === "all") return true;
  return rule.parity === "odd" ? weekNo % 2 === 1 : weekNo % 2 === 0;
}

/** Whether a slot occurs in the given week number. */
export function slotInWeek(slot: TimetableSlot, weekNo: number): boolean {
  return weekRuleMatches(slot.weeks, weekNo);
}

/**
 * Whether two week rules can both be active in at least one week.
 * Missing rules mean "every week" and therefore overlap everything.
 */
export function weekRuleOverlap(a: WeekRule | undefined, b: WeekRule | undefined, maxWeek = 60): boolean {
  if (!a || !b) return true;
  const limit = Math.max(1, Math.min(maxWeek, Math.max(a.end, b.end, 60)));
  for (let w = 1; w <= limit; w++) {
    if (weekRuleMatches(a, w) && weekRuleMatches(b, w)) return true;
  }
  return false;
}

/** "HH:MM" → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** minutes since midnight → "HH:MM". */
export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Short date like "8/31" or "31 Aug" depending on locale — used in headers. */
export function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
