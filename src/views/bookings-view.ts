import { isFinished } from "../core/rules";
import type { Booking, WorkoutSession } from "../core/types";
import type { AppContext } from "../app/context";
import { h, replace } from "../ui/dom";
import { fmtDate, fmtTime, relativeDay } from "../ui/format";
import { icon } from "../ui/icons";
import { errorMessage } from "../ui/messages";
import { BaseView } from "./view";
import {
  button,
  coverImg,
  emptyState,
  intensityChip,
  kindBadge,
  pageHead,
} from "../ui/controls";

interface Item {
  booking: Booking;
  session: WorkoutSession;
}

export class BookingsView extends BaseView {
  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected init(): void {
    this.watch("bookings", () => this.render());
    this.watch("sessions", () => this.render());
  }

  protected render(): void {
    const now = new Date();
    const items: Item[] = this.ctx.booking
      .ofCurrentUser()
      .map((booking) => ({
        booking,
        session: this.ctx.state.sessionById(booking.sessionId),
      }))
      .filter((x): x is Item => x.session !== undefined);
    const upcoming = items
      .filter((x) => !isFinished(x.session, now))
      .sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
    const history = items
      .filter((x) => isFinished(x.session, now))
      .sort((a, b) => b.session.startsAt.localeCompare(a.session.startsAt));

    replace(
      this.root,
      pageHead(
        "Мои записи",
        "Отмена — в одно касание, вернуть можно сразу из уведомления.",
      ),
      items.length === 0
        ? emptyState(
            "У вас пока нет записей.",
            button({
              label: "К расписанию",
              onClick: () => this.ctx.navigate("schedule"),
            }),
            "ticket",
          )
        : h(
            "div",
            {},
            h(
              "h2",
              { class: "section-title" },
              "Предстоящие ",
              h("em", { class: "count-pill", text: String(upcoming.length) }),
            ),
            h(
              "div",
              { class: "session-list" },
              upcoming.length > 0
                ? upcoming.map((x, i) => this.card(x, i, false))
                : h("p", { class: "muted", text: "Нет предстоящих записей." }),
            ),
            history.length > 0
              ? h(
                  "div",
                  {},
                  h(
                    "h2",
                    { class: "section-title" },
                    "История ",
                    h("em", {
                      class: "count-pill",
                      text: String(history.length),
                    }),
                  ),
                  h(
                    "div",
                    { class: "session-list" },
                    ...history.map((x, i) => this.card(x, i, true)),
                  ),
                )
              : null,
          ),
    );
  }

  private card(item: Item, index: number, past: boolean): HTMLElement {
    const { booking, session } = item;
    const now = new Date();
    const cover = h(
      "div",
      { class: "card-cover" },
      coverImg(session.kind),
      h("span", { class: "cover-time", text: fmtTime(session.startsAt) }),
    );
    const info = h(
      "div",
      { class: "session-info" },
      h(
        "div",
        { class: "session-top" },
        h("h3", { text: session.title }),
        kindBadge(session.kind),
        intensityChip(session.kind),
      ),
      h(
        "p",
        { class: "muted session-meta" },
        icon("calendar", 16),
        h("span", {
          text: `${fmtDate(session.startsAt)}, ${relativeDay(session.startsAt, now)} · ${session.trainer} · ${session.room}`,
        }),
      ),
    );
    const side = h(
      "div",
      { class: "session-side" },
      past
        ? h("span", { class: "status-chip done", text: "Завершена" })
        : h(
            "div",
            { class: "side-stack" },
            h("span", { class: "status-chip upcoming", text: "Предстоит" }),
            button({
              label: "Отменить",
              tone: "danger-ghost",
              small: true,
              onClick: () => {
                void this.cancel(booking);
              },
            }),
          ),
    );
    return h(
      "article",
      {
        class: `booking-card${past ? " past" : ""}`,
        style: `animation-delay:${Math.min(index * 40, 240)}ms`,
      },
      cover,
      info,
      side,
    );
  }

  private async cancel(booking: Booking): Promise<void> {
    const r = await this.ctx.booking.cancel(booking.id);
    if (!r.ok) {
      this.ctx.toasts.show(errorMessage(r.error), "err");
      return;
    }
    this.ctx.toasts.show("Запись отменена", "info", {
      label: "Вернуть",
      run: () => {
        void this.restore(booking);
      },
    });
  }

  private async restore(booking: Booking): Promise<void> {
    const r = await this.ctx.booking.book(booking.sessionId);
    this.ctx.toasts.show(
      r.ok ? "Запись восстановлена" : errorMessage(r.error),
      r.ok ? "ok" : "err",
    );
  }
}
