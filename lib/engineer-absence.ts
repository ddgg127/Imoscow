import type { Engineer, OptimizationResult } from "./vrptw.ts";

export type AbsenceMoment = {
  reportedAt: number;
  effectiveAt: number;
  phase: "service" | "travel" | "wait" | "idle";
  currentJobId: string | null;
  completedBefore: number;
};

/** The report takes effect after an active visit; travel and waiting stop immediately. */
export function engineerAbsenceMoment(plan: OptimizationResult, engineer: Engineer, reportedAt: number): AbsenceMoment {
  const stops = plan.routes.find(route => route.engineerId === engineer.id)?.stops ?? [];
  const completedBefore = stops.filter(stop => stop.end <= reportedAt).length;
  let departure = engineer.shiftStart;
  for (const stop of stops) {
    if (reportedAt >= stop.start && reportedAt < stop.end) {
      return { reportedAt, effectiveAt: stop.end, phase: "service", currentJobId: stop.jobId, completedBefore };
    }
    if (reportedAt < stop.start) {
      const phase = reportedAt >= stop.arrival ? "wait" : reportedAt >= departure ? "travel" : "idle";
      return { reportedAt, effectiveAt: reportedAt, phase, currentJobId: stop.jobId, completedBefore };
    }
    departure = stop.end;
  }
  return { reportedAt, effectiveAt: reportedAt, phase: "idle", currentJobId: null, completedBefore };
}

export type AbsenceImpact = { reassigned: Array<{ jobId: string; engineerName: string }>; unassigned: string[]; preserved: string[] };

/** Compare only the engineer's previously planned visits after the event. */
export function absenceImpact(before: OptimizationResult, after: OptimizationResult, engineerId: string, eventTime: number, engineers: Engineer[]): AbsenceImpact {
  const nextOwner = new Map(after.jobs.map(job => [job.id, job.engineerId] as const));
  const names = new Map(engineers.map(engineer => [engineer.id, engineer.name] as const));
  const impact: AbsenceImpact = { reassigned: [], unassigned: [], preserved: [] };
  for (const stop of before.routes.find(route => route.engineerId === engineerId)?.stops ?? []) {
    const owner = nextOwner.get(stop.jobId);
    if (owner === engineerId) impact.preserved.push(stop.jobId);
    else if (owner) impact.reassigned.push({ jobId: stop.jobId, engineerName: names.get(owner) ?? owner });
    else if (stop.end > eventTime) impact.unassigned.push(stop.jobId);
  }
  return impact;
}
