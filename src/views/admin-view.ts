import {
  addDays,
  buildReport,
  dayKey,
  isFinished,
  occupancyPct,
  seatsTaken,
} from "../core/rules";
import {
  WORKOUT_KINDS,
  type Booking,
  type SessionDraft,
  type User,
  type WorkoutSession,
} from "../core/types";
import type { AppContext } from "../app/context";
import { h, replace, type Child } from "../ui/dom";
import {
  downloadText,
  fmtDate,
  fmtFull,
  fmtTime,
  KIND_LABEL,
  relativeDay,
  timeInputValue,
  toCsv,
} from "../ui/format";
import { icon, type IconName } from "../ui/icons";
import { errorMessage } from "../ui/messages";
import { BaseView } from "./view";
import {
  avatar,
  button,
  chip,
  dataTable,
  emptyState,
  field,
  iconButton,
  kindBadge,
  occupancyBar,
  pageHead,
  roleBadge,
  selectInput,
  statCard,
  textInput,
} from "../ui/controls";

type Section = "overview" | "schedule" | "clients" | "reports";

export class AdminView extends BaseView {
  private section: Section = "overview";
  private dayFilter: number | "all" = "all";
  private sessionQuery = "";
  private clientQuery = "";
  private readonly selection = new Set<string>();
  private sectionEl!: HTMLElement;

  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected init(): void {
    this.watch("sessions", () => this.renderSection());
    this.watch("bookings", () => this.renderSection());
    this.watch("users", () => this.renderSection());
  }

  protected render(): void {
    this.sectionEl = h("div", { class: "admin-content" });
    replace(
      this.root,
      h("div", { class: "admin" }, this.sidebar(), this.sectionEl),
    );
    this.renderSection();
  }

  private sidebar(): HTMLElement {
    const item = (id: Section, label: string, name: IconName): HTMLElement =>
      h(
        "button",
        {
          class: `side-btn${this.section === id ? " active" : ""}`,
          attrs: {
            type: "button",
            "aria-current": this.section === id ? "page" : "false",
          },
          on: {
            click: () => {
              this.section = id;
              this.selection.clear();
              this.render();
            },
          },
        },
        icon(name, 18),
        h("span", { text: label }),
      );
    return h(
      "aside",
      { class: "side" },
      h("span", { class: "side-title", text: "Управление" }),
      item("overview", "Обзор", "grid"),
      item("schedule", "Расписание", "calendar"),
      item("clients", "Клиенты", "users"),
      item("reports", "Отчёты", "chart"),
    );
  }

  private renderSection(): void {
    this.pruneSelection();
    if (this.section === "overview") this.renderOverview();
    else if (this.section === "schedule") this.renderSchedule();
    else if (this.section === "clients") this.renderClients();
    else this.renderReports();
  }

  private pruneSelection(): void {
    const ids = new Set(
      this.section === "schedule"
        ? this.ctx.state.allSessions().map((s) => s.id)
        : this.section === "clients"
          ? this.ctx.state.allUsers().map((u) => u.id)
          : [],
    );
    for (const id of [...this.selection])
      if (!ids.has(id)) this.selection.delete(id);
  }

  private sessions(): WorkoutSession[] {
    return [...this.ctx.state.allSessions()].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );
  }

  private searchBox(
    placeholder: string,
    value: string,
    onInput: (v: string) => void,
  ): HTMLElement {
    const input = h("input", {
      class: "search-input",
      attrs: {
        type: "search",
        placeholder,
        "aria-label": placeholder,
        autocomplete: "off",
      },
      value,
      on: { input: () => onInput(input.value) },
    });
    return h(
      "div",
      { class: "toolbar" },
      h("label", { class: "search" }, icon("search", 18), input),
    );
  }

  private bulkBar(onDelete: () => void): HTMLElement {
    return h(
      "div",
      { class: "bulk-bar" },
      h("span", { text: `Выбрано: ${this.selection.size}` }),
      button({
        label: "Удалить",
        tone: "danger",
        small: true,
        icon: "trash",
        onClick: onDelete,
      }),
      button({
        label: "Снять",
        tone: "ghost",
        small: true,
        onClick: () => {
          this.selection.clear();
          this.renderSection();
        },
      }),
    );
  }

  // ---------- Обзор ----------
  private renderOverview(): void {
    const now = new Date();
    const sessions = this.sessions();
    const bookings = this.ctx.state.allBookings();
    const users = this.ctx.state.allUsers();
    const today = dayKey(now);
    const todaySessions = sessions.filter((s) => dayKey(s.startsAt) === today);
    const todayBookings = bookings.filter((b) => {
      const s = this.ctx.state.sessionById(b.sessionId);
      return s !== undefined && dayKey(s.startsAt) === today;
    });
    const weekEnd = addDays(now, 7).getTime();
    const week = sessions.filter((s) => {
      const t = Date.parse(s.startsAt);
      return t >= now.getTime() && t < weekEnd;
    });
    const weekCap = week.reduce((n, s) => n + s.capacity, 0);
    const weekBooked = week.reduce((n, s) => n + seatsTaken(bookings, s.id), 0);
    const weekPct = weekCap ? Math.round((weekBooked / weekCap) * 100) : 0;
    const upcoming = sessions
      .filter((s) => Date.parse(s.startsAt) > now.getTime())
      .slice(0, 5);
    const attention = upcoming.filter(
      (s) =>
        Date.parse(s.startsAt) < now.getTime() + 48 * 3_600_000 &&
        occupancyPct(s, bookings) < 30,
    );

    replace(
      this.sectionEl,
      pageHead("Обзор", "Сводка по центру на сегодня"),
      h(
        "div",
        { class: "report-cards" },
        statCard(todaySessions.length, "тренировок сегодня"),
        statCard(todayBookings.length, "записей сегодня"),
        statCard(users.filter((u) => u.role === "client").length, "клиентов"),
        statCard(`${weekPct}%`, "заполняемость недели"),
      ),
      attention.length > 0
        ? this.attentionPanel(attention, bookings, now)
        : null,
      h(
        "div",
        { class: "grid2" },
        this.upcomingPanel(upcoming, bookings, now),
        this.loadPanel(sessions, bookings, now),
      ),
    );
  }

  private attentionPanel(
    list: WorkoutSession[],
    bookings: readonly Booking[],
    now: Date,
  ): HTMLElement {
    const items = list.map((s) =>
      h(
        "button",
        {
          class: "attn-item",
          attrs: { type: "button" },
          on: { click: () => this.openRoster(s) },
        },
        h("strong", {
          text: `${relativeDay(s.startsAt, now)} ${fmtTime(s.startsAt)}`,
        }),
        h("span", { text: s.title }),
        h("span", { class: "muted", text: `${occupancyPct(s, bookings)}%` }),
      ),
    );
    return h(
      "div",
      { class: "panel-card attn" },
      h("h3", {}, icon("clock", 18), " Требуют внимания"),
      h("p", {
        class: "muted",
        text: "Стартуют в ближайшие 48 часов, заполнены меньше чем на 30%.",
      }),
      h("div", { class: "attn-list" }, ...items),
    );
  }

  private upcomingPanel(
    list: WorkoutSession[],
    bookings: readonly Booking[],
    now: Date,
  ): HTMLElement {
    const rows = list.map((s) =>
      h(
        "div",
        { class: "mini-row" },
        h("span", {
          class: "mini-time",
          text: `${relativeDay(s.startsAt, now)} ${fmtTime(s.startsAt)}`,
        }),
        h("span", { class: "mini-title", text: s.title }),
        occupancyBar(occupancyPct(s, bookings)),
        iconButton("users", "Состав группы", () => this.openRoster(s)),
      ),
    );
    return h(
      "div",
      { class: "panel-card" },
      h("h3", { text: "Ближайшие тренировки" }),
      list.length === 0
        ? h("p", { class: "muted", text: "Нет запланированных тренировок." })
        : h("div", { class: "mini-list" }, ...rows),
    );
  }

  private loadPanel(
    sessions: WorkoutSession[],
    bookings: readonly Booking[],
    now: Date,
  ): HTMLElement {
    const rows = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(now, i);
      const key = dayKey(day);
      const daySessions = sessions.filter((s) => dayKey(s.startsAt) === key);
      const cap = daySessions.reduce((n, s) => n + s.capacity, 0);
      const booked = daySessions.reduce(
        (n, s) => n + seatsTaken(bookings, s.id),
        0,
      );
      const pct = cap ? Math.round((booked / cap) * 100) : 0;
      return h(
        "div",
        { class: "chart-row" },
        h("span", {
          class: "chart-label",
          text: relativeDay(day.toISOString(), now),
        }),
        h(
          "span",
          { class: "chart-bar" },
          h("span", { style: `width:${pct}%` }),
        ),
        h("span", { class: "chart-value", text: cap ? `${pct}%` : "—" }),
      );
    });
    return h(
      "div",
      { class: "panel-card" },
      h("h3", { text: "Загрузка по дням" }),
      h("div", { class: "chart" }, ...rows),
    );
  }

  // ---------- Расписание ----------
  private renderSchedule(): void {
    const now = new Date();
    const resultsEl = h("div", { class: "day-groups" });
    const renderResults = (): void => {
      replace(resultsEl, ...this.scheduleGroups());
    };
    replace(
      this.sectionEl,
      pageHead(
        "Расписание",
        "Управление тренировками и составом групп",
        button({
          label: "Новая тренировка",
          icon: "plus",
          onClick: () => this.openSessionForm(),
        }),
      ),
      this.selection.size > 0
        ? this.bulkBar(() => {
            void this.deleteSelectedSessions();
          })
        : null,
      h(
        "div",
        { class: "chips" },
        chip("Все дни", this.dayFilter === "all", () => {
          this.dayFilter = "all";
          this.renderSection();
        }),
        ...Array.from({ length: 7 }, (_, i) =>
          chip(
            relativeDay(addDays(now, i).toISOString(), now),
            this.dayFilter === i,
            () => {
              this.dayFilter = i;
              this.renderSection();
            },
          ),
        ),
      ),
      this.searchBox(
        "Поиск по названию, тренеру, залу…",
        this.sessionQuery,
        (v) => {
          this.sessionQuery = v;
          renderResults();
        },
      ),
      resultsEl,
    );
    renderResults();
  }

  private scheduleGroups(): Child[] {
    const now = new Date();
    const bookings = this.ctx.state.allBookings();
    const q = this.sessionQuery.trim().toLowerCase();
    let list = this.sessions();
    if (this.dayFilter !== "all") {
      const key = dayKey(addDays(now, this.dayFilter));
      list = list.filter((s) => dayKey(s.startsAt) === key);
    }
    if (q)
      list = list.filter((s) =>
        `${s.title} ${s.trainer} ${s.room}`.toLowerCase().includes(q),
      );
    if (list.length === 0) return [emptyState("Тренировок не найдено.")];
    const groups = new Map<string, WorkoutSession[]>();
    for (const s of list) {
      const key = dayKey(s.startsAt);
      const bucket = groups.get(key) ?? [];
      bucket.push(s);
      groups.set(key, bucket);
    }
    return [...groups.values()].map((daySessions) =>
      this.dayGroup(daySessions, bookings, now),
    );
  }

  private dayGroup(
    daySessions: WorkoutSession[],
    bookings: readonly Booking[],
    now: Date,
  ): HTMLElement {
    const first = daySessions[0];
    const allChecked = daySessions.every((s) => this.selection.has(s.id));
    const master = h("input", {
      attrs: { type: "checkbox", "aria-label": "Выбрать день" },
      checked: allChecked,
    });
    master.addEventListener("change", () => {
      if (master.checked) daySessions.forEach((s) => this.selection.add(s.id));
      else daySessions.forEach((s) => this.selection.delete(s.id));
      this.renderSection();
    });
    const head = h(
      "h3",
      { class: "day-group-head" },
      master,
      h("span", {
        text: `${relativeDay(first.startsAt, now)}, ${fmtDate(first.startsAt)}`,
      }),
      h("em", { class: "count-pill", text: String(daySessions.length) }),
    );
    const table = h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { text: "" }),
          h("th", { text: "Время" }),
          h("th", { text: "Тренировка" }),
          h("th", { text: "Тренер / зал" }),
          h("th", { text: "Заполнено" }),
          h("th", { text: "" }),
        ),
      ),
      h(
        "tbody",
        {},
        ...daySessions.map((s) => this.sessionRow(s, bookings, now)),
      ),
    );
    return h(
      "section",
      { class: "day-group" },
      head,
      h("div", { class: "table-wrap" }, table),
    );
  }

  private sessionRow(
    s: WorkoutSession,
    bookings: readonly Booking[],
    now: Date,
  ): HTMLElement {
    const taken = seatsTaken(bookings, s.id);
    const pct = occupancyPct(s, bookings);
    const box = h("input", {
      attrs: { type: "checkbox", "aria-label": `Выбрать ${s.title}` },
      checked: this.selection.has(s.id),
    });
    box.addEventListener("change", () => {
      if (box.checked) this.selection.add(s.id);
      else this.selection.delete(s.id);
      this.renderSection();
    });
    const actions = h(
      "span",
      { class: "row-actions" },
      iconButton("users", "Состав группы", () => this.openRoster(s)),
      iconButton("edit", "Редактировать", () => this.openSessionForm(s)),
      iconButton(
        "trash",
        "Удалить",
        () => {
          void this.deleteSession(s);
        },
        { danger: true },
      ),
    );
    return h(
      "tr",
      { class: isFinished(s, now) ? "past" : "" },
      h("td", {}, box),
      h(
        "td",
        {},
        h("strong", { text: fmtTime(s.startsAt) }),
        h("small", { class: "muted", text: ` ${s.durationMin} мин` }),
      ),
      h(
        "td",
        {},
        h(
          "span",
          { class: "cell-title" },
          h("span", { text: s.title }),
          kindBadge(s.kind),
        ),
      ),
      h("td", { class: "muted", text: `${s.trainer} · ${s.room}` }),
      h(
        "td",
        {},
        h(
          "span",
          { class: "occ-cell" },
          occupancyBar(pct),
          h("span", { text: `${taken}/${s.capacity}` }),
        ),
      ),
      h("td", {}, actions),
    );
  }

  private openRoster(s: WorkoutSession): void {
    const content = h("div", { class: "drawer-body" });
    const close = this.ctx.overlays.open(content, "drawer");
    const fill = (): void => {
      const bookings = this.ctx.state
        .allBookings()
        .filter((b) => b.sessionId === s.id);
      const pct = occupancyPct(s, this.ctx.state.allBookings());
      const rows = bookings.map((b) => {
        const u = this.ctx.state.userById(b.userId);
        return h(
          "li",
          { class: "roster-row" },
          avatar(u?.name ?? "?"),
          h(
            "span",
            { class: "roster-name" },
            h("strong", { text: u?.name ?? "Удалённый пользователь" }),
            h("small", { class: "muted", text: u?.email ?? "" }),
          ),
          iconButton(
            "trash",
            "Отменить запись клиента",
            () => {
              void this.cancelFor(b, fill);
            },
            { danger: true },
          ),
        );
      });
      replace(
        content,
        h(
          "div",
          { class: "drawer-head" },
          kindBadge(s.kind),
          iconButton("x", "Закрыть", () => close()),
        ),
        h("h2", { text: s.title }),
        h("p", {
          class: "muted",
          text: `${fmtFull(s.startsAt)} · ${s.trainer} · ${s.room}`,
        }),
        h(
          "div",
          { class: "occ" },
          h("div", { class: "occ-bar" }, h("span", { style: `width:${pct}%` })),
          h("p", {
            class: "muted",
            text: `Записано ${bookings.length} из ${s.capacity}`,
          }),
        ),
        h("h4", { text: `Состав группы (${bookings.length})` }),
        bookings.length === 0
          ? h("p", { class: "muted", text: "Пока никто не записан." })
          : h("ul", { class: "roster" }, ...rows),
      );
    };
    fill();
  }

  private async cancelFor(b: Booking, refresh: () => void): Promise<void> {
    const u = this.ctx.state.userById(b.userId);
    const confirmed = await this.ctx.overlays.confirm({
      title: "Отменить запись?",
      text: `Запись клиента ${u?.name ?? ""} будет отменена.`,
      okLabel: "Отменить запись",
    });
    if (!confirmed) return;
    const r = await this.ctx.booking.cancel(b.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("Запись клиента отменена", "info");
    refresh();
  }

  private async deleteSession(s: WorkoutSession): Promise<void> {
    const confirmed = await this.ctx.overlays.confirm({
      title: "Удалить тренировку?",
      text: `«${s.title}» и все её записи будут удалены.`,
    });
    if (!confirmed) return;
    const r = await this.ctx.catalog.remove(s.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    const token = r.value.undoToken;
    this.ctx.toasts.show(`«${s.title}» удалена`, "info", {
      label: "Вернуть",
      run: () => {
        void this.restoreSession(token);
      },
    });
  }

  private async deleteSelectedSessions(): Promise<void> {
    const count = this.selection.size;
    const confirmed = await this.ctx.overlays.confirm({
      title: `Удалить тренировки (${count})?`,
      text: "Все связанные записи будут удалены.",
    });
    if (!confirmed) return;
    const tokens: string[] = [];
    for (const id of [...this.selection]) {
      const r = await this.ctx.catalog.remove(id);
      if (r.ok) tokens.push(r.value.undoToken);
    }
    this.selection.clear();
    this.ctx.toasts.show(`Удалено: ${tokens.length}`, "info", {
      label: "Вернуть",
      run: () => {
        void this.restoreSessions(tokens);
      },
    });
  }

  private async restoreSession(token: string): Promise<void> {
    const r = await this.ctx.catalog.restore(token);
    this.ctx.toasts.show(
      r.ok ? "Тренировка восстановлена" : errorMessage(r.error),
      r.ok ? "ok" : "err",
    );
  }

  private async restoreSessions(tokens: string[]): Promise<void> {
    for (const t of tokens) await this.ctx.catalog.restore(t);
    this.ctx.toasts.show("Тренировки восстановлены", "ok");
  }

  private openSessionForm(existing?: WorkoutSession): void {
    const now = new Date();
    const title = textInput(
      {
        type: "text",
        required: true,
        maxlength: 60,
        placeholder: "Силовая тренировка",
      },
      existing?.title ?? "",
    );
    const kind = selectInput(
      WORKOUT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
      existing?.kind ?? "strength",
    );
    const trainer = textInput(
      { type: "text", required: true, placeholder: "Фамилия Имя" },
      existing?.trainer ?? "",
    );
    const room = textInput(
      { type: "text", required: true },
      existing?.room ?? "Зал 1",
    );
    const date = textInput(
      { type: "date", required: true },
      existing ? dayKey(existing.startsAt) : dayKey(addDays(now, 1)),
    );
    const time = textInput(
      { type: "time", required: true },
      existing ? timeInputValue(existing.startsAt) : "18:00",
    );
    const duration = textInput(
      { type: "number", min: 15, max: 180, step: 5, required: true },
      String(existing?.durationMin ?? 60),
    );
    const capacity = textInput(
      { type: "number", min: 1, max: 100, required: true },
      String(existing?.capacity ?? 12),
    );

    const submit = async (): Promise<void> => {
      const draft: SessionDraft = {
        title: title.value,
        kind: WORKOUT_KINDS.find((k) => k === kind.value) ?? "strength",
        trainer: trainer.value,
        room: room.value,
        date: date.value,
        time: time.value,
        durationMin: Number(duration.value),
        capacity: Number(capacity.value),
      };
      const r = existing
        ? await this.ctx.catalog.update(existing.id, draft)
        : await this.ctx.catalog.create(draft);
      if (!r.ok) {
        this.ctx.toasts.show(errorMessage(r.error), "err");
        return;
      }
      close();
      this.ctx.toasts.show(
        existing ? "Тренировка обновлена" : "Тренировка добавлена",
        "ok",
      );
    };

    const form = h(
      "form",
      {
        class: "form-grid",
        on: {
          submit: (e) => {
            e.preventDefault();
            void submit();
          },
        },
      },
      field("Название", title, true),
      field("Тип", kind),
      field("Тренер", trainer),
      field("Зал", room),
      field("Дата", date),
      field("Время", time),
      field("Длительность, мин", duration),
      field("Вместимость", capacity),
      h(
        "div",
        { class: "modal-actions span2" },
        button({ label: "Отмена", tone: "ghost", onClick: () => close() }),
        button({ label: "Сохранить", type: "submit" }),
      ),
    );
    const close = this.ctx.overlays.open(
      h(
        "div",
        {},
        h("h3", {
          text: existing ? "Редактировать тренировку" : "Новая тренировка",
        }),
        form,
      ),
    );
  }

  // ---------- Клиенты ----------
  private renderClients(): void {
    const resultsEl = h("div", {});
    const renderResults = (): void => {
      replace(resultsEl, this.clientsTable());
    };
    replace(
      this.sectionEl,
      pageHead("Клиенты", "Поиск, досье и управление ролями"),
      this.selection.size > 0
        ? this.bulkBar(() => {
            void this.deleteSelectedUsers();
          })
        : null,
      this.searchBox("Имя или email…", this.clientQuery, (v) => {
        this.clientQuery = v;
        renderResults();
      }),
      resultsEl,
    );
    renderResults();
  }

  private clientsTable(): HTMLElement {
    const now = new Date();
    const bookings = this.ctx.state.allBookings();
    const q = this.clientQuery.trim().toLowerCase();
    const users = this.ctx.state
      .allUsers()
      .filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
    if (users.length === 0)
      return emptyState("Никого не найдено.", undefined, "users");
    const selfId = this.ctx.auth.currentUser()?.id;
    const rows = users.map((u) => {
      const mine = bookings.filter((b) => b.userId === u.id);
      const upcoming = mine.filter((b) => {
        const s = this.ctx.state.sessionById(b.sessionId);
        return s !== undefined && !isFinished(s, now);
      }).length;
      const box = h("input", {
        attrs: { type: "checkbox", "aria-label": `Выбрать ${u.name}` },
        checked: this.selection.has(u.id),
        disabled: u.id === selfId,
      });
      box.addEventListener("click", (e) => e.stopPropagation());
      box.addEventListener("change", () => {
        if (box.checked) this.selection.add(u.id);
        else this.selection.delete(u.id);
        this.renderSection();
      });
      const actions = h(
        "span",
        { class: "row-actions" },
        iconButton("edit", "Редактировать", (e) => {
          e.stopPropagation();
          this.openUserForm(u);
        }),
        iconButton(
          "trash",
          "Удалить",
          (e) => {
            e.stopPropagation();
            void this.deleteUser(u);
          },
          { danger: true, disabled: u.id === selfId },
        ),
      );
      return {
        class: "clickable",
        onClick: () => this.openClient(u),
        cells: [
          box,
          h(
            "span",
            { class: "cell-user" },
            avatar(u.name),
            h("strong", { text: u.name }),
          ),
          h("span", { class: "muted", text: u.email }),
          roleBadge(u.role),
          String(mine.length),
          String(upcoming),
          actions,
        ] as Child[],
      };
    });
    return dataTable(
      ["", "Имя", "Email", "Роль", "Записей", "Предстоит", ""],
      rows,
    );
  }

  private openClient(u: User): void {
    const content = h("div", { class: "drawer-body" });
    const close = this.ctx.overlays.open(content, "drawer");
    const fill = (): void => {
      const now = new Date();
      const mine = this.ctx.state
        .allBookings()
        .filter((b) => b.userId === u.id)
        .map((b) => ({ b, s: this.ctx.state.sessionById(b.sessionId) }))
        .filter(
          (x): x is { b: Booking; s: WorkoutSession } => x.s !== undefined,
        )
        .sort((a, b) => b.s.startsAt.localeCompare(a.s.startsAt));
      const upcoming = mine.filter((x) => !isFinished(x.s, now));
      const rows = mine.map(({ b, s }) =>
        h(
          "li",
          { class: `roster-row${isFinished(s, now) ? " past" : ""}` },
          h(
            "span",
            { class: "roster-name" },
            h("strong", { text: s.title }),
            h("small", {
              class: "muted",
              text: `${fmtDate(s.startsAt)} ${fmtTime(s.startsAt)} · ${s.trainer}`,
            }),
          ),
          isFinished(s, now)
            ? h("span", { class: "status-chip done", text: "Завершена" })
            : iconButton(
                "trash",
                "Отменить запись",
                () => {
                  void this.cancelFor(b, fill);
                },
                { danger: true },
              ),
        ),
      );
      replace(
        content,
        h(
          "div",
          { class: "drawer-head" },
          roleBadge(u.role),
          iconButton("x", "Закрыть", () => close()),
        ),
        h(
          "div",
          { class: "client-head" },
          avatar(u.name),
          h(
            "div",
            {},
            h("h2", { text: u.name }),
            h("p", { class: "muted", text: u.email }),
          ),
        ),
        h(
          "div",
          { class: "report-cards two" },
          statCard(mine.length, "записей всего"),
          statCard(upcoming.length, "предстоит"),
        ),
        h("h4", { text: "Записи" }),
        mine.length === 0
          ? h("p", { class: "muted", text: "Записей нет." })
          : h("ul", { class: "roster" }, ...rows),
      );
    };
    fill();
  }

  private async deleteUser(u: User): Promise<void> {
    const confirmed = await this.ctx.overlays.confirm({
      title: "Удалить пользователя?",
      text: `${u.name} и все его записи будут удалены.`,
    });
    if (!confirmed) return;
    const r = await this.ctx.accounts.remove(u.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    const token = r.value.undoToken;
    this.ctx.toasts.show(`${u.name} удалён`, "info", {
      label: "Вернуть",
      run: () => {
        void this.restoreUser(token);
      },
    });
  }

  private async deleteSelectedUsers(): Promise<void> {
    const count = this.selection.size;
    const confirmed = await this.ctx.overlays.confirm({
      title: `Удалить пользователей (${count})?`,
      text: "Все их записи будут удалены.",
    });
    if (!confirmed) return;
    const tokens: string[] = [];
    for (const id of [...this.selection]) {
      const r = await this.ctx.accounts.remove(id);
      if (r.ok) tokens.push(r.value.undoToken);
    }
    this.selection.clear();
    this.ctx.toasts.show(`Удалено: ${tokens.length}`, "info", {
      label: "Вернуть",
      run: () => {
        void this.restoreUsers(tokens);
      },
    });
  }

  private async restoreUser(token: string): Promise<void> {
    const r = await this.ctx.accounts.restore(token);
    this.ctx.toasts.show(
      r.ok ? "Пользователь восстановлен" : errorMessage(r.error),
      r.ok ? "ok" : "err",
    );
  }

  private async restoreUsers(tokens: string[]): Promise<void> {
    for (const t of tokens) await this.ctx.accounts.restore(t);
    this.ctx.toasts.show("Пользователи восстановлены", "ok");
  }

  private openUserForm(u: User): void {
    const name = textInput(
      { type: "text", required: true, minlength: 2 },
      u.name,
    );
    const email = textInput({ type: "email", required: true }, u.email);
    const role = selectInput(
      [
        { value: "client", label: "Клиент" },
        { value: "admin", label: "Админ" },
      ],
      u.role,
    );
    const submit = async (): Promise<void> => {
      const r = await this.ctx.accounts.update(u.id, {
        name: name.value,
        email: email.value,
        role: role.value === "admin" ? "admin" : "client",
      });
      if (!r.ok) {
        this.ctx.toasts.show(errorMessage(r.error), "err");
        return;
      }
      close();
      this.ctx.toasts.show("Данные пользователя обновлены", "ok");
    };
    const form = h(
      "form",
      {
        class: "form-grid",
        on: {
          submit: (e) => {
            e.preventDefault();
            void submit();
          },
        },
      },
      field("Имя", name, true),
      field("Email", email, true),
      field("Роль", role, true),
      h(
        "div",
        { class: "modal-actions span2" },
        button({ label: "Отмена", tone: "ghost", onClick: () => close() }),
        button({ label: "Сохранить", type: "submit" }),
      ),
    );
    const close = this.ctx.overlays.open(
      h("div", {}, h("h3", { text: "Пользователь" }), form),
    );
  }

  // ---------- Отчёты ----------
  private renderReports(): void {
    const now = new Date();
    const report = buildReport(
      this.ctx.state.allSessions(),
      this.ctx.state.allBookings(),
      this.ctx.state.allUsers(),
    );
    const byKind = WORKOUT_KINDS.map((kind) => {
      const ids = new Set(
        report.rows
          .filter((r) => r.session.kind === kind)
          .map((r) => r.session.id),
      );
      return {
        kind,
        count: this.ctx.state.allBookings().filter((b) => ids.has(b.sessionId))
          .length,
      };
    });
    const maxKind = Math.max(1, ...byKind.map((x) => x.count));
    const kindRows = byKind.map((x) =>
      h(
        "div",
        { class: "chart-row" },
        h("span", { class: "chart-label", text: KIND_LABEL[x.kind] }),
        h(
          "span",
          { class: "chart-bar" },
          h("span", {
            class: `k-${x.kind}`,
            style: `width:${Math.round((x.count / maxKind) * 100)}%`,
          }),
        ),
        h("span", { class: "chart-value", text: String(x.count) }),
      ),
    );
    const table = dataTable(
      ["Тренировка", "Дата", "Записано", "Заполняемость"],
      report.rows.map((r) => ({
        class: isFinished(r.session, now) ? "past" : "",
        cells: [
          h(
            "span",
            { class: "cell-title" },
            h("span", { text: r.session.title }),
            kindBadge(r.session.kind),
          ),
          `${fmtDate(r.session.startsAt)} ${fmtTime(r.session.startsAt)}`,
          `${r.booked}/${r.session.capacity}`,
          h(
            "span",
            { class: "occ-cell" },
            occupancyBar(r.occupancy),
            h("span", { text: `${r.occupancy}%` }),
          ),
        ] as Child[],
      })),
    );
    replace(
      this.sectionEl,
      pageHead(
        "Отчёты",
        "Формируются мгновенно из загруженных данных",
        button({
          label: "Скачать CSV",
          tone: "ghost",
          icon: "download",
          onClick: () => this.exportCsv(report.rows),
        }),
      ),
      h(
        "div",
        { class: "report-cards" },
        statCard(report.totalSessions, "тренировок"),
        statCard(report.totalBookings, "записей"),
        statCard(report.activeClients, "клиентов"),
        statCard(`${report.occupancy}%`, "заполняемость"),
      ),
      h(
        "div",
        { class: "panel-card" },
        h("h3", { text: "Записи по направлениям" }),
        h("div", { class: "chart" }, ...kindRows),
      ),
      table,
    );
  }

  private exportCsv(
    rows: { session: WorkoutSession; booked: number; occupancy: number }[],
  ): void {
    const data: (string | number)[][] = [
      [
        "Тренировка",
        "Тип",
        "Дата",
        "Время",
        "Тренер",
        "Зал",
        "Записано",
        "Вместимость",
        "Заполняемость %",
      ],
      ...rows.map((r) => [
        r.session.title,
        KIND_LABEL[r.session.kind],
        fmtDate(r.session.startsAt),
        fmtTime(r.session.startsAt),
        r.session.trainer,
        r.session.room,
        r.booked,
        r.session.capacity,
        r.occupancy,
      ]),
    ];
    downloadText(`atlet-report-${dayKey(new Date())}.csv`, toCsv(data));
    this.ctx.toasts.show("Отчёт выгружен в CSV", "ok");
  }
}
