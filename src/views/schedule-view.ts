import {
  bookingOf,
  filterSessions,
  isFinished,
  seatsLeft,
  seatsTaken,
  sortSessions,
} from "../core/rules";
import {
  DEFAULT_FILTERS,
  WORKOUT_KINDS,
  type ScheduleFilters,
  type TimeOfDay,
  type WorkoutSession,
} from "../core/types";
import type { AppContext } from "../app/context";
import type { FilterPreset } from "../app/saved-views";
import { h, replace } from "../ui/dom";
import {
  dayLabel,
  fmtEndTime,
  fmtFull,
  fmtTime,
  KIND_LABEL,
  plural,
  relativeDay,
} from "../ui/format";
import { icon } from "../ui/icons";
import { errorMessage } from "../ui/messages";
import { BaseView } from "./view";
import {
  button,
  chip,
  coverImg,
  emptyState,
  field,
  iconButton,
  intensityChip,
  kindBadge,
  miniAvatar,
  occupancyBar,
  textInput,
} from "../ui/controls";
const TIME_OPTIONS: { value: TimeOfDay | "all"; label: string }[] = [
  { value: "all", label: "Любое время" },
  { value: "morning", label: "Утро" },
  { value: "day", label: "День" },
  { value: "evening", label: "Вечер" },
];

export class ScheduleView extends BaseView {
  private filters: ScheduleFilters = { ...DEFAULT_FILTERS };
  private daysEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private presetsEl!: HTMLElement;
  private countEl!: HTMLElement;
  private listEl!: HTMLElement;
  private nextEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private sortSelect!: HTMLSelectElement;
  private drawerContent: HTMLElement | null = null;
  private drawerSessionId: string | null = null;
  private closeDrawer: (() => void) | null = null;
  private searchTimer = 0;

  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected init(): void {
    this.watch("sessions", () => {
      this.renderList();
      this.renderNext();
      this.refreshDrawer();
    });
    this.watch("bookings", () => {
      this.renderList();
      this.renderNext();
      this.refreshDrawer();
    });
  }

  protected onDestroy(): void {
    window.clearTimeout(this.searchTimer);
    this.closeDrawer?.();
  }

  protected render(): void {
    this.daysEl = h("div", {
      class: "days",
      attrs: { role: "tablist", "aria-label": "Дни недели" },
    });
    this.chipsEl = h("div", { class: "chips" });
    this.presetsEl = h("div", { class: "presets" });
    this.countEl = h("p", { class: "muted result-count" });
    this.listEl = h("div", { class: "session-list" });
    this.nextEl = h("div", { class: "next-slot" });

    this.searchInput = h("input", {
      class: "search-input",
      attrs: {
        type: "search",
        placeholder: "Тренировка, тренер или зал…",
        "aria-label": "Поиск",
        autocomplete: "off",
      },
      value: this.filters.query,
      on: {
        input: () => {
          window.clearTimeout(this.searchTimer);
          this.searchTimer = window.setTimeout(() => {
            this.filters.query = this.searchInput.value;
            this.renderList();
          }, 150);
        },
      },
    });
    this.sortSelect = h(
      "select",
      {
        class: "input select sort-select",
        attrs: { "aria-label": "Сортировка" },
        value: this.filters.sort,
        on: {
          change: () => {
            this.filters.sort =
              this.sortSelect.value === "seats" ? "seats" : "time";
            this.renderList();
          },
        },
      },
      h("option", { attrs: { value: "time" }, text: "Сначала ранние" }),
      h("option", { attrs: { value: "seats" }, text: "Больше свободных мест" }),
    );

    replace(
      this.root,
      this.hero(),
      this.nextEl,
      this.daysEl,
      h(
        "div",
        { class: "toolbar" },
        h("label", { class: "search" }, icon("search", 18), this.searchInput),
        this.sortSelect,
      ),
      this.chipsEl,
      this.presetsEl,
      this.countEl,
      this.listEl,
    );

    this.renderDays();
    this.renderChips();
    this.renderPresets();
    this.renderList();
    this.renderNext();
  }

  private hero(): HTMLElement {
    const user = this.ctx.auth.currentUser();
    const first = user?.name.split(" ")[0] ?? "";
    return h(
      "section",
      { class: "hero-fit" },
      h(
        "div",
        { class: "hero-copy" },
        h("span", { class: "hero-kicker", text: "Расписание" }),
        h("h1", {
          class: "hero-title",
          text: first ? `Привет, ${first}` : "Тренируйся в своём ритме",
        }),
        h("p", {
          class: "hero-sub",
          text: "Выбери день и тренировку — запись займёт пару секунд.",
        }),
      ),
    );
  }

  private renderNext(): void {
    const now = new Date();
    const upcoming = this.ctx.booking
      .ofCurrentUser()
      .map((b) => this.ctx.state.sessionById(b.sessionId))
      .filter(
        (s): s is WorkoutSession => s !== undefined && !isFinished(s, now),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const next = upcoming[0];
    if (!next) {
      replace(this.nextEl);
      this.nextEl.hidden = true;
      return;
    }
    this.nextEl.hidden = false;
    replace(
      this.nextEl,
      h(
        "div",
        { class: "next-card" },
        h(
          "div",
          { class: "next-info" },
          h("span", { class: "next-label", text: "Ближайшая тренировка" }),
          h("strong", { text: next.title }),
          h("span", {
            class: "muted",
            text: `${relativeDay(next.startsAt, now)}, ${fmtTime(next.startsAt)} · ${next.trainer}`,
          }),
        ),
        button({
          label: "Открыть",
          tone: "ghost",
          small: true,
          onClick: () => this.openDrawer(next.id),
        }),
      ),
    );
  }

  private renderDays(): void {
    const now = new Date();
    replace(
      this.daysEl,
      ...Array.from({ length: 7 }, (_, i) => {
        const label = dayLabel(i, now);
        return h(
          "button",
          {
            class: `day${this.filters.dayOffset === i ? " active" : ""}`,
            attrs: {
              type: "button",
              role: "tab",
              "aria-selected": String(this.filters.dayOffset === i),
            },
            on: {
              click: () => {
                this.filters.dayOffset = i;
                this.renderDays();
                this.renderList();
              },
            },
          },
          h("span", { text: label.top }),
          h("small", { text: label.sub }),
        );
      }),
    );
  }

  private renderChips(): void {
    const kindChips = [
      chip("Все", this.filters.kind === "all", () => {
        this.filters.kind = "all";
        this.renderChips();
        this.renderList();
      }),
      ...WORKOUT_KINDS.map((kind) =>
        chip(KIND_LABEL[kind], this.filters.kind === kind, () => {
          this.filters.kind = kind;
          this.renderChips();
          this.renderList();
        }),
      ),
    ];
    const timeChips = TIME_OPTIONS.map((opt) =>
      chip(opt.label, this.filters.time === opt.value, () => {
        this.filters.time = opt.value;
        this.renderChips();
        this.renderList();
      }),
    );
    replace(
      this.chipsEl,
      ...kindChips,
      h("span", { class: "chips-sep", attrs: { "aria-hidden": "true" } }),
      ...timeChips,
    );
  }

  private renderPresets(): void {
    const presets = this.ctx.savedViews.all();
    replace(
      this.presetsEl,
      presets.length > 0
        ? h("span", { class: "presets-label muted", text: "Сохранённые:" })
        : null,
      ...presets.map((p) =>
        h(
          "span",
          { class: "preset" },
          h("button", {
            class: "preset-apply",
            attrs: { type: "button", title: "Применить фильтр" },
            text: p.name,
            on: { click: () => this.applyPreset(p) },
          }),
          h("button", {
            class: "preset-x",
            attrs: { type: "button", "aria-label": `Удалить фильтр ${p.name}` },
            text: "×",
            on: {
              click: () => {
                this.ctx.savedViews.remove(p.id);
                this.renderPresets();
              },
            },
          }),
        ),
      ),
      button({
        label: "Сохранить фильтр",
        tone: "ghost",
        small: true,
        icon: "bookmark",
        onClick: () => this.openSavePreset(),
      }),
    );
  }

  private applyPreset(p: FilterPreset): void {
    this.filters = { ...DEFAULT_FILTERS, ...p.filters };
    this.searchInput.value = this.filters.query;
    this.sortSelect.value = this.filters.sort;
    this.renderDays();
    this.renderChips();
    this.renderList();
  }

  private openSavePreset(): void {
    const input = textInput({
      type: "text",
      required: true,
      maxlength: 40,
      placeholder: "Например: Йога по утрам",
    });
    const form = h(
      "form",
      {
        on: {
          submit: (e) => {
            e.preventDefault();
            const name = input.value.trim();
            if (!name) return;
            this.ctx.savedViews.save(name, this.filters);
            close();
            this.renderPresets();
            this.ctx.toasts.show("Фильтр сохранён", "ok");
          },
        },
      },
      h("h3", { text: "Сохранить текущий фильтр" }),
      field("Название", input, true),
      h(
        "div",
        { class: "modal-actions" },
        button({ label: "Отмена", tone: "ghost", onClick: () => close() }),
        button({ label: "Сохранить", type: "submit" }),
      ),
    );
    const close = this.ctx.overlays.open(form);
  }

  private renderList(): void {
    const now = new Date();
    const bookings = this.ctx.state.allBookings();
    const list = sortSessions(
      filterSessions(this.ctx.state.allSessions(), this.filters, now),
      this.filters.sort,
      bookings,
    );
    this.countEl.textContent = `${list.length} ${plural(list.length, ["тренировка", "тренировки", "тренировок"])}`;
    if (list.length === 0) {
      replace(
        this.listEl,
        emptyState(
          "Ничего не найдено. Измените фильтры.",
          button({
            label: "Сбросить фильтры",
            tone: "ghost",
            onClick: () => {
              this.filters = {
                ...DEFAULT_FILTERS,
                dayOffset: this.filters.dayOffset,
              };
              this.searchInput.value = "";
              this.sortSelect.value = "time";
              this.renderChips();
              this.renderList();
            },
          }),
        ),
      );
      return;
    }
    replace(this.listEl, ...list.map((s, i) => this.sessionCard(s, i)));
  }

  private sessionCard(s: WorkoutSession, index: number): HTMLElement {
    const now = new Date();
    const bookings = this.ctx.state.allBookings();
    const user = this.ctx.auth.currentUser();
    const left = seatsLeft(s, bookings);
    const mine = user ? bookingOf(bookings, user.id, s.id) : undefined;
    const finished = isFinished(s, now);

    const cover = h(
      "div",
      { class: "card-cover" },
      coverImg(s.kind),
      h("span", { class: "cover-time", text: fmtTime(s.startsAt) }),
    );
    const info = h(
      "div",
      { class: "session-info" },
      h(
        "div",
        { class: "session-top" },
        h("h3", { text: s.title }),
        kindBadge(s.kind),
        intensityChip(s.kind),
      ),
      h(
        "p",
        { class: "muted session-meta" },
        miniAvatar(s.trainer),
        h("span", { text: `${s.trainer} · ${s.room} · ${s.durationMin} мин` }),
      ),
    );

    const action = finished
      ? button({ label: "Завершена", tone: "ghost", disabled: true })
      : mine
        ? button({
            label: "Вы записаны",
            tone: "ok",
            icon: "check",
            onClick: (e) => {
              e.stopPropagation();
              this.openDrawer(s.id);
            },
          })
        : left <= 0
          ? button({ label: "Мест нет", tone: "ghost", disabled: true })
          : button({
              label: "Записаться",
              onClick: (e) => {
                e.stopPropagation();
                void this.book(s.id);
              },
            });

    const taken = seatsTaken(bookings, s.id);
    const pct = s.capacity ? Math.round((taken / s.capacity) * 100) : 0;
    const spotsText = finished
      ? "—"
      : left <= 0
        ? "Мест нет"
        : `${left} ${plural(left, ["место", "места", "мест"])}`;
    const spotsCls = finished
      ? "spots"
      : left <= 0
        ? "spots none"
        : left <= 3
          ? "spots low urgent"
          : "spots";
    const side = h(
      "div",
      { class: "session-side" },
      h("span", { class: spotsCls, text: spotsText }),
      h(
        "div",
        { class: "card-occ" },
        occupancyBar(pct),
        h("span", { text: `${taken}/${s.capacity}` }),
      ),
      action,
    );

    return h(
      "article",
      {
        class: `session-card${finished ? " past" : ""}`,
        style: `animation-delay:${Math.min(index * 40, 240)}ms`,
        attrs: {
          tabindex: "0",
          role: "group",
          "aria-label": `${s.title}, ${fmtTime(s.startsAt)}. Открыть подробности`,
        },
        on: {
          click: () => this.openDrawer(s.id),
          keydown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              this.openDrawer(s.id);
            }
          },
        },
      },
      cover,
      info,
      side,
    );
  }

  private async book(sessionId: string): Promise<void> {
    const r = await this.ctx.booking.book(sessionId);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    const s = this.ctx.state.sessionById(sessionId);
    this.ctx.toasts.show(
      s ? `Вы записаны: ${s.title}, ${fmtFull(s.startsAt)}` : "Вы записаны",
      "ok",
      {
        label: "Отменить",
        run: () => {
          void this.cancel(r.value.id);
        },
      },
    );
  }

  private async cancel(bookingId: string): Promise<void> {
    const r = await this.ctx.booking.cancel(bookingId);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("Запись отменена", "info", {
      label: "Вернуть",
      run: () => {
        void this.restore(r.value);
      },
    });
  }

  private async restore(booking: { sessionId: string }): Promise<void> {
    const r = await this.ctx.booking.book(booking.sessionId);
    this.ctx.toasts.show(
      r.ok ? "Запись восстановлена" : errorMessage(r.error),
      r.ok ? "ok" : "err",
    );
  }

  private openDrawer(sessionId: string): void {
    if (!this.ctx.state.sessionById(sessionId)) return;
    this.drawerSessionId = sessionId;
    this.drawerContent = h("div", { class: "drawer-body" });
    this.fillDrawer();
    this.closeDrawer = this.ctx.overlays.open(
      this.drawerContent,
      "drawer",
      () => {
        this.drawerSessionId = null;
        this.drawerContent = null;
        this.closeDrawer = null;
      },
    );
  }

  private refreshDrawer(): void {
    if (!this.drawerSessionId) return;
    if (!this.ctx.state.sessionById(this.drawerSessionId)) {
      this.closeDrawer?.();
      return;
    }
    this.fillDrawer();
  }

  private fillDrawer(): void {
    if (!this.drawerContent || !this.drawerSessionId) return;
    const s = this.ctx.state.sessionById(this.drawerSessionId);
    if (!s) return;
    const now = new Date();
    const bookings = this.ctx.state.allBookings();
    const user = this.ctx.auth.currentUser();
    const taken = seatsTaken(bookings, s.id);
    const left = seatsLeft(s, bookings);
    const mine = user ? bookingOf(bookings, user.id, s.id) : undefined;
    const finished = isFinished(s, now);
    const pct = s.capacity ? Math.round((taken / s.capacity) * 100) : 0;

    const action = finished
      ? button({
          label: "Тренировка завершена",
          tone: "ghost",
          wide: true,
          disabled: true,
        })
      : mine
        ? button({
            label: "Отменить запись",
            tone: "danger",
            wide: true,
            onClick: () => {
              void this.cancel(mine.id);
            },
          })
        : left <= 0
          ? button({
              label: "Свободных мест нет",
              tone: "ghost",
              wide: true,
              disabled: true,
            })
          : button({
              label: "Записаться",
              wide: true,
              onClick: () => {
                void this.book(s.id);
              },
            });

    const cover = h(
      "div",
      { class: "drawer-cover" },
      coverImg(s.kind, "drawer-cover-img"),
      h(
        "div",
        { class: "drawer-cover-badges" },
        kindBadge(s.kind),
        intensityChip(s.kind),
      ),
      iconButton("x", "Закрыть", () => this.closeDrawer?.()),
    );

    replace(
      this.drawerContent,
      cover,
      h("h2", { text: s.title }),
      h("p", {
        class: "muted",
        text: `${fmtFull(s.startsAt)} · ${s.durationMin} мин`,
      }),
      h(
        "ul",
        { class: "facts" },
        h(
          "li",
          {},
          icon("user", 18),
          h("span", {}, "Тренер: ", h("strong", { text: s.trainer })),
        ),
        h("li", {}, icon("pin", 18), h("span", { text: s.room })),
        h(
          "li",
          {},
          icon("clock", 18),
          h("span", {
            text: `${fmtTime(s.startsAt)}–${fmtEndTime(s.startsAt, s.durationMin)}`,
          }),
        ),
      ),
      h(
        "div",
        { class: "occ" },
        h("div", { class: "occ-bar" }, h("span", { style: `width:${pct}%` })),
        h("p", { class: "muted", text: `Записано ${taken} из ${s.capacity}` }),
      ),
      action,
    );
  }
}
