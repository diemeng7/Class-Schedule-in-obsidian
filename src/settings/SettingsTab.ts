import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type ClassSchedulePlugin from "../main";
import type { DayOverride, LangSetting, SchoolDay } from "../types";
import { DEFAULT_DATA } from "../settings";
import { normalizeTime, isValidIsoDate } from "../utils/scheduleUtils";
import { localIso } from "../utils/weekUtils";
import { ConfirmModal, TextPromptModal } from "../modals/common";
import { DatePickerModal } from "../modals/DatePickerModal";
import { CourseFormModal } from "../modals/CourseFormModal";
import { EventModal } from "../modals/EventModal";

const DAY_KEYS: SchoolDay[] = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

/** Add a whole-day override (放假 / 补课). */
class DayOverrideModal extends Modal {
  private plugin: ClassSchedulePlugin;
  private onSaved: () => void;

  private date = "";
  private endDate = "";
  private type: DayOverride["type"] = "holiday";
  private sourceDate = "";

  constructor(app: App, plugin: ClassSchedulePlugin, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSaved = onSaved;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.plugin.t("settings.dayOverride.add"));
    contentEl.addClass("cs-override-form");
    const p = this.plugin;

    new Setting(contentEl).setName(p.t("settings.dayOverride.date")).addText(t => {
      t.setPlaceholder("2026-10-01").setValue(this.date).onChange(v => { this.date = v.trim(); });
    }).addButton(b => b.setButtonText("…").onClick(() => {
      new DatePickerModal(p.app, {
        value: this.date || undefined,
        min: p.settings.startDate,
        max: p.settings.endDate,
        t: (k, v) => p.t(k, v),
        onPick: (iso) => {
          this.date = iso;
          if (!this.endDate) this.endDate = iso;
          this.contentEl.empty();
          this.onOpen();
        },
      }).open();
    }));

    if (this.type === "holiday") {
      new Setting(contentEl).setName(p.t("settings.dayOverride.endDate")).addText(t => {
        t.setPlaceholder(this.date || "2026-10-07").setValue(this.endDate).onChange(v => { this.endDate = v.trim(); });
      }).addButton(b => b.setButtonText("…").onClick(() => {
        new DatePickerModal(p.app, {
          value: this.endDate || this.date || undefined,
          min: this.date || p.settings.startDate,
          max: p.settings.endDate,
          t: (k, v) => p.t(k, v),
          onPick: (iso) => {
            this.endDate = iso;
            this.contentEl.empty();
            this.onOpen();
          },
        }).open();
      }));
    }

    new Setting(contentEl).setName(p.t("settings.dayOverride.type")).addDropdown(d => {
      d.addOption("holiday", p.t("settings.dayOverride.holiday"));
      d.addOption("makeup", p.t("settings.dayOverride.makeup"));
      d.setValue(this.type).onChange(v => {
        this.type = v as DayOverride["type"];
        this.contentEl.empty();
        this.onOpen();
      });
    });

    if (this.type === "makeup") {
      new Setting(contentEl).setName(p.t("settings.dayOverride.sourceDate")).addText(t => {
        t.setPlaceholder("2026-10-08").setValue(this.sourceDate).onChange(v => { this.sourceDate = v.trim(); });
      }).addButton(b => b.setButtonText("…").onClick(() => {
        new DatePickerModal(p.app, {
          value: this.sourceDate || undefined,
          min: p.settings.startDate,
          max: p.settings.endDate,
          t: (k, v) => p.t(k, v),
          onPick: (iso) => {
            this.sourceDate = iso;
            this.contentEl.empty();
            this.onOpen();
          },
        }).open();
      }));
    }

    const footer = contentEl.createDiv("cs-modal-footer");
    footer.createEl("button", { cls: "cs-btn", text: p.t("common.cancel") })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { cls: "cs-btn cs-btn--primary", text: p.t("common.save") })
      .addEventListener("click", () => {
        if (!isValidIsoDate(this.date)) { new Notice(p.t("settings.startDate") + " YYYY-MM-DD"); return; }
        if (this.type === "holiday" && this.endDate.trim() !== "" && !isValidIsoDate(this.endDate)) {
          new Notice(p.t("settings.dayOverride.endDate") + " YYYY-MM-DD");
          return;
        }
        if (this.type === "makeup" && !isValidIsoDate(this.sourceDate)) {
          new Notice(p.t("settings.dayOverride.sourceDate") + " YYYY-MM-DD");
          return;
        }
        const dates = this.type === "holiday" && this.endDate.trim()
          ? datesInRange(this.date, this.endDate)
          : [this.date];
        let list = (p.settings.dayOverrides ?? []).filter(o => !dates.includes(o.date));
        for (const d of dates) {
          const ov: DayOverride = this.type === "makeup"
            ? { date: d, type: "makeup", sourceDate: this.sourceDate }
            : { date: d, type: "holiday" };
          list.push(ov);
        }
        p.settings.dayOverrides = list;
        void p.saveSettings().then(() => { this.onSaved(); this.close(); });
      });
  }

  onClose() { this.contentEl.empty(); }
}

export class ClassScheduleSettingTab extends PluginSettingTab {
  plugin: ClassSchedulePlugin;

  constructor(app: App, plugin: ClassSchedulePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const scroller = this.scrollerEl();
    const top = scroller?.scrollTop ?? 0;
    this.render();
    if (scroller) {
      window.requestAnimationFrame(() => { scroller.scrollTop = top; });
    }
  }

  /** Nearest scrollable ancestor of the settings content — keeps position on re-render. */
  private scrollerEl(): HTMLElement | null {
    let el = this.containerEl.parentElement;
    while (el) {
      if (el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  }

  hide(): void {
    this.plugin.flushPendingSave().catch(err => {
      console.error("Class Schedule: flushPendingSave on settings hide failed.", err);
    });
  }

  private render() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("cs-settings");
    const p = this.plugin;

    // ── Language ───────────────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.lang")).setDesc(p.t("settings.langDesc"))
      .addDropdown(d => {
        const opts: Array<[LangSetting, string]> = [
          ["auto", p.t("settings.lang.auto")],
          ["zh", p.t("settings.lang.zh")],
          ["en", p.t("settings.lang.en")],
        ];
        for (const [v, label] of opts) d.addOption(v, label);
        d.setValue(p.data.lang).onChange(async (v: LangSetting) => {
          p.setLangSetting(v);
          await p.saveSettings();
          p.refreshViews();
          this.display();
        });
      });

    // ── Semesters ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.semesters")).setDesc(p.t("settings.semestersDesc")).setHeading();

    for (const sem of p.data.semesters) {
      const row = new Setting(containerEl)
        .setName(sem.name + (sem.id === p.data.activeSemesterId ? `  ·  ${p.t("settings.semester.active")}` : ""))
        .addButton(b => b.setButtonText(p.t("settings.semester.switch")).onClick(() => {
          void p.switchSemester(sem.id).then(() => this.display());
        }))
        .addButton(b => b.setIcon("pencil").setTooltip(p.t("settings.semester.rename")).onClick(() => {
          new TextPromptModal(p.app, p.t("settings.semester.rename"), sem.name, p.t("settings.semester.namePh"),
            (name) => { void p.renameSemester(sem.id, name).then(() => this.display()); }).open();
        }));
      if (p.data.semesters.length > 1) {
        row.addButton(b => b.setIcon("trash-2").setTooltip(p.t("settings.semester.delete")).onClick(() => {
          new ConfirmModal(p.app, p.t("settings.semester.deleteConfirm", { name: sem.name }),
            () => { void p.deleteSemester(sem.id).then(() => this.display()); },
            p.t("common.delete")).open();
        }));
      }
    }

    new Setting(containerEl).addButton(b => b.setButtonText(p.t("settings.semester.add")).setCta().onClick(() => {
      new TextPromptModal(p.app, p.t("settings.semester.add"), "", p.t("settings.semester.namePh"),
        (name) => { void p.createSemester(name).then(() => this.display()); }).open();
    }));

    // ── Dates ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.dates")).setHeading();
    new Setting(containerEl).setName(p.t("settings.startDate")).setDesc(p.t("settings.startDateDesc"))
      .addText(t => t.setValue(p.settings.startDate).onChange(v => {
        if (isValidIsoDate(v)) { p.settings.startDate = v; p.requestSave(); }
      }));
    new Setting(containerEl).setName(p.t("settings.endDate")).setDesc(p.t("settings.endDateDesc"))
      .addText(t => t.setValue(p.settings.endDate).onChange(v => {
        if (isValidIsoDate(v)) { p.settings.endDate = v; p.requestSave(); }
      }));

    // ── School days ────────────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.schoolDays")).setHeading();
    for (const k of DAY_KEYS) {
      new Setting(containerEl).setName(p.t("day." + k)).addToggle(t => {
        t.setValue(p.settings.schoolDays.includes(k)).onChange(on => {
          const set = new Set(p.settings.schoolDays);
          if (on) set.add(k); else set.delete(k);
          p.settings.schoolDays = DAY_KEYS.filter(d => set.has(d));
          p.requestSave();
        });
      });
    }

    // ── Custom lesson time ─────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.customTime")).setDesc(p.t("settings.customTimeDesc"))
      .addToggle(t => t.setValue(!!p.settings.useCustomTime).onChange(on => {
        p.settings.useCustomTime = on;
        void p.saveSettings();
      }));

    // ── Appearance ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.compact")).setDesc(p.t("settings.compactDesc"))
      .addToggle(t => t.setValue(p.compact).onChange(on => {
        p.compact = on;
        void p.saveSettings();
        p.refreshViews();
      }));
    new Setting(containerEl).setName(p.t("settings.zoom")).setDesc(p.t("settings.zoomDesc"))
      .addSlider(s => s.setLimits(60, 240, 5).setValue(p.getGridScale()).setDynamicTooltip()
        .onChange(v => { p.setGridScale(v); }));
    new Setting(containerEl).addButton(b => b.setButtonText(p.t("cmd.exportIcal")).setCta()
      .onClick(() => { void p.exportIcal(); }));

    // ── Periods ────────────────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.periods")).setDesc(p.t("settings.periodsDesc")).setHeading();
    for (const period of [...p.settings.periods]) {
      const row = new Setting(containerEl)
        .setName(period.name)
        .addText(t => t.setPlaceholder(p.t("settings.period.namePh")).setValue(period.name).onChange(v => {
          period.name = v; p.requestSave(); row.setName(v || "—");
        }))
        .addText(t => t.setPlaceholder("08:00").setValue(period.start).onChange(v => {
          const n = normalizeTime(v);
          if (n) { period.start = n; p.requestSave(); }
        }))
        .addText(t => t.setPlaceholder("09:40").setValue(period.end).onChange(v => {
          const n = normalizeTime(v);
          if (n) { period.end = n; p.requestSave(); }
        }))
        .addButton(b => b.setIcon("trash-2").onClick(() => {
          p.settings.periods = p.settings.periods.filter(x => x.id !== period.id);
          p.settings.timetable = p.settings.timetable.filter(s => s.periodId !== period.id);
          void p.saveSettings().then(() => this.display());
        }));
    }
    new Setting(containerEl).addButton(b => b.setButtonText(p.t("settings.period.add")).setCta().onClick(() => {
      p.settings.periods.push({
        id: "period-" + Date.now(),
        name: p.t("settings.period.namePh"),
        start: "08:00",
        end: "09:40",
      });
      void p.saveSettings().then(() => this.display());
    }));

    // ── Courses ────────────────────────────────────────────────────────────
    const totalCredits = p.settings.courses.reduce((sum, c) => sum + (c.credits ?? 0), 0);
    const creditsDesc = totalCredits > 0
      ? p.t("settings.coursesDesc") + " — " + p.t("settings.totalCredits", { n: totalCredits })
      : p.t("settings.coursesDesc");
    new Setting(containerEl).setName(p.t("settings.courses")).setDesc(creditsDesc).setHeading();
    for (const course of [...p.settings.courses]) {
      const creditSuffix = course.credits ? ` · ${course.credits}${p.t("course.creditsShort")}` : "";
      const row = new Setting(containerEl)
        .setName(`${course.emoji ?? ""} ${course.name}${creditSuffix}`)
        .addButton(b => b.setButtonText(p.t("settings.course.edit")).onClick(() => {
          new CourseFormModal(p.app, p, course, () => this.display()).open();
        }))
        .addButton(b => b.setIcon("trash-2").onClick(() => {
          new ConfirmModal(p.app, p.t("settings.course.deleteConfirm", { name: course.name }),
            () => {
              p.removeCourse(course.id);
              void p.saveSettings().then(() => this.display());
            },
            p.t("common.delete")).open();
        }));
      const desc = [course.teacher, course.classroom].filter(Boolean).join(" · ");
      if (desc) row.setDesc(desc);
    }
    new Setting(containerEl).addButton(b => b.setButtonText(p.t("settings.course.add")).setCta().onClick(() => {
      new CourseFormModal(p.app, p, null, () => this.display()).open();
    }));

    // ── Day overrides (调休) ───────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.dayOverrides")).setDesc(p.t("settings.dayOverridesDesc")).setHeading();
    for (const ov of [...(p.settings.dayOverrides ?? [])]) {
      const label = ov.type === "holiday"
        ? p.t("settings.dayOverride.holiday")
        : p.t("settings.dayOverride.makeup") + " ← " + (ov.sourceDate ?? "?");
      new Setting(containerEl)
        .setName(ov.date)
        .setDesc(label)
        .addButton(b => b.setIcon("trash-2").onClick(() => {
          new ConfirmModal(p.app, p.t("settings.dayOverride.deleteConfirm"), () => {
            p.settings.dayOverrides = (p.settings.dayOverrides ?? []).filter(o => o.date !== ov.date);
            void p.saveSettings().then(() => this.display());
          }, p.t("common.delete")).open();
        }));
    }
    new Setting(containerEl).addButton(b => b.setButtonText(p.t("settings.dayOverride.add")).setCta().onClick(() => {
      new DayOverrideModal(p.app, p, () => this.display()).open();
    }));

    // ── One-off events (临时事件) ──────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.events")).setDesc(p.t("settings.eventsDesc")).setHeading();
    for (const ev of [...(p.settings.events ?? [])]) {
      const period = p.settings.periods.find(x => x.id === ev.periodId);
      new Setting(containerEl)
        .setName(`${ev.date} · ${period?.name ?? ev.periodId}`)
        .setDesc(ev.title)
        .addButton(b => b.setIcon("pencil").onClick(() => {
          new EventModal(p.app, p, { event: ev, onSaved: () => this.display() }).open();
        }))
        .addButton(b => b.setIcon("trash-2").onClick(() => {
          new ConfirmModal(p.app, p.t("event.deleteConfirm"), () => {
            p.settings.events = (p.settings.events ?? []).filter(e => e.id !== ev.id);
            void p.saveSettings().then(() => this.display());
          }, p.t("common.delete")).open();
        }));
    }
    new Setting(containerEl).addButton(b => b.setButtonText(p.t("event.add")).setCta().onClick(() => {
      new EventModal(p.app, p, { onSaved: () => this.display() }).open();
    }));

    // ── Reset / about ──────────────────────────────────────────────────────
    new Setting(containerEl).setName(p.t("settings.about")).setDesc(p.t("settings.aboutDesc")).setHeading();
    new Setting(containerEl).setName(p.t("settings.dataReset")).setDesc(p.t("settings.dataResetDesc"))
      .addButton(b => b.setButtonText(p.t("common.delete")).setClass("cs-btn--danger").onClick(() => {
        new ConfirmModal(p.app, p.t("settings.dataResetConfirm"), async () => {
          p.data = {
            ...DEFAULT_DATA,
            lang: p.data.lang,
            semesters: DEFAULT_DATA.semesters.map(s => ({ ...s, periods: s.periods.map(x => ({ ...x })) })),
          };
          p.data.activeSemesterId = p.data.semesters[0].id;
          p.settings = p.data.semesters[0];
          await p.saveSettings();
          this.display();
        }, p.t("common.delete")).open();
      }));
  }
}

/** Inclusive list of ISO dates from start to end. */
function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T12:00:00");
  const last = new Date(end + "T12:00:00");
  while (d.getTime() <= last.getTime()) {
    out.push(localIso(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
