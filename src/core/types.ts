export type Role = "client" | "admin";

export const WORKOUT_KINDS = [
  "strength",
  "cardio",
  "yoga",
  "crossfit",
  "stretch",
] as const;
export type WorkoutKind = (typeof WORKOUT_KINDS)[number];

export type TimeOfDay = "morning" | "day" | "evening";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface WorkoutSession {
  id: string;
  title: string;
  kind: WorkoutKind;
  trainer: string;
  room: string;
  startsAt: string;
  durationMin: number;
  capacity: number;
}

export interface Booking {
  id: string;
  userId: string;
  sessionId: string;
  createdAt: string;
}

export interface SessionDraft {
  title: string;
  kind: WorkoutKind;
  trainer: string;
  room: string;
  date: string;
  time: string;
  durationMin: number;
  capacity: number;
}

export interface UserPatch {
  name: string;
  email: string;
  role: Role;
}

export interface ScheduleFilters {
  dayOffset: number;
  kind: WorkoutKind | "all";
  time: TimeOfDay | "all";
  query: string;
  sort: "time" | "seats";
}

export const DEFAULT_FILTERS: ScheduleFilters = {
  dayOffset: 0,
  kind: "all",
  time: "all",
  query: "",
  sort: "time",
};

export interface ReportRow {
  session: WorkoutSession;
  booked: number;
  occupancy: number;
}
export interface Report {
  rows: ReportRow[];
  totalSessions: number;
  totalBookings: number;
  activeClients: number;
  occupancy: number;
  topKind: WorkoutKind | null;
}
