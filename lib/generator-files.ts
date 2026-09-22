import { applyAverageWindows, scaleEngineers, scaleJobs, type Engineer, type Job } from "./vrptw.ts";

export type GeneratedDataset = { jobs: Job[]; engineers: Engineer[]; speedKmh: number };

export function generateDataset(sourceJobs: Job[], sourceEngineers: Engineer[], options: { jobs: number; engineers: number; windowMinutes: number; speedKmh: number }): GeneratedDataset {
  const jobs = applyAverageWindows(scaleJobs(sourceJobs, options.jobs), options.windowMinutes).map(job => ({
    ...job, engineerId: null, baselineEngineerId: null, status: job.cancelled ? "Отменена" : "Новая",
  }));
  return { jobs, engineers: scaleEngineers(sourceEngineers, options.engineers, jobs), speedKmh: options.speedKmh };
}

const columns = ["recordType", "id", "region", "area", "address", "kind", "workType", "lon", "lat", "geocodeQuality", "windowStart", "windowEnd", "serviceMinutes", "equipment", "requiredTransport", "allowedTransports", "priority", "status", "cancelled", "name", "initials", "skills", "transport", "shiftStart", "shiftEnd", "color", "speedKmh"] as const;

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  const safe = /^[=+@\-\t\r]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function generatedCsv(dataset: GeneratedDataset) {
  const jobs = dataset.jobs.map(job => ({ recordType: "job", id: job.id, region: job.region, area: job.area, address: job.address, kind: job.kind, workType: job.workType ?? job.kind, lon: job.coordinates[0], lat: job.coordinates[1], geocodeQuality: job.geocodeQuality, windowStart: job.windowStart, windowEnd: job.windowEnd, serviceMinutes: job.serviceMinutes, equipment: job.equipment, requiredTransport: job.requiredTransport, allowedTransports: job.allowedTransports?.join("|"), priority: job.priority, status: job.status, cancelled: Boolean(job.cancelled), speedKmh: dataset.speedKmh }));
  const engineers = dataset.engineers.map(engineer => ({ recordType: "engineer", id: engineer.id, region: engineer.region, lon: engineer.start[0], lat: engineer.start[1], equipment: engineer.equipment.join("|"), name: engineer.name, initials: engineer.initials, skills: engineer.skills.join("|"), transport: engineer.transport, shiftStart: engineer.shiftStart, shiftEnd: engineer.shiftEnd, color: engineer.color, speedKmh: dataset.speedKmh }));
  return "\uFEFF" + columns.join(",") + "\r\n" + [...jobs, ...engineers].map(row => columns.map(column => csvCell((row as Record<string, unknown>)[column])).join(",")).join("\r\n") + "\r\n";
}

export function generatedJson(dataset: GeneratedDataset) {
  return JSON.stringify({ format: "fieldflow-dataset-v1", speedKmh: dataset.speedKmh, jobs: dataset.jobs, engineers: dataset.engineers }, null, 2);
}

export function downloadGeneratedDataset(dataset: GeneratedDataset, format: "csv" | "json") {
  const content = format === "csv" ? generatedCsv(dataset) : generatedJson(dataset);
  const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fieldflow-${dataset.jobs.length}-jobs-${dataset.engineers.length}-engineers.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
