import { App, Modal, Notice } from "obsidian";
import type ClassSchedulePlugin from "../main";
import { COURSE_EMOJIS } from "../settings";
import ColourPickerComponent from "./ColourPickerComponent.svelte";

/** Minimal text-input modal — window.prompt() is disabled inside Obsidian. */
export class TextPromptModal extends Modal {
  private title: string;
  private initial: string;
  private placeholder: string;
  private onSubmit: (value: string) => void;

  constructor(app: App, title: string, initial: string, placeholder: string, onSubmit: (value: string) => void) {
    super(app);
    this.title = title;
    this.initial = initial;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.title);
    const input = contentEl.createEl("input", { type: "text", cls: "cs-prompt-input" });
    input.value = this.initial;
    input.placeholder = this.placeholder;
    const submit = () => {
      const v = input.value.trim();
      if (!v) { new Notice(this.placeholder); return; }
      this.close();
      this.onSubmit(v);
    };
    input.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter") submit(); });
    const footer = contentEl.createDiv("cs-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "cs-btn" })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { text: "Save", cls: "cs-btn cs-btn--primary" })
      .addEventListener("click", submit);
    window.setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  onClose() { this.contentEl.empty(); }
}

/** Confirmation dialog — window.confirm() is discouraged in plugins. */
export class ConfirmModal extends Modal {
  private message: string;
  private confirmLabel: string;
  private onConfirm: () => void | Promise<void>;

  constructor(app: App, message: string, onConfirm: () => void | Promise<void>, confirmLabel = "Confirm") {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.confirmLabel = confirmLabel;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Are you sure?");
    contentEl.createEl("p", { text: this.message, cls: "setting-item-description" });
    const footer = contentEl.createDiv("cs-modal-footer");
    footer.createEl("button", { text: "Cancel", cls: "cs-btn" })
      .addEventListener("click", () => this.close());
    footer.createEl("button", { text: this.confirmLabel, cls: "cs-btn cs-btn--primary" })
      .addEventListener("click", () => {
        this.close();
        void this.onConfirm();
      });
  }

  onClose() { this.contentEl.empty(); }
}

/** Run a destructive action behind a confirmation dialog. */
export function confirmDelete(
  plugin: ClassSchedulePlugin,
  message: string,
  onConfirm: () => void | Promise<void>,
): void {
  new ConfirmModal(plugin.app, message, onConfirm, plugin.t("common.delete")).open();
}

/** Modal wrapper around the shared colour-picker Svelte component. */
export class ColourPickerModal extends Modal {
  private initialColour: string;
  private label: string;
  private onSave: (colour: string) => Promise<void>;
  private saveLabel: string;
  private cancelLabel: string;

  constructor(
    app: App,
    initialColour: string,
    label: string,
    onSave: (colour: string) => Promise<void>,
    saveLabel = "Save colour",
    cancelLabel = "Cancel",
  ) {
    super(app);
    this.initialColour = initialColour;
    this.label = label;
    this.onSave = onSave;
    this.saveLabel = saveLabel;
    this.cancelLabel = cancelLabel;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.label);
    const target = contentEl.createDiv("cs-colour-target");
    new ColourPickerComponent({
      target,
      props: {
        initialColour: this.initialColour,
        label: this.label,
        saveLabel: this.saveLabel,
        cancelLabel: this.cancelLabel,
        onSave: async (colour: string) => { await this.onSave(colour); this.close(); },
        onCancel: () => this.close(),
      },
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ── Emoji picker ─────────────────────────────────────────────────────────────

let _activeEmojiCleanup: (() => void) | null = null;

export function closeEmojiPicker() {
  _activeEmojiCleanup?.();
}

export function openEmojiPicker(
  anchor: HTMLElement,
  current: string,
  onSelect: (emoji: string) => void,
) {
  closeEmojiPicker();

  const popup = activeDocument.body.createDiv("cs-emoji-popup");

  const cleanup = () => {
    activeDocument.removeEventListener("click", onDocClick, true);
    activeDocument.removeEventListener("keydown", onKeyDown, true);
    popup.remove();
    if (_activeEmojiCleanup === cleanup) _activeEmojiCleanup = null;
  };
  const onDocClick = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node)) cleanup();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") cleanup();
  };

  for (const emoji of COURSE_EMOJIS) {
    const btn = popup.createEl("button", { text: emoji, cls: "cs-emoji-option" });
    if (emoji === current) btn.addClass("cs-emoji-option--active");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(emoji);
      cleanup();
    });
  }

  const rect = anchor.getBoundingClientRect();
  const popupWidth = 220;
  const popupHeight = 180;
  let top = rect.bottom + 4;
  let left = rect.left;
  if (top + popupHeight > window.innerHeight) top = rect.top - popupHeight - 4;
  if (left + popupWidth > window.innerWidth) left = window.innerWidth - popupWidth - 8;
  popup.setCssStyles({ top: top + "px" });
  popup.setCssStyles({ left: left + "px" });

  window.setTimeout(() => {
    activeDocument.addEventListener("click", onDocClick, true);
    activeDocument.addEventListener("keydown", onKeyDown, true);
  }, 0);
  _activeEmojiCleanup = cleanup;
}
