import { h } from "./dom";
import { button } from "./controls";

type Variant = "modal" | "drawer";

interface Entry {
  scrim: HTMLElement;
  panel: HTMLElement;
  previousFocus: HTMLElement | null;
  close: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class OverlayHost {
  private readonly stack: Entry[] = [];

  constructor(private readonly host: HTMLElement) {
    document.addEventListener("keydown", (e) => {
      const top = this.stack[this.stack.length - 1];
      if (!top) return;
      if (e.key === "Escape") top.close();
      else if (e.key === "Tab") this.trapFocus(e, top.panel);
    });
  }

  open(
    content: HTMLElement,
    variant: Variant = "modal",
    onClose?: () => void,
  ): () => void {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = h(
      "div",
      {
        class: `panel panel-${variant}`,
        attrs: { role: "dialog", "aria-modal": "true", tabindex: "-1" },
      },
      content,
    );
    const scrim = h("div", { class: `scrim scrim-${variant}` }, panel);
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close();
    });

    const entry: Entry = { scrim, panel, previousFocus, close: () => {} };
    const close = (): void => {
      const idx = this.stack.indexOf(entry);
      if (idx < 0) return;
      this.stack.splice(idx, 1);
      scrim.classList.remove("open");
      window.setTimeout(() => scrim.remove(), 220);
      if (this.stack.length === 0) document.body.classList.remove("no-scroll");
      const below = this.stack[this.stack.length - 1];
      if (below) below.panel.focus();
      else previousFocus?.focus();
      onClose?.();
    };
    entry.close = close;

    this.stack.push(entry);
    this.host.append(scrim);
    document.body.classList.add("no-scroll");
    requestAnimationFrame(() => scrim.classList.add("open"));
    (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
    return close;
  }

  closeActive(): void {
    this.stack[this.stack.length - 1]?.close();
  }

  closeAll(): void {
    while (this.stack.length > 0) this.stack[this.stack.length - 1].close();
  }

  confirm(opts: {
    title: string;
    text: string;
    okLabel?: string;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: boolean): void => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const body = h(
        "div",
        { class: "confirm" },
        h("h3", { text: opts.title }),
        h("p", { class: "muted", text: opts.text }),
        h(
          "div",
          { class: "modal-actions" },
          button({ label: "Отмена", tone: "ghost", onClick: () => close() }),
          button({
            label: opts.okLabel ?? "Удалить",
            tone: "danger",
            onClick: () => {
              done(true);
              close();
            },
          }),
        ),
      );
      const close = this.open(body, "modal", () => done(false));
    });
  }

  private trapFocus(e: KeyboardEvent, panel: HTMLElement): void {
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0,
    );
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
