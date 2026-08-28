/** Time helpers shared by settings and the course modal. */

/** Normalise "8:5" → "08:05"; returns "" for invalid input. */
export function normalizeTime(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return "";
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Validate a "YYYY-MM-DD" date string. */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00");
  return !isNaN(d.getTime()) && s === toIsoLocal(d);
}

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Parse a comma/space separated week list like "1,3,5,9" → unique sorted numbers. */
export function parseWeekList(s: string): number[] {
  const out = new Set<number>();
  for (const part of s.split(/[,，\s]+/)) {
    const n = parseInt(part, 10);
    if (!isNaN(n) && n >= 1 && n <= 60) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}
