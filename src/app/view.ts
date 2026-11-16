import type { AppContext } from "../app/context";
import type { AppEvent } from "../state/app-state";

export interface View {
  mount(container: HTMLElement): void;
  destroy(): void;
}

export abstract class BaseView implements View {
  protected root!: HTMLElement;
  private readonly controller = new AbortController();
  private readonly unsubscribers: (() => void)[] = [];

  constructor(protected readonly ctx: AppContext) {}

  mount(container: HTMLElement): void {
    this.root = container;
    this.init();
    this.render();
  }

  destroy(): void {
    this.controller.abort();
    for (const un of this.unsubscribers.splice(0)) un();
    this.onDestroy();
  }

  protected init(): void {}
  protected onDestroy(): void {}
  protected abstract render(): void;

  protected watch(event: AppEvent, fn: () => void): void {
    this.unsubscribers.push(this.ctx.bus.on(event, fn));
  }

  protected listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document | Window,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, fn as EventListener, {
      signal: this.controller.signal,
    });
  }
}
