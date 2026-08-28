import { ItemView, WorkspaceLeaf, ViewStateResult } from "obsidian";
import type ClassSchedulePlugin from "../main";
import WeekViewComponent from "./WeekView.svelte";

export const WEEK_VIEW_TYPE = "class-schedule-week-view";

type WeekViewInstance = WeekViewComponent & {
  prevWeek(): void;
  nextWeek(): void;
  refreshEvents(): void;
};

export class WeekView extends ItemView {
  private plugin: ClassSchedulePlugin;
  private component: WeekViewInstance | null = null;
  private mountTarget: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClassSchedulePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return WEEK_VIEW_TYPE; }
  getDisplayText(): string { return this.plugin.t("week.title"); }
  getIcon(): string { return "calendar-days"; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("cs-root");
    this.mountTarget = container;

    this.app.workspace.onLayoutReady(() => {
      window.requestAnimationFrame(() => this.ensureMounted());
    });

    this.resizeObserver = new ResizeObserver(() => {
      const wasMounted = !!this.component;
      this.ensureMounted();
      if (wasMounted) this.component?.refreshEvents();
    });
    this.resizeObserver.observe(container);

    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.ensureMounted();
      this.component?.refreshEvents();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.ensureMounted();
      this.component?.refreshEvents();
    }));
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    window.requestAnimationFrame(() => {
      this.ensureMounted();
      this.component?.refreshEvents();
    });
  }

  private ensureMounted() {
    if (this.component) return;
    const container = this.mountTarget ?? (this.containerEl.children[1] as HTMLElement | undefined);
    if (!container) return;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return;
    if (!container.hasClass("cs-root")) {
      container.empty();
      container.addClass("cs-root");
    }
    this.mountTarget = container;
    this.component = new WeekViewComponent({
      target: container,
      props: { plugin: this.plugin, initialDate: new Date() },
    }) as WeekViewInstance;
  }

  async onClose() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.component?.$destroy();
    this.component = null;
    this.mountTarget = null;
  }

  goToCurrentWeek()      { this.ensureMounted(); this.component?.$set({ initialDate: new Date() }); }
  goToPrevWeek()         { this.ensureMounted(); this.component?.prevWeek(); }
  goToNextWeek()         { this.ensureMounted(); this.component?.nextWeek(); }
  navigateToWeek(d: Date) { this.ensureMounted(); this.component?.$set({ initialDate: d }); }
  onSettingsChange()     { this.ensureMounted(); this.component?.refreshEvents(); }
}
