/**
 * One-off migration: import a Teacher Planner vault into Class Schedule.
 *
 * Reads .obsidian/plugins/teacher-planer/data.json and rewrites
 * .obsidian/plugins/Class Schedule/data.json with the active planner's
 * semester, courses (name/emoji/colour/teacher/room/credits parsed from the
 * lesson notes) and timetable slots (week rules parsed from 周次 notes).
 */
import fs from "node:fs";
import path from "node:path";

const vault = path.resolve(import.meta.dirname, "../../..");
const teacherPath = path.join(vault, ".obsidian", "plugins", "teacher-planer", "data.json");
const pluginDataPath = path.join(vault, ".obsidian", "plugins", "Class Schedule", "data.json");

const teacher = JSON.parse(fs.readFileSync(teacherPath, "utf8"));
const planner = teacher.planners?.find(p => p.id === teacher.activePlannerId) ?? teacher.planners?.[0];
if (!planner) {
  console.error("No planner found in teacher data.");
  process.exit(1);
}

const slots = (planner.timetableTemplates ?? []).flatMap(t => t.slots ?? []);
if (slots.length === 0) {
  console.error("No timetable slots found.");
  process.exit(1);
}

const subjectMap = new Map((planner.subjects ?? []).map(s => [s.id, s]));

// ── Courses ──────────────────────────────────────────────────────────────
const courses = [];
const classToCourse = new Map();
for (const cls of planner.classes ?? []) {
  const subj = subjectMap.get(cls.subjectId);
  const clsSlots = slots.filter(s => s.classId === cls.id);
  const notesText = clsSlots.map(s => s.notes ?? "").join(";");
  const teacherName = (notesText.match(/教师[:：]\s*([^;；]+)/)?.[1] ?? "").trim();
  const creditsRaw = notesText.match(/学分[:：]?\s*([\d.]+)/)?.[1];
  const course = {
    id: "course-" + String(cls.id).replace(/^cls-/, ""),
    name: cls.code || subj?.name || "课程",
    emoji: subj?.emoji || undefined,
    colour: cls.colour || subj?.colour || "#89b4fa",
    teacher: teacherName || undefined,
    classroom: cls.classroom || clsSlots.find(s => s.classroom)?.classroom || undefined,
    credits: creditsRaw ? parseFloat(creditsRaw) : undefined,
  };
  classToCourse.set(cls.id, course.id);
  courses.push(course);
}

// Unscheduled courses from activities that only have a week range
// (e.g. 课程设计 18-19周, 实验 1-16周) — no fixed day/period.
for (const act of planner.activities ?? []) {
  if (!act.info) continue;
  const m = act.info.match(/(\d+)\s*-\s*(\d+)\s*周/);
  if (!m) continue;
  const teacherName = act.info.split(/[·\s]/).filter(Boolean)[0] ?? undefined;
  courses.push({
    id: "course-" + String(act.id).replace(/^activity-/, ""),
    name: act.label,
    emoji: "🧪",
    colour: act.colour || "#94e2d5",
    teacher: teacherName || undefined,
    unscheduled: true,
    weeks: { start: parseInt(m[1], 10), end: parseInt(m[2], 10), parity: "all" },
  });
}

// ── Week rules (parsed from 周次 notes; A/B only as fallback) ─────────────
const ay = planner.academicYear;
const startM = getMonday(new Date(ay.startDate + "T12:00:00"));
const endM = getMonday(new Date(ay.endDate + "T12:00:00"));
const totalWeeks = Math.max(1, Math.round((endM - startM) / (7 * 86400000)) + 1);

function getMonday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
  return x;
}

function parseWeeks(slot) {
  const note = slot.notes ?? "";
  const m = note.match(/周次[:：]?\s*(\d+)\s*-\s*(\d+)\s*周\s*(?:\((单|双)\))?/);
  if (m) {
    return {
      start: parseInt(m[1], 10),
      end: parseInt(m[2], 10),
      parity: m[3] === "单" ? "odd" : m[3] === "双" ? "even" : "all",
    };
  }
  if (slot.weekType === "A") return { start: 1, end: totalWeeks, parity: "odd" };
  if (slot.weekType === "B") return { start: 1, end: totalWeeks, parity: "even" };
  return undefined; // every week
}

// ── Semester ─────────────────────────────────────────────────────────────
const semester = {
  id: "semester-default",
  name: ay.name || "Imported Semester",
  startDate: ay.startDate,
  endDate: ay.endDate,
  periods: (ay.periods ?? []).map(p => ({ id: p.id, name: p.name, start: p.start, end: p.end })),
  courses,
  timetable: slots
    .map(s => ({
      id: String(s.id ?? "slot-" + Math.random()),
      day: s.day,
      periodId: s.periodId,
      courseId: classToCourse.get(s.classId) ?? "",
      weeks: parseWeeks(s),
      classroom: s.classroom || undefined,
      notes: s.notes || undefined,
    }))
    .filter(t => t.courseId),
  schoolDays: planner.schoolDays ?? ["monday", "tuesday", "wednesday", "thursday", "friday"],
  useCustomTime: false,
  dayOverrides: [],
};

// ── Write (backup first) ─────────────────────────────────────────────────
const current = JSON.parse(fs.readFileSync(pluginDataPath, "utf8"));
fs.writeFileSync(pluginDataPath + ".bak-import", JSON.stringify(current, null, 2), "utf8");

const out = {
  ...current,
  activeSemesterId: "semester-default",
  semesters: [semester],
};
fs.writeFileSync(pluginDataPath, JSON.stringify(out, null, 2), "utf8");

console.log(`Imported "${semester.name}"`);
console.log(`  courses: ${courses.length}  slots: ${semester.timetable.length}  periods: ${semester.periods.length}`);
console.log(`  unscheduled courses: ${courses.filter(c => c.unscheduled).length}`);
const odd = semester.timetable.filter(t => t.weeks?.parity === "odd").length;
const even = semester.timetable.filter(t => t.weeks?.parity === "even").length;
const all = semester.timetable.filter(t => !t.weeks || t.weeks.parity === "all").length;
console.log(`  week rules → 单周:${odd}  双周:${even}  每周:${all}`);
