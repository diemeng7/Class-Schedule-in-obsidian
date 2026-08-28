<script lang="ts">
  import type ClassSchedulePlugin from "../main";
  import type { DayOverride, OneOffEvent, SchoolDay, TimetableSlot } from "../types";
  import { Menu, Platform, setIcon } from "obsidian";
  import { onMount, onDestroy } from "svelte";
  import {
    getMondayOfWeek, addWeeks, addDays, isSameWeek, localIso,
    getWeekNumber, slotInWeek, timeToMinutes, shortDate, schoolDayOf, weekRuleOverlap, weekRuleMatches,
  } from "../utils/weekUtils";
  import { hexToRgba, colourToCss, clearThemeColourCache } from "../utils/themeColours";
  import { DatePickerModal } from "../modals/DatePickerModal";
  import { CourseModal } from "../modals/CourseModal";
  import { CourseFormModal } from "../modals/CourseFormModal";
  import { EventModal } from "../modals/EventModal";

  export let plugin: ClassSchedulePlugin;
  export let initialDate: Date = new Date();

  // ── Reactivity tick ──────────────────────────────────────────────────────
  let _tick = 0;
  function _dep<T>(_t: unknown, value: T): T { return value; }
  function invalidate() { _tick++; }
  export function refreshEvents() { invalidate(); }

  const DAY_KEYS: SchoolDay[] = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

  function obsIcon(node: HTMLElement, id: string) {
    setIcon(node, id);
    return { update(newId: string) { setIcon(node, newId); } };
  }

  // ── Date / week state ────────────────────────────────────────────────────
  let currentDate = new Date(initialDate);
  let _lastInitialDate = initialDate;
  $: if (initialDate !== _lastInitialDate) {
    _lastInitialDate = initialDate;
    currentDate = new Date(initialDate);
  }

  $: currentMonday = getMondayOfWeek(currentDate);
  $: isCurrentWeek = _dep(_tick, isSameWeek(currentMonday, new Date()));
  $: weekNo = _dep(_tick, getWeekNumber(currentMonday, plugin.settings));
  $: weekLabel = weekNo > 0
    ? plugin.t("week.label", { n: weekNo })
    : (weekNo === 0 ? plugin.t("week.beforeStart") : plugin.t("week.afterEnd"));
  $: dateRange = (() => {
    const end = addDays(currentMonday, 6);
    return `${shortDate(currentMonday)} – ${shortDate(end)}`;
  })();
  $: dayOverrides = _dep(_tick, plugin.settings.dayOverrides ?? []);
  $: events = _dep(_tick, plugin.settings.events ?? []);
  $: exclusions = _dep(_tick, plugin.settings.slotExclusions ?? []);
  $: useCustomTime = _dep(_tick, !!plugin.settings.useCustomTime);
  $: periods = _dep(_tick, plugin.settings.periods);
  $: courses = _dep(_tick, plugin.settings.courses);
  $: slots = _dep(_tick, plugin.settings.timetable);
  $: semesters = _dep(_tick, plugin.data.semesters);
  $: activeSemesterId = _dep(_tick, plugin.data.activeSemesterId);
  $: compact = _dep(_tick, plugin.compact);

  // School-day columns plus any make-up days in the current week.
  $: days = (() => {
    const base = plugin.settings.schoolDays.map(k => ({ key: k, offset: DAY_KEYS.indexOf(k) }));
    const seen = new Set(base.map(d => d.key));
    for (const ov of dayOverrides) {
      if (ov.type !== "makeup" || !ov.date) continue;
      const d = new Date(ov.date + "T12:00:00");
      if (getMondayOfWeek(d).getTime() !== currentMonday.getTime()) continue;
      const key = schoolDayOf(d);
      if (!seen.has(key)) {
        seen.add(key);
        base.push({ key, offset: DAY_KEYS.indexOf(key) });
      }
    }
    return base.sort((a, b) => a.offset - b.offset);
  })();

  // ── Whole-day overrides (放假 / 补课) ────────────────────────────────────
  function overrideFor(iso: string): DayOverride | undefined {
    return dayOverrides.find(o => o.date === iso);
  }
  function dayStatusOf(dayKey: SchoolDay, iso: string): { status: "normal" | "holiday" | "makeup"; sourceDate?: string } {
    const ov = overrideFor(iso);
    if (!ov) return { status: "normal" };
    if (ov.type === "holiday") return { status: "holiday" };
    return { status: "makeup", sourceDate: ov.sourceDate };
  }
  async function setDayOverride(iso: string, ov: DayOverride | undefined) {
    const list = (plugin.settings.dayOverrides ?? []).filter(o => o.date !== iso);
    if (ov) list.push(ov);
    plugin.settings.dayOverrides = list;
    await plugin.saveSettings();
    invalidate();
  }
  function openDayMenu(e: MouseEvent, day: { key: SchoolDay; offset: number }) {
    e.stopPropagation();
    const iso = dayISODate(day.offset, currentMonday);
    const st = dayStatusOf(day.key, iso);
    const menu = new Menu();
    menu.addItem(i => i.setTitle(plugin.t("day.override.normal")).setChecked(st.status === "normal")
      .onClick(() => { void setDayOverride(iso, undefined); }));
    menu.addItem(i => i.setTitle(plugin.t("day.override.setHoliday")).setChecked(st.status === "holiday")
      .onClick(() => { void setDayOverride(iso, { date: iso, type: "holiday" }); }));
    menu.addSeparator();
    menu.addItem(i => i.setTitle(plugin.t("day.override.setMakeup")).setIcon("arrow-right-left").onClick(() => {
      new DatePickerModal(plugin.app, {
        value: iso,
        min: plugin.settings.startDate,
        max: plugin.settings.endDate,
        t: (k, v) => plugin.t(k, v),
        onPick: (src) => { void setDayOverride(iso, { date: iso, type: "makeup", sourceDate: src }); },
      }).open();
    }));
    if (st.status !== "normal") {
      menu.addSeparator();
      menu.addItem(i => i.setTitle(plugin.t("day.override.clear")).setIcon("undo-2")
        .onClick(() => { void setDayOverride(iso, undefined); }));
    }
    menu.showAtMouseEvent(e);
  }

  // Slots visible in the current week, keyed "day:periodId" → array
  // (a cell can hold several courses, e.g. odd/even weeks).
  $: slotMap = (() => {
    const m: Record<string, TimetableSlot[]> = {};
    if (weekNo <= 0) return m;
    for (const s of slots) {
      if (!slotInWeek(s, weekNo)) continue;
      (m[s.day + ":" + s.periodId] ??= []).push(s);
    }
    return m;
  })();

  function courseOf(slot: TimetableSlot) {
    return courses.find(c => c.id === slot.courseId);
  }

  // ── Time axis ────────────────────────────────────────────────────────────
  $: PX_PER_MIN = _dep(_tick, plugin.getGridScale()) / 60;
  $: axis = (() => {
    let min = 24 * 60, max = 0;
    for (const p of periods) {
      min = Math.min(min, timeToMinutes(p.start));
      max = Math.max(max, timeToMinutes(p.end));
    }
    if (min >= max) { min = 8 * 60; max = 16 * 60; }
    return { start: min, end: max };
  })();
  $: axisHeight = (axis.end - axis.start) * PX_PER_MIN;
  $: hourMarks = (() => {
    const marks: number[] = [];
    for (let m = Math.ceil(axis.start / 60) * 60; m <= axis.end; m += 60) marks.push(m);
    return marks;
  })();
  function fmtAxisTime(m: number): string {
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }

  // Current time line (only when viewing the real current week)
  let nowMinutes = 0;
  function updateNow() { nowMinutes = new Date().getHours() * 60 + new Date().getMinutes(); }
  updateNow();
  const _nowInterval = plugin.registerInterval(window.setInterval(updateNow, 60_000));
  function _onVisibilityChange() { if (document.visibilityState === "visible") updateNow(); }
  plugin.registerDomEvent(document, "visibilitychange", _onVisibilityChange);
  const _cssChangeRef = plugin.app.workspace.on("css-change", () => {
    clearThemeColourCache();
    invalidate();
  });
  onDestroy(() => {
    clearInterval(_nowInterval);
    document.removeEventListener("visibilitychange", _onVisibilityChange);
    plugin.app.workspace.offref(_cssChangeRef);
  });
  $: currentTimeStr = (() => {
    const h = Math.floor(nowMinutes / 60), m = nowMinutes % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  })();
  $: nowTop = (isCurrentWeek && nowMinutes >= axis.start && nowMinutes <= axis.end)
    ? (nowMinutes - axis.start) * PX_PER_MIN
    : null;

  // ── Day helpers ──────────────────────────────────────────────────────────
  function dayISODate(offset: number, monday: Date): string {
    return localIso(addDays(monday, offset));
  }
  function isToday(offset: number, monday: Date): boolean {
    const t = new Date();
    return isSameWeek(monday, t) && addDays(monday, offset).getDate() === t.getDate()
      && addDays(monday, offset).getMonth() === t.getMonth();
  }
  function dayHeader(offset: number, monday: Date): string {
    const d = addDays(monday, offset);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }
  function dayShortLabel(key: SchoolDay): string {
    return plugin.t("day." + key + ".short");
  }
  function dayHasSlots(dayKey: SchoolDay): boolean {
    return periods.some(p => slotsFor(dayKey, p.id).length > 0);
  }
  function dayHasAnything(dayKey: SchoolDay): boolean {
    return periods.some(p => slotsFor(dayKey, p.id).length > 0 || eventsFor(dayKey, p.id).length > 0);
  }
  /** All slots shown in a grid cell (respects 放假 / 补课 by-date). */
  function slotsFor(dayKey: SchoolDay, periodId: string): TimetableSlot[] {
    const iso = dayISODate(DAY_KEYS.indexOf(dayKey), currentMonday);
    const st = dayStatusOf(dayKey, iso);
    if (st.status === "holiday") return [];
    const list = st.status === "makeup" && st.sourceDate
      ? (slotsForDate(st.sourceDate)[periodId] ?? [])
      : (slotMap[dayKey + ":" + periodId] ?? []);
    return list.filter(s => !isExcluded(s.id, iso));
  }

  function isExcluded(slotId: string, iso: string): boolean {
    return exclusions.some(e => e.slotId === slotId && e.date === iso);
  }

  /** Recurring slots of this cell that were cancelled on this date (停课). */
  function excludedSlotsFor(dayKey: SchoolDay, periodId: string): TimetableSlot[] {
    const iso = dayISODate(DAY_KEYS.indexOf(dayKey), currentMonday);
    const st = dayStatusOf(dayKey, iso);
    if (st.status === "holiday") return [];
    const list = st.status === "makeup" && st.sourceDate
      ? (slotsForDate(st.sourceDate)[periodId] ?? [])
      : (slotMap[dayKey + ":" + periodId] ?? []);
    return list.filter(s => isExcluded(s.id, iso));
  }

  /** One-off events on a specific day+period of the viewed week. */
  function eventsFor(dayKey: SchoolDay, periodId: string): OneOffEvent[] {
    const iso = dayISODate(DAY_KEYS.indexOf(dayKey), currentMonday);
    const st = dayStatusOf(dayKey, iso);
    if (st.status === "holiday") return [];
    return events.filter(e => e.date === iso && e.periodId === periodId);
  }

  /** True when two+ courses in the cell share at least one overlapping week. */
  function cellClash(list: TimetableSlot[]): boolean {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (weekRuleOverlap(list[i].weeks, list[j].weeks, totalWeeksCount)) return true;
      }
    }
    return false;
  }

  /** Slots that actually run on a specific date, keyed by periodId → array. */
  function slotsForDate(iso: string): Record<string, TimetableSlot[]> {
    const d = new Date(iso + "T12:00:00");
    const wk = getWeekNumber(d, plugin.settings);
    const dayKey = schoolDayOf(d);
    const m: Record<string, TimetableSlot[]> = {};
    if (wk <= 0) return m;
    for (const s of slots) {
      if (s.day !== dayKey) continue;
      if (!slotInWeek(s, wk)) continue;
      (m[s.periodId] ??= []).push(s);
    }
    return m;
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  function onPrev() { if (canGoPrev) currentDate = addWeeks(currentDate, -1); }
  function onNext() { if (canGoNext) currentDate = addWeeks(currentDate, 1); }
  $: canGoPrev = _dep(_tick, weekNo > 1 || isBeforeSemester);
  $: canGoNext = _dep(_tick, weekNo < totalWeeksCount || isAfterSemester);
  $: isBeforeSemester = _dep(_tick, currentMonday.getTime() < getMondayOfWeek(new Date(plugin.settings.startDate + "T12:00:00")).getTime());
  $: isAfterSemester = _dep(_tick, currentMonday.getTime() > getMondayOfWeek(new Date(plugin.settings.endDate + "T12:00:00")).getTime());
  $: totalWeeksCount = _dep(_tick, totalWeeksOf());
  function totalWeeksOf(): number {
    const startM = getMondayOfWeek(new Date(plugin.settings.startDate + "T12:00:00"));
    const endM = getMondayOfWeek(new Date(plugin.settings.endDate + "T12:00:00"));
    return Math.max(1, Math.round((endM.getTime() - startM.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1);
  }
  function onToday() {
    // Jump to the real current day — even before/after the semester, so the
    // view honestly shows 未开学 / 已结束 instead of clamping away.
    currentDate = new Date();
  }
  function jumpToDate(iso: string) {
    if (!iso) return;
    const d = new Date(iso + "T12:00:00");
    const s = new Date(plugin.settings.startDate + "T00:00:00");
    const e = new Date(plugin.settings.endDate + "T23:59:59");
    currentDate = d < s ? s : d > e ? e : d;
  }
  function openDatePicker() {
    new DatePickerModal(plugin.app, {
      value: localIso(currentMonday),
      min: plugin.settings.startDate,
      max: plugin.settings.endDate,
      t: (k, v) => plugin.t(k, v),
      onPick: (iso) => jumpToDate(iso),
    }).open();
  }
  $: navCentreLabel = currentMonday.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  function onOpenSettings() {
    const s = (plugin.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    s.open();
    s.openTabById("class-schedule");
  }

  // ── Semester switching ───────────────────────────────────────────────────
  function onSemesterChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (id && id !== plugin.data.activeSemesterId) {
      void plugin.switchSemester(id);
    }
  }

  // ── Course editing ───────────────────────────────────────────────────────
  function editSlot(slot: TimetableSlot, contextDate?: string) {
    new CourseModal(plugin.app, plugin, { slot, contextDate, onSaved: () => invalidate() }).open();
  }
  function editEvent(ev: OneOffEvent) {
    new EventModal(plugin.app, plugin, { event: ev, onSaved: () => invalidate() }).open();
  }
  function addSlot(day: SchoolDay, periodId: string) {
    new CourseModal(plugin.app, plugin, { day, periodId, onSaved: () => invalidate() }).open();
  }
  function addEvent(day: SchoolDay, periodId: string) {
    new EventModal(plugin.app, plugin, {
      date: dayISODate(DAY_KEYS.indexOf(day), currentMonday),
      periodId,
      onSaved: () => invalidate(),
    }).open();
  }
  function addAnySlot() {
    const today = new Date();
    const todayKey = DAY_KEYS[today.getDay() === 0 ? 6 : today.getDay() - 1];
    const day = plugin.settings.schoolDays.includes(todayKey) ? todayKey : (plugin.settings.schoolDays[0] ?? "monday");
    addSlot(day, periods[0]?.id ?? "");
  }

  /** Menu on an empty / cancelled cell: restore, add course, add event. */
  function openCellMenu(e: MouseEvent, day: SchoolDay, periodId: string) {
    e.stopPropagation();
    const menu = new Menu();
    const ex = excludedSlotsFor(day, periodId);
    for (const s of ex) {
      const c = courseOf(s);
      menu.addItem(i => i.setTitle(plugin.t("course.restoreDay") + " · " + (c?.name ?? "?"))
        .setIcon("undo-2")
        .onClick(() => {
          const iso = dayISODate(DAY_KEYS.indexOf(day), currentMonday);
          plugin.settings.slotExclusions = (plugin.settings.slotExclusions ?? [])
            .filter(x => !(x.slotId === s.id && x.date === iso));
          void plugin.saveSettings().then(() => invalidate());
        }));
    }
    if (ex.length > 0) menu.addSeparator();
    menu.addItem(i => i.setTitle(plugin.t("course.add")).setIcon("plus").onClick(() => addSlot(day, periodId)));
    menu.addItem(i => i.setTitle(plugin.t("event.add")).setIcon("calendar-plus").onClick(() => addEvent(day, periodId)));
    menu.showAtMouseEvent(e);
  }

  // ── Drag to move / copy a course (desktop only) ─────────────────────────
  let dragSlotId: string | null = null;
  let dragOverKey: string | null = null;
  function onChipDragStart(e: DragEvent, slot: TimetableSlot) {
    dragSlotId = slot.id;
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", slot.id);
      e.dataTransfer.effectAllowed = "copyMove";
    }
  }
  function onBlockDragOver(e: DragEvent, day: SchoolDay, periodId: string) {
    if (!dragSlotId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = (e.ctrlKey || e.metaKey) ? "copy" : "move";
    dragOverKey = day + ":" + periodId;
  }
  function onBlockDragLeave(e: DragEvent) {
    const rel = e.relatedTarget as HTMLElement | null;
    if (!rel?.closest(".cs-block")) dragOverKey = null;
  }
  async function onBlockDrop(e: DragEvent, day: SchoolDay, periodId: string) {
    e.preventDefault();
    dragOverKey = null;
    const id = dragSlotId;
    dragSlotId = null;
    if (!id) return;
    const slot = slots.find(s => s.id === id);
    if (!slot || (slot.day === day && slot.periodId === periodId)) return;
    const copy = e.ctrlKey || e.metaKey;
    if (copy) {
      plugin.settings.timetable.push({ ...slot, id: "slot-" + Date.now(), day, periodId });
    } else {
      slot.day = day;
      slot.periodId = periodId;
    }
    await plugin.saveSettings();
    invalidate();
  }
  function onDragEnd() { dragSlotId = null; dragOverKey = null; }

  // ── Grid zoom (Ctrl/Cmd + wheel, per-device) ─────────────────────────────
  let scrollEl: HTMLElement;
  function onZoomWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 10 : -10;
    plugin.setGridScale(plugin.getGridScale() + delta);
    invalidate();
  }
  onMount(() => {
    if (scrollEl) plugin.registerDomEvent(scrollEl, "wheel", onZoomWheel, { passive: false });
  });

  // ── Next-class bar (real time, regardless of the viewed week) ────────────
  $: nextClass = (() => {
    const now = new Date();
    const todayKey = DAY_KEYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
    const todayIso = localIso(now);
    const st = dayStatusOf(todayKey, todayIso);
    if (st.status === "holiday") return { has: false, key: "holiday" as const, minutes: 0 };
    const weekNoNow = getWeekNumber(now, plugin.settings);
    if (weekNoNow <= 0) return { has: false, key: "beforeStart" as const, minutes: 0 };
    const todaySlots = st.status === "makeup" && st.sourceDate
      ? Object.values(slotsForDate(st.sourceDate)).flat()
      : slots.filter(s => s.day === todayKey && slotInWeek(s, weekNoNow));
    let best: { slot: TimetableSlot; start: number; end: number; ongoing: boolean } | null = null;
    for (const s of todaySlots) {
      const p = periods.find(x => x.id === s.periodId);
      if (!p) continue;
      const start = timeToMinutes(p.start);
      const end = timeToMinutes(p.end);
      if (end > nowMinutes) {
        if (!best || start < best.start) best = { slot: s, start, end, ongoing: start <= nowMinutes };
      }
    }
    if (best) {
      const c = courseOf(best.slot);
      const room = best.slot.classroom ?? c?.classroom ?? "";
      const mins = best.ongoing ? best.end - nowMinutes : best.start - nowMinutes;
      return {
        has: true,
        ongoing: best.ongoing,
        name: c?.name ?? "?",
        emoji: c?.emoji ?? "",
        colour: c?.colour ?? "",
        room,
        startLabel: fmtAxisTime(best.start),
        minutes: Math.max(1, mins),
      };
    }
    return { has: false, key: "noneToday" as const, minutes: 0 };
  })();
  $: nextClassInfo = nextClass.has
    ? plugin.t("week.nextClassIn", { minutes: nextClass.minutes })
    : "";

  // Unscheduled courses (无固定时间, e.g. 课程设计 18-19周) active this week.
  $: unscheduledInWeek = weekNo > 0
    ? courses.filter(c => c.unscheduled && c.weeks && weekRuleMatches(c.weeks, weekNo))
    : [];

  // ── Weekly stats (viewed week) ───────────────────────────────────────────
  $: weekStats = (() => {
    const weekSlots = weekNo > 0 ? slots.filter(s => slotInWeek(s, weekNo)) : [];
    const unique = new Set(weekSlots.map(s => s.courseId));
    for (const c of unscheduledInWeek) unique.add(c.id);
    let credits = 0;
    for (const id of unique) {
      const c = courses.find(x => x.id === id);
      credits += c?.credits ?? 0;
    }
    let done = 0;
    let left = 0;
    if (isCurrentWeek) {
      for (const s of weekSlots) {
        const p = periods.find(x => x.id === s.periodId);
        if (!p) continue;
        if (timeToMinutes(p.end) <= nowMinutes) done++;
        else left++;
      }
    } else {
      left = weekSlots.length;
    }
    return { total: weekSlots.length, done, left, credits };
  })();

  // ── Chip foreground contrast ─────────────────────────────────────────────
  let _rootEl: HTMLElement;
  $: _themeBg = _dep(_tick, _rootEl ? getComputedStyle(_rootEl).getPropertyValue("--background-primary").trim() : "");
  function _parseColour(c: string): [number, number, number] | null {
    const t = c.trim();
    if (t.startsWith("#")) {
      let h = t.slice(1);
      if (h.length === 3) h = h.split("").map(x => x + x).join("");
      if (h.length >= 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      return null;
    }
    const m = t.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const ps = m[1].split(",").map(n => parseFloat(n));
      if (ps.length >= 3 && ps.slice(0, 3).every(n => !isNaN(n))) return [ps[0], ps[1], ps[2]];
    }
    return null;
  }
  function chipFg(colour: string, bg: string, alpha = 0.22): string {
    const fg = _parseColour(colour), b = _parseColour(bg);
    if (!fg || !b) return "";
    const r = fg[0] * alpha + b[0] * (1 - alpha);
    const g = fg[1] * alpha + b[1] * (1 - alpha);
    const bl = fg[2] * alpha + b[2] * (1 - alpha);
    const lum = (0.299 * r + 0.587 * g + 0.114 * bl) / 255;
    return lum > 0.58 ? "#1c1c1e" : "#f2f2f3";
  }

  // ── Mobile modes ─────────────────────────────────────────────────────────
  const _isMobileApp = Platform.isMobile;
  type MobileMode = "day" | "agenda" | "grid";
  $: viewMode = _dep(_tick, (_isMobileApp ? (plugin.settingsMobileMode as MobileMode) : "grid"));
  $: isDayMode = _isMobileApp && viewMode === "day";
  $: isAgendaMode = _isMobileApp && viewMode === "agenda";
  $: selectedOffset = (() => {
    // Follow the currently viewed date within its week, so tapping a day
    // pill (or navigating) actually moves the day list.
    const a = new Date(currentMonday); a.setHours(0, 0, 0, 0);
    const b = new Date(currentDate);   b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  })();
  $: selectedDay = _dep(_tick, days.find(d => d.offset === selectedOffset) ?? days[0]);
  $: renderDays = isDayMode && selectedDay ? [selectedDay] : days;
  $: selStatus = (() => {
    const day = selectedDay;
    if (!day) return { status: "normal" as const };
    return dayStatusOf(day.key, dayISODate(day.offset, currentMonday));
  })();
  function setMobileMode(m: MobileMode) {
    plugin.settingsMobileMode = m;
    void plugin.saveSettings();
    invalidate();
  }
</script>


<div class="cs-week-view" class:cs-week-view--compact={compact} class:cs-week-view--mobile={_isMobileApp} bind:this={_rootEl}>
  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <header class="cs-header" class:cs-header--mobile={_isMobileApp}>
    <div class="cs-header-identity">
      <span class="cs-week-label">
        {weekLabel}
        {#if isCurrentWeek}<span class="cs-week-now">{plugin.t("week.today")}</span>{/if}
      </span>
      <span class="cs-date-range">{dateRange}</span>
    </div>

    <nav class="cs-nav" aria-label="Week navigation">
      <button class="cs-btn cs-nav-arrow" on:click={onPrev} aria-label={plugin.t("common.prev")} title={plugin.t("common.prev")} disabled={!canGoPrev} use:obsIcon={"arrow-left"}></button>
      <button class="cs-btn cs-nav-centre" on:click={openDatePicker} aria-haspopup="dialog" title={plugin.t("week.jumpToDate")}>
        <span use:obsIcon={"calendar"}></span>
        <span>{navCentreLabel}</span>
        <span class="cs-nav-caret">▾</span>
      </button>
      <button class="cs-btn cs-nav-arrow" on:click={onNext} aria-label={plugin.t("common.next")} title={plugin.t("common.next")} disabled={!canGoNext} use:obsIcon={"arrow-right"}></button>
    </nav>

    <div class="cs-header-actions">
      <select class="cs-semester-select" value={activeSemesterId} on:change={onSemesterChange} aria-label={plugin.t("week.semester")}>
        {#each semesters as sem (sem.id)}
          <option value={sem.id}>{sem.name}</option>
        {/each}
      </select>
      {#if !_isMobileApp}
        <button class="cs-btn cs-action-btn" on:click={onToday} aria-label={plugin.t("common.today")}>
          <span use:obsIcon={"calendar"} class="cs-btn-icon"></span>{plugin.t("common.today")}
        </button>
        <button class="cs-btn cs-action-btn" on:click={addAnySlot} aria-label={plugin.t("week.addCourse")}>
          <span use:obsIcon={"plus"} class="cs-btn-icon"></span>{plugin.t("week.addCourse")}
        </button>
        <button class="cs-btn cs-action-btn cs-action-btn--icon" on:click={onOpenSettings} aria-label={plugin.t("common.settings")} use:obsIcon={"settings"}></button>
      {/if}
    </div>
  </header>

  {#if _isMobileApp}
    <div class="cs-mobile-bar">
      <div class="cs-mobile-modes" role="tablist">
        <button class="cs-mode-btn" class:cs-mode-btn--on={isDayMode} role="tab" aria-selected={isDayMode} on:click={() => setMobileMode("day")}>{plugin.t("mode.day")}</button>
        <button class="cs-mode-btn" class:cs-mode-btn--on={isAgendaMode} role="tab" aria-selected={isAgendaMode} on:click={() => setMobileMode("agenda")}>{plugin.t("mode.agenda")}</button>
        <button class="cs-mode-btn" class:cs-mode-btn--on={!isDayMode && !isAgendaMode} role="tab" aria-selected={!isDayMode && !isAgendaMode} on:click={() => setMobileMode("grid")}>{plugin.t("mode.week")}</button>
      </div>
      <div class="cs-mobile-acts">
        <select class="cs-semester-select cs-semester-select--mobile" value={activeSemesterId} on:change={onSemesterChange} aria-label={plugin.t("week.semester")}>
          {#each semesters as sem (sem.id)}
            <option value={sem.id}>{sem.name}</option>
          {/each}
        </select>
        <button class="cs-btn cs-mobile-act" on:click={onToday} aria-label={plugin.t("common.today")} use:obsIcon={"calendar"}></button>
        <button class="cs-btn cs-mobile-act" on:click={addAnySlot} aria-label={plugin.t("week.addCourse")} use:obsIcon={"plus"}></button>
        <button class="cs-btn cs-mobile-act" on:click={onOpenSettings} aria-label={plugin.t("common.settings")} use:obsIcon={"settings"}></button>
      </div>
    </div>
  {/if}

  <!-- ── Info strip: next class + weekly stats ───────────────────────────── -->
  <div class="cs-info-strip">
    <div class="cs-next-bar" class:cs-next-bar--live={nextClass.has} style={nextClass.has ? ("--nc:" + (nextClass.colour || "#888")) : ""}>
      {#if !isCurrentWeek}
        <span class="cs-next-dot"></span>
        <span class="cs-next-text cs-next-text--muted">{plugin.t("week.viewingWeek", { n: weekNo })}</span>
      {:else if nextClass.has}
        <span class="cs-next-dot" class:cs-next-dot--live={nextClass.ongoing}></span>
        <span class="cs-next-text">
          {nextClass.ongoing
            ? plugin.t("week.classOngoing") + " · "
            : plugin.t("week.nextClass", { name: (nextClass.emoji ? nextClass.emoji + " " : "") + nextClass.name }) + " · "}
          {nextClass.startLabel}{#if nextClass.room} · {nextClass.room}{/if}
        </span>
        <span class="cs-next-mins">
          {nextClassInfo}
        </span>
      {:else}
        <span class="cs-next-text cs-next-text--muted">
          {nextClass.key === "holiday"
            ? plugin.t("week.todayHoliday")
            : nextClass.key === "beforeStart"
              ? plugin.t("week.beforeStart")
              : plugin.t("week.noClassToday")}
        </span>
      {/if}
    </div>

    <div class="cs-stats-bar">
      <span class="cs-stat"><b>{weekStats.total}</b>{plugin.t("stats.classes")}</span>
      <span class="cs-stat"><b>{weekStats.done}</b>{plugin.t("stats.done")}</span>
      <span class="cs-stat"><b>{weekStats.left}</b>{plugin.t("stats.left")}</span>
      {#if weekStats.credits > 0}<span class="cs-stat"><b>{weekStats.credits}</b>{plugin.t("stats.credits")}</span>{/if}
    </div>
  </div>

  <!-- ── Unscheduled courses strip (无固定时间) ──────────────────────────── -->
  {#if unscheduledInWeek.length > 0}
    <div class="cs-unscheduled-bar">
      <span class="cs-unscheduled-label">{plugin.t("week.unscheduled")}</span>
      {#each unscheduledInWeek as c (c.id)}
        <button class="cs-unscheduled-chip" style="--uc:{c.colour};"
          title={plugin.t("settings.course.edit")}
          on:click={() => new CourseFormModal(plugin.app, plugin, c, () => invalidate()).open()}>
          {c.emoji ?? ""} {c.name} · {plugin.t("week.unscheduledRange", { start: c.weeks?.start ?? 1, end: c.weeks?.end ?? 1 })}
        </button>
      {/each}
    </div>
  {/if}

  {#if isDayMode}
    <!-- ── Mobile day list ─────────────────────────────────────────────── -->
    <div class="cs-day-strip">
      {#each days as day}
        <button class="cs-day-pill"
          class:cs-day-pill--sel={day.offset === selectedOffset}
          class:cs-day-pill--today={isToday(day.offset, currentMonday)}
          on:click={() => { currentDate = addDays(currentMonday, day.offset); invalidate(); }}>
          <span class="cs-day-pill-dow">{dayShortLabel(day.key)}</span>
          <span class="cs-day-pill-num">{addDays(currentMonday, day.offset).getDate()}</span>
          {#if dayHasSlots(day.key)}<span class="cs-day-pill-dot"></span>{/if}
        </button>
      {/each}
    </div>
    <div class="cs-daylist">
      {#if selStatus.status === "holiday"}
        <div class="cs-daylist-empty">{plugin.t("week.holiday")}</div>
      {:else}
        {#each periods as period (period.id)}
          {@const dSlots = slotsFor(selectedDay.key, period.id)}
          {@const dEvents = eventsFor(selectedDay.key, period.id)}
          {#if dSlots.length > 0 || dEvents.length > 0}
            {#each dSlots as dSlot (dSlot.id)}
              {@const c = courseOf(dSlot)}
              {@const room = dSlot.classroom ?? c?.classroom ?? ""}
              {@const dCustom = useCustomTime && !!dSlot.durationMinutes}
              {@const dTime = dCustom
                ? (dSlot.durationMinutes ?? 0) + plugin.t("course.min") + ((dSlot.breakMinutes ?? 0) > 0 ? " · " + plugin.t("course.brk") + (dSlot.breakMinutes ?? 0) + plugin.t("course.min") : "")
                : period.start + "–" + period.end}
              <div class="cs-dcard" role="button" tabindex="0" style="--chip-fg:{chipFg(c?.colour ?? "#888", _themeBg)}; border-left:3px solid {c?.colour ?? '#888'}; background:{hexToRgba(c?.colour ?? '#888', 0.16)};"
                on:click={() => editSlot(dSlot, dayISODate(selectedDay.offset, currentMonday))}
                on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editSlot(dSlot, dayISODate(selectedDay.offset, currentMonday)); } }}>
                <div class="cs-dcard-time">{period.name}<br><span>{dTime}</span></div>
                <div class="cs-dcard-body">
                  <div class="cs-dcard-code">{c?.emoji ?? ""} {c?.name ?? "?"}{#if c?.credits}<span class="cs-dcard-credits">{c?.credits}{plugin.t("course.creditsShort")}</span>{/if}</div>
                  <div class="cs-dcard-sub">{([c?.teacher, room].filter(Boolean)).join(" · ")}</div>
                  {#if dSlot.notes}<div class="cs-dcard-note">{dSlot.notes}</div>{/if}
                </div>
              </div>
            {/each}
            {#each dEvents as ev (ev.id)}
              <div class="cs-dcard cs-dcard--event" role="button" tabindex="0" style="--chip-fg:{chipFg(ev.colour ?? '#888', _themeBg)}; border-left:3px solid {ev.colour ?? '#888'}; background:{hexToRgba(ev.colour ?? '#888', 0.16)};"
                on:click={() => editEvent(ev)} on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editEvent(ev); } }}>
                <div class="cs-dcard-time">{period.name}<br><span>{period.start}–{period.end}</span></div>
                <div class="cs-dcard-body">
                  <div class="cs-dcard-code">📌 {ev.title}</div>
                  {#if ev.classroom}<div class="cs-dcard-sub">{ev.classroom}</div>{/if}
                  {#if ev.notes}<div class="cs-dcard-note">{ev.notes}</div>{/if}
                </div>
              </div>
            {/each}
          {:else if selStatus.status !== "makeup"}
            <button class="cs-dslim" on:click={(e) => openCellMenu(e, selectedDay.key, period.id)} aria-label={plugin.t("week.emptySlot")}>
              <span class="cs-dslim-time">{period.start}</span>
              <span class="cs-dslim-name">{period.name}</span>
              <span class="cs-dslim-add">＋</span>
            </button>
          {/if}
        {/each}
      {/if}
    </div>
  {:else if isAgendaMode}
    <!-- ── Mobile agenda (整周列表) ───────────────────────────────────── -->
    <div class="cs-agenda">
      {#each days as day}
        {@const aIso = dayISODate(day.offset, currentMonday)}
        {@const aStatus = dayStatusOf(day.key, aIso)}
        <div class="cs-agenda-day">
          <div class="cs-agenda-head" class:cs-agenda-head--today={isToday(day.offset, currentMonday)}>
            <span class="cs-agenda-dayname">{dayShortLabel(day.key)} · {dayHeader(day.offset, currentMonday)}</span>
            {#if aStatus.status === "holiday"}<span class="cs-day-badge cs-day-badge--holiday">{plugin.t("week.holiday")}</span>
            {:else if aStatus.status === "makeup"}<span class="cs-day-badge cs-day-badge--makeup">{plugin.t("week.makeup")}</span>{/if}
          </div>
          {#if aStatus.status === "holiday"}
            <div class="cs-agenda-empty">{plugin.t("week.holiday")}</div>
          {:else}
            {#each periods as period (period.id)}
              {@const aSlots = slotsFor(day.key, period.id)}
              {@const aEvents = eventsFor(day.key, period.id)}
              {#if aSlots.length > 0 || aEvents.length > 0}
                <div class="cs-agenda-row">
                  <span class="cs-agenda-time">{period.name}<br><span>{period.start}</span></span>
                  <div class="cs-agenda-body">
                    {#each aSlots as s (s.id)}
                      {@const c = courseOf(s)}
                      <div class="cs-agenda-item" role="button" tabindex="0"
                        style="--chip-fg:{chipFg(c?.colour ?? '#888', _themeBg)}; border-left:3px solid {c?.colour ?? '#888'}; background:{hexToRgba(c?.colour ?? '#888', 0.16)};"
                        on:click={() => editSlot(s, aIso)} on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editSlot(s, aIso); } }}>
                        <span class="cs-agenda-name">{c?.emoji ?? ""} {c?.name ?? "?"}{#if c?.credits}<span class="cs-chip-credits">{c?.credits}{plugin.t("course.creditsShort")}</span>{/if}</span>
                        <span class="cs-agenda-meta">{[s.classroom ?? c?.classroom ?? "", c?.teacher].filter(Boolean).join(" · ")}</span>
                      </div>
                    {/each}
                    {#each aEvents as ev (ev.id)}
                      <div class="cs-agenda-item cs-agenda-item--event" role="button" tabindex="0"
                        style="--chip-fg:{chipFg(ev.colour ?? '#888', _themeBg)}; border-left:3px solid {ev.colour ?? '#888'}; background:{hexToRgba(ev.colour ?? '#888', 0.16)};"
                        on:click={() => editEvent(ev)} on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editEvent(ev); } }}>
                        <span class="cs-agenda-name">📌 {ev.title}</span>
                        <span class="cs-agenda-meta">{ev.classroom ?? ""}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}
            {#if !dayHasAnything(day.key)}
              <div class="cs-agenda-empty">{plugin.t("week.noClasses")}</div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <!-- ── Week grid ───────────────────────────────────────────────────── -->
    <div class="cs-table-scroll" bind:this={scrollEl}>
      <div class="cs-axis"
        style="--grid-colour:{colourToCss('theme:border', '#555')}; --today-colour:{colourToCss(plugin.todayHighlightColour ?? 'theme:accent', 'var(--interactive-accent)')};">

        <div class="cs-axis-head">
          <div class="cs-axis-head-gutter"></div>
          {#each renderDays as day}
            {@const hIso = dayISODate(day.offset, currentMonday)}
            {@const hStatus = dayStatusOf(day.key, hIso)}
            <div class="cs-axis-head-day"
              class:cs-th-day--today={isToday(day.offset, currentMonday)}
              class:cs-th-day--holiday={hStatus.status === "holiday"}
              class:cs-th-day--makeup={hStatus.status === "makeup"}>
              <div class="cs-th-day-inner">
                <span class="cs-day-name">
                  {dayShortLabel(day.key)}
                  {#if hStatus.status !== "normal"}
                    <span class="cs-day-badge" class:cs-day-badge--holiday={hStatus.status === "holiday"} class:cs-day-badge--makeup={hStatus.status === "makeup"}>
                      {hStatus.status === "holiday" ? plugin.t("week.holiday") : plugin.t("week.makeup")}
                    </span>
                  {/if}
                </span>
                <span class="cs-day-date">{dayHeader(day.offset, currentMonday)}</span>
              </div>
              <button class="cs-day-head-menu" aria-label={plugin.t("settings.dayOverrides")} title={plugin.t("settings.dayOverrides")}
                on:click={(e) => openDayMenu(e, day)} use:obsIcon={"calendar-off"}></button>
            </div>
          {/each}
        </div>

        <div class="cs-axis-body">
          <div class="cs-axis-gutter" style="height:{axisHeight}px;">
            {#each hourMarks as hm}
              <div class="cs-axis-hour" style="top:{(hm - axis.start) * PX_PER_MIN}px;">{fmtAxisTime(hm)}</div>
            {/each}
            {#if nowTop !== null}
              <div class="cs-now-badge" style="top:{nowTop}px;">{currentTimeStr}</div>
            {/if}
          </div>

          {#if nowTop !== null}
            <div class="cs-now-line" style="top:{nowTop + 6}px;"></div>
          {/if}

          {#each renderDays as day}
            {@const colIso = dayISODate(day.offset, currentMonday)}
            {@const colStatus = dayStatusOf(day.key, colIso)}
            <div class="cs-axis-col"
              class:cs-axis-col--today={isToday(day.offset, currentMonday)}
              class:cs-axis-col--holiday={colStatus.status === "holiday"}
              class:cs-axis-col--makeup={colStatus.status === "makeup"}
              style="height:{axisHeight}px;">
              {#each hourMarks as hm}
                <div class="cs-axis-line" style="top:{(hm - axis.start) * PX_PER_MIN}px;"></div>
              {/each}
              {#if colStatus.status === "holiday"}
                <div class="cs-day-overlay">{plugin.t("week.holiday")}</div>
              {:else}
                {#each periods as period (period.id)}
                  {@const pStartMin = timeToMinutes(period.start)}
                  {@const pEndMin = timeToMinutes(period.end)}
                  {@const cellSlots = slotsFor(day.key, period.id)}
                  {@const cellEvents = eventsFor(day.key, period.id)}
                  {@const first = cellSlots[0]}
                  {@const _clash = cellClash(cellSlots)}
                  {@const _customDur = useCustomTime ? (first?.durationMinutes ?? null) : null}
                  {@const _laterStarts = periods.filter(p => timeToMinutes(p.start) > pStartMin).map(p => timeToMinutes(p.start))}
                  {@const _nextStart = _laterStarts.length ? Math.min(..._laterStarts) : axis.end}
                  {@const _avail = Math.max(1, _nextStart - pStartMin)}
                  {@const _durMin = _customDur != null ? Math.min(_customDur, _avail) : (pEndMin - pStartMin)}
                  {@const bTop = (pStartMin - axis.start) * PX_PER_MIN}
                  {@const bHeight = Math.max(20, _durMin * PX_PER_MIN)}
                  {@const _truncated = _customDur != null && _customDur > _avail}
                  {@const _breakTop = cellSlots.length === 1 && _customDur != null && (first?.breakMinutes ?? 0) > 0 && (_customDur / 2) * PX_PER_MIN < bHeight - 8 ? (_customDur / 2) * PX_PER_MIN : null}
                  <div class="cs-block" role="presentation"
                    class:cs-block--empty={cellSlots.length === 0 && cellEvents.length === 0}
                    class:cs-block--multi={cellSlots.length > 1}
                    class:cs-block--readonly={colStatus.status === "makeup"}
                    class:cs-block--dragover={dragOverKey === day.key + ":" + period.id}
                    on:dragover={(e) => onBlockDragOver(e, day.key, period.id)}
                    on:dragleave={onBlockDragLeave}
                    on:drop={(e) => onBlockDrop(e, day.key, period.id)}
                    style="top:{bTop}px; height:{bHeight}px; --bh:{bHeight}px; --tint:{hexToRgba('#7a7a7a', 0.08)}; background:{hexToRgba('#7a7a7a', 0.06)}; border-left:3px solid {hexToRgba('#7a7a7a', 0.5)};">
                    {#if _breakTop !== null}
                      <div class="cs-block-break" style="top:{_breakTop}px;"></div>
                    {/if}
                    {#if _clash}
                      <span class="cs-block-clash" title={plugin.t("week.clash")}>⚠</span>
                    {/if}
                    {#if cellSlots.length > 0 || cellEvents.length > 0}
                      <div class="cs-chip-stack">
                        {#each cellSlots as slot (slot.id)}
                          {@const c = courseOf(slot)}
                          {@const room = slot.classroom ?? c?.classroom ?? ""}
                          {@const sCustom = useCustomTime && !!slot.durationMinutes}
                          {@const sTime = sCustom
                            ? period.name + " · " + (slot.durationMinutes ?? 0) + plugin.t("course.min") + ((slot.breakMinutes ?? 0) > 0 ? " · " + plugin.t("course.brk") + (slot.breakMinutes ?? 0) + plugin.t("course.min") : "")
                            : period.name + " · " + period.start + "–" + period.end}
                          <button
                            class="cs-chip"
                            draggable={!_isMobileApp}
                            title={_truncated && cellSlots.length === 1 ? plugin.t("course.truncated") : undefined}
                            style="--chip-fg:{chipFg(c?.colour ?? '#888', _themeBg, 0.30)}; --ctint:{hexToRgba(c?.colour ?? '#888', 0.30)}; background:{hexToRgba(c?.colour ?? '#888', 0.30)}; border-left:4px solid {c?.colour ?? '#888'};"
                            on:dragstart={(e) => onChipDragStart(e, slot)}
                            on:dragend={onDragEnd}
                            on:click={() => editSlot(slot, colIso)}
                            on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editSlot(slot, colIso); } }}>
                            <span class="cs-chip-period">{sTime}</span>
                            <span class="cs-chip-code">{c?.emoji ?? ""} {c?.name ?? "?"}{#if c?.credits}<span class="cs-chip-credits">{c?.credits}{plugin.t("course.creditsShort")}</span>{/if}</span>
                            {#if room || c?.teacher}
                              <span class="cs-chip-meta">{[room, c?.teacher].filter(Boolean).join(" · ")}</span>
                            {/if}
                            {#if slot.notes}<span class="cs-chip-notes">{slot.notes}</span>{/if}
                          </button>
                        {/each}
                        {#each cellEvents as ev (ev.id)}
                          <button
                            class="cs-chip cs-chip--event"
                            title={plugin.t("event.edit")}
                            style="--chip-fg:{chipFg(ev.colour ?? '#888', _themeBg, 0.30)}; --ctint:{hexToRgba(ev.colour ?? '#888', 0.30)}; background:{hexToRgba(ev.colour ?? '#888', 0.30)}; border-left:4px dashed {ev.colour ?? '#888'};"
                            on:click={() => editEvent(ev)}
                            on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editEvent(ev); } }}>
                            <span class="cs-chip-period">{period.name} · {period.start}–{period.end}</span>
                            <span class="cs-chip-code">📌 {ev.title}</span>
                            {#if ev.classroom}<span class="cs-chip-meta">{ev.classroom}</span>{/if}
                            {#if ev.notes}<span class="cs-chip-notes">{ev.notes}</span>{/if}
                          </button>
                        {/each}
                      </div>
                    {:else if colStatus.status !== "makeup"}
                      <button class="cs-cell-add" title={plugin.t("week.emptySlot")} on:click={(e) => openCellMenu(e, day.key, period.id)}>
                        <span class="cs-cell-plus">＋</span>
                      </button>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>


<style>
  .cs-week-view {
    --cs-radius: 10px;
    --cs-soft: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
    display:flex; flex-direction:column; flex:1; min-height:0; height:100%; overflow:hidden;
    background:var(--background-primary); font-family:var(--font-interface);
  }

  /* Header */
  .cs-header {
    display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px;
    padding:10px 16px; border-bottom:1px solid var(--background-modifier-border);
    flex-shrink:0; background:linear-gradient(180deg, var(--background-secondary), var(--background-primary));
  }
  .cs-header--mobile { grid-template-columns:1fr auto; }
  .cs-header-identity { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .cs-week-label { font-size:18px; font-weight:800; color:var(--text-normal); line-height:1.2; display:flex; align-items:center; gap:8px; }
  .cs-week-now {
    font-size:10px; font-weight:800; padding:2px 9px; border-radius:12px;
    background:var(--interactive-accent); color:var(--text-on-accent);
    box-shadow:0 1px 4px color-mix(in srgb, var(--interactive-accent) 45%, transparent);
  }
  .cs-date-range { font-size:12px; color:var(--text-muted); }
  .cs-nav { display:flex; align-items:center; gap:6px; }
  .cs-nav-arrow {
    width:30px; height:30px; padding:0; display:inline-flex; align-items:center; justify-content:center;
    border-radius:50%; font-size:16px; line-height:1;
  }
  .cs-nav-centre {
    display:inline-flex; align-items:center; gap:7px; padding:6px 14px; font-size:13px; font-weight:700;
    border-radius:999px;
  }
  .cs-nav-centre :global(svg) { width:14px; height:14px; }
  .cs-nav-caret { font-size:10px; color:var(--text-muted); }
  .cs-header-actions { display:flex; gap:8px; justify-content:flex-end; align-items:center; }
  .cs-btn-icon :global(svg), .cs-action-btn :global(svg) { width:14px; height:14px; }
  .cs-action-btn { border-radius:999px; }
  .cs-action-btn--icon { width:30px; height:30px; padding:0; justify-content:center; border-radius:50%; }

  .cs-semester-select {
    max-width:180px; font-size:12px; font-weight:600; padding:5px 10px;
    border-radius:999px; border:1px solid var(--background-modifier-border);
    background:var(--background-primary); color:var(--text-normal); cursor:pointer;
  }

  .cs-btn {
    display:inline-flex; align-items:center; gap:5px; padding:5px 12px;
    border-radius:8px; border:1px solid var(--background-modifier-border);
    background:var(--background-primary); color:var(--text-normal);
    font-size:13px; font-family:var(--font-interface); cursor:pointer; white-space:nowrap;
    transition:background 0.12s, transform 0.08s;
  }
  .cs-btn:hover { background:var(--background-modifier-hover); }
  .cs-btn:active { transform:scale(0.97); }
  .cs-btn:disabled { opacity:0.38; cursor:default; pointer-events:none; }

  /* Mobile bar */
  .cs-mobile-bar {
    display:flex; align-items:center; justify-content:space-between;
    padding:8px 12px; border-bottom:1px solid var(--background-modifier-border);
    background:var(--background-secondary); flex-shrink:0;
  }
  .cs-mobile-modes { display:flex; gap:6px; background:var(--background-primary); padding:3px; border-radius:999px; border:1px solid var(--background-modifier-border); }
  .cs-mode-btn {
    padding:5px 16px; border-radius:999px; border:none; background:transparent;
    color:var(--text-muted); font-size:12px; font-weight:700; cursor:pointer; transition:all 0.12s;
  }
  .cs-mode-btn--on {
    background:var(--interactive-accent); color:var(--text-on-accent);
    box-shadow:0 1px 4px color-mix(in srgb, var(--interactive-accent) 40%, transparent);
  }
  .cs-mobile-acts { display:flex; gap:6px; }
  .cs-mobile-act { width:30px; height:30px; padding:0; justify-content:center; border-radius:50%; }
  .cs-mobile-act :global(svg) { width:14px; height:14px; }

  /* Next-class bar */
  .cs-next-bar {
    display:flex; align-items:center; gap:8px; padding:7px 16px; flex-shrink:0; font-size:13px;
    border-bottom:1px solid var(--background-modifier-border);
    background:var(--background-primary); transition:background 0.15s;
  }
  .cs-next-bar--live {
    background:color-mix(in srgb, var(--nc, var(--interactive-accent)) 8%, var(--background-primary));
  }
  .cs-next-dot {
    width:9px; height:9px; border-radius:50%; background:var(--text-muted); flex-shrink:0;
    box-shadow:0 0 0 3px color-mix(in srgb, var(--text-muted) 18%, transparent);
  }
  .cs-next-dot--live { background:var(--nc, var(--color-green, #80c787)); animation:cs-pulse 2s infinite; }
  @keyframes cs-pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
  .cs-next-text { color:var(--text-normal); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cs-next-text--muted { color:var(--text-muted); font-weight:400; }
  .cs-next-mins {
    margin-left:auto; color:var(--nc, var(--text-accent)); font-weight:800; white-space:nowrap;
    padding:2px 10px; border-radius:999px;
    background:color-mix(in srgb, var(--nc, var(--interactive-accent)) 14%, transparent);
  }

  /* Weekly stats */
  .cs-stats-bar {
    display:flex; align-items:center; gap:14px; flex-wrap:wrap;
    padding:6px 16px; border-bottom:1px solid var(--background-modifier-border);
    background:var(--background-primary); flex-shrink:0;
  }
  .cs-stat { font-size:12px; color:var(--text-muted); white-space:nowrap; }
  .cs-stat b {
    font-weight:800; color:var(--text-accent); margin-right:3px;
    font-variant-numeric:tabular-nums;
  }

  /* Scroll container */
  .cs-table-scroll { flex:1 1 0; overflow:auto; min-height:0; }
  /* Floor so the grid never collapses to zero height in odd layouts. */
  .cs-table-scroll { min-height:240px; }

  /* Time axis */
  .cs-axis { display:flex; flex-direction:column; min-width:560px; }
  .cs-axis-head {
    position:sticky; top:0; z-index:10; display:flex; gap:6px; padding:8px 8px 0 0;
    background:color-mix(in srgb, var(--background-primary) 92%, transparent);
    backdrop-filter:blur(4px);
  }
  .cs-axis-head-gutter { width:48px; flex-shrink:0; }
  .cs-axis-head-day {
    flex:1; min-width:0; position:relative; padding:8px 6px 10px; font-size:12px; font-weight:600;
    color:var(--text-muted); border-radius:12px 12px 0 0; background:var(--background-primary);
  }
  .cs-th-day--today {
    color:var(--text-normal); font-weight:800;
    background:color-mix(in srgb, var(--today-colour, var(--interactive-accent)) 12%, var(--background-primary));
  }
  .cs-th-day--holiday { background:color-mix(in srgb, var(--color-yellow, #f9e2af) 16%, var(--background-secondary)) !important; color:var(--color-yellow, #d4a017) !important; }
  .cs-th-day--makeup { background:color-mix(in srgb, var(--interactive-accent) 10%, var(--background-secondary)) !important; }
  .cs-th-day-inner { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; }
  .cs-day-name { font-size:13px; font-weight:800; white-space:nowrap; display:flex; align-items:center; gap:5px; }
  .cs-day-date {
    font-size:11px; color:var(--text-normal); opacity:0.85; white-space:nowrap;
    width:24px; height:24px; display:flex; align-items:center; justify-content:center; border-radius:50%;
  }
  .cs-th-day--today .cs-day-date {
    background:var(--today-colour, var(--interactive-accent)); color:var(--text-on-accent, #fff); opacity:1;
    box-shadow:0 2px 6px color-mix(in srgb, var(--today-colour, var(--interactive-accent)) 40%, transparent);
  }
  .cs-day-badge { font-size:9px; font-weight:800; padding:1px 6px; border-radius:8px; }
  .cs-day-badge--holiday { background:var(--color-yellow, #f59e0b); color:#1a1a1a; }
  .cs-day-badge--makeup { background:var(--interactive-accent); color:var(--text-on-accent, #fff); }
  .cs-day-head-menu {
    position:absolute; top:4px; right:4px; padding:3px; border:none; border-radius:6px;
    background:transparent; color:var(--text-muted); cursor:pointer; opacity:0; transition:opacity 0.12s;
  }
  .cs-axis-head-day:hover .cs-day-head-menu, .cs-day-head-menu:focus-visible { opacity:1; }
  .cs-day-head-menu:hover { background:var(--background-modifier-hover); color:var(--text-normal); }
  .cs-day-head-menu :global(svg) { width:12px; height:12px; }

  .cs-axis-body { display:flex; align-items:flex-start; gap:6px; padding:8px 8px 16px 0; position:relative; }
  .cs-axis-gutter { width:48px; flex-shrink:0; position:relative; }
  .cs-axis-hour {
    position:absolute; right:8px; transform:translateY(-50%); font-size:11px;
    color:var(--text-muted); white-space:nowrap; font-variant-numeric:tabular-nums;
  }
  .cs-axis-col {
    flex:1; min-width:0; position:relative; border-radius:10px;
    background:var(--background-secondary); overflow:hidden;
  }
  .cs-axis-line { position:absolute; left:0; right:0; border-top:1px solid color-mix(in srgb, var(--grid-colour, var(--background-modifier-border)) 16%, transparent); pointer-events:none; }
  .cs-axis-col--today { background:color-mix(in srgb, var(--today-colour, var(--interactive-accent)) 7%, var(--background-secondary)); }
  .cs-axis-col--holiday { background:color-mix(in srgb, var(--color-yellow, #f9e2af) 8%, var(--background-secondary)); }
  .cs-axis-col--makeup { background:color-mix(in srgb, var(--interactive-accent) 5%, var(--background-secondary)); }
  .cs-day-overlay {
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    font-size:15px; font-weight:800; letter-spacing:0.1em; color:var(--color-yellow, #d4a017); opacity:0.55; pointer-events:none;
  }
  .cs-now-line {
    position:absolute; left:0; right:8px; z-index:5; border-top:2px solid var(--color-red, #f38ba8);
    box-shadow:0 0 6px color-mix(in srgb, var(--color-red, #f38ba8) 60%, transparent); pointer-events:none;
  }
  .cs-now-badge {
    position:absolute; right:0; transform:translateY(-50%); font-size:10px; font-weight:800;
    padding:1px 7px; border-radius:999px; background:var(--color-red, #f38ba8); color:#fff; z-index:6;
    box-shadow:0 1px 4px color-mix(in srgb, var(--color-red, #f38ba8) 50%, transparent);
  }

  /* Period blocks */
  .cs-block {
    position:absolute; left:4px; right:4px; border:1px solid transparent;
    border-radius:var(--cs-radius); box-sizing:border-box; overflow:hidden; z-index:2;
  }
  .cs-block--empty {
    background:transparent !important; border:1px dashed color-mix(in srgb, var(--text-muted) 35%, transparent);
    transition:background 0.12s, border-color 0.12s;
  }
  .cs-block--empty:hover {
    background:color-mix(in srgb, var(--interactive-accent) 7%, transparent) !important;
    border-color:var(--interactive-accent);
  }
  .cs-block--readonly .cs-cell-add { display:none; }
  .cs-block--multi .cs-chip-stack { gap:3px; }
  .cs-chip-stack {
    position:absolute; inset:3px; display:flex; flex-direction:column; gap:2px; z-index:3;
  }
  .cs-block-break {
    position:absolute; left:8px; right:8px; z-index:4; pointer-events:none;
    border-top:1px dashed color-mix(in srgb, var(--text-muted) 55%, transparent);
  }

  .cs-cell-add {
    position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    border:none; background:transparent; cursor:pointer; opacity:0; transition:opacity 0.12s;
  }
  .cs-block:hover .cs-cell-add { opacity:0.7; }
  .cs-cell-add:hover { opacity:1 !important; }
  .cs-cell-plus {
    width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center;
    border-radius:50%; background:color-mix(in srgb, var(--text-muted) 18%, transparent);
    color:var(--text-muted); font-size:13px;
  }

  /* Course chip */
  .cs-chip {
    position:relative; flex:1 1 0; min-height:0; display:flex; flex-direction:column; gap:2px;
    padding:5px 7px; border-radius:8px; cursor:pointer; overflow:hidden; text-align:left;
    color:var(--chip-fg, var(--text-normal)); border:none; font-family:var(--font-interface);
    box-shadow:0 1px 3px rgba(0,0,0,0.18);
    transition:transform 0.1s, filter 0.1s, box-shadow 0.1s;
  }
  .cs-chip:hover {
    filter:brightness(1.07); transform:translateY(-1px);
    box-shadow:0 3px 10px rgba(0,0,0,0.28);
  }
  .cs-chip:active { transform:translateY(0) scale(0.99); }
  .cs-chip-period {
    display:none; font-size:11px; color:var(--chip-fg); opacity:0.85;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600;
  }
  .cs-block:hover .cs-chip-period { display:block; }
  .cs-chip-code { font-size:14px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cs-chip-credits {
    font-size:10px; font-weight:800; margin-left:4px; padding:0 5px; border-radius:6px;
    background:color-mix(in srgb, currentColor 20%, transparent); vertical-align:1px;
  }
  .cs-chip-meta { font-size:11px; opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cs-chip-notes { font-size:11px; opacity:0.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* Day mode */
  .cs-day-strip {
    display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid var(--background-modifier-border);
    flex-shrink:0; overflow-x:auto;
  }
  .cs-day-pill {
    display:flex; flex-direction:column; align-items:center; gap:3px; min-width:56px;
    padding:8px 10px; border-radius:12px; border:1px solid var(--background-modifier-border);
    background:var(--background-primary); cursor:pointer; transition:all 0.12s;
  }
  .cs-day-pill:hover { background:var(--background-modifier-hover); }
  .cs-day-pill--today { border-color:var(--interactive-accent); box-shadow:0 0 0 1px var(--interactive-accent) inset; }
  .cs-day-pill--sel {
    background:var(--interactive-accent); color:var(--text-on-accent); border-color:var(--interactive-accent);
    box-shadow:0 3px 10px color-mix(in srgb, var(--interactive-accent) 35%, transparent);
  }
  .cs-day-pill-dow { font-size:12px; font-weight:700; }
  .cs-day-pill-num { font-size:17px; font-weight:800; }
  .cs-day-pill-dot { width:5px; height:5px; border-radius:50%; background:var(--interactive-accent); }
  .cs-daylist {
    flex:1 1 0; overflow:auto; padding:12px 14px 80px; display:flex; flex-direction:column; gap:10px;
  }
  .cs-dcard {
    display:flex; gap:12px; padding:12px 14px; border-radius:14px; cursor:pointer;
    box-shadow:0 1px 4px rgba(0,0,0,0.12); transition:transform 0.1s, box-shadow 0.1s;
  }
  .cs-dcard:hover { transform:translateY(-1px); box-shadow:0 3px 10px rgba(0,0,0,0.18); }
  .cs-dcard-time { flex-shrink:0; font-size:12px; color:var(--text-muted); line-height:1.5; font-weight:600; }
  .cs-dcard-body { min-width:0; }
  .cs-dcard-code { font-size:16px; font-weight:800; }
  .cs-dcard-credits {
    font-size:11px; font-weight:800; margin-left:6px; padding:0 6px; border-radius:6px;
    background:color-mix(in srgb, currentColor 16%, transparent); vertical-align:1px;
  }
  .cs-dcard-sub { font-size:12px; opacity:0.8; margin-top:3px; }
  .cs-dcard-note { font-size:12px; opacity:0.65; margin-top:4px; }
  .cs-dslim {
    display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:12px;
    border:1px dashed color-mix(in srgb, var(--text-muted) 35%, transparent);
    background:transparent; cursor:pointer; color:var(--text-muted); font-size:12px; transition:all 0.12s;
  }
  .cs-dslim:hover { background:color-mix(in srgb, var(--interactive-accent) 7%, transparent); border-color:var(--interactive-accent); color:var(--text-normal); }
  .cs-dslim-time { width:36px; font-weight:600; }
  .cs-dslim-add { margin-left:auto; font-size:14px; }
  .cs-daylist-empty {
    padding:28px 12px; text-align:center; color:var(--color-yellow, #d4a017); font-weight:800; font-size:15px;
    border-radius:12px; background:color-mix(in srgb, var(--color-yellow, #f9e2af) 10%, transparent);
  }

  /* Unscheduled strip (无固定时间) */
  .cs-unscheduled-bar {
    display:flex; align-items:center; gap:8px; flex-wrap:wrap;
    padding:6px 16px; border-bottom:1px solid var(--background-modifier-border);
    background:color-mix(in srgb, var(--background-secondary) 60%, transparent); flex-shrink:0;
  }
  .cs-unscheduled-label {
    font-size:11px; font-weight:800; letter-spacing:0.04em; color:var(--text-muted); text-transform:uppercase;
  }
  .cs-unscheduled-chip {
    display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px;
    border:1px solid color-mix(in srgb, var(--uc, var(--interactive-accent)) 45%, transparent);
    background:color-mix(in srgb, var(--uc, var(--interactive-accent)) 12%, transparent);
    color:var(--text-normal); font-size:12px; font-weight:600; cursor:pointer; transition:filter 0.1s;
  }
  .cs-unscheduled-chip:hover { filter:brightness(1.08); }

  /* Clash badge */
  .cs-block-clash {
    position:absolute; top:2px; right:4px; z-index:6; font-size:11px; line-height:1;
    color:var(--color-yellow, #e0af68); cursor:help; text-shadow:0 1px 2px rgba(0,0,0,0.5);
  }

  /* Drag & drop */
  .cs-block--dragover {
    outline:2px dashed var(--interactive-accent); outline-offset:-2px;
    background:color-mix(in srgb, var(--interactive-accent) 16%, transparent) !important;
  }
  .cs-chip { cursor:grab; }
  .cs-chip:active { cursor:grabbing; }
  .cs-chip--event { border-style:dashed; }
  .cs-chip--event .cs-chip-code { font-style:italic; }

  /* Agenda (mobile) */
  .cs-agenda { flex:1 1 0; overflow:auto; padding:12px 14px 80px; display:flex; flex-direction:column; gap:14px; }
  .cs-agenda-day { border-radius:14px; border:1px solid var(--background-modifier-border); overflow:hidden; }
  .cs-agenda-head {
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    padding:8px 12px; background:var(--background-secondary); font-size:13px; font-weight:800;
  }
  .cs-agenda-head--today { color:var(--interactive-accent); }
  .cs-agenda-dayname { white-space:nowrap; }
  .cs-agenda-row { display:flex; gap:10px; padding:8px 12px; border-top:1px solid var(--background-modifier-border); }
  .cs-agenda-time { flex-shrink:0; width:52px; font-size:11px; color:var(--text-muted); font-weight:700; line-height:1.4; }
  .cs-agenda-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
  .cs-agenda-item {
    padding:8px 10px; border-radius:10px; cursor:pointer; display:flex; flex-direction:column; gap:2px;
    box-shadow:0 1px 3px rgba(0,0,0,0.12); transition:transform 0.1s, box-shadow 0.1s;
  }
  .cs-agenda-item:hover { transform:translateY(-1px); box-shadow:0 3px 8px rgba(0,0,0,0.18); }
  .cs-agenda-item--event { border-style:dashed; }
  .cs-agenda-name { font-size:14px; font-weight:800; }
  .cs-agenda-meta { font-size:11px; opacity:0.8; }
  .cs-agenda-empty { padding:14px; text-align:center; color:var(--text-muted); font-size:12px; }

  /* Event day cards */
  .cs-dcard--event { border-style:dashed; }

  /* ── Mobile layout: compact chrome, more room for content ─────────────── */
  .cs-info-strip { display:contents; }
  .cs-week-view--mobile .cs-info-strip {
    display:flex; align-items:center; gap:4px;
    border-bottom:1px solid var(--background-modifier-border);
  }
  .cs-week-view--mobile .cs-next-bar {
    flex:1 1 0; min-width:0; padding:5px 10px; border-bottom:none; font-size:12px;
  }
  .cs-week-view--mobile .cs-next-mins { padding:1px 8px; font-size:11px; }
  .cs-week-view--mobile .cs-stats-bar {
    flex-shrink:0; padding:5px 10px 5px 0; border-bottom:none; gap:8px;
  }
  .cs-week-view--mobile .cs-stat { font-size:10px; }
  .cs-week-view--mobile .cs-stat b { margin-right:2px; }

  .cs-week-view--mobile .cs-header {
    grid-template-columns:1fr auto; padding:6px 10px; gap:8px;
  }
  .cs-week-view--mobile .cs-header-actions { display:none; }
  .cs-week-view--mobile .cs-week-label { font-size:15px; gap:6px; }
  .cs-week-view--mobile .cs-date-range { font-size:11px; }
  .cs-week-view--mobile .cs-nav-arrow { width:28px; height:28px; }
  .cs-week-view--mobile .cs-nav-centre { padding:5px 10px; font-size:12px; }

  .cs-week-view--mobile .cs-mobile-bar { padding:6px 10px; gap:8px; }
  .cs-week-view--mobile .cs-mobile-modes { gap:4px; padding:2px; }
  .cs-week-view--mobile .cs-mode-btn { padding:4px 12px; font-size:11px; }
  .cs-week-view--mobile .cs-mobile-act { width:28px; height:28px; }
  .cs-semester-select--mobile { max-width:110px; font-size:11px; padding:3px 6px; }

  .cs-week-view--mobile .cs-unscheduled-bar {
    flex-wrap:nowrap; overflow-x:auto; padding:4px 10px; gap:6px;
  }
  .cs-week-view--mobile .cs-unscheduled-chip { white-space:nowrap; font-size:11px; padding:2px 8px; }
  .cs-week-view--mobile .cs-unscheduled-label { font-size:10px; }

  .cs-week-view--mobile .cs-day-strip { padding:8px 10px; gap:6px; }
  .cs-week-view--mobile .cs-day-pill { min-width:50px; padding:6px 8px; }
  .cs-week-view--mobile .cs-daylist { padding:10px 12px 70px; gap:8px; }
  .cs-week-view--mobile .cs-agenda { padding:10px 12px 70px; gap:12px; }

  /* Compact mode */
  .cs-week-view--compact .cs-header { padding:6px 12px; }
  .cs-week-view--compact .cs-week-label { font-size:15px; }
  .cs-week-view--compact .cs-date-range { font-size:11px; }
  .cs-week-view--compact .cs-axis-body { padding:6px 6px 12px 0; gap:4px; }
  .cs-week-view--compact .cs-axis-head { gap:4px; padding:6px 6px 0 0; }
  .cs-week-view--compact .cs-axis-head-day { padding:6px 4px 8px; }
  .cs-week-view--compact .cs-day-name { font-size:12px; }
  .cs-week-view--compact .cs-day-date { width:20px; height:20px; font-size:10px; }
  .cs-week-view--compact .cs-chip { padding:3px 5px; gap:1px; }
  .cs-week-view--compact .cs-chip-code { font-size:12px; }
  .cs-week-view--compact .cs-chip-meta { font-size:10px; }
  .cs-week-view--compact .cs-block { left:2px; right:2px; }
  .cs-week-view--compact .cs-next-bar { padding:5px 12px; font-size:12px; }
  .cs-week-view--compact .cs-stats-bar { padding:4px 12px; gap:10px; }
  .cs-week-view--compact .cs-stat { font-size:11px; }
  .cs-week-view--compact .cs-dcard { padding:9px 11px; }
  .cs-week-view--compact .cs-dcard-code { font-size:14px; }
</style>


