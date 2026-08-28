import type { PluginData, Semester } from "./types";

/**
 * Default semester — a neutral placeholder term with standard period times,
 * so the plugin is usable immediately. Users change everything in Settings.
 */
export const DEFAULT_SEMESTER: Semester = {
  id: "semester-default",
  name: "2025-2026-1",
  startDate: "2025-09-01",
  endDate: "2026-07-15",
  periods: [
    { id: "p1-2",  name: "第1-2节",  start: "08:00", end: "09:40" },
    { id: "p3-4",  name: "第3-4节",  start: "10:00", end: "11:40" },
    { id: "p5-6",  name: "第5-6节",  start: "14:00", end: "15:40" },
    { id: "p7-8",  name: "第7-8节",  start: "16:00", end: "17:40" },
    { id: "p9-11", name: "第9-11节(晚上)", start: "19:00", end: "21:35" },
  ],
  courses: [],
  timetable: [],
  schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  useCustomTime: false,
  dayOverrides: [],
  events: [],
  slotExclusions: [],
};

export function makeSemester(overrides: Partial<Semester> = {}): Semester {
  return {
    ...DEFAULT_SEMESTER,
    id: "semester-" + Date.now(),
    courses: [],
    timetable: [],
    ...overrides,
  };
}

export const DEFAULT_DATA: PluginData = {
  activeSemesterId: DEFAULT_SEMESTER.id,
  lang: "auto",
  semesters: [DEFAULT_SEMESTER],
};

/** Palette ordered by spectrum — used for new courses and period tinting. */
export const COURSE_COLOUR_PALETTE = [
  "#f6a9a9", "#fab387", "#f2c97d", "#f9e2af",
  "#a6e3a1", "#80c787", "#94e2d5",
  "#89dceb", "#74c7ec", "#89b4fa",
  "#b4befe", "#cba6f7", "#d4a5c9",
  "#e8a2b8", "#f38ba8",
];

export function randomCourseColour(used: Array<string | undefined> = []): string {
  const taken = new Set(used.filter((c): c is string => !!c).map(c => c.toLowerCase()));
  const free = COURSE_COLOUR_PALETTE.filter(c => !taken.has(c.toLowerCase()));
  const pool = free.length ? free : COURSE_COLOUR_PALETTE;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Emoji choices for the course icon picker. */
export const COURSE_EMOJIS = [
  "📚", "📖", "🧮", "🔬", "⚗️", "⚡", "💻", "🔭", "🌍", "🏛️",
  "🎨", "🎵", "🏃", "🌐", "💰", "🎭", "📐", "🧠", "⚖️", "🌱",
  "📸", "🎬", "🍳", "🤝", "📊", "🎸", "📝", "🌿", "🧬", "🩺",
];
