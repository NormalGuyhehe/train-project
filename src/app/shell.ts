import { isFinished } from "../core/rules";
import type { User } from "../core/types";
import type { AppContext, Route } from "./context";
import { h, replace } from "../ui/dom";
import { icon } from "../ui/icons";
import { avatar, button, iconButton } from "../ui/controls";
import { currentTheme, initTheme, toggleTheme } from "../ui/theme";

export class AppShell {
  readonly content: HTMLElement;
  private readonly header: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly mobileNav: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private route: Route = "home";

  constructor(
    private readonly ctx: AppContext,
    root: HTMLElement,
  ) {
    initTheme();

    this.bannerText = h("span", {
      text: "Нет соединения — показаны сохранённые данные",
    });
    this.banner = h(
      "div",
      { class: "net-banner", attrs: { role: "alert" } },
      this.bannerText,
      button({
        label: "Повторить",
        tone: "ghost",
        small: true,
        onClick: () => {
          void this.ctx.state.refresh();
        },
      }),
    );

    this.header = h("header", { class: "top" });
    this.content = h("main", { class: "main" });
    this.footer = h(
      "footer",
      { class: "foot" },
      h("span", { text: "АТЛЕТ · учебный проект · данные на сервере" }),
    );
    this.mobileNav = h("nav", {
      class: "mob-nav",
      attrs: { "aria-label": "Мобильная навигация" },
    });
    root.append(
      this.banner,
      this.header,
      this.content,
      this.footer,
      this.mobileNav,
    );

    this.ctx.bus.on("auth", () => this.sync(this.route));
    this.ctx.bus.on("users", () => this.renderHeader());
    this.ctx.bus.on("bookings", () => this.renderHeader());
    this.ctx.bus.on("sessions", () => this.renderHeader());
    this.ctx.bus.on("sync", () => this.syncBanner());
    window.addEventListener("online", () => this.networkChanged(true));
    window.addEventListener("offline", () => this.networkChanged(false));
    this.syncBanner();
  }

  sync(route: Route): void {
    this.route = route;
    this.content.className =
      "main " +
      (route === "home"
        ? "main-landing"
        : route === "admin"
          ? "main-admin"
          : "main-app");
    this.footer.hidden = route === "home" || route === "auth";
    this.renderHeader();
    this.renderMobileNav();
    this.syncBanner();
  }

  private themeButton(): HTMLButtonElement {
    const btn = iconButton(
      currentTheme() === "dark" ? "sun" : "moon",
      "Сменить тему",
      () => {
        const next = toggleTheme();
        replace(btn, icon(next === "dark" ? "sun" : "moon", 18));
      },
    );
    return btn;
  }

  private brand(suffix = ""): HTMLElement {
    return h(
      "button",
      {
        class: "brand",
        attrs: { type: "button", "aria-label": "АТЛЕТ — на главную" },
        on: { click: () => this.ctx.navigate("home") },
      },
      h("span", { class: "logo-mark" }, icon("dumbbell", 22)),
      h("span", {
        class: "brand-name",
        text: suffix ? `АТЛЕТ ${suffix}` : "АТЛЕТ",
      }),
    );
  }

  private renderHeader(): void {
    const user = this.ctx.auth.currentUser();
    let variant: string;
    let items: HTMLElement[];

    if (this.route === "auth") {
      variant = "top-public";
      items = [
        this.brand(),
        h(
          "div",
          { class: "top-actions" },
          button({
            label: "На главную",
            tone: "ghost",
            small: true,
            icon: "arrow-left",
            onClick: () => this.ctx.navigate("home"),
          }),
          this.themeButton(),
        ),
      ];
    } else if (this.route === "home") {
      variant = "top-public";
      const anchor = (id: string, label: string): HTMLElement =>
        h("button", {
          class: "nav-link",
          attrs: { type: "button" },
          text: label,
          on: {
            click: () =>
              document
                .getElementById(id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
        });
      items = [
        this.brand(),
        h(
          "nav",
          { class: "nav nav-public", attrs: { "aria-label": "Разделы" } },
          anchor("directions", "Направления"),
          anchor("trainers", "Тренеры"),
          anchor("pricing", "Цены"),
        ),
        h(
          "div",
          { class: "top-actions" },
          button({
            label: user ? "В расписание" : "Войти",
            tone: "primary",
            small: true,
            onClick: () => this.ctx.navigate(user ? "schedule" : "auth"),
          }),
          this.themeButton(),
        ),
      ];
    } else if (this.route === "admin" && user) {
      variant = "top-admin";
      items = [
        this.brand("ADMIN"),
        h(
          "div",
          { class: "top-actions" },
          button({
            label: "На сайт",
            tone: "ghost",
            small: true,
            icon: "arrow-left",
            onClick: () => this.ctx.navigate("schedule"),
          }),
          this.themeButton(),
          this.userChip(user),
        ),
      ];
    } else if (user) {
      variant = "top-app";
      const upcoming = this.upcomingCount();
      const navBtn = (
        route: Route,
        label: string,
        name: "calendar" | "ticket",
        badge = 0,
      ): HTMLElement =>
        h(
          "button",
          {
            class: `nav-btn${this.route === route ? " active" : ""}`,
            attrs: {
              type: "button",
              ...(this.route === route ? { "aria-current": "page" } : {}),
            },
            on: { click: () => this.ctx.navigate(route) },
          },
          icon(name, 20),
          h("span", { text: label }),
          badge > 0 ? h("em", { class: "badge", text: String(badge) }) : null,
        );
      items = [
        this.brand(),
        h(
          "nav",
          { class: "nav", attrs: { "aria-label": "Основная навигация" } },
          navBtn("schedule", "Расписание", "calendar"),
          navBtn("bookings", "Мои записи", "ticket", upcoming),
        ),
        h(
          "div",
          { class: "top-actions" },
          this.themeButton(),
          this.userChip(user),
        ),
      ];
    } else {
      variant = "top-public";
      items = [
        this.brand(),
        h("div", { class: "top-actions" }, this.themeButton()),
      ];
    }

    this.header.className = `top ${variant}`;
    replace(this.header, h("div", { class: "top-inner" }, ...items));
  }

  private userChip(user: User): HTMLElement {
    return h(
      "div",
      { class: "user-chip" },
      avatar(user.name),
      h("span", { class: "user-name", text: user.name }),
      iconButton("logout", "Выйти", () => {
        void this.ctx.auth.logout();
      }),
    );
  }

  private upcomingCount(): number {
    const now = new Date();
    return this.ctx.booking.ofCurrentUser().filter((b) => {
      const s = this.ctx.state.sessionById(b.sessionId);
      return s !== undefined && !isFinished(s, now);
    }).length;
  }

  private networkChanged(online: boolean): void {
    this.syncBanner();
    this.ctx.toasts.show(
      online ? "Соединение восстановлено" : "Соединение потеряно",
      online ? "ok" : "err",
    );
    if (online) void this.ctx.state.refresh();
  }

  private syncBanner(): void {
    const offline = !navigator.onLine;
    const serverDown = navigator.onLine && !this.ctx.state.isSyncOk;
    this.banner.hidden = (!offline && !serverDown) || this.route === "auth";
    this.bannerText.textContent = offline
      ? "Нет соединения — показаны сохранённые данные"
      : "Сервер недоступен — показаны сохранённые данные";
  }
  private renderMobileNav(): void {
    const user = this.ctx.auth.currentUser();
    if (
      !user ||
      this.route === "home" ||
      this.route === "auth" ||
      this.route === "admin"
    ) {
      this.mobileNav.replaceChildren();
      return;
    }
    const upcoming = this.upcomingCount();
    const btn = (
      route: Route,
      label: string,
      name: "calendar" | "ticket",
      badge = 0,
    ): HTMLElement =>
      h(
        "button",
        {
          class: `mob-nav-btn${this.route === route ? " active" : ""}`,
          attrs: {
            type: "button",
            ...(this.route === route ? { "aria-current": "page" } : {}),
          },
          on: { click: () => this.ctx.navigate(route) },
        },
        icon(name, 22),
        h("span", { text: label }),
        badge > 0 ? h("em", { class: "badge", text: String(badge) }) : null,
      );
    replace(
      this.mobileNav,
      btn("schedule", "Расписание", "calendar"),
      btn("bookings", "Записи", "ticket", upcoming),
    );
  }
}
