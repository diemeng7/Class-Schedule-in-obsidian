/**
 * Class Schedule — student timetable plugin for Obsidian.
 *
 * Data model. Kept deliberately small and WakeUp-like:
 * a semester holds periods (节次), courses (课程) and a flat timetable
 * of slots (each slot is one recurring course occurrence with a week rule).
 */

export type SchoolDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** One time block in the school day, e.g. "第1-2节" 08:00–09:40. */
export interface Period {
  id: string;
  name: string;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

/** A course (课程): name, emoji, colour, optional teacher and default room. */
export interface Course {
  id: string;
  name: string;
  emoji?: string;
  colour: string;
  teacher?: string;
  classroom?: string;
  /** 学分 — shown on course cards and summed in settings. */
  credits?: number;
  /** 无固定时间：只有周次、没有具体星期/节次（如课程设计第18-19周）。 */
  unscheduled?: boolean;
  /** 无固定时间课程的周次（仅 unscheduled 时使用）。 */
  weeks?: WeekRule;
}

/**
 * Which weeks of the semester a slot runs in.
 * - `weeks` (explicit list) wins when present — e.g. [1, 3, 5, 9].
 * - otherwise `parity` applies within [start, end] — e.g. 1–13 odd weeks.
 * Omit the rule entirely (undefined) for "every week".
 */
export interface WeekRule {
  start: number;
  end: number;
  parity: "all" | "odd" | "even";
  weeks?: number[];
}

/** One recurring course occurrence: a course on a day/period, with a week rule. */
export interface TimetableSlot {
  id: string;
  day: SchoolDay;
  periodId: string;
  courseId: string;
  weeks?: WeekRule;
  /** Per-slot classroom override — falls back to the course default. */
  classroom?: string;
  /** Free-form note shown on the course chip (e.g. 调课说明). */
  notes?: string;
  /** Custom total duration in minutes (feature: 自定义课时). */
  durationMinutes?: number;
  /** Middle break in minutes, rendered as a dashed divider inside the block. */
  breakMinutes?: number;
}

/**
 * One whole-day override (调休):
 * - "holiday"  → the day's classes are hidden.
 * - "makeup"   → the day shows another specific date's timetable (sourceDate),
 *                resolved with that date's own week-rule.
 * Manual overrides always beat the semester's default school days.
 */
export interface DayOverride {
  date: string; // "YYYY-MM-DD"
  type: "holiday" | "makeup";
  /** For "makeup": the specific date whose timetable is moved here. */
  sourceDate?: string;
}

/** A one-off event on a specific date+period (补课 / 讲座 / 班会…). */
export interface OneOffEvent {
  id: string;
  date: string;     // "YYYY-MM-DD"
  periodId: string;
  title: string;
  colour?: string;
  classroom?: string;
  notes?: string;
}

/** Hide one recurring slot on one specific date (停课, day only). */
export interface SlotExclusion {
  slotId: string;
  date: string; // "YYYY-MM-DD"
}

/** One semester (学期): dates, periods, courses and the timetable. */
export interface Semester {
  id: string;
  name: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  periods: Period[];
  courses: Course[];
  timetable: TimetableSlot[];
  schoolDays: SchoolDay[];
  /** Whether custom lesson duration / break fields are enabled. */
  useCustomTime?: boolean;
  /** Manual whole-day overrides (放假 / 补课). */
  dayOverrides?: DayOverride[];
  /** One-off events (临时事件). */
  events?: OneOffEvent[];
  /** Per-date course cancellations (停课). */
  slotExclusions?: SlotExclusion[];
}

export type LangSetting = "auto" | "zh" | "en";
export type Lang = "zh" | "en";

/** Top-level data persisted to data.json. */
export interface PluginData {
  activeSemesterId: string;
  lang: LangSetting;
  semesters: Semester[];
  /** Compact grid / card density (global appearance). */
  compact?: boolean;
}
