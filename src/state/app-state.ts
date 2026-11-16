import type { Api } from "../api/client";
import type { DomainError } from "../core/errors";
import { fail, ok, type Result } from "../core/result";
import type { Booking, User, WorkoutSession } from "../core/types";

export type AppEvent = "auth" | "sessions" | "bookings" | "users" | "sync";

export class EventBus {
  private readonly listeners = new Map<AppEvent, Set<() => void>>();
  on(event: AppEvent, fn: () => void): () => void {
    const set = this.listeners.get(event) ?? new Set<() => void>();
    set.add(fn);
    this.listeners.set(event, set);
    return () => set.delete(fn);
  }
  emit(event: AppEvent): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn();
  }
}

const SNAPSHOT_KEY = "atlet:snapshot:v1";

export class AppState {
  private user: User | null = null;
  private users: User[] = [];
  private sessions: WorkoutSession[] = [];
  private bookings: Booking[] = [];
  private syncOk = true;
  private syncErrorHandler: ((e: DomainError) => void) | null = null;

  constructor(
    private readonly api: Api,
    readonly bus: EventBus,
  ) {}

  get me(): User | null {
    return this.user;
  }
  get isSyncOk(): boolean {
    return this.syncOk;
  }
  onSyncError(fn: (e: DomainError) => void): void {
    this.syncErrorHandler = fn;
  }
  markSyncFailed(): void {
    this.syncOk = false;
    this.bus.emit("sync");
  }
  setMe(user: User | null): void {
    this.user = user;
    if (!user) {
      this.users = [];
      this.sessions = [];
      this.bookings = [];
    }
    this.bus.emit("auth");
  }

  allUsers(): readonly User[] {
    return this.users;
  }
  allSessions(): readonly WorkoutSession[] {
    return this.sessions;
  }
  allBookings(): readonly Booking[] {
    return this.bookings;
  }
  userById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }
  sessionById(id: string): WorkoutSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }
  bookingById(id: string): Booking | undefined {
    return this.bookings.find((b) => b.id === id);
  }

  async refresh(): Promise<Result<void, DomainError>> {
    const r = await this.api.state();
    if (!r.ok) {
      const code = r.error.code;
      // Баннер «Сервер недоступен» — только когда нет сетевого ответа.
      this.syncOk = code !== "network";
      if (code === "unauthorized") this.setMe(null);
      else this.syncErrorHandler?.(r.error);
      this.bus.emit("sync");
      return r;
    }
    try {
      const { sessions, bookings, users } = r.value;
      if (!Array.isArray(sessions) || !Array.isArray(bookings)) {
        throw new Error("state: ожидаются массивы sessions/bookings");
      }
      this.sessions = sessions;
      this.bookings = bookings;
      this.users = Array.isArray(users) ? users : [];
      this.syncOk = true;
      this.persist();
      this.bus.emit("sessions");
      this.bus.emit("bookings");
      this.bus.emit("users");
      this.bus.emit("sync");
      return ok(undefined);
    } catch {
      // Тело 200, но не по контракту: сервер жив, баннер НЕ вешаем, шипим в тост.
      this.syncOk = true;
      this.syncErrorHandler?.({
        code: "contract",
        message: "Данные сервера не соответствуют формату",
      });
      this.bus.emit("sync");
      return fail({ code: "contract", message: "Некорректный формат данных" });
    }
  }

  loadSnapshot(): boolean {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as {
        sessions: WorkoutSession[];
        bookings: Booking[];
        users: User[];
      };
      this.sessions = data.sessions ?? [];
      this.bookings = data.bookings ?? [];
      this.users = data.users ?? [];
      return this.sessions.length > 0;
    } catch {
      return false;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({
          sessions: this.sessions,
          bookings: this.bookings,
          users: this.users,
        }),
      );
    } catch {
      /* quota / private mode */
    }
  }

  addBooking(b: Booking): void {
    this.bookings = [...this.bookings, b];
    this.bus.emit("bookings");
  }
  removeBooking(id: string): void {
    this.bookings = this.bookings.filter((b) => b.id !== id);
    this.bus.emit("bookings");
  }
  replaceBooking(tempId: string, real: Booking): void {
    this.bookings = this.bookings.map((b) => (b.id === tempId ? real : b));
    this.bus.emit("bookings");
  }

  upsertSession(s: WorkoutSession): void {
    const i = this.sessions.findIndex((x) => x.id === s.id);
    this.sessions =
      i >= 0
        ? this.sessions.map((x) => (x.id === s.id ? s : x))
        : [...this.sessions, s];
    this.bus.emit("sessions");
  }
  removeSession(id: string): void {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.bookings = this.bookings.filter((b) => b.sessionId !== id);
    this.bus.emit("sessions");
    this.bus.emit("bookings");
  }

  upsertUser(u: User): void {
    const i = this.users.findIndex((x) => x.id === u.id);
    this.users =
      i >= 0
        ? this.users.map((x) => (x.id === u.id ? u : x))
        : [...this.users, u];
    this.bus.emit("users");
  }
  removeUser(id: string): void {
    this.users = this.users.filter((u) => u.id !== id);
    this.bookings = this.bookings.filter((b) => b.userId !== id);
    this.bus.emit("users");
    this.bus.emit("bookings");
  }
}
