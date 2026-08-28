import { App, Modal, Notice, Setting } from "obsidian";
import type ClassSchedulePlugin from "../main";
import type { Course, WeekRule } from "../types";
import { randomCourseColour } from "../settings";
import { totalWeeks } from "../utils/weekUtils";
import { ColourPickerModal } from "./common";

/** Add / edit a course's metadata, including the 无固定时间 option. */
export class CourseFormModal extends Modal {
  private plugin: ClassSchedulePlugin;
  private course: Course | null;
  private onSaved: () => void;

  private name = "";
  private emoji = "📚";
  private colour = "#89b4fa";
  private teacher = "";
  private classroom = "";
  private credits = "";
  private unscheduled = false;
  private weekStart = 1;
  private weekEnd = 1;
  private parity: WeekRule["parity"] = "all";

  constructor(app: App, plugin: ClassSchedulePlugin, course: Course | null, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.course = course;
    this.onSaved = onSaved;
    if (course) {
      this.name = course.name;
      this.emoji = course.emoji ?? "📚";
      this.colour = course.colour;
      this.teacher = course.teacher ?? "";
      this.classroom = course.classroom ?? "";
      this.credits = course.credits != null ? String(course.credits) : "";
      this.unscheduled = !!course.unscheduled;
      this.weekStart = course.weeks?.start ?? 1;
      this.weekEnd = course.weeks?.end ?? totalWeeks(plugin.settings);
      this.parity = course.weeks?.parity ?? "all";
    } else {
      this.colour = randomCourseColour(plugin.settings.courses.map(c => c.colour));
      this.weekEnd = totalWeeks(plugin.settings);
    }
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.course ? this.plugin.t("settings.course.edit") : this.plugin.t("settings.course.add"));
    contentEl.addClass("cs-course-form");
    const p = this.plugin;

    new Setting(contentEl).setName(p.t("course.name")).addText(t => t.setValue(this.name).onChange(v => { this.name = v; }));
    new Setting(contentEl).setName(p.t("course.emoji")).addText(t => t.setValue(this.emoji).onChange(v => { this.emoji = v.trim(); }));
    new Setting(contentEl).setName(p.t("course.teacher")).addText(t => t.setValue(this.teacher).onChange(v => { this.teacher = v; }));
    new Setting(contentEl).setName(p.t("course.classroom")).addText(t => t.setValue(this.classroom).onChange(v => { this.classroom = v; }));
    new Setting(contentEl).setName(p.t("course.credits")).addText(t => {
      t.setPlaceholder(p.t("course.creditsPh")).setValue(this.credits).onChange(v => { this.credits = v; });
    });
    new Setting(contentEl).setName(p.t("course.colour")).addButton(b => {
      b.setButtonText(this.colour).setCta().onClick(() => {
        new ColourPickerModal(this.app, this.colour, p.t("course.colour"), async (c) => {
          this.colour = c;
          b.setButtonText(c);
        }, p.t("common.save"), p.t("common.cancel")).open();
      });
    });

    new Setting(contentEl).setName(p.t("course.unscheduled")).setDesc(p.t("course.unscheduledDesc"))
      .addToggle(t => t.setValue(this.unscheduled).onChange(on => {
        this.unscheduled = on;
        this.contentEl.empty();
        this.onOpen();
      }));

    if (this.unscheduled) {
      new Setting(contentEl).setName(p.t("course.startWeek"))
        .addText(t => t.setValue(String(this.weekStart)).onChange(v => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 1) this.weekStart = n;
        }));
      new Setting(contentEl).setName(p.t("course.endWeek"))
        .addText(t => t.setValue(String(this.weekEnd)).onChange(v => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 1) this.weekEnd = n;
        }));
      new Setting(contentEl).setName(p.t("course.weeks")).addDropdown(d => {
        d.addOption("all", p.t("course.weeksAll"));
        d.addOption("odd", p.t("course.weeksOdd"));
        d.addOption("even", p.t("course.weeksEven"));
        d.setValue(this.parity).onChange(v => { this.parity = v as WeekRule["parity"]; });
      });
    }

    const footer = contentEl.createDiv("cs-modal-footer");
    footer.createEl("button", { cls: "cs-btn", text: p.t("common.cancel") })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { cls: "cs-btn cs-btn--primary", text: p.t("common.save") })
      .addEventListener("click", () => { void this.save(); });
  }

  private async save() {
    if (!this.name.trim()) { new Notice(this.plugin.t("course.needName")); return; }
    const credits = this.credits.trim() !== "" ? parseFloat(this.credits) : undefined;
    const parsedCredits = credits != null && !isNaN(credits) && credits > 0 ? credits : undefined;
    const weeks: WeekRule | undefined = this.unscheduled
      ? { start: Math.max(1, this.weekStart), end: Math.max(this.weekStart, this.weekEnd), parity: this.parity }
      : undefined;

    if (this.course) {
      this.course.name = this.name.trim();
      this.course.emoji = this.emoji || undefined;
      this.course.colour = this.colour;
      this.course.teacher = this.teacher.trim() || undefined;
      this.course.classroom = this.classroom.trim() || undefined;
      this.course.credits = parsedCredits;
      this.course.unscheduled = this.unscheduled;
      this.course.weeks = weeks;
    } else {
      this.plugin.settings.courses.push({
        id: "course-" + Date.now(),
        name: this.name.trim(),
        emoji: this.emoji || undefined,
        colour: this.colour,
        teacher: this.teacher.trim() || undefined,
        classroom: this.classroom.trim() || undefined,
        credits: parsedCredits,
        unscheduled: this.unscheduled,
        weeks,
      });
    }
    await this.plugin.saveSettings();
    this.onSaved();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}
