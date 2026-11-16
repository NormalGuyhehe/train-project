import { h } from "./dom";

export type ToastTone = "ok" | "err" | "info";
export interface ToastAction {
  label: string;
  run: () => void;
}

export class ToastCenter {
  private readonly root: HTMLElement;
  constructor(host: HTMLElement) {
    this.root = h("div", { class: "toasts", attrs: { "aria-live": "polite" } });
    host.append(this.root);
  }
  show(message: string, tone: ToastTone = "info", action?: ToastAction): void {
    const toast = h(
      "div",
      { class: `toast toast-${tone}`, attrs: { role: "status" } },
      h("span", { class: "toast-msg", text: message }),
      action
        ? h("button", {
            class: "toast-act",
            attrs: { type: "button" },
            text: action.label,
            on: {
              click: () => {
                action.run();
                dismiss();
              },
            },
          })
        : null,
      h("button", {
        class: "toast-x",
        attrs: { type: "button", "aria-label": "Закрыть" },
        text: "×",
        on: { click: () => dismiss() },
      }),
    );
    let timer = 0;
    const dismiss = (): void => {
      window.clearTimeout(timer);
      toast.classList.add("out");
      window.setTimeout(() => toast.remove(), 200);
    };
    timer = window.setTimeout(dismiss, action ? 7000 : 4200);
    this.root.append(toast);
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
  }
}
