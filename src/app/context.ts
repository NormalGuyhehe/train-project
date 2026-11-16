import type {
  RemoteAccounts,
  RemoteAuth,
  RemoteBooking,
  RemoteCatalog,
} from "../application/services";
import type { AppState, EventBus } from "../state/app-state";
import type { OverlayHost } from "../ui/overlay";
import type { ToastCenter } from "../ui/toast";
import type { SavedViewsStore } from "./saved-views";

export type Route = "home" | "auth" | "schedule" | "bookings" | "admin";

export interface AppContext {
  auth: RemoteAuth;
  booking: RemoteBooking;
  catalog: RemoteCatalog;
  accounts: RemoteAccounts;
  state: AppState;
  savedViews: SavedViewsStore;
  bus: EventBus;
  toasts: ToastCenter;
  overlays: OverlayHost;
  navigate(route: Route): void;
}
