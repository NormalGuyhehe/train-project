import type { ScheduleFilters } from "../core/types";

export interface FilterPreset {
  id: string;
  name: string;
  filters: ScheduleFilters;
}

const KEY = "atlet:presets:v1";

export class SavedViewsStore {
  all(): FilterPreset[] {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as FilterPreset[]) : [];
    } catch {
      return [];
    }
  }
  save(name: string, filters: ScheduleFilters): void {
    const preset: FilterPreset = {
      id: crypto.randomUUID(),
      name,
      filters: { ...filters },
    };
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.all(), preset]));
    } catch {
      /* noop */
    }
  }
  remove(id: string): void {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(this.all().filter((p) => p.id !== id)),
      );
    } catch {
      /* noop */
    }
  }
}
