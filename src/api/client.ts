import type { DomainError } from "../core/errors";
import { fail, ok, type Result } from "../core/result";
import type {
  Booking,
  SessionDraft,
  User,
  UserPatch,
  WorkoutSession,
} from "../core/types";

export interface StateDto {
  sessions: WorkoutSession[];
  bookings: Booking[];
  users: User[] | null;
}
export interface UndoDto {
  undoToken: string;
}

export interface Api {
  auth: {
    register(
      name: string,
      email: string,
      password: string,
    ): Promise<Result<User, DomainError>>;
    login(email: string, password: string): Promise<Result<User, DomainError>>;
    logout(): Promise<Result<void, DomainError>>;
    me(): Promise<Result<User, DomainError>>;
  };
  state(): Promise<Result<StateDto, DomainError>>;
  sessions: {
    create(draft: SessionDraft): Promise<Result<WorkoutSession, DomainError>>;
    update(
      id: string,
      draft: SessionDraft,
    ): Promise<Result<WorkoutSession, DomainError>>;
    remove(id: string): Promise<Result<UndoDto, DomainError>>;
    restore(undoToken: string): Promise<Result<void, DomainError>>;
  };
  bookings: {
    create(sessionId: string): Promise<Result<Booking, DomainError>>;
    cancel(id: string): Promise<Result<Booking, DomainError>>;
  };
  users: {
    update(id: string, patch: UserPatch): Promise<Result<User, DomainError>>;
    remove(id: string): Promise<Result<UndoDto, DomainError>>;
    restore(undoToken: string): Promise<Result<void, DomainError>>;
  };
}

export class ApiClient implements Api {
  constructor(private readonly base: string) {}

  auth = {
    register: (name: string, email: string, password: string) =>
      this.request<User>("POST", "/auth/register", { name, email, password }),
    login: (email: string, password: string) =>
      this.request<User>("POST", "/auth/login", { email, password }),
    logout: () => this.requestVoid("POST", "/auth/logout"),
    me: () => this.request<User>("GET", "/auth/me"),
  };

  state = (): Promise<Result<StateDto, DomainError>> =>
    this.request<StateDto>("GET", "/state");

  sessions = {
    create: (draft: SessionDraft) =>
      this.request<WorkoutSession>("POST", "/sessions", draft),
    update: (id: string, draft: SessionDraft) =>
      this.request<WorkoutSession>("PUT", `/sessions/${id}`, draft),
    remove: (id: string) => this.request<UndoDto>("DELETE", `/sessions/${id}`),
    restore: (undoToken: string) =>
      this.requestVoid("POST", "/sessions/restore", { undoToken }),
  };

  bookings = {
    create: (sessionId: string) =>
      this.request<Booking>("POST", "/bookings", { sessionId }),
    cancel: (id: string) => this.request<Booking>("DELETE", `/bookings/${id}`),
  };

  users = {
    update: (id: string, patch: UserPatch) =>
      this.request<User>("PUT", `/users/${id}`, patch),
    remove: (id: string) => this.request<UndoDto>("DELETE", `/users/${id}`),
    restore: (undoToken: string) =>
      this.requestVoid("POST", "/users/restore", { undoToken }),
  };

  private async send(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result<unknown, DomainError>> {
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        method,
        credentials: "include",
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Единственный честный триггер «Сервер недоступен» — нет сетевого ответа.
      return fail({ code: "network", message: "Сервер недоступен" });
    }

    if (response.status === 204) return ok(null);

    // 200, но тело не JSON — это ошибка контракта, НЕ успех и НЕ офлайн.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return fail({
        code: "contract",
        message: `Некорректный ответ сервера (${response.status})`,
      });
    }

    if (!response.ok) {
      // Пробрасываем доменный error из тела как есть; FastAPI {"detail"} маппим в 'server',
      // НИКОГДА не в 'network' — сервер ответил, он жив.
      const err = (payload as { error?: DomainError } | null)?.error;
      if (err) return fail(err);
      const detail = (payload as { detail?: unknown } | null)?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : `Ошибка сервера (${response.status})`;
      return fail({
        code: response.status === 401 ? "unauthorized" : "server",
        message,
      });
    }

    return ok(payload);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result<T, DomainError>> {
    const r = await this.send(method, path, body);
    return r.ok ? ok(r.value as T) : r;
  }

  private async requestVoid(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result<void, DomainError>> {
    const r = await this.send(method, path, body);
    return r.ok ? ok(undefined) : r;
  }
}
