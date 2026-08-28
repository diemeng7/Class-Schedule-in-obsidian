/**
 * RFC 5545 iCalendar export for one semester.
 * - recurring courses are expanded per occurrence (week rules applied);
 * - one-off events are included on their date/period;
 * - unscheduled courses (课程设计…) become all-day events for each week
 *   in their week range.
 */
import type { Semester, TimetableSlot } from "../types";
import {
  addDays, getMondayOfWeek, localIso, schoolDayOffset,
  slotInWeek, timeToMinutes, totalWeeks, weekRuleMatches,
} from "./weekUtils";

const CRLF = "\r\n";

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function icsDateTime(iso: string, hhmm: string): string {
  return `${icsDate(iso)}T${hhmm.replace(":", "")}00`;
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}Z`;
}

function vevent(uid: string, start: string, end: string, summary: string, location: string, description: string): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowStamp()}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(summary)}`,
  ];
  if (location) lines.push(`LOCATION:${esc(location)}`);
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  lines.push("END:VEVENT");
  return lines.join(CRLF);
}

function courseLabel(sem: Semester, slot: TimetableSlot): { summary: string; room: string; desc: string } {
  const c = sem.courses.find(x => x.id === slot.courseId);
  const room = slot.classroom ?? c?.classroom ?? "";
  const desc = [c?.teacher, slot.notes].filter(Boolean).join(" · ");
  return { summary: `${c?.emoji ?? ""} ${c?.name ?? "?"}`.trim(), room, desc };
}

export function buildIcs(sem: Semester): string {
  const events: string[] = [];
  const total = totalWeeks(sem);
  const startMonday = getMondayOfWeek(new Date(sem.startDate + "T12:00:00"));

  // Recurring courses, expanded per occurrence.
  for (let wk = 1; wk <= total; wk++) {
    const weekMonday = addDays(startMonday, (wk - 1) * 7);
    for (const dayKey of sem.schoolDays) {
      const date = localIso(addDays(weekMonday, schoolDayOffset(dayKey)));
      for (const slot of sem.timetable) {
        if (slot.day !== dayKey || !slotInWeek(slot, wk)) continue;
        if (sem.slotExclusions?.some(e => e.slotId === slot.id && e.date === date)) continue;
        const p = sem.periods.find(x => x.id === slot.periodId);
        if (!p) continue;
        const { summary, room, desc } = courseLabel(sem, slot);
        events.push(vevent(
          `cs-${sem.id}-${slot.id}-${date}@class-schedule`,
          icsDateTime(date, p.start),
          icsDateTime(date, p.end),
          summary, room, desc,
        ));
      }
    }
  }

  // One-off events.
  for (const ev of sem.events ?? []) {
    const p = sem.periods.find(x => x.id === ev.periodId);
    if (!p) continue;
    events.push(vevent(
      `cs-${sem.id}-ev-${ev.id}@class-schedule`,
      icsDateTime(ev.date, p.start),
      icsDateTime(ev.date, p.end),
      ev.title, ev.classroom ?? "", ev.notes ?? "",
    ));
  }

  // Unscheduled courses → all-day events for each week in range.
  for (const c of sem.courses) {
    if (!c.unscheduled || !c.weeks) continue;
    const label = `${c.emoji ?? ""} ${c.name}`.trim();
    for (let wk = Math.max(1, c.weeks.start); wk <= Math.min(total, c.weeks.end); wk++) {
      if (!weekRuleMatches(c.weeks, wk)) continue;
      const monday = localIso(addDays(startMonday, (wk - 1) * 7));
      const nextMonday = localIso(addDays(startMonday, wk * 7));
      events.push(vevent(
        `cs-${sem.id}-${c.id}-w${wk}@class-schedule`,
        `VALUE=DATE:${icsDate(monday)}`,
        `VALUE=DATE:${icsDate(nextMonday)}`,
        label, c.classroom ?? "", c.teacher ?? "",
      ));
    }
  }

  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Class Schedule//Obsidian//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ].join(CRLF);

  return head + CRLF + events.join(CRLF) + CRLF + "END:VCALENDAR" + CRLF;
}
