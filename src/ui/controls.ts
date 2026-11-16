import type { Role, WorkoutKind } from "../core/types";
import { h, type Child } from "./dom";
import { coverUrl, KIND_GRADIENT, KIND_INTENSITY, KIND_LABEL } from "./format";
import { icon, type IconName } from "./icons";

export type ButtonTone = "primary" | "ghost" | "danger" | "danger-ghost" | "ok";

export function button(opts: {
  label: string;
  tone?: ButtonTone;
  icon?: IconName;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  wide?: boolean;
  small?: boolean;
  type?: "button" | "submit";
}): HTMLButtonElement {
  const cls = [
    "btn",
    `btn-${opts.tone ?? "primary"}`,
    opts.wide ? "btn-wide" : "",
    opts.small ? "btn-small" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return h(
    "button",
    {
      class: cls,
      attrs: { type: opts.type ?? "button" },
      disabled: opts.disabled,
      on: opts.onClick ? { click: opts.onClick } : undefined,
    },
    opts.icon ? icon(opts.icon, 18) : null,
    h("span", { text: opts.label }),
  );
}

export function iconButton(
  name: IconName,
  label: string,
  onClick: (event: MouseEvent) => void,
  opts?: { danger?: boolean; disabled?: boolean },
): HTMLButtonElement {
  return h(
    "button",
    {
      class: `icon-btn${opts?.danger ? " danger" : ""}`,
      attrs: { type: "button", "aria-label": label, title: label },
      disabled: opts?.disabled,
      on: { click: onClick },
    },
    icon(name, 18),
  );
}

export function chip(
  label: string,
  active: boolean,
  onClick: () => void,
): HTMLButtonElement {
  return h("button", {
    class: `chip-btn${active ? " active" : ""}`,
    attrs: { type: "button", "aria-pressed": String(active) },
    on: { click: onClick },
    text: label,
  });
}

export const kindBadge = (kind: WorkoutKind): HTMLElement =>
  h("span", { class: `chip k-${kind}`, text: KIND_LABEL[kind] });

export const intensityChip = (kind: WorkoutKind): HTMLElement => {
  const meta = KIND_INTENSITY[kind];
  return h("span", {
    class: `intensity i-${meta.level}`,
    text: meta.label,
    attrs: { title: `Интенсивность: ${meta.label.toLowerCase()}` },
  });
};

/** Фото с graceful-фолбэком: при ошибке загрузки — градиентная плашка, не битая картинка. */
export function remoteImg(
  src: string,
  alt: string,
  cls: string,
  makeFallback: () => HTMLElement,
): HTMLImageElement {
  const img = h("img", {
    class: cls,
    attrs: {
      src,
      alt,
      loading: "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer",
    },
  });
  img.addEventListener(
    "error",
    () => {
      img.replaceWith(makeFallback());
    },
    { once: true },
  );
  return img;
}

export const coverImg = (
  kind: WorkoutKind,
  cls = "cover-img",
): HTMLImageElement =>
  remoteImg(coverUrl(kind), KIND_LABEL[kind], cls, () =>
    h(
      "div",
      { class: "cover-fallback", style: `background:${KIND_GRADIENT[kind]}` },
      h("span", { text: KIND_LABEL[kind] }),
    ),
  );

export const miniAvatar = (name: string): HTMLElement =>
  h("span", {
    class: "mini-avatar",
    text: name.charAt(0).toUpperCase(),
    attrs: { "aria-hidden": "true" },
  });

export const roleBadge = (role: Role): HTMLElement =>
  h("span", {
    class: `role-badge ${role}`,
    text: role === "admin" ? "Админ" : "Клиент",
  });

export const avatar = (name: string): HTMLElement =>
  h("span", { class: "avatar", text: name.charAt(0).toUpperCase() });

export const field = (
  label: string,
  input: HTMLElement,
  wide = false,
): HTMLElement =>
  h(
    "label",
    { class: `field${wide ? " span2" : ""}` },
    h("span", { class: "field-label", text: label }),
    input,
  );

export const textInput = (
  attrs: Record<string, string | number | boolean>,
  value?: string,
): HTMLInputElement => h("input", { class: "input", attrs, value });

export const selectInput = (
  options: { value: string; label: string }[],
  value: string,
): HTMLSelectElement =>
  h(
    "select",
    { class: "input select", value },
    ...options.map((o) =>
      h("option", { attrs: { value: o.value }, text: o.label }),
    ),
  );

export const emptyState = (
  text: string,
  action?: HTMLElement,
  iconName: IconName = "search",
): HTMLElement =>
  h(
    "div",
    { class: "empty" },
    icon(iconName, 28),
    h("p", { text }),
    action ?? null,
  );

export const occupancyBar = (pct: number): HTMLElement =>
  h(
    "span",
    { class: `bar${pct >= 100 ? " full" : ""}` },
    h("span", { style: `width:${Math.min(100, Math.max(0, pct))}%` }),
  );

export const statCard = (value: string | number, label: string): HTMLElement =>
  h(
    "div",
    { class: "r-card" },
    h("strong", { text: String(value) }),
    h("span", { text: label }),
  );

export const pageHead = (
  title: string,
  subtitle: string,
  actions?: HTMLElement,
): HTMLElement =>
  h(
    "section",
    { class: "hero" },
    h(
      "div",
      { class: "hero-text" },
      h("h1", { text: title }),
      h("p", { class: "muted", text: subtitle }),
    ),
    actions ?? null,
  );

export interface TableRow {
  class?: string;
  cells: Child[];
  onClick?: () => void;
}

export function dataTable(headers: Child[], rows: TableRow[]): HTMLElement {
  const toCell = (c: Child): HTMLElement =>
    c instanceof HTMLElement && c.tagName === "TD" ? c : h("td", {}, c);
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, ...headers.map((head) => h("th", {}, head)))),
      h(
        "tbody",
        {},
        ...rows.map((row) =>
          h(
            "tr",
            {
              ...(row.class ? { class: row.class } : {}),
              ...(row.onClick ? { on: { click: row.onClick } } : {}),
            },
            ...row.cells.map(toCell),
          ),
        ),
      ),
    ),
  );
}
