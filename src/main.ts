import { Plugin, Platform } from "obsidian";
import type { Lang, LangSetting, PluginData, Semester } from "./types";
import { DEFAULT_DATA, makeSemester } from "./settings";
import { translate, detectObsidianLang } from "./i18n";
import { buildIcs } from "./utils/icalUtils";
import { WeekView, WEEK_VIEW_TYPE } from "./views/WeekView";
import { ClassScheduleSettingTab } from "./settings/SettingsTab";

export default class ClassSchedulePlugin extends Plugin {
  data: PluginData;
  /** The active semester — what views and settings read/write. */
  settings: Semester;
  /** Resolved interface language. */
  lang: Lang = "en";

  async onload() {
    await this.loadSettings();

    this.registerView(WEEK_VIEW_TYPE, (leaf) => new WeekView(leaf, this));

    this.addRibbonIcon("calendar-days", this.t("ribbon.open"), () => { void this.activateView(); });
    this.addCommand({ id: "open", name: this.t("cmd.open"), callback: () => { void this.activateView(); } });
    this.addCommand({ id: "go-to-current-week", name: this.t("cmd.current-week"), callback: () => this.sendWeekViewCommand("current") });
    this.addCommand({ id: "go-to-previous-week", name: this.t("cmd.prev-week"), callback: () => this.sendWeekViewCommand("prev") });
    this.addCommand({ id: "go-to-next-week", name: this.t("cmd.next-week"), callback: () => this.sendWeekViewCommand("next") });
    this.addCommand({ id: "export-ical", name: this.t("cmd.exportIcal"), callback: () => { void this.exportIcal(); } });

    this.addSettingTab(new ClassScheduleSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      try { this.refreshViews(); }
      catch (err) { console.error("Class Schedule: refreshViews() failed.", err); }
    });
  }

  onunload() {
    this.flushPendingSave().catch(err => {
      console.error("Class Schedule: flushPendingSave on unload failed.", err);
    });
  }

  // ── i18n ─────────────────────────────────────────────────────────────────
  t(key: string, vars?: Record<string, string | number>): string {
    return translate(this.lang, key, vars);
  }

  setLangSetting(l: LangSetting) {
    this.data.lang = l;
    this.resolveLang();
  }

  private resolveLang() {
    this.lang = this.data.lang === "auto" ? detectObsidianLang() : this.data.lang;
  }

  // ── View helpers ─────────────────────────────────────────────────────────
  async activateView() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length > 0) {
      await workspace.revealLeaf(leaves[0]);
    } else {
      const leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: WEEK_VIEW_TYPE, active: true });
      await workspace.revealLeaf(leaf);
    }
  }

  private sendWeekViewCommand(cmd: "prev" | "next" | "current") {
    const leaves = this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE);
    if (leaves.length === 0) { void this.activateView(); return; }
    const view = leaves[0].view;
    if (!(view instanceof WeekView)) return;
    if (cmd === "current") view.goToCurrentWeek();
    if (cmd === "prev")    view.goToPrevWeek();
    if (cmd === "next")    view.goToNextWeek();
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(WEEK_VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof WeekView) leaf.view.onSettingsChange();
    });
  }

  // ── Grid scale ───────────────────────────────────────────────────────────
  getGridScale(): number {
    const n = this.data.gridScale;
    if (typeof n === "number" && n >= 60 && n <= 240) return n;
    return Platform.isMobile ? 150 : 120;
  }

  setGridScale(pxPerHour: number): number {
    const clamped = Math.max(60, Math.min(240, Math.round(pxPerHour)));
    this.data.gridScale = clamped;
    void this.saveSettings();
    this.refreshViews();
    return clamped;
  }

  /** Export the active semester as an .ics file inside the vault. */
  async exportIcal(): Promise<void> {
    const { Notice } = await import("obsidian");
    const sem = this.getActiveSemester();
    if (!sem) { new Notice(this.t("notice.noSemester")); return; }
    const ics = buildIcs(sem);
    const folder = "Class Schedule 导出";
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const safeName = (sem.name || "timetable").replace(/[\\/:*?"<>|]/g, "-");
    const path = `${folder}/${safeName}.ics`;
    const existing = this.app.vault.getFileByPath(path);
    if (existing) {
      await this.app.vault.modify(existing, ics);
    } else {
      await this.app.vault.create(path, ics);
    }
    new Notice(this.t("ical.exported", { path }));
  }

  // ── Global visual prefs ──────────────────────────────────────────────────
  get todayHighlightColour(): string { return "theme:accent"; }

  get settingsMobileMode(): "day" | "agenda" | "grid" {
    return (this.data as PluginData & { mobileMode?: "day" | "agenda" | "grid" }).mobileMode ?? "day";
  }
  set settingsMobileMode(m: "day" | "agenda" | "grid") {
    (this.data as PluginData & { mobileMode?: "day" | "agenda" | "grid" }).mobileMode = m;
  }

  get compact(): boolean {
    return this.data.compact ?? false;
  }
  set compact(v: boolean) {
    this.data.compact = v;
  }

  // ── Semester management ──────────────────────────────────────────────────
  getActiveSemester(): Semester | undefined {
    return this.data.semesters.find(s => s.id === this.data.activeSemesterId);
  }

  private populateSettings() {
    const sem = this.getActiveSemester();
    if (sem) this.settings = sem;
  }

  async createSemester(name: string) {
    const sem = makeSemester({ name });
    this.data.semesters.push(sem);
    this.data.activeSemesterId = sem.id;
    this.populateSettings();
    await this.saveData(this.data);
    this.refreshViews();
  }

  async switchSemester(id: string) {
    if (!this.data.semesters.some(s => s.id === id)) return;
    this.data.activeSemesterId = id;
    this.populateSettings();
    await this.saveData(this.data);
    this.refreshViews();
  }

  async renameSemester(id: string, name: string) {
    const sem = this.data.semesters.find(s => s.id === id);
    if (sem) {
      sem.name = name;
      if (this.settings.id === id) this.settings = sem;
      await this.saveData(this.data);
      this.refreshViews();
    }
  }

  async deleteSemester(id: string) {
    if (this.data.semesters.length <= 1) return;
    this.data.semesters = this.data.semesters.filter(s => s.id !== id);
    if (this.data.activeSemesterId === id) {
      this.data.activeSemesterId = this.data.semesters[0].id;
      this.populateSettings();
    }
    await this.saveData(this.data);
    this.refreshViews();
  }

  /** Delete a course everywhere (settings UI uses this). */
  removeCourse(courseId: string) {
    this.settings.courses = this.settings.courses.filter(c => c.id !== courseId);
    this.settings.timetable = this.settings.timetable.filter(s => s.courseId !== courseId);
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  async loadSettings() {
    const raw = (await this.loadData()) as Partial<PluginData> | null;
    this.data = {
      ...DEFAULT_DATA,
      ...(raw ?? {}),
      semesters: raw?.semesters?.length ? raw.semesters : DEFAULT_DATA.semesters,
    };
    // Normalise optional v0.2/v0.3 fields on persisted semesters.
    for (const sem of this.data.semesters) {
      sem.useCustomTime = sem.useCustomTime ?? false;
      sem.dayOverrides = sem.dayOverrides ?? [];
      sem.events = sem.events ?? [];
      sem.slotExclusions = sem.slotExclusions ?? [];
      if (!sem.schoolDays || sem.schoolDays.length === 0) {
        sem.schoolDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
      }
    }
    if (!this.data.semesters.some(s => s.id === this.data.activeSemesterId)) {
      this.data.activeSemesterId = this.data.semesters[0].id;
    }
    this.populateSettings();
    this.resolveLang();
  }

  async saveSettings() {
    await this.saveData(this.data);
  }

  private saveTimer: number | null = null;

  /** Debounced save — coalesces rapid edits from settings inputs. */
  requestSave() {
    if (this.saveTimer != null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.data).catch(err => {
        console.error("Class Schedule: debounced saveSettings failed.", err);
      });
    }, 400);
  }

  async flushPendingSave() {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveData(this.data);
  }
}
