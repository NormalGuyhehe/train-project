import type { AppContext } from "../app/context";
import { h, replace } from "../ui/dom";
import { icon, type IconName } from "../ui/icons";
import { errorMessage } from "../ui/messages";
import { AUTH_PHOTO } from "../ui/format";
import { BaseView } from "./view";
import { button, iconButton, remoteImg, textInput } from "../ui/controls";
import { currentTheme, toggleTheme } from "../ui/theme";

type Tab = "login" | "register";

let requestedTab: Tab | null = null;
export function requestAuthTab(tab: Tab): void {
  requestedTab = tab;
}

export class AuthView extends BaseView {
  private tab: Tab = "login";
  private busy = false;

  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected init(): void {
    if (requestedTab) {
      this.tab = requestedTab;
      requestedTab = null;
    }
  }

  protected render(): void {
    replace(
      this.root,
      h("div", { class: "auth-wrap" }, this.art(), this.card()),
    );
  }

  private art(): HTMLElement {
    return h(
      "section",
      { class: "auth-art" },
      remoteImg(AUTH_PHOTO, "Зал АТЛЕТ", "auth-photo", () =>
        h("div", { class: "auth-photo-fallback" }),
      ),
      h("span", { class: "logo-mark" }, icon("dumbbell", 22)),
      h("h1", { class: "auth-slogan", text: "Тренируйся по расписанию." }),
      h("p", {
        class: "auth-art-note",
        text: "Пять направлений, два зала и тренеры, которые доводят до результата.",
      }),
      h(
        "ul",
        { class: "auth-points" },
        h("li", {}, icon("check", 16), "Первая тренировка — бесплатно"),
        h("li", {}, icon("check", 16), "Отмена и возврат — в одно касание"),
        h("li", {}, icon("check", 16), "Работает с телефона и компьютера"),
      ),
    );
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

  private card(): HTMLElement {
    return h(
      "section",
      { class: "auth-card" },
      h(
        "div",
        { class: "auth-top" },
        h(
          "button",
          {
            class: "auth-back",
            attrs: { type: "button" },
            on: { click: () => this.ctx.navigate("home") },
          },
          icon("arrow-left", 16),
          "На главную",
        ),
        this.themeButton(),
      ),
      h(
        "div",
        { class: "auth-head" },
        h("h2", { text: this.tab === "login" ? "Вход" : "Регистрация" }),
        h("p", {
          class: "muted",
          text:
            this.tab === "login"
              ? "С возвращением. Продолжи тренировки."
              : "Аккаунт за 20 секунд — без анкеты и звонков.",
        }),
      ),
      h(
        "div",
        { class: "auth-tabs", attrs: { role: "tablist" } },
        this.tabButton("login", "Вход"),
        this.tabButton("register", "Регистрация"),
      ),
      this.tab === "login" ? this.loginForm() : this.registerForm(),
      h("div", { class: "auth-divider" }, "демо-доступ"),
      h(
        "div",
        { class: "auth-demo" },
        button({
          label: "Клиент",
          tone: "ghost",
          small: true,
          onClick: () => {
            void this.submit("client@atlet.kz", "client123");
          },
        }),
        button({
          label: "Админ",
          tone: "ghost",
          small: true,
          onClick: () => {
            void this.submit("admin@atlet.kz", "admin123");
          },
        }),
      ),
      h("p", {
        class: "auth-hint",
        text: "admin@atlet.kz / admin123 · client@atlet.kz / client123",
      }),
    );
  }

  private tabButton(tab: Tab, label: string): HTMLElement {
    return h("button", {
      class: `auth-tab${this.tab === tab ? " active" : ""}`,
      attrs: {
        type: "button",
        role: "tab",
        "aria-selected": String(this.tab === tab),
      },
      text: label,
      on: {
        click: () => {
          this.tab = tab;
          this.render();
        },
      },
    });
  }

  private iconField(
    label: string,
    iconName: IconName,
    input: HTMLElement,
  ): HTMLElement {
    return h(
      "label",
      { class: "auth-field" },
      h("span", { text: label }),
      h("div", { class: "auth-input-wrap" }, icon(iconName, 18), input),
    );
  }

  private loginForm(): HTMLElement {
    const email = textInput({
      type: "email",
      required: true,
      autocomplete: "email",
      placeholder: "you@mail.kz",
    });
    const password = textInput({
      type: "password",
      required: true,
      autocomplete: "current-password",
      placeholder: "••••••••",
    });
    const submit = button({ label: "Войти", type: "submit", wide: true });
    return h(
      "form",
      {
        class: "auth-form",
        on: {
          submit: (e) => {
            e.preventDefault();
            void this.submit(email.value, password.value, submit);
          },
        },
      },
      this.iconField("Email", "mail", email),
      this.iconField("Пароль", "lock", password),
      h("div", { class: "auth-submit" }, submit),
    );
  }

  private registerForm(): HTMLElement {
    const name = textInput({
      type: "text",
      required: true,
      minlength: 2,
      autocomplete: "name",
      placeholder: "Алия Серикова",
    });
    const email = textInput({
      type: "email",
      required: true,
      autocomplete: "email",
      placeholder: "you@mail.kz",
    });
    const password = textInput({
      type: "password",
      required: true,
      minlength: 6,
      autocomplete: "new-password",
      placeholder: "Минимум 6 символов",
    });
    const submit = button({
      label: "Создать аккаунт",
      type: "submit",
      wide: true,
    });
    return h(
      "form",
      {
        class: "auth-form",
        on: {
          submit: (e) => {
            e.preventDefault();
            void this.register(name.value, email.value, password.value, submit);
          },
        },
      },
      this.iconField("Имя и фамилия", "user", name),
      this.iconField("Email", "mail", email),
      this.iconField("Пароль", "lock", password),
      h("div", { class: "auth-submit" }, submit),
    );
  }

  private async submit(
    email: string,
    password: string,
    btn?: HTMLButtonElement,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (btn) btn.disabled = true;
    const r = await this.ctx.auth.login(email, password);
    this.busy = false;
    if (!r.ok) {
      if (btn) btn.disabled = false;
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show(
      `С возвращением, ${r.value.name.split(" ")[0]}!`,
      "ok",
    );
    this.ctx.navigate(r.value.role === "admin" ? "admin" : "schedule");
  }

  private async register(
    name: string,
    email: string,
    password: string,
    btn: HTMLButtonElement,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    btn.disabled = true;
    const r = await this.ctx.auth.register(name, email, password);
    this.busy = false;
    if (!r.ok) {
      btn.disabled = false;
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("Аккаунт создан. Добро пожаловать!", "ok");
    this.ctx.navigate("schedule");
  }
}
