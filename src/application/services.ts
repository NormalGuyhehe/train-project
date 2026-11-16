import type { Api } from "../api/client";
import type { DomainError } from "../core/errors";
import { fail, ok, type Result } from "../core/result";
import { checkBookable } from "../core/rules";
import type {
  Booking,
  SessionDraft,
  User,
  UserPatch,
  WorkoutSession,
} from "../core/types";
import type { AppState } from "../state/app-state";

export class RemoteAuth {
  constructor(
    private readonly api: Api,
    private readonly state: AppState,
  ) {}
  currentUser(): User | null {
    return this.state.me;
  }

  async login(
    email: string,
    password: string,
  ): Promise<Result<User, DomainError>> {
    const r = await this.api.auth.login(email, password);
    if (!r.ok) return r;
    await this.state.refresh();
    this.state.setMe(r.value);
    return r;
  }

  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<Result<User, DomainError>> {
    const r = await this.api.auth.register(name, email, password);
    if (!r.ok) return r;
    await this.state.refresh();
    this.state.setMe(r.value);
    return r;
  }

  async logout(): Promise<void> {
    await this.api.auth.logout();
    this.state.setMe(null);
  }

  async restoreSession(): Promise<Result<User, DomainError>> {
    const r = await this.api.auth.me();
    if (!r.ok) return r;
    await this.state.refresh();
    this.state.setMe(r.value);
    return r;
  }
}

export class RemoteBooking {
  constructor(
    private readonly api: Api,
    private readonly state: AppState,
  ) {}

  async book(sessionId: string): Promise<Result<Booking, DomainError>> {
    const me = this.state.me;
    if (!me) return fail({ code: "forbidden" });
    const session = this.state.sessionById(sessionId);
    if (!session)
      return fail({ code: "not-found", message: "Тренировка не найдена" });
    const check = checkBookable(
      session,
      this.state.allBookings(),
      me.id,
      new Date(),
    );
    if (!check.ok) return check;
    const temp: Booking = {
      id: `tmp-${Date.now()}`,
      userId: me.id,
      sessionId,
      createdAt: new Date().toISOString(),
    };
    this.state.addBooking(temp);
    const r = await this.api.bookings.create(sessionId);
    if (!r.ok) {
      this.state.removeBooking(temp.id);
      return r;
    }
    this.state.replaceBooking(temp.id, r.value);
    return r;
  }

  async cancel(bookingId: string): Promise<Result<Booking, DomainError>> {
    const snapshot = this.state.bookingById(bookingId);
    if (snapshot) this.state.removeBooking(bookingId);
    const r = await this.api.bookings.cancel(bookingId);
    if (!r.ok && snapshot) this.state.addBooking(snapshot);
    return r;
  }

  async restore(booking: Booking): Promise<Result<Booking, DomainError>> {
    return this.book(booking.sessionId);
  }

  ofCurrentUser(): Booking[] {
    const me = this.state.me;
    return me ? this.state.allBookings().filter((b) => b.userId === me.id) : [];
  }
}

export class RemoteCatalog {
  constructor(
    private readonly api: Api,
    private readonly state: AppState,
  ) {}

  async create(
    draft: SessionDraft,
  ): Promise<Result<WorkoutSession, DomainError>> {
    const r = await this.api.sessions.create(draft);
    if (r.ok) this.state.upsertSession(r.value);
    return r;
  }

  async update(
    id: string,
    draft: SessionDraft,
  ): Promise<Result<WorkoutSession, DomainError>> {
    const r = await this.api.sessions.update(id, draft);
    if (r.ok) this.state.upsertSession(r.value);
    return r;
  }

  async remove(
    id: string,
  ): Promise<Result<{ undoToken: string }, DomainError>> {
    const r = await this.api.sessions.remove(id);
    if (r.ok) this.state.removeSession(id);
    return r;
  }

  async restore(undoToken: string): Promise<Result<void, DomainError>> {
    const r = await this.api.sessions.restore(undoToken);
    if (r.ok) await this.state.refresh();
    return r;
  }
}

export class RemoteAccounts {
  constructor(
    private readonly api: Api,
    private readonly state: AppState,
  ) {}

  async update(
    id: string,
    patch: UserPatch,
  ): Promise<Result<User, DomainError>> {
    const r = await this.api.users.update(id, patch);
    if (r.ok) this.state.upsertUser(r.value);
    return r;
  }

  async remove(
    id: string,
  ): Promise<Result<{ undoToken: string }, DomainError>> {
    const r = await this.api.users.remove(id);
    if (r.ok) this.state.removeUser(id);
    return r;
  }

  async restore(undoToken: string): Promise<Result<void, DomainError>> {
    const r = await this.api.users.restore(undoToken);
    if (r.ok) await this.state.refresh();
    return r;
  }
}

export const asResult = ok;
