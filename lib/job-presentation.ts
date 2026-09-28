import type { Job } from "./vrptw.ts";

export type JobState = "in_progress" | "waiting" | "completed" | "unassigned" | "cancelled";
export const jobStateLabels: Record<JobState, string> = {
  in_progress: "Выполняется", waiting: "Ожидает", completed: "Завершена",
  unassigned: "Не назначена", cancelled: "Отменена",
};

export function getJobState(job: Pick<Job, "cancelled" | "executionStatus" | "engineerId">, started: boolean): JobState {
  if (job.cancelled) return "cancelled";
  if (job.executionStatus === "completed") return "completed";
  if (job.executionStatus === "in_progress") return "in_progress";
  if (started && !job.engineerId) return "unassigned";
  return "waiting";
}
