import { describe, expect, it } from "vitest";
import type { Api, StateDto } from "../src/api/client";
import {
  RemoteAccounts,
  RemoteAuth,
  RemoteBooking,
  RemoteCatalog,
} from "../src/application/services";
import { fail, ok } from "../src/core/result";
import type { Booking, User, WorkoutSession } from "../src/core/types";
import { AppState, EventBus } from "../src/state/app-state";

const me: User = {
  id: "u1",
  name: "Алия Ким",
  email: "aliya@test.kz",
  role: "client",
};
const session = (id: string): WorkoutSession => ({
  id,
  title: "Йога",
  kind: "yoga",
  trainer: "Ким",
  room: "Зал 2",
  startsAt: new Date(Date.now() + 3_600_000).toISOString(),
  durationMin: 60,
  capacity: 10,
});

function fixture() {
  const sessions = [session("s1")];
  const bookings: Booking[] = [];
  const removed: string[] = [];
  let seq = 0;
  const api: Api = {
    auth: {
      register: async () => ok(me),
      login: async () => ok(me),
      logout: async () => ok(undefined),
      me: async () => ok(me),
    },
    state: async (): Promise<
      ReturnType<Api["state"]> extends Promise<infer R> ? R : never
    > =>
      ok({
        sessions: [...sessions],
        bookings: [...bookings],
        users: [me],
      } as StateDto),
    sessions: {
      create: async (draft) => {
        const c = {
          ...session(`s${++seq}`),
          title: draft.title,
          capacity: draft.capacity,
        };
        sessions.push(c);
        return ok(c);
      },
      update: async (id, draft) => {
        const t = sessions.find((s) => s.id === id);
        if (!t) return fail({ code: "not-found" });
        Object.assign(t, { title: draft.title, capacity: draft.capacity });
        return ok(t);
      },
      remove: async (id) => {
        const i = sessions.findIndex((s) => s.id === id);
        if (i < 0) return fail({ code: "not-found" });
        sessions.splice(i, 1);
        removed.push(id);
        return ok({ undoToken: `t-${id}` });
      },
      restore: async (token) => {
        const id = token.slice(2);
        const i = removed.indexOf(id);
        if (i < 0) return fail({ code: "not-found" });
        removed.splice(i, 1);
        sessions.push(session(id));
        return ok(undefined);
      },
    },
    bookings: {
      create: async (sessionId) => {
        if (
          bookings.some((b) => b.sessionId === sessionId && b.userId === me.id)
        )
          return fail({ code: "already-booked" });
        const b: Booking = {
          id: `b${++seq}`,
          userId: me.id,
          sessionId,
          createdAt: new Date().toISOString(),
        };
        bookings.push(b);
        return ok(b);
      },
      cancel: async (id) => {
        const i = bookings.findIndex((b) => b.id === id);
        if (i < 0) return fail({ code: "not-found" });
        return ok(bookings.splice(i, 1)[0]);
      },
    },
    users: {
      update: async (id, patch) => ok({ ...me, id, ...patch }),
      remove: async () => ok({ undoToken: "u-token" }),
      restore: async () => ok(undefined),
    },
  };
  const bus = new EventBus();
  const state = new AppState(api, bus);
  return {
    state,
    auth: new RemoteAuth(api, state),
    booking: new RemoteBooking(api, state),
    catalog: new RemoteCatalog(api, state),
    accounts: new RemoteAccounts(api, state),
  };
}

describe("RemoteAuth", () => {
  it("логин загружает состояние", async () => {
    const fx = fixture();
    const r = await fx.auth.login("a@t.kz", "x");
    expect(r.ok).toBe(true);
    expect(fx.auth.currentUser()?.id).toBe("u1");
    expect(fx.state.allSessions()).toHaveLength(1);
  });
  it("выход очищает", async () => {
    const fx = fixture();
    await fx.auth.login("a@t.kz", "x");
    await fx.auth.logout();
    expect(fx.auth.currentUser()).toBeNull();
    expect(fx.state.allSessions()).toHaveLength(0);
  });
});

describe("RemoteBooking", () => {
  it("оптимистичная запись", async () => {
    const fx = fixture();
    await fx.auth.login("a@t.kz", "x");
    const r = await fx.booking.book("s1");
    expect(r.ok).toBe(true);
    expect(fx.booking.ofCurrentUser()).toHaveLength(1);
  });
  it("повторная отклоняется", async () => {
    const fx = fixture();
    await fx.auth.login("a@t.kz", "x");
    await fx.booking.book("s1");
    const r = await fx.booking.book("s1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("already-booked");
  });
  it("отмена и возврат", async () => {
    const fx = fixture();
    await fx.auth.login("a@t.kz", "x");
    const b = await fx.booking.book("s1");
    if (!b.ok) throw new Error("book");
    const c = await fx.booking.cancel(b.value.id);
    expect(c.ok).toBe(true);
    expect(fx.booking.ofCurrentUser()).toHaveLength(0);
    if (!c.ok) throw new Error("cancel");
    expect((await fx.booking.restore(c.value)).ok).toBe(true);
    expect(fx.booking.ofCurrentUser()).toHaveLength(1);
  });
});

describe("RemoteCatalog", () => {
  it("удаление + undo-токен", async () => {
    const fx = fixture();
    await fx.auth.login("a@t.kz", "x");
    const r = await fx.catalog.remove("s1");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("remove");
    expect(r.value.undoToken).toBe("t-s1");
    expect(fx.state.allSessions()).toHaveLength(0);
    expect((await fx.catalog.restore(r.value.undoToken)).ok).toBe(true);
    expect(fx.state.allSessions()).toHaveLength(1);
  });
  it("повторный возврат отклоняется", async () => {
    const fx = fixture();
    await fx.auth.login("a@t.kz", "x");
    const r = await fx.catalog.remove("s1");
    if (!r.ok) throw new Error("remove");
    await fx.catalog.restore(r.value.undoToken);
    expect((await fx.catalog.restore(r.value.undoToken)).ok).toBe(false);
  });
});

describe("RemoteAccounts", () => {
  it("обновление роли", async () => {
    const fx = fixture();
    await fx.auth.login("a@t.kz", "x");
    const r = await fx.accounts.update("u1", {
      name: "Новое",
      email: "n@t.kz",
      role: "admin",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.role).toBe("admin");
  });
});
