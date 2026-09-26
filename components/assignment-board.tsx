"use client";

import { useMemo, useState } from "react";
import { Search, X, Zap } from "lucide-react";
import { jobPriorityLevel, type Engineer, type Job, type RoutePlan } from "@/lib/vrptw";

export type TaskFilter = "all" | "in_progress" | "waiting" | "completed" | "unassigned" | "cancelled";
export type JobState = Exclude<TaskFilter, "all">;

export function getJobState(job: Job, started: boolean): JobState {
  if (job.cancelled) return "cancelled";
  if (job.executionStatus === "completed") return "completed";
  if (job.executionStatus === "in_progress") return "in_progress";
  if (started && !job.engineerId) return "unassigned";
  return "waiting";
}

const stateLabels: Record<JobState, string> = {
  in_progress: "В работе",
  waiting: "Ожидает",
  completed: "Завершена",
  unassigned: "Не удаётся назначить",
  cancelled: "Отменена",
};

export function AssignmentBoard({ jobs, engineers, routes, selectedJobId, selectedEngineerId, started, loading, onSelectJob, onSelectEngineer, onShowAll }: {
  jobs: Job[];
  engineers: Engineer[];
  routes: RoutePlan[];
  selectedJobId: string | null;
  selectedEngineerId: string | null;
  started: boolean;
  loading: boolean;
  onSelectJob: (id: string) => void;
  onSelectEngineer: (id: string) => void;
  onShowAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const byEngineer = useMemo(() => new Map(engineers.map(engineer => [engineer.id, engineer])), [engineers]);
  const positionByJob = useMemo(() => new Map(routes.flatMap(route => route.stops.map((stop, index) => [stop.jobId, `${index + 1}/${route.stops.length}`] as const))), [routes]);
  const jobStates = useMemo(() => new Map(jobs.map(job => [job.id, getJobState(job, started)] as const)), [jobs, started]);
  const counts = useMemo(() => {
    const result: Record<TaskFilter, number> = { all: jobs.length, in_progress: 0, waiting: 0, completed: 0, unassigned: 0, cancelled: 0 };
    for (const state of jobStates.values()) result[state]++;
    return result;
  }, [jobs.length, jobStates]);
  const shown = useMemo(() => jobs.filter(job => {
    if (filter !== "all" && jobStates.get(job.id) !== filter) return false;
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return true;
    const engineer = job.engineerId ? byEngineer.get(job.engineerId) : undefined;
    const numericId = String(parseInt(job.id, 10));
    return [job.id, numericId, job.address, job.kind, engineer?.name ?? ""].some(value => value.toLocaleLowerCase("ru").includes(needle));
  }), [jobs, filter, query, jobStates, byEngineer]);

  const filters: { id: TaskFilter; label: string; className: string }[] = [
    { id: "all", label: "Все", className: "btn-all" },
    { id: "in_progress", label: "В работе", className: "btn-in-progress" },
    { id: "waiting", label: "Ожидают", className: "btn-waiting" },
    { id: "completed", label: "Завершены", className: "btn-completed" },
    { id: "unassigned", label: "Не удаётся назначить", className: "btn-unassigned" },
    { id: "cancelled", label: "Отменены", className: "btn-cancelled" },
  ];

  return <div className="assignment-board">
    <div className="assignment-tools">
      <div className="assignment-search"><Search aria-hidden="true" /><input aria-label="Поиск по номеру, адресу или инженеру" placeholder="№, адрес или инженер" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")}><X /></button>}</div>
      <div className="assignment-filters" role="group" aria-label="Фильтры состояния заявок">
        {filters.map(item => <button type="button" key={item.id} className={`filter-btn ${item.className}${filter === item.id ? " active" : ""}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} <b>{counts[item.id]}</b></button>)}
      </div>
    </div>
    <div className="assignment-table-head"><span>Заявка</span><span>Назначенный инженер</span></div>
    <div className="assignment-table" role="list" aria-label="Заявки и назначенные инженеры">
      {shown.map(job => {
        const engineer = job.engineerId ? byEngineer.get(job.engineerId) : undefined;
        const state = jobStates.get(job.id) ?? "waiting";
        return <div className="assignment-row" role="listitem" key={job.id}>
          <button type="button" className={`assignment-job${selectedJobId === job.id ? " selected" : ""}`} onClick={() => onSelectJob(job.id)} title={`${job.address} · ${job.kind}`} aria-label={`Открыть заявку № ${job.id}, ${job.address}`}>
            <span className={`assignment-tone ${job.tone}`} aria-hidden="true" />
            <span className="assignment-cell-copy"><strong>№ {job.id}{jobPriorityLevel(job) === 2 && <Zap className="assignment-urgent-icon" aria-label="Повышенный приоритет" />}</strong><small>{job.time} · {stateLabels[state]}</small><small title={job.address}>{job.address}</small></span>
          </button>
          {engineer && !job.cancelled ? <button type="button" className={`assignment-engineer${selectedEngineerId === engineer.id ? " selected" : ""}`} onClick={() => onSelectEngineer(engineer.id)} title={`Показать маршрут: ${engineer.name}`} aria-label={`Показать маршрут инженера ${engineer.name} для заявки № ${job.id}`}>
            <span className="assignment-avatar" style={{ background: `${engineer.color}20`, color: engineer.color }}>{engineer.initials}</span>
            <span className="assignment-cell-copy"><strong>{engineer.name.replace(/^Инженер\s+/i, "")}</strong><small>{positionByJob.get(job.id) ?? "—"} в маршруте</small></span>
          </button> : <span className="assignment-unassigned">{job.cancelled ? "Отменена" : loading ? "Расчёт…" : "Не назначен"}</span>}
        </div>;
      })}
      {!shown.length && <div className="assignment-no-results">По этому запросу заявок нет.</div>}
    </div>
    {(selectedEngineerId || selectedJobId) && <button className="assignment-show-all" type="button" onClick={onShowAll}>Показать все заявки и маршруты</button>}
  </div>;
}
