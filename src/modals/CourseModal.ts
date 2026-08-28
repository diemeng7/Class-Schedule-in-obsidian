import { App, Modal, Notice } from "obsidian";
import type ClassSchedulePlugin from "../main";
import type { Course, SchoolDay, Semester, TimetableSlot, WeekRule } from "../types";
import { randomCourseColour } from "../settings";
import { timeToMinutes, totalWeeks } from "../utils/weekUtils";
import { ColourPickerModal, ConfirmModal, openEmojiPicker } from "./common";

export interface CourseModalOptions {
  slot?: TimetableSlot;
  day?: SchoolDay;
  periodId?: string;
  /** When set, the footer offers 停课/恢复 for this specific date. */
  contextDate?: string;
  onSaved: () => void;
}

const DAY_KEYS: SchoolDay[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

/**
 * Add or edit one timetable slot: course (+ credits), day/period,
 * week rule (range/parity or tap-to-select weeks), optional custom
 * duration/break, classroom override and notes.
 */
export class CourseModal extends Modal {
  private plugin: ClassSchedulePlugin;
  private opts: CourseModalOptions;

  // course state
  private creatingCourse = false;
  private selectedCourseId = "";
  private courseName = "";
  private courseEmoji = "📚";
  private courseColour = "";
  private courseTeacher = "";
  private courseClassroom = "";
  private courseCredits = "";

  // slot state
  private day: SchoolDay;
  private periodId: string;
  private weekStart = 1;
  private weekEnd = 1;
  private parity: WeekRule["parity"] = "all";
  private selectedWeeks = new Set<number>();
  private notes = "";
  private classroomOverride = "";
  private duration = "";
  private breakMins = "";

  constructor(app: App, plugin: ClassSchedulePlugin, opts: CourseModalOptions) {
    super(app);
    this.plugin = plugin;
    this.opts = opts;
    const sem = plugin.settings;
    this.day = opts.slot?.day ?? opts.day ?? (sem.schoolDays[0] ?? "monday");
    this.periodId = opts.slot?.periodId ?? opts.periodId ?? sem.periods[0]?.id ?? "";
    const rule = opts.slot?.weeks;
    if (rule) {
      this.weekStart = rule.start;
      this.weekEnd = rule.end;
      this.parity = rule.parity;
      if (rule.weeks && rule.weeks.length > 0) {
        for (const w of rule.weeks) this.selectedWeeks.add(w);
      }
    } else {
      const total = totalWeeks(sem);
      this.weekStart = 1;
      this.weekEnd = total;
    }
    this.notes = opts.slot?.notes ?? "";
    this.classroomOverride = opts.slot?.classroom ?? "";
    this.selectedCourseId = opts.slot?.courseId ?? sem.courses[0]?.id ?? "";
    const course = sem.courses.find(c => c.id === this.selectedCourseId);
    if (course) this.initFromCourse(course);

    if (opts.slot?.durationMinutes) this.duration = String(opts.slot.durationMinutes);
    if (opts.slot?.breakMinutes) this.breakMins = String(opts.slot.breakMinutes);
    if (!this.duration) {
      const p = sem.periods.find(x => x.id === this.periodId);
      if (p) this.duration = String(timeToMinutes(p.end) - timeToMinutes(p.start));
    }
    if (!this.breakMins) this.breakMins = "0";
  }

  private initFromCourse(c: Course) {
    this.courseName = c.name;
    this.courseEmoji = c.emoji ?? "📚";
    this.courseColour = c.colour;
    this.courseTeacher = c.teacher ?? "";
    this.courseClassroom = c.classroom ?? "";
    this.courseCredits = c.credits != null ? String(c.credits) : "";
  }

  private get sem(): Semester { return this.plugin.settings; }
  private t(key: string, vars?: Record<string, string | number>): string {
    return this.plugin.t(key, vars);
  }

  onOpen() {
    this.modalEl.addClass("cs-course-modal");
    this.render();
  }

  private render() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(this.opts.slot ? this.t("course.edit") : this.t("course.add"));

    // ── Course section ────────────────────────────────────────────────────
    const courseSection = contentEl.createDiv("cs-form-section");
    courseSection.createEl("h4", { text: this.t("course.select") });

    if (!this.creatingCourse) {
      const row = courseSection.createDiv("cs-form-row");
      const select = row.createEl("select", { cls: "cs-select" });
      if (this.sem.courses.length === 0) {
        select.createEl("option", { text: "—", value: "" });
        select.disabled = true;
      } else {
        for (const c of this.sem.courses) {
          const opt = select.createEl("option", { value: c.id });
          opt.text = `${c.emoji ?? ""} ${c.name}${c.credits ? " · " + c.credits + this.t("course.creditsShort") : ""}`;
        }
        select.value = this.selectedCourseId;
      }
      select.addEventListener("change", () => {
        this.selectedCourseId = select.value;
        const c = this.sem.courses.find(x => x.id === this.selectedCourseId);
        if (c) this.initFromCourse(c);
      });

      const newBtn = row.createEl("button", { cls: "cs-btn", text: this.t("course.new") });
      newBtn.addEventListener("click", () => {
        this.creatingCourse = true;
        this.courseColour = randomCourseColour(this.sem.courses.map(c => c.colour));
        this.courseName = "";
        this.courseTeacher = "";
        this.courseClassroom = "";
        this.courseCredits = "";
        this.render();
      });

      const creditField = courseSection.createDiv("cs-form-field");
      creditField.createEl("label", { text: this.t("course.credits") });
      const creditInput = creditField.createEl("input", { type: "number", cls: "cs-input cs-input--num" });
      creditInput.step = "0.5";
      creditInput.min = "0";
      creditInput.placeholder = this.t("course.creditsPh");
      creditInput.value = this.courseCredits;
      creditInput.addEventListener("input", () => { this.courseCredits = creditInput.value; });
    } else {
      const field = (label: string, input: HTMLInputElement) => {
        const wrap = courseSection.createDiv("cs-form-field");
        wrap.createEl("label", { text: label });
        wrap.appendChild(input);
      };

      const nameInput = courseSection.createEl("input", { type: "text", cls: "cs-input" });
      nameInput.placeholder = this.t("course.namePh");
      nameInput.value = this.courseName;
      nameInput.addEventListener("input", () => { this.courseName = nameInput.value; });
      field(this.t("course.name"), nameInput);

      const emojiRow = courseSection.createDiv("cs-form-row");
      emojiRow.createEl("label", { text: this.t("course.emoji") });
      const emojiBtn = emojiRow.createEl("button", { cls: "cs-btn cs-emoji-btn", text: this.courseEmoji });
      emojiBtn.addEventListener("click", () => {
        openEmojiPicker(emojiBtn, this.courseEmoji, (e) => { this.courseEmoji = e; emojiBtn.setText(e); });
      });
      emojiRow.createEl("label", { text: this.t("course.credits") });
      const creditInput = emojiRow.createEl("input", { type: "number", cls: "cs-input cs-input--num", value: this.courseCredits });
      creditInput.step = "0.5";
      creditInput.min = "0";
      creditInput.addEventListener("input", () => { this.courseCredits = creditInput.value; });

      const teacherInput = courseSection.createEl("input", { type: "text", cls: "cs-input" });
      teacherInput.placeholder = this.t("course.teacherPh");
      teacherInput.value = this.courseTeacher;
      teacherInput.addEventListener("input", () => { this.courseTeacher = teacherInput.value; });
      field(this.t("course.teacher"), teacherInput);

      const roomInput = courseSection.createEl("input", { type: "text", cls: "cs-input" });
      roomInput.placeholder = this.t("course.classroomPh");
      roomInput.value = this.courseClassroom;
      roomInput.addEventListener("input", () => { this.courseClassroom = roomInput.value; });
      field(this.t("course.classroom"), roomInput);

      const colourRow = courseSection.createDiv("cs-form-row");
      colourRow.createEl("label", { text: this.t("course.colour") });
      const colourBtn = colourRow.createEl("button", { cls: "cs-btn cs-colour-btn" });
      const swatch = colourBtn.createSpan({ cls: "cs-swatch" });
      swatch.setCssStyles({ background: this.courseColour });
      colourBtn.appendChild(swatch);
      colourBtn.appendText(" " + this.courseColour);
      colourBtn.addEventListener("click", () => {
        new ColourPickerModal(this.app, this.courseColour, this.t("course.colour"), async (c) => {
          this.courseColour = c;
          swatch.setCssStyles({ background: c });
          colourBtn.lastChild?.remove();
          colourBtn.appendText(" " + c);
        }, this.t("common.save"), this.t("common.cancel")).open();
      });

      const backRow = courseSection.createDiv("cs-form-row cs-form-row--end");
      const backBtn = backRow.createEl("button", { cls: "cs-btn", text: "‹ " + this.t("course.select") });
      backBtn.addEventListener("click", () => { this.creatingCourse = false; this.render(); });
    }

    // ── Time section ──────────────────────────────────────────────────────
    const timeSection = contentEl.createDiv("cs-form-section");
    timeSection.createEl("h4", { text: this.t("course.day") + " / " + this.t("course.period") });
    const timeRow = timeSection.createDiv("cs-form-row");

    const daySelect = timeRow.createEl("select", { cls: "cs-select" });
    for (const k of DAY_KEYS) {
      if (!this.sem.schoolDays.includes(k)) continue;
      const opt = daySelect.createEl("option", { value: k });
      opt.text = this.t("day." + k);
    }
    daySelect.value = this.day;
    daySelect.addEventListener("change", () => { this.day = daySelect.value as SchoolDay; });

    const periodSelect = timeRow.createEl("select", { cls: "cs-select" });
    for (const p of this.sem.periods) {
      periodSelect.createEl("option", { value: p.id, text: `${p.name} (${p.start}–${p.end})` });
    }
    periodSelect.value = this.periodId;
    periodSelect.addEventListener("change", () => {
      this.periodId = periodSelect.value;
      if (this.sem.useCustomTime) {
        const p = this.sem.periods.find(x => x.id === this.periodId);
        if (p) this.duration = String(timeToMinutes(p.end) - timeToMinutes(p.start));
      }
    });

    // ── Custom time (feature toggle) ──────────────────────────────────────
    if (this.sem.useCustomTime) {
      const customSection = contentEl.createDiv("cs-form-section");
      customSection.createEl("h4", { text: this.t("course.duration") });
      const customRow = customSection.createDiv("cs-form-row");
      customRow.createEl("label", { text: this.t("course.duration") });
      const durInput = customRow.createEl("input", { type: "number", cls: "cs-input cs-input--num" });
      durInput.min = "1";
      durInput.step = "5";
      durInput.placeholder = this.t("course.durationPh");
      durInput.value = this.duration;
      durInput.addEventListener("input", () => { this.duration = durInput.value; });
      customRow.createEl("label", { text: this.t("course.break") });
      const brkInput = customRow.createEl("input", { type: "number", cls: "cs-input cs-input--num" });
      brkInput.min = "0";
      brkInput.step = "5";
      brkInput.placeholder = this.t("course.breakPh");
      brkInput.value = this.breakMins;
      brkInput.addEventListener("input", () => { this.breakMins = brkInput.value; });
    }

    // ── Weeks section ─────────────────────────────────────────────────────
    const weeksSection = contentEl.createDiv("cs-form-section");
    weeksSection.createEl("h4", { text: this.t("course.weeks") });

    const rangeRow = weeksSection.createDiv("cs-form-row");
    rangeRow.createEl("label", { text: this.t("course.startWeek") });
    const startInput = rangeRow.createEl("input", { type: "number", cls: "cs-input cs-input--num", value: String(this.weekStart) });
    startInput.min = "1";
    startInput.addEventListener("change", () => { this.weekStart = Math.max(1, parseInt(startInput.value, 10) || 1); });
    rangeRow.createEl("label", { text: this.t("course.endWeek") });
    const endInput = rangeRow.createEl("input", { type: "number", cls: "cs-input cs-input--num", value: String(this.weekEnd) });
    endInput.min = "1";
    endInput.addEventListener("change", () => { this.weekEnd = Math.max(1, parseInt(endInput.value, 10) || 1); });

    const parityRow = weeksSection.createDiv("cs-form-row");
    const paritySelect = parityRow.createEl("select", { cls: "cs-select" });
    const parityOptions: Array<WeekRule["parity"]> = ["all", "odd", "even"];
    for (const p of parityOptions) {
      paritySelect.createEl("option", { value: p, text: this.t("course.weeks" + (p === "all" ? "All" : p === "odd" ? "Odd" : "Even")) });
    }
    paritySelect.value = this.parity;
    paritySelect.addEventListener("change", () => { this.parity = paritySelect.value as WeekRule["parity"]; });

    // Tap-to-select week buttons
    weeksSection.createEl("label", { cls: "cs-week-buttons-title", text: this.t("course.weekButtons") });
    const weekCount = Math.min(30, totalWeeks(this.sem));
    const grid = weeksSection.createDiv("cs-week-buttons");
    const buttons: HTMLButtonElement[] = [];
    const paint = () => {
      for (let i = 1; i <= weekCount; i++) {
        const b = buttons[i - 1];
        b.classList.toggle("cs-week-btn--on", this.selectedWeeks.has(i));
      }
    };
    const toggle = (n: number) => {
      if (this.selectedWeeks.has(n)) this.selectedWeeks.delete(n); else this.selectedWeeks.add(n);
      paint();
    };
    for (let i = 1; i <= weekCount; i++) {
      const b = grid.createEl("button", { cls: "cs-week-btn", text: String(i) });
      b.classList.toggle("cs-week-btn--on", this.selectedWeeks.has(i));
      b.title = this.t("week.label", { n: i });
      b.addEventListener("click", () => toggle(i));
      buttons.push(b);
    }
    const quickRow = weeksSection.createDiv("cs-form-row cs-week-quick");
    const quick = (label: string, fn: () => void) => {
      const b = quickRow.createEl("button", { cls: "cs-btn", text: label });
      b.addEventListener("click", () => { fn(); paint(); });
    };
    quick(this.t("course.weeksQuickAll"), () => { for (let i = 1; i <= weekCount; i++) this.selectedWeeks.add(i); });
    quick(this.t("course.weeksQuickNone"), () => this.selectedWeeks.clear());
    quick(this.t("course.weeksQuickOdd"), () => {
      this.selectedWeeks.clear();
      for (let i = 1; i <= weekCount; i += 2) this.selectedWeeks.add(i);
    });
    quick(this.t("course.weeksQuickEven"), () => {
      this.selectedWeeks.clear();
      for (let i = 2; i <= weekCount; i += 2) this.selectedWeeks.add(i);
    });

    // ── Notes ─────────────────────────────────────────────────────────────
    const notesField = contentEl.createDiv("cs-form-field");
    notesField.createEl("label", { text: this.t("course.notes") });
    const notesInput = notesField.createEl("textarea", { cls: "cs-input cs-textarea" });
    notesInput.placeholder = this.t("course.notesPh");
    notesInput.value = this.notes;
    notesInput.addEventListener("input", () => { this.notes = notesInput.value; });

    // ── Footer ────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv("cs-modal-footer");
    if (this.opts.slot && this.opts.contextDate) {
      const excluded = (this.sem.slotExclusions ?? []).some(
        e => e.slotId === this.opts.slot!.id && e.date === this.opts.contextDate
      );
      footer.createEl("button", { cls: "cs-btn", text: excluded ? this.t("course.restoreDay") : this.t("course.stopDay") })
        .addEventListener("click", () => {
          const list = (this.sem.slotExclusions ?? []).filter(
            e => !(e.slotId === this.opts.slot!.id && e.date === this.opts.contextDate)
          );
          if (!excluded) list.push({ slotId: this.opts.slot!.id, date: this.opts.contextDate! });
          this.sem.slotExclusions = list;
          void this.plugin.saveSettings().then(() => { this.opts.onSaved(); this.close(); });
        });
    }
    if (this.opts.slot) {
      const delBtn = footer.createEl("button", { cls: "cs-btn cs-btn--danger", text: this.t("common.delete") });
      delBtn.addEventListener("click", () => {
        new ConfirmModal(this.app, this.t("course.deleteConfirm"), async () => {
          this.sem.timetable = this.sem.timetable.filter(s => s.id !== this.opts.slot!.id);
          await this.plugin.saveSettings();
          this.opts.onSaved();
        }, this.t("common.delete")).open();
      });
    }
    footer.createEl("button", { cls: "cs-btn", text: this.t("common.cancel") })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { cls: "cs-btn cs-btn--primary", text: this.t("common.save") })
      .addEventListener("click", () => { void this.save(); });
  }

  private async save() {
    // 1. Resolve / create the course (including credits).
    let courseId = this.selectedCourseId;
    const credits = this.courseCredits.trim() !== ""
      ? parseFloat(this.courseCredits)
      : undefined;
    const parsedCredits = credits != null && !isNaN(credits) && credits > 0 ? credits : undefined;

    if (this.creatingCourse) {
      if (!this.courseName.trim()) { new Notice(this.t("course.needName")); return; }
      const course: Course = {
        id: "course-" + Date.now(),
        name: this.courseName.trim(),
        emoji: this.courseEmoji || undefined,
        colour: this.courseColour || randomCourseColour(this.sem.courses.map(c => c.colour)),
        teacher: this.courseTeacher.trim() || undefined,
        classroom: this.courseClassroom.trim() || undefined,
        credits: parsedCredits,
      };
      this.sem.courses.push(course);
      courseId = course.id;
    } else {
      const existing = this.sem.courses.find(c => c.id === courseId);
      if (!existing) { new Notice(this.t("course.needCourse")); return; }
      existing.credits = parsedCredits;
    }

    // 2. Build the week rule.
    let weeks: WeekRule | undefined;
    if (this.selectedWeeks.size > 0) {
      const list = Array.from(this.selectedWeeks).sort((a, b) => a - b);
      weeks = { start: list[0], end: list[list.length - 1], parity: "all", weeks: list };
    } else {
      const start = Math.max(1, this.weekStart);
      const end = Math.max(start, this.weekEnd);
      if (!(start === 1 && end === totalWeeks(this.sem) && this.parity === "all")) {
        weeks = { start, end, parity: this.parity };
      }
    }

    // 3. Custom duration / break.
    const period = this.sem.periods.find(p => p.id === this.periodId);
    const defaultDur = period ? timeToMinutes(period.end) - timeToMinutes(period.start) : 0;
    let durationMinutes: number | undefined;
    let breakMinutes: number | undefined;
    if (this.sem.useCustomTime) {
      const d = parseInt(this.duration, 10);
      const b = parseInt(this.breakMins, 10);
      if (!isNaN(d) && d > 0) durationMinutes = d !== defaultDur ? d : undefined;
      if (!isNaN(b) && b > 0) breakMinutes = b;
    }

    // 4. Update or create the slot.
    const slot = this.opts.slot;
    const classroom = this.classroomOverride.trim() || undefined;
    const notes = this.notes.trim() || undefined;
    if (slot) {
      slot.day = this.day;
      slot.periodId = this.periodId;
      slot.courseId = courseId;
      slot.weeks = weeks;
      slot.classroom = classroom;
      slot.notes = notes;
      slot.durationMinutes = durationMinutes;
      slot.breakMinutes = breakMinutes;
    } else {
      this.sem.timetable.push({
        id: "slot-" + Date.now(),
        day: this.day,
        periodId: this.periodId,
        courseId,
        weeks,
        classroom,
        notes,
        durationMinutes,
        breakMinutes,
      });
    }

    await this.plugin.saveSettings();
    this.opts.onSaved();
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
