import { minutesLabel, type Engineer, type Job } from "./vrptw.ts";
import { engineerSpeedKmh } from "./transport-speed.ts";

export const executionLabels = {
  not_started: "Не начата",
  in_progress: "Начата",
  completed: "Завершена",
} as const;

function searchableValues(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(searchableValues);
  if (typeof value === "object") return Object.values(value).flatMap(searchableValues);
  return [String(value)];
}

/** Search every source field, including resources, coordinates, times and states. */
export function matchesEditorQuery(item: Job | Engineer, query: string, unavailable = false) {
  const terms = query.trim().toLocaleLowerCase("ru").split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const isJob = "windowStart" in item;
  const extras = isJob
    ? [minutesLabel(item.windowStart), minutesLabel(item.windowEnd), executionLabels[item.executionStatus ?? "not_started"], item.cancelled ? "отменена да" : "не отменена нет", item.geocodeVerified ? "геокодирование подтверждено" : "геокодирование не подтверждено"]
    : [minutesLabel(item.shiftStart), minutesLabel(item.shiftEnd), unavailable ? "недоступен вне смены" : "доступен в смене"];
  const text = [...searchableValues(item), ...extras].join(" ").toLocaleLowerCase("ru");
  return terms.every(term => text.includes(term));
}

export function executionAtTime(job: Job, stop: { arrival: number; end: number } | undefined, time: number | null) {
  if (job.executionStatus === "completed") return "completed" as const;
  if (time == null || !stop) return job.executionStatus ?? "not_started";
  if (time >= stop.end) return "completed" as const;
  if (time >= stop.arrival) return "in_progress" as const;
  return job.executionStatus ?? "not_started";
}

export function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : NaN;
}

export function timeInput(value: number) {
  return Number.isFinite(value) && value >= 0 && value < 1440 ? minutesLabel(value) : "";
}

export function validateEditedData(jobs: Job[], engineers: Engineer[]) {
  if (!jobs.length) return "Добавьте хотя бы одну заявку.";
  if (!engineers.length) return "Добавьте хотя бы одного инженера.";
  if (jobs.length > 1000 || engineers.length > 500) return "Лимит: 1000 заявок и 500 инженеров.";
  const ids = new Set<string>();
  for (const [index, job] of jobs.entries()) {
    if (!job.id.trim() || ids.has(job.id)) return `Заявка ${index + 1}: пустой или повторяющийся ID.`;
    ids.add(job.id);
    if (!job.address.trim() || !job.kind.trim() || !job.equipment.trim()) return `Заявка № ${job.id}: укажите адрес, навык и оборудование.`;
    if (!validCoordinate(job.coordinates)) return `Заявка № ${job.id}: координаты вне допустимого диапазона.`;
    if (!validWindow(job.windowStart, job.windowEnd)) return `Заявка № ${job.id}: некорректное окно времени.`;
    if (!Number.isFinite(job.serviceMinutes) || job.serviceMinutes <= 0) return `Заявка № ${job.id}: норматив должен быть положительным.`;
    if (![1, 2].includes(job.priority)) return `Заявка № ${job.id}: приоритет должен быть обычным или повышенным.`;
  }
  ids.clear();
  for (const [index, engineer] of engineers.entries()) {
    if (!engineer.id.trim() || ids.has(engineer.id)) return `Инженер ${index + 1}: пустой или повторяющийся ID.`;
    ids.add(engineer.id);
    if (!engineer.name.trim() || !engineer.skills.length || !engineer.equipment.length) return `Инженер ${engineer.name || engineer.id}: укажите имя, навыки и оборудование.`;
    if (!validCoordinate(engineer.start)) return `Инженер ${engineer.name}: координаты базы вне допустимого диапазона.`;
    if (!validWindow(engineer.shiftStart, engineer.shiftEnd)) return `Инженер ${engineer.name}: некорректная смена.`;
    if (!Number.isFinite(engineerSpeedKmh(engineer.transport, engineer.speedKmh, 24))) return `Инженер ${engineer.name}: некорректная скорость.`;
    if (engineer.speedKmh != null && (!Number.isFinite(engineer.speedKmh) || engineer.speedKmh < 2 || engineer.speedKmh > 200)) return `Инженер ${engineer.name}: скорость должна быть от 2 до 200 км/ч.`;
  }
  return null;
}

function validWindow(start: number, end: number) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1440 && start < end;
}

function validCoordinate(point: [number, number]) {
  return point.every(Number.isFinite) && point[0] >= 36 && point[0] <= 39 && point[1] >= 54 && point[1] <= 57;
}
