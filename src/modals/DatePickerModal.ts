import { App, Modal, Platform, setIcon } from "obsidian";
import { localIso } from "../utils/weekUtils";

export interface DatePickerOptions {
  value?: string;
  min?: string;
  max?: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onPick: (iso: string) => void;
}

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/** Month-grid date picker, Monday-start, fixed six-week grid. */
export class DatePickerModal extends Modal {
  private opts: DatePickerOptions;
  private month: Date;
  private readonly selected: string;

  constructor(app: App, opts: DatePickerOptions) {
    super(app);
    this.opts = opts;
    const base = opts.value ? new Date(opts.value + "T12:00:00") : new Date();
    this.month = new Date(base.getFullYear(), base.getMonth(), 1);
    this.selected = opts.value ?? "";
  }

  onOpen() {
    this.modalEl.addClass("cs-datepicker-modal");
    if (Platform.isMobile) this.modalEl.addClass("cs-datepicker-modal--mobile");
    this.render();
  }

  private shift(n: number) {
    this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1);
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cs-datepicker");

    const todayIso = localIso(new Date());
    const viewMonth = this.month.getMonth();

    const head = contentEl.createDiv("cs-datepicker-head");
    const prev = head.createEl("button", { cls: "cs-datepicker-nav" });
    prev.setAttribute("aria-label", this.opts.t("datepicker.prevMonth"));
    setIcon(prev, "arrow-left");
    prev.addEventListener("click", () => this.shift(-1));

    head.createSpan({
      cls: "cs-datepicker-title",
      text: this.month.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    });

    const next = head.createEl("button", { cls: "cs-datepicker-nav" });
    next.setAttribute("aria-label", this.opts.t("datepicker.nextMonth"));
    setIcon(next, "arrow-right");
    next.addEventListener("click", () => this.shift(1));

    const dow = contentEl.createDiv("cs-datepicker-dow");
    for (const d of DOW) dow.createSpan({ text: d });

    const grid = contentEl.createDiv("cs-datepicker-grid");
    const lead = (this.month.getDay() + 6) % 7;
    const start = new Date(this.month.getFullYear(), this.month.getMonth(), 1 - lead);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = localIso(d);
      const inRange = (!this.opts.min || iso >= this.opts.min) && (!this.opts.max || iso <= this.opts.max);
      const cell = grid.createEl("button", { cls: "cs-datepicker-day", text: String(d.getDate()) });
      if (d.getMonth() !== viewMonth) cell.addClass("cs-datepicker-day--adjacent");
      if (iso === this.selected) cell.addClass("cs-datepicker-day--sel");
      if (iso === todayIso) cell.addClass("cs-datepicker-day--today");
      if (!inRange) { cell.disabled = true; }
      else cell.addEventListener("click", () => { this.opts.onPick(iso); this.close(); });
    }

    const foot = contentEl.createDiv("cs-datepicker-foot");
    const label = foot.createSpan({ cls: "cs-datepicker-selected" });
    if (this.selected) {
      const sd = new Date(this.selected + "T12:00:00");
      label.setText(this.opts.t("datepicker.selected", {
        date: sd.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      }));
    }
    const today = foot.createEl("button", { cls: "cs-btn cs-datepicker-today", text: this.opts.t("datepicker.today") });
    today.addEventListener("click", () => {
      const t = localIso(new Date());
      const clamped = this.opts.min && t < this.opts.min ? this.opts.min
        : this.opts.max && t > this.opts.max ? this.opts.max : t;
      this.opts.onPick(clamped);
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}
