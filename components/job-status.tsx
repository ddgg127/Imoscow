import { getJobState, jobStateLabels } from "@/lib/job-presentation";
import type { Job } from "@/lib/vrptw";

export function JobStatus({ job, started }: { job: Pick<Job, "cancelled" | "executionStatus" | "engineerId">; started: boolean }) {
  const state = getJobState(job, started);
  return <span className={`job-status status-${state}`}>{jobStateLabels[state]}</span>;
}
