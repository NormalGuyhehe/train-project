export type Child =
  | Node
  | string
  | number
  | null
  | undefined
  | false
  | readonly Child[];

type Handlers = {
  [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
};

export interface Props {
  class?: string;
  text?: string;
  style?: string;
  attrs?: Record<string, string | number | boolean>;
  dataset?: Record<string, string>;
  on?: Handlers;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.style) el.setAttribute("style", props.style);
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      if (value === false) continue;
      el.setAttribute(name, value === true ? "" : String(value));
    }
  }
  if (props.dataset) Object.assign(el.dataset, props.dataset);
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      if (handler) el.addEventListener(type, handler as EventListener);
    }
  }
  append(el, children);
  if (props.value !== undefined)
    (el as unknown as HTMLInputElement).value = props.value;
  if (props.checked !== undefined)
    (el as unknown as HTMLInputElement).checked = props.checked;
  if (props.disabled !== undefined)
    (el as unknown as HTMLButtonElement).disabled = props.disabled;
  return el;
}

export function append(el: HTMLElement, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else
      el.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  }
}

export function replace(el: HTMLElement, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}
