import type { DomainError } from "./errors";
import { fail, ok, type Result } from "./result";
import type {
  Booking,
  Report,
  ScheduleFilters,
  SessionDraft,
  TimeOfDay,
  User,
  WorkoutKind,
  WorkoutSession,
} from "./types";

export const MINUTE_MS = 60_000;

export const sessionEndsAt = (s: WorkoutSession): number =>
  Date.parse(s.startsAt) + s.durationMin * MINUTE_MS;
export const hasStarted = (s: WorkoutSession, now: Date): boolean =>
  Date.parse(s.startsAt) <= now.getTime();
export const isFinished = (s: WorkoutSession, now: Date): boolean =>
  sessionEndsAt(s) < now.getTime();

const pad = (n: number): string => String(n).padStart(2, "0");

export function dayKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

export function timeBucket(iso: string): TimeOfDay {
  const h = new Date(iso).getHours();
  if (h < 12) return "morning";
  if (h < 17) return "day";
  return "evening";
}

export const seatsTaken = (
  bookings: readonly Booking[],
  sessionId: string,
): number => bookings.filter((b) => b.sessionId === sessionId).length;

export const seatsLeft = (
  s: WorkoutSession,
  bookings: readonly Booking[],
): number => s.capacity - seatsTaken(bookings, s.id);

export const bookingOf = (
  bookings: readonly Booking[],
  userId: string,
  sessionId: string,
): Booking | undefined =>
  bookings.find((b) => b.userId === userId && b.sessionId === sessionId);

export const occupancyPct = (
  s: WorkoutSession,
  bookings: readonly Booking[],
): number =>
  s.capacity === 0
    ? 0
    : Math.round((seatsTaken(bookings, s.id) / s.capacity) * 100);

export function checkBookable(
  s: WorkoutSession,
  bookings: readonly Booking[],
  userId: string,
  now: Date,
): Result<true, DomainError> {
  if (hasStarted(s, now)) return fail({ code: "session-started" });
  if (bookingOf(bookings, userId, s.id))
    return fail({ code: "already-booked" });
  if (seatsLeft(s, bookings) <= 0) return fail({ code: "session-full" });
  return ok(true);
}

export function filterSessions(
  all: readonly WorkoutSession[],
  f: ScheduleFilters,
  now: Date,
): WorkoutSession[] {
  const key = dayKey(addDays(now, f.dayOffset));
  const q = f.query.trim().toLowerCase();
  return all
    .filter((s) => dayKey(s.startsAt) === key)
    .filter((s) => f.kind === "all" || s.kind === f.kind)
    .filter((s) => f.time === "all" || timeBucket(s.startsAt) === f.time)
    .filter(
      (s) =>
        !q || `${s.title} ${s.trainer} ${s.room}`.toLowerCase().includes(q),
    );
}

export function sortSessions(
  list: readonly WorkoutSession[],
  mode: ScheduleFilters["sort"],
  bookings: readonly Booking[],
): WorkoutSession[] {
  return [...list].sort((a, b) =>
    mode === "seats"
      ? seatsLeft(b, bookings) - seatsLeft(a, bookings) ||
        a.startsAt.localeCompare(b.startsAt)
      : a.startsAt.localeCompare(b.startsAt),
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email);

export function validateRegistration(
  name: string,
  email: string,
  password: string,
): Result<true, DomainError> {
  if (name.trim().length < 2)
    return fail({
      code: "validation",
      message: "Укажите имя (минимум 2 символа)",
    });
  if (!isValidEmail(email.trim()))
    return fail({ code: "validation", message: "Некорректный email" });
  if (password.length < 6)
    return fail({ code: "validation", message: "Пароль — минимум 6 символов" });
  return ok(true);
}

export const draftToStartDate = (draft: SessionDraft): Date =>
  new Date(`${draft.date}T${draft.time}`);

export function validateSessionDraft(
  draft: SessionDraft,
  now: Date,
  opts: { isNew: boolean; booked: number },
): Result<true, DomainError> {
  if (!draft.title.trim() || !draft.trainer.trim() || !draft.room.trim()) {
    return fail({
      code: "validation",
      message: "Заполните название, тренера и зал",
    });
  }
  const start = draftToStartDate(draft);
  if (Number.isNaN(start.getTime()))
    return fail({ code: "validation", message: "Некорректные дата или время" });
  if (opts.isNew && start.getTime() <= now.getTime())
    return fail({
      code: "validation",
      message: "Новая тренировка должна быть в будущем",
    });
  if (
    !Number.isInteger(draft.durationMin) ||
    draft.durationMin < 15 ||
    draft.durationMin > 180
  ) {
    return fail({
      code: "validation",
      message: "Длительность — от 15 до 180 минут",
    });
  }
  if (
    !Number.isInteger(draft.capacity) ||
    draft.capacity < 1 ||
    draft.capacity > 100
  ) {
    return fail({
      code: "validation",
      message: "Вместимость — от 1 до 100 мест",
    });
  }
  if (draft.capacity < opts.booked) {
    return fail({
      code: "capacity-below-booked",
      message: `Уже записано ${opts.booked} — меньшую вместимость задать нельзя`,
    });
  }
  return ok(true);
}

export function buildReport(
  sessions: readonly WorkoutSession[],
  bookings: readonly Booking[],
  users: readonly User[],
): Report {
  const sorted = [...sessions].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
  const rows = sorted.map((s) => ({
    session: s,
    booked: seatsTaken(bookings, s.id),
    occupancy: occupancyPct(s, bookings),
  }));
  const cap = sorted.reduce((n, s) => n + s.capacity, 0);
  const total = bookings.length;
  const kindOf = new Map(sorted.map((s) => [s.id, s.kind]));
  const byKind = new Map<WorkoutKind, number>();
  for (const b of bookings) {
    const k = kindOf.get(b.sessionId);
    if (k) byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  let topKind: WorkoutKind | null = null;
  let top = 0;
  for (const [k, n] of byKind)
    if (n > top) {
      top = n;
      topKind = k;
    }
  return {
    rows,
    totalSessions: sorted.length,
    totalBookings: total,
    activeClients: users.filter((u) => u.role === "client").length,
    occupancy: cap ? Math.round((total / cap) * 100) : 0,
    topKind,
  };
}
