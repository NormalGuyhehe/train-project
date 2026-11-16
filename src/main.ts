import "./styles/main.css";

import { ApiClient } from "./api/client";
import {
  RemoteAccounts,
  RemoteAuth,
  RemoteBooking,
  RemoteCatalog,
} from "./application/services";
import { AppShell } from "./app/shell";
import type { AppContext } from "./app/context";
import { Router } from "./app/router";
import { SavedViewsStore } from "./app/saved-views";
import { AppState, EventBus } from "./state/app-state";
import { errorMessage } from "./ui/messages";
import { OverlayHost } from "./ui/overlay";
import { ToastCenter } from "./ui/toast";
import { AdminView } from "./views/admin-view";
import { AuthView } from "./views/auth-view";
import { BookingsView } from "./views/bookings-view";
import { LandingView } from "./views/landing-view";
import { ScheduleView } from "./views/schedule-view";

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} не найден — проверь www/index.html`);
  return el;
}

/** Прод (:8001) — same-origin. Dev (:8000) — тот же хост, что открыл пользователь, порт API. */
const apiBase = (): string =>
  location.port === "8001"
    ? "/api"
    : `${location.protocol}//${location.hostname}:8001/api`;

    async function bootstrap(): Promise<void> {
  const bus = new EventBus();
  const api = new ApiClient(apiBase());
  const state = new AppState(api, bus);
  const auth = new RemoteAuth(api, state);
  const booking = new RemoteBooking(api, state);
  const catalog = new RemoteCatalog(api, state);
  const accounts = new RemoteAccounts(api, state);
  const savedViews = new SavedViewsStore();

  const toasts = new ToastCenter(document.body);
  const overlays = new OverlayHost(document.body);
  state.onSyncError((e) => toasts.show(errorMessage(e), "err"));

  let router: Router;
  const ctx: AppContext = {
    auth,
    booking,
    catalog,
    accounts,
    state,
    savedViews,
    bus,
    toasts,
    overlays,
    navigate: (route) => router.navigate(route),
  };

  const shell = new AppShell(ctx, requireElement("app"));
  router = new Router(
    ctx,
    shell.content,
    {
      home: () => new LandingView(ctx),
      auth: () => new AuthView(ctx),
      schedule: () => new ScheduleView(ctx),
      bookings: () => new BookingsView(ctx),
      admin: () => new AdminView(ctx),
    },
    (route) => shell.sync(route),
  );

  bus.on("auth", () => overlays.closeAll());

  const restored = await auth.restoreSession();
  if (!restored.ok && restored.error.code === "network") state.markSyncFailed();
  if (!auth.currentUser()) state.loadSnapshot();
  router.start();
  document.getElementById("boot")?.remove();
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  const boot = document.getElementById("boot");
  if (boot)
    boot.textContent =
      "Не удалось запустить приложение. Открой консоль (F12) и обнови страницу.";
});
