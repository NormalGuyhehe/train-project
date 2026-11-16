import { WORKOUT_KINDS } from "../core/types";
import type { AppContext } from "../app/context";
import {
  CLUB_INFO,
  DIRECTIONS,
  FAQ,
  formatPrice,
  PLANS,
  REVIEWS,
  TRAINERS,
  type Plan,
} from "../app/content";
import { h, replace } from "../ui/dom";
import { HERO_PHOTO, KIND_LABEL } from "../ui/format";
import { icon } from "../ui/icons";
import { BaseView } from "./view";
import {
  avatar,
  button,
  coverImg,
  intensityChip,
  kindBadge,
  remoteImg,
} from "../ui/controls";
import { requestAuthTab } from "./auth-view";

export class LandingView extends BaseView {
  private observer: IntersectionObserver | null = null;
  private counterObserver: IntersectionObserver | null = null;

  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected init(): void {
    this.watch("auth", () => this.render());
  }

  protected onDestroy(): void {
    this.observer?.disconnect();
    this.counterObserver?.disconnect();
  }

  protected render(): void {
    replace(
      this.root,
      this.promoBar(),
      this.hero(),
      this.marquee(),
      this.directions(),
      this.steps(),
      this.trainers(),
      this.pricing(),
      this.reviews(),
      this.faq(),
      this.ctaBand(),
      this.footer(),
    );
    this.observeReveals();
    this.observeCounters();
  }

  private observeReveals(): void {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            this.observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    this.root
      .querySelectorAll(".reveal")
      .forEach((el) => this.observer?.observe(el));
  }

  private observeCounters(): void {
    this.counterObserver?.disconnect();
    this.counterObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          this.counterObserver?.unobserve(el);
          this.animateCount(el);
        }
      },
      { threshold: 0.4 },
    );
    this.root
      .querySelectorAll<HTMLElement>("[data-count]")
      .forEach((el) => this.counterObserver?.observe(el));
  }

  private animateCount(el: HTMLElement): void {
    const target = Number(el.dataset.count ?? "0");
    const suffix = el.dataset.suffix ?? "";
    const duration = 1100;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = `${Math.round(target * eased)}${suffix}`;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private go(): void {
    if (this.ctx.auth.currentUser()) {
      this.ctx.navigate("schedule");
      return;
    }
    requestAuthTab("register");
    this.ctx.navigate("auth");
  }

  private scrollTo(id: string): void {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private promoBar(): HTMLElement {
    return h(
      "div",
      { class: "promo-bar" },
      h("span", { text: "Первая тренировка — бесплатно" }),
      h("button", {
        class: "promo-link",
        attrs: { type: "button" },
        text: "Записаться →",
        on: { click: () => this.go() },
      }),
    );
  }

  private hero(): HTMLElement {
    const stat = (value: number, suffix: string, label: string): HTMLElement =>
      h(
        "div",
        { class: "hl-stat" },
        h("strong", {
          attrs: { "data-count": String(value), "data-suffix": suffix },
          text: `0${suffix}`,
        }),
        h("span", { text: label }),
      );
    const art = h(
      "div",
      { class: "hl-art" },
      remoteImg(HERO_PHOTO, "Атлет в зале", "hl-athlete", () =>
        h("div", { class: "hl-athlete hl-athlete-fallback" }),
      ),
      h(
        "div",
        { class: "hl-badge" },
        h("strong", { text: "16+" }),
        h("span", { text: "лет и старше" }),
      ),
    );
    return h(
      "section",
      { class: "hl" },
      h(
        "div",
        { class: "hl-inner" },
        h(
          "div",
          { class: "hl-copy" },
          h("span", {
            class: "hl-kicker",
            text: `Спортивный центр · ${CLUB_INFO.city}`,
          }),
          h(
            "h1",
            { class: "hl-title" },
            "Сила.",
            h("br"),
            "Ритм.",
            h("br"),
            h("span", { class: "hl-accent", text: "Результат." }),
          ),
          h("p", {
            class: "hl-sub",
            text: "Пять направлений и расписание, которое подстраивается под тебя. Запись — в два клика, первая тренировка — бесплатно.",
          }),
          h(
            "div",
            { class: "hl-ctas" },
            button({ label: "Записаться бесплатно", onClick: () => this.go() }),
            button({
              label: "Смотреть цены",
              tone: "ghost",
              onClick: () => this.scrollTo("pricing"),
            }),
          ),
          h(
            "div",
            { class: "hl-stats" },
            stat(5, "", "направлений"),
            stat(5, "", "тренеров"),
            stat(7, "", "дней в неделю"),
            stat(1200, "+", "записей"),
          ),
        ),
        art,
      ),
    );
  }

  private marquee(): HTMLElement {
    const text =
      WORKOUT_KINDS.map((k) => KIND_LABEL[k].toUpperCase()).join("  ·  ") +
      "  ·  ";
    return h(
      "div",
      { class: "marquee", attrs: { "aria-hidden": "true" } },
      h(
        "div",
        { class: "marquee-track" },
        h("span", { text }),
        h("span", { text }),
      ),
    );
  }

  private sectionHead(
    kicker: string,
    title: string,
    sub?: string,
  ): HTMLElement {
    return h(
      "div",
      { class: "ls-head reveal" },
      h("span", { class: "ls-kicker", text: kicker }),
      h("h2", { class: "ls-title", text: title }),
      sub ? h("p", { class: "ls-sub", text: sub }) : null,
    );
  }

  private directions(): HTMLElement {
    const cards = DIRECTIONS.map((dir) =>
      h(
        "article",
        { class: "dir-card reveal" },
        h(
          "div",
          { class: "dir-cover" },
          coverImg(dir.kind, "dir-img"),
          h("span", { class: "dir-duration", text: dir.duration }),
        ),
        h(
          "div",
          { class: "dir-body" },
          h(
            "div",
            { class: "dir-badges" },
            kindBadge(dir.kind),
            intensityChip(dir.kind),
          ),
          h("h3", { text: dir.title }),
          h("p", { class: "muted", text: dir.description }),
          button({
            label: "В расписание",
            tone: "ghost",
            small: true,
            onClick: () => this.go(),
          }),
        ),
      ),
    );
    return h(
      "section",
      { class: "ls", attrs: { id: "directions" } },
      this.sectionHead(
        "Направления",
        "Найди свою нагрузку",
        "От спокойной йоги до жёсткого кроссфита — интенсивность видна сразу.",
      ),
      h("div", { class: "dir-grid" }, ...cards),
    );
  }

  private steps(): HTMLElement {
    const items = [
      {
        n: "01",
        title: "Выбери тренировку",
        text: "Расписание на неделю вперёд: день, время, тренер и свободные места — всё видно сразу.",
      },
      {
        n: "02",
        title: "Запишись в два клика",
        text: "Без звонков и анкет. Место бронируется мгновенно, отмена — тоже в один клик.",
      },
      {
        n: "03",
        title: "Приходи и тренируйся",
        text: "Тренер встретит, подберёт нагрузку и доведёт до результата. Первое занятие — бесплатно.",
      },
    ];
    const cards = items.map((s) =>
      h(
        "div",
        { class: "step-card reveal" },
        h("span", { class: "step-num", text: s.n }),
        h("h3", { text: s.title }),
        h("p", { class: "muted", text: s.text }),
      ),
    );
    return h(
      "section",
      { class: "ls ls-alt" },
      this.sectionHead("Как это работает", "Три шага до первой тренировки"),
      h("div", { class: "steps-grid" }, ...cards),
    );
  }

  private trainers(): HTMLElement {
    const cards = TRAINERS.map((t) =>
      h(
        "article",
        { class: `trainer-card reveal k-${t.kind}` },
        remoteImg(t.photo, t.name, "trainer-photo", () => avatar(t.name)),
        h("h3", { text: t.name }),
        h("span", { class: "trainer-role", text: t.role }),
        h("span", { class: "trainer-exp muted", text: t.experience }),
        h("p", { class: "trainer-quote", text: `«${t.quote}»` }),
      ),
    );
    return h(
      "section",
      { class: "ls", attrs: { id: "trainers" } },
      this.sectionHead(
        "Команда",
        "Тренеры, которые доводят до результата",
        "Каждый — специалист в своём направлении, а не универсал «обо всём».",
      ),
      h("div", { class: "trainer-grid" }, ...cards),
    );
  }

  private pricing(): HTMLElement {
    const cards = PLANS.map((plan) => this.priceCard(plan));
    return h(
      "section",
      { class: "ls ls-alt", attrs: { id: "pricing" } },
      this.sectionHead(
        "Абонементы",
        "Честные цены без звёздочек",
        "Первая тренировка бесплатно. Дальше — выбери свой формат.",
      ),
      h("div", { class: "price-grid" }, ...cards),
      h("p", {
        class: "price-note muted",
        text: "Оплата в клубе или онлайн. Заморозка и отмена — без штрафов.",
      }),
    );
  }

  private priceCard(plan: Plan): HTMLElement {
    const features = plan.features.map((f) =>
      h("li", {}, icon("check", 16), h("span", { text: f })),
    );
    return h(
      "article",
      { class: `price-card reveal${plan.popular ? " popular" : ""}` },
      plan.badge ? h("span", { class: "price-badge", text: plan.badge }) : null,
      h("h3", { text: plan.name }),
      h("p", { class: "muted price-tagline", text: plan.tagline }),
      h(
        "div",
        { class: "price-value" },
        h("strong", { text: formatPrice(plan.price) }),
        h("span", { class: "muted", text: plan.period }),
      ),
      h("ul", { class: "feature-list" }, ...features),
      button({
        label: plan.popular ? "Выбрать безлимит" : "Выбрать",
        tone: plan.popular ? "primary" : "ghost",
        wide: true,
        onClick: () => this.onPlan(plan),
      }),
    );
  }

  private onPlan(plan: Plan): void {
    if (!this.ctx.auth.currentUser()) {
      requestAuthTab("register");
      this.ctx.navigate("auth");
      return;
    }
    this.openCheckout(plan);
  }

  private openCheckout(plan: Plan): void {
    const method = (
      value: string,
      label: string,
      checked: boolean,
    ): HTMLElement =>
      h(
        "label",
        { class: "pay-opt" },
        h("input", { attrs: { type: "radio", name: "pay", value }, checked }),
        h("span", { text: label }),
      );
    const form = h(
      "form",
      {
        on: {
          submit: (e) => {
            e.preventDefault();
            close();
            this.ctx.toasts.show(
              `Заявка на «${plan.name}» принята — менеджер свяжется с тобой`,
              "ok",
            );
          },
        },
      },
      h("h3", { text: "Оформление абонемента" }),
      h(
        "div",
        { class: "plan-summary" },
        h(
          "div",
          {},
          h("strong", { text: plan.name }),
          h("span", { class: "muted", text: plan.period }),
        ),
        h("strong", { class: "plan-price", text: formatPrice(plan.price) }),
      ),
      h(
        "div",
        { class: "pay-methods" },
        method("kaspi", "Kaspi QR", true),
        method("card", "Банковская карта", false),
      ),
      h("p", {
        class: "demo-note",
        text: "Демо-режим: онлайн-оплата не подключена. Заявка ни к чему не обязывает.",
      }),
      h(
        "div",
        { class: "modal-actions" },
        button({ label: "Отмена", tone: "ghost", onClick: () => close() }),
        button({ label: "Оставить заявку", type: "submit" }),
      ),
    );
    const close = this.ctx.overlays.open(form);
  }

  private reviews(): HTMLElement {
    const cards = REVIEWS.map((r) =>
      h(
        "article",
        { class: "review-card reveal" },
        h("span", {
          class: "stars",
          text: "★".repeat(r.stars),
          attrs: { "aria-label": `Оценка ${r.stars} из 5` },
        }),
        h("p", { text: `«${r.text}»` }),
        h("strong", { text: r.name }),
      ),
    );
    return h(
      "section",
      { class: "ls" },
      this.sectionHead(
        "Отзывы",
        "Что говорят участники",
        "Демонстрационные отзывы учебного проекта.",
      ),
      h("div", { class: "review-grid" }, ...cards),
    );
  }

  private faq(): HTMLElement {
    const items = FAQ.map((item) =>
      h(
        "details",
        { class: "faq-item reveal" },
        h(
          "summary",
          {},
          h("span", { text: item.q }),
          h("span", {
            class: "faq-mark",
            attrs: { "aria-hidden": "true" },
            text: "+",
          }),
        ),
        h("p", { class: "muted", text: item.a }),
      ),
    );
    return h(
      "section",
      { class: "ls ls-alt" },
      this.sectionHead("Вопросы", "Частые вопросы"),
      h("div", { class: "faq-list" }, ...items),
    );
  }

  private ctaBand(): HTMLElement {
    return h(
      "section",
      { class: "cta-band reveal" },
      h("h2", { text: "Первая тренировка — за наш счёт" }),
      h("p", {
        text: "Выбери направление, запишись онлайн и приходи. Без обязательств.",
      }),
      button({ label: "Записаться бесплатно", onClick: () => this.go() }),
    );
  }

  private footer(): HTMLElement {
    return h(
      "footer",
      { class: "landing-foot" },
      h(
        "div",
        { class: "lf-inner" },
        h(
          "div",
          { class: "lf-brand" },
          h("span", { class: "logo-mark" }, icon("dumbbell", 22)),
          h(
            "div",
            {},
            h("strong", { text: "АТЛЕТ" }),
            h("span", { class: "muted", text: "спортивный центр" }),
          ),
        ),
        h(
          "div",
          { class: "lf-col" },
          h("strong", { text: "Контакты" }),
          h("span", { text: `${CLUB_INFO.city}, ${CLUB_INFO.address}` }),
          h("a", {
            attrs: { href: `tel:${CLUB_INFO.phone.replace(/[^\d+]/g, "")}` },
            text: CLUB_INFO.phone,
          }),
        ),
        h(
          "div",
          { class: "lf-col" },
          h("strong", { text: "Режим работы" }),
          h("span", { text: CLUB_INFO.hours }),
          h("span", { class: "muted", text: "Учебный проект · демо-данные" }),
        ),
      ),
    );
  }
}
