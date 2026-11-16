import { addDays, dayKey } from "../core/rules";
import type { WorkoutKind } from "../core/types";
import { h } from "./dom";

export const KIND_LABEL: Record<WorkoutKind, string> = {
  strength: "Силовая",
  cardio: "Кардио",
  yoga: "Йога",
  crossfit: "Кроссфит",
  stretch: "Стретчинг",
};

export const KIND_INTENSITY: Record<
  WorkoutKind,
  { label: string; level: 1 | 2 | 3 }
> = {
  strength: { label: "Интенсивная", level: 3 },
  crossfit: { label: "Интенсивная", level: 3 },
  cardio: { label: "Средняя", level: 2 },
  yoga: { label: "Спокойная", level: 1 },
  stretch: { label: "Спокойная", level: 1 },
};

const unsplash = (id: string, w: number): string =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;

export const KIND_PHOTO: Record<WorkoutKind, string> = {
  strength: unsplash("photo-1526506118085-60ce8714f8c5", 800),
  cardio: unsplash("photo-1476480862126-209bfaa8edc8", 800),
  yoga: unsplash("photo-1544367567-0f2fcb009e0b", 800),
  crossfit: unsplash("photo-1541534741688-6078c6bfb5c5", 800),
  stretch: unsplash("photo-1552196563-55cd4e45efb3", 800),
};

export const KIND_GRADIENT: Record<WorkoutKind, string> = {
  strength: "linear-gradient(135deg,#1e3a8a,#2f6fed)",
  cardio: "linear-gradient(135deg,#b3300f,#e4572e)",
  yoga: "linear-gradient(135deg,#5b34b8,#8b5cf6)",
  crossfit: "linear-gradient(135deg,#7a5200,#c98a0b)",
  stretch: "linear-gradient(135deg,#0b6e6a,#12a5a0)",
};

export const HERO_PHOTO = unsplash("photo-1571902943202-507ec2618e8f", 1400);
export const AUTH_PHOTO = unsplash("photo-1534438327276-14e5300c3a48", 1200);
export const coverUrl = (kind: WorkoutKind): string => KIND_PHOTO[kind];

const timeFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
});
const fullFmt = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const weekdayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short" });

export const fmtTime = (iso: string): string => timeFmt.format(new Date(iso));
export const fmtDate = (iso: string): string => dateFmt.format(new Date(iso));
export const fmtFull = (iso: string): string =>
  `${fullFmt.format(new Date(iso))}, ${fmtTime(iso)}`;
export const fmtEndTime = (iso: string, durationMin: number): string =>
  fmtTime(new Date(Date.parse(iso) + durationMin * 60_000).toISOString());

export function dayLabel(
  offset: number,
  now: Date,
): { top: string; sub: string } {
  const d = addDays(now, offset);
  const top =
    offset === 0 ? "Сегодня" : offset === 1 ? "Завтра" : weekdayFmt.format(d);
  return { top, sub: dateFmt.format(d) };
}

export function relativeDay(iso: string, now: Date): string {
  const key = dayKey(iso);
  if (key === dayKey(now)) return "Сегодня";
  if (key === dayKey(addDays(now, 1))) return "Завтра";
  if (key === dayKey(addDays(now, -1))) return "Вчера";
  return weekdayFmt.format(new Date(iso));
}

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function timeInputValue(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const toCsv = (rows: (string | number)[][]): string =>
  rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"),
    )
    .join("\r\n");

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }),
  );
  const a = h("a", { attrs: { href: url, download: filename } });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
