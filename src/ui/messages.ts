import type { DomainError } from "../core/errors";

const FALLBACK: Record<string, string> = {
  validation: "Проверьте введённые данные",
  "not-found": "Данные не найдены",
  forbidden: "Недостаточно прав для этого действия",
  "invalid-credentials": "Неверный email или пароль",
  "email-taken": "Этот email уже занят",
  "session-full": "Свободных мест не осталось",
  "already-booked": "Вы уже записаны на эту тренировку",
  "session-started": "Тренировка уже началась или завершилась",
  "capacity-below-booked": "Вместимость меньше числа записей",
  "self-delete": "Нельзя удалить собственную учётную запись",
  network: "Сервер недоступен",
};

export function errorMessage(error: DomainError): string {
  const message = error.message?.trim();
  if (message) return message;
  return FALLBACK[error.code] ?? "Неизвестная ошибка";
}
