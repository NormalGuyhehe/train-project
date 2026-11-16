import type { AppContext, Route } from "./context";
import type { View } from "../views/view";

export type ViewFactory = () => View;
const ROUTES: readonly Route[] = [
  "home",
  "auth",
  "schedule",
  "bookings",
  "admin",
];

export class Router {
  private current: View | null = null;
  private currentRoute: Route | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly host: HTMLElement,
    private readonly factories: Record<Route, ViewFactory>,
    private readonly onRoute: (route: Route) => void,
  ) {}

  start(): void {
    window.addEventListener("hashchange", () => this.resolve());
    this.ctx.bus.on("auth", () => this.resolve());
    this.ctx.bus.on("users", () => this.resolve());
    this.resolve();
  }

  navigate(route: Route): void {
    const hash = `#/${route}`;
    if (location.hash === hash) this.resolve();
    else location.hash = hash;
  }

  private resolve(): void {
    const route = this.guard(this.parse());
    const canonical = `#/${route}`;
    if (location.hash !== canonical) history.replaceState(null, "", canonical);
    this.onRoute(route);
    if (route === this.currentRoute && this.current) return;
    this.current?.destroy();
    this.currentRoute = route;
    this.current = this.factories[route]();
    this.host.replaceChildren();
    this.current.mount(this.host);
    window.scrollTo({ top: 0 });
  }

  private parse(): Route {
    const raw = location.hash.replace(/^#\/?/, "");
    return (ROUTES as readonly string[]).includes(raw)
      ? (raw as Route)
      : "home";
  }

  /** Лендинг доступен всем. Закрыты только auth для авторизованных и admin для не-админов. */
  private guard(requested: Route): Route {
    const user = this.ctx.auth.currentUser();
    if (!user) return requested === "auth" ? "auth" : "home";
    if (requested === "auth")
      return user.role === "admin" ? "admin" : "schedule";
    if (requested === "admin" && user.role !== "admin") return "schedule";
    return requested;
  }
}
