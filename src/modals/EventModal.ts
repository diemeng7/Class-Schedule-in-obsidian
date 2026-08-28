import { App, Modal, Notice, Setting } from "obsidian";
import type ClassSchedulePlugin from "../main";
import type { OneOffEvent } from "../types";
import { isValidIsoDate } from "../utils/scheduleUtils";
import { ColourPickerModal, ConfirmModal } from "./common";
import { DatePickerModal } from "./DatePickerModal";

export interface EventModalOptions {
  event?: OneOffEvent;
  date?: string;
  periodId?: string;
  onSaved: () => void;
}

/** Add / edit a one-off event (补课 / 讲座 / 班会) on a specific date+period. */
export class EventModal extends Modal {
  private plugin: ClassSchedulePlugin;
  private opts: EventModalOptions;

  private date = "";
  private periodId = "";
  private title = "";
  private colour = "#89b4fa";
  private classroom = "";
  private notes = "";

  constructor(app: App, plugin: ClassSchedulePlugin, opts: EventModalOptions) {
    super(app);
    this.plugin = plugin;
    this.opts = opts;
    const ev = opts.event;
    this.date = ev?.date ?? opts.date ?? plugin.settings.startDate;
    this.periodId = ev?.periodId ?? opts.periodId ?? plugin.settings.periods[0]?.id ?? "";
    this.title = ev?.title ?? "";
    this.colour = ev?.colour ?? "#89b4fa";
    this.classroom = ev?.classroom ?? "";
    this.notes = ev?.notes ?? "";
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.opts.event ? this.plugin.t("event.edit") : this.plugin.t("event.add"));
    const p = this.plugin;

    new Setting(contentEl).setName(p.t("event.title")).addText(t => {
      t.setValue(this.title).onChange(v => { this.title = v; });
    });
    new Setting(contentEl).setName(p.t("event.date")).addText(t => {
      t.setValue(this.date).onChange(v => { this.date = v.trim(); });
    }).addButton(b => b.setButtonText("…").onClick(() => {
      new DatePickerModal(p.app, {
        value: this.date || undefined,
        min: p.settings.startDate,
        max: p.settings.endDate,
        t: (k, v) => p.t(k, v),
        onPick: (iso) => {
          this.date = iso;
          this.contentEl.empty();
          this.onOpen();
        },
      }).open();
    }));
    new Setting(contentEl).setName(p.t("event.period")).addDropdown(d => {
      for (const per of p.settings.periods) d.addOption(per.id, `${per.name} (${per.start}–${per.end})`);
      d.setValue(this.periodId).onChange(v => { this.periodId = v; });
    });
    new Setting(contentEl).setName(p.t("course.classroom")).addText(t => {
      t.setValue(this.classroom).onChange(v => { this.classroom = v; });
    });
    new Setting(contentEl).setName(p.t("course.colour")).addButton(b => {
      b.setButtonText(this.colour).setCta().onClick(() => {
        new ColourPickerModal(p.app, this.colour, p.t("course.colour"), async (c) => {
          this.colour = c;
          b.setButtonText(c);
        }, p.t("common.save"), p.t("common.cancel")).open();
      });
    });
    new Setting(contentEl).setName(p.t("course.notes")).addText(t => {
      t.setValue(this.notes).onChange(v => { this.notes = v; });
    });

    const footer = contentEl.createDiv("cs-modal-footer");
    if (this.opts.event) {
      footer.createEl("button", { cls: "cs-btn cs-btn--danger", text: p.t("common.delete") })
        .addEventListener("click", () => {
          new ConfirmModal(p.app, p.t("event.deleteConfirm"), async () => {
            p.settings.events = (p.settings.events ?? []).filter(e => e.id !== this.opts.event!.id);
            await p.saveSettings();
            this.opts.onSaved();
          }, p.t("common.delete")).open();
        });
    }
    footer.createEl("button", { cls: "cs-btn", text: p.t("common.cancel") })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { cls: "cs-btn cs-btn--primary", text: p.t("common.save") })
      .addEventListener("click", () => { void this.save(); });
  }

  private async save() {
    if (!isValidIsoDate(this.date)) { new Notice(this.plugin.t("settings.startDate") + " YYYY-MM-DD"); return; }
    if (!this.title.trim()) { new Notice(this.plugin.t("event.title")); return; }
    const events = this.plugin.settings.events ?? [];
    if (this.opts.event) {
      const ev = this.opts.event;
      ev.date = this.date;
      ev.periodId = this.periodId;
      ev.title = this.title.trim();
      ev.colour = this.colour;
      ev.classroom = this.classroom.trim() || undefined;
      ev.notes = this.notes.trim() || undefined;
    } else {
      events.push({
        id: "event-" + Date.now(),
        date: this.date,
        periodId: this.periodId,
        title: this.title.trim(),
        colour: this.colour,
        classroom: this.classroom.trim() || undefined,
        notes: this.notes.trim() || undefined,
      });
      this.plugin.settings.events = events;
    }
    await this.plugin.saveSettings();
    this.opts.onSaved();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}
