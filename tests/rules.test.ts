import { describe, expect, it } from "vitest";
import {
  buildReport,
  checkBookable,
  filterSessions,
  isFinished,
  occupancyPct,
  seatsLeft,
  sortSessions,
  timeBucket,
  validateSessionDraft,
} from "../src/core/rules";
import {
  DEFAULT_FILTERS,
  type Booking,
  type SessionDraft,
  type User,
  type WorkoutSession,
} from "../src/core/types";

const now = new Date("2026-01-10T10:00:00");
const session = (o: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: "s1",
  title: "Йога",
  kind: "yoga",
  trainer: "Ким",
  room: "Зал 2",
  startsAt: "2026-01-10T12:00:00",
  durationMin: 60,
  capacity: 2,
  ...o,
});
const booking = (userId: string, sessionId = "s1"): Booking => ({
  id: `b-${userId}`,
  userId,
  sessionId,
  createdAt: now.toISOString(),
});

describe("checkBookable", () => {
  it("разрешает при свободных местах", () =>
    expect(checkBookable(session(), [], "u1", now).ok).toBe(true));
  it("запрещает повторную", () => {
    const r = checkBookable(session(), [booking("u1")], "u1", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("already-booked");
  });
  it("запрещает при полном зале", () => {
    const r = checkBookable(session(), [booking("a"), booking("b")], "u1", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("session-full");
  });
  it("запрещает на начавшуюся", () => {
    const r = checkBookable(
      session({ startsAt: "2026-01-10T09:00:00" }),
      [],
      "u1",
      now,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("session-started");
  });
});

describe("места и заполняемость", () => {
  it("остаток мест", () =>
    expect(seatsLeft(session(), [booking("a")])).toBe(1));
  it("проценты", () =>
    expect(occupancyPct(session(), [booking("a")])).toBe(50));
  it("завершённость", () => {
    expect(isFinished(session({ startsAt: "2026-01-10T08:00:00" }), now)).toBe(
      true,
    );
    expect(isFinished(session(), now)).toBe(false);
  });
});

describe("filterSessions", () => {
  const list = [
    session(),
    session({ id: "s2", kind: "cardio", startsAt: "2026-01-11T12:00:00" }),
    session({ id: "s3", trainer: "Ли", startsAt: "2026-01-10T15:00:00" }),
  ];
  it("по дню", () =>
    expect(filterSessions(list, DEFAULT_FILTERS, now)).toHaveLength(2));
  it("по типу", () =>
    expect(
      filterSessions(
        list,
        { ...DEFAULT_FILTERS, dayOffset: 1, kind: "cardio" },
        now,
      ),
    ).toHaveLength(1));
  it("по тренеру", () =>
    expect(
      filterSessions(list, { ...DEFAULT_FILTERS, query: "ли" }, now),
    ).toHaveLength(1));
  it("по времени суток", () =>
    expect(
      filterSessions(list, { ...DEFAULT_FILTERS, time: "evening" }, now),
    ).toHaveLength(0));
});

describe("sortSessions", () => {
  it("по времени", () => {
    const s = sortSessions(
      [
        session({ id: "late", startsAt: "2026-01-10T18:00:00" }),
        session({ id: "early", startsAt: "2026-01-10T08:00:00" }),
      ],
      "time",
      [],
    );
    expect(s[0].id).toBe("early");
  });
  it("по местам", () => {
    const s = sortSessions(
      [session({ id: "a", capacity: 1 }), session({ id: "b", capacity: 5 })],
      "seats",
      [booking("x", "a")],
    );
    expect(s[0].id).toBe("b");
  });
});

describe("validateSessionDraft", () => {
  const draft: SessionDraft = {
    title: "Йога",
    kind: "yoga",
    trainer: "Ким",
    room: "Зал 2",
    date: "2026-01-11",
    time: "10:00",
    durationMin: 60,
    capacity: 10,
  };
  it("корректный", () =>
    expect(
      validateSessionDraft(draft, now, { isNew: true, booked: 0 }).ok,
    ).toBe(true));
  it("в прошлом", () =>
    expect(
      validateSessionDraft({ ...draft, date: "2026-01-09" }, now, {
        isNew: true,
        booked: 0,
      }).ok,
    ).toBe(false));
  it("вместимость ниже записей", () => {
    const r = validateSessionDraft({ ...draft, capacity: 3 }, now, {
      isNew: false,
      booked: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("capacity-below-booked");
  });
});

describe("timeBucket", () => {
  it("части дня", () => {
    expect(timeBucket("2026-01-10T08:00:00")).toBe("morning");
    expect(timeBucket("2026-01-10T14:00:00")).toBe("day");
    expect(timeBucket("2026-01-10T19:00:00")).toBe("evening");
  });
});

describe("buildReport", () => {
  it("агрегирует", () => {
    const sessions = [
      session({ id: "a", capacity: 10 }),
      session({ id: "b", kind: "cardio", capacity: 10 }),
    ];
    const bookings = [
      booking("u1", "a"),
      booking("u2", "a"),
      booking("u3", "b"),
      booking("u4", "b"),
      booking("u5", "b"),
    ];
    const users: User[] = [
      { id: "u1", name: "А", email: "a@t.kz", role: "client" },
    ];
    const r = buildReport(sessions, bookings, users);
    expect(r.totalSessions).toBe(2);
    expect(r.totalBookings).toBe(5);
    expect(r.occupancy).toBe(25);
    expect(r.topKind).toBe("cardio");
    expect(r.activeClients).toBe(1);
  });
});
