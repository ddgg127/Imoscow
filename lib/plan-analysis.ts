import { DISTANCE_WEIGHT, VEHICLE_COST, coordKey, minutesLabel, uniquePoints, type Engineer, type Job, type OptimizationResult, type RoutePlan, type TravelMatrix } from "./vrptw";

export type AssignmentRow = {
  jobId: string;
  address: string;
  region: string;
  window: string;
  baselineEngineer: string;
  vrptwEngineer: string;
  changed: boolean;
};

export type LegRow = {
  source: "VRPTW" | "исходный";
  engineer: string;
  sequence: number;
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  km: number;
  minutes: number;
};

export type PlanAnalysis = {
  assigned: number;
  vehiclesVrptw: number;
  vehiclesBaseline: number;
  distanceVrptw: number;
  distanceBaseline: number;
  extraKm: number;
  packNote: string;
  assignments: AssignmentRow[];
  legs: LegRow[];
  matrix: { labels: string[]; km: number[][] };
};

function engineerName(engineers: Engineer[], id: string | null) {
  if (!id) return "—";
  return engineers.find(item => item.id === id)?.name ?? id;
}

function jobLabel(job: Job | undefined, fallback: string) {
  if (!job) return fallback;
  return `${job.id} · ${job.address}`;
}

function legsFrom(source: LegRow["source"], engineer: Engineer, plan: RoutePlan, jobs: Map<string, Job>): LegRow[] {
  let fromId = `depot:${engineer.id}`;
  let fromLabel = `База · ${engineer.name}`;
  let fromPoint = engineer.start;
  return plan.stops.map((stop, index) => {
    const job = jobs.get(stop.jobId);
    const toPoint = job?.coordinates ?? fromPoint;
    const minutes = stop.arrival - (index === 0 ? engineer.shiftStart : plan.stops[index - 1].end);
    const row: LegRow = {
      source,
      engineer: engineer.name,
      sequence: index + 1,
      fromId,
      toId: stop.jobId,
      fromLabel,
      toLabel: jobLabel(job, stop.jobId),
      km: stop.distanceKm,
      minutes,
    };
    fromId = stop.jobId;
    fromLabel = row.toLabel;
    fromPoint = toPoint;
    return row;
  });
}

export function buildPlanAnalysis(result: OptimizationResult, engineers: Engineer[], travel?: TravelMatrix): PlanAnalysis {
  const jobs = new Map(result.jobs.map(job => [job.id, job]));
  const byId = new Map(engineers.map(item => [item.id, item]));
  const assignments: AssignmentRow[] = result.jobs.map(job => ({
    jobId: job.id,
    address: job.address,
    region: job.region,
    window: `${minutesLabel(job.windowStart)}–${minutesLabel(job.windowEnd)}`,
    baselineEngineer: engineerName(engineers, job.baselineEngineerId),
    vrptwEngineer: engineerName(engineers, job.engineerId),
    changed: (job.engineerId ?? "") !== (job.baselineEngineerId ?? ""),
  }));
  const vrptwLegs = result.routes.flatMap(route => {
    const engineer = byId.get(route.engineerId);
    return engineer ? legsFrom("VRPTW", engineer, route, jobs) : [];
  });
  const baselineLegs = result.baselineRoutes.flatMap(route => {
    const engineer = byId.get(route.engineerId);
    return engineer ? legsFrom("исходный", engineer, route, jobs) : [];
  });
  const points = uniquePoints(engineers, result.jobs).slice(0, 28);
  const labels = points.map((point, index) => {
    const job = result.jobs.find(item => coordKey(item.coordinates) === coordKey(point));
    const engineer = engineers.find(item => coordKey(item.start) === coordKey(point));
    if (job) return job.id;
    if (engineer) return `база:${engineer.initials}`;
    return `p${index + 1}`;
  });
  const km = points.map(a => points.map(b => {
    if (coordKey(a) === coordKey(b)) return 0;
    return travel ? travel.distanceKm(a, b) : 0;
  }));
  const extraKm = result.metrics.distanceKm - result.baseline.distanceKm;
  const vehiclesVrptw = result.routes.length;
  const vehiclesBaseline = result.baselineRoutes.length;
  const breakEven = VEHICLE_COST / DISTANCE_WEIGHT;
  const packNote = extraKm > 0.05
    ? `VRPTW держит ${vehiclesVrptw} машин вместо ${vehiclesBaseline}. Штраф за новую машину равен ${VEHICLE_COST} ≈ ${breakEven.toFixed(0)} км, поэтому уплотнение принимается, даже если суммарный пробег растёт.`
    : extraKm < -0.05
      ? "Текущий план короче контрольного распределения по километрам."
      : "Пробег почти совпадает с контрольным распределением.";
  return {
    assigned: result.metrics.assigned,
    vehiclesVrptw,
    vehiclesBaseline,
    distanceVrptw: result.metrics.distanceKm,
    distanceBaseline: result.baseline.distanceKm,
    extraKm,
    packNote,
    assignments,
    legs: [...vrptwLegs, ...baselineLegs],
    matrix: { labels, km },
  };
}

function csv(rows: Array<Array<string | number>>) {
  return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, "\"\"")}"`).join(";")).join("\n");
}

function save(filename: string, body: string, type: string) {
  const blob = new Blob(["\uFEFF" + body], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadAnalysis(analysis: PlanAnalysis, kind: "assignments" | "legs" | "matrix" | "json") {
  if (kind === "assignments") {
    save("vrptw-assignments.csv", csv([
      ["Заявка", "Адрес", "Зона", "Окно", "Исходный инженер", "VRPTW", "Переназначена"],
      ...analysis.assignments.map(row => [row.jobId, row.address, row.region, row.window, row.baselineEngineer, row.vrptwEngineer, row.changed ? "да" : "нет"]),
    ]), "text/csv;charset=utf-8");
    return;
  }
  if (kind === "legs") {
    save("vrptw-legs.csv", csv([
      ["Источник", "Инженер", "№", "Откуда", "Куда", "км", "мин"],
      ...analysis.legs.map(row => [row.source, row.engineer, row.sequence, row.fromLabel, row.toLabel, row.km.toFixed(3), row.minutes.toFixed(1)]),
    ]), "text/csv;charset=utf-8");
    return;
  }
  if (kind === "matrix") {
    save("vrptw-matrix.csv", csv([
      ["", ...analysis.matrix.labels],
      ...analysis.matrix.labels.map((label, i) => [label, ...analysis.matrix.km[i].map(value => value.toFixed(3))]),
    ]), "text/csv;charset=utf-8");
    return;
  }
  save("vrptw-analysis.json", JSON.stringify(analysis, null, 2), "application/json");
}

export function formatKm(value: number) {
  return `${value.toFixed(1).replace(".", ",")} км`;
}
