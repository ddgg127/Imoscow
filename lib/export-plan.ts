import type { SolverEngine } from "./server-solver.ts";
import { minutesLabel, type Engineer, type OptimizationResult } from "./vrptw.ts";

export type ExportMetadata = {
  solver: SolverEngine;
  generatedAt?: string;
  speedKmh?: number;
};

const csvColumns = [
  "Заявка", "Статус", "Регион", "Адрес", "Тип работы", "Окно SLA", "Инженер",
  "Порядок", "Прибытие", "Начало работ", "Окончание", "Пробег участка, км",
  "Навык", "Оборудование", "Транспорт", "Источник", "Причина отсутствия маршрута",
  "Baseline инженер", "Выполнение", "Срочность", "Класс работ",
  "Работа, мин", "Норматив, мин", "Резерв дороги, мин", "Расчётная дорога, мин", "Источник норматива",
] as const;

function safeCell(value: unknown) {
  const text = value == null ? "" : String(value);
  // Prevent spreadsheet formula execution when a user-provided field is opened in Excel.
  const protectedText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(protectedText) ? `"${protectedText.replaceAll('"', '""')}"` : protectedText;
}

export function buildPlanRows(result: OptimizationResult, engineers: Engineer[]) {
  const engineerById = new Map(engineers.map(engineer => [engineer.id, engineer]));
  const routeByJob = new Map(result.routes.flatMap(route => route.stops.map((stop, index) => [stop.jobId, { route, stop, index }])));
  return result.jobs.map(job => {
    const assignment = routeByJob.get(job.id);
    const engineer = job.engineerId ? engineerById.get(job.engineerId) : undefined;
    const baseline = job.baselineEngineerId ? engineerById.get(job.baselineEngineerId) : undefined;
    return [
      job.id,
      assignment ? "Назначена" : "Нет маршрута",
      job.region,
      job.address,
      job.kind,
      job.time,
      engineer?.name ?? "",
      assignment ? assignment.index + 1 : "",
      assignment ? minutesLabel(assignment.stop.arrival) : "",
      assignment ? minutesLabel(assignment.stop.start) : "",
      assignment ? minutesLabel(assignment.stop.end) : "",
      assignment ? assignment.stop.distanceKm.toFixed(3) : "",
      job.kind,
      job.equipment,
      job.requiredTransport,
      job.source,
      job.unassignedReason ?? "",
      baseline?.name ?? "",
      job.executionStatus ?? "not_started",
      job.urgency ?? "normal",
      job.workClass ?? "repair",
      job.serviceMinutes,
      job.normativeMinutes ?? "",
      job.travelReserveMinutes ?? "",
      assignment?.stop.travelMinutes ?? job.estimatedTravelMinutes ?? "",
      job.normSource ?? "",
    ];
  });
}

export function serializePlanCsv(result: OptimizationResult, engineers: Engineer[]) {
  const rows = buildPlanRows(result, engineers);
  return [csvColumns, ...rows].map(row => row.map(safeCell).join(";")).join("\r\n");
}

export function buildPlanExport(result: OptimizationResult, engineers: Engineer[], metadata: ExportMetadata) {
  const engineerById = new Map(engineers.map(engineer => [engineer.id, engineer]));
  const jobById = new Map(result.jobs.map(job => [job.id, job]));
  return {
    schemaVersion: "1.0",
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    solver: metadata.solver,
    config: { speedKmh: metadata.speedKmh ?? null },
    metrics: result.metrics,
    baseline: result.baseline,
    comparison: result.comparison,
    zones: result.zones,
    routes: result.routes.map(route => ({
      engineer: engineerById.get(route.engineerId) ?? { id: route.engineerId },
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      load: route.load,
      stops: route.stops.map((stop, index) => ({ order: index + 1, ...stop, job: jobById.get(stop.jobId) })),
    })),
    unassigned: result.jobs.filter(job => !job.engineerId).map(job => ({ job, reason: job.unassignedReason ?? null })),
  };
}

export function serializePlanJson(result: OptimizationResult, engineers: Engineer[], metadata: ExportMetadata) {
  return JSON.stringify(buildPlanExport(result, engineers, metadata), null, 2);
}

export function downloadPlan(result: OptimizationResult, engineers: Engineer[], format: "csv" | "json", metadata: ExportMetadata) {
  const content = format === "csv" ? `\uFEFF${serializePlanCsv(result, engineers)}` : serializePlanJson(result, engineers, metadata);
  const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `fieldflow-plan-${new Date().toISOString().slice(0, 10)}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
