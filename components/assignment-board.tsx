"use client";

import { useMemo, useState } from "react";
import {
  Clock,
  MapPin,
  Search,
  User,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { jobPriorityLevel, type Engineer, type Job, type RoutePlan } from "@/lib/vrptw";

export type TaskFilter = "all" | "in_progress" | "waiting" | "completed" | "unassigned" | "cancelled";

export type JobState = "in_progress" | "waiting" | "completed" | "unassigned" | "cancelled";

export function getJobState(job: Job, started: boolean): JobState {
  if (job.cancelled) return "cancelled";
  if (job.executionStatus === "completed") return "completed";
  if (job.executionStatus === "in_progress") return "in_progress";
  if (started && !job.engineerId) return "unassigned";
  return "waiting";
}

const STATE_LABELS: Record<JobState, string> = {
  in_progress: "В работе",
  waiting: "Ожидает",
  completed: "Завершена",
  unassigned: "Не удаётся назначить",
  cancelled: "Отменена",
};

export function AssignmentBoard({
  jobs,
  engineers,
  routes,
  selectedJobId,
  selectedEngineerId,
  started,
  loading,
  onSelectJob,
  onSelectEngineer,
  onShowAll,
}: {
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

  const byEngineer = useMemo(() => new Map(engineers.map(e => [e.id, e])), [engineers]);

  // Compute states and counts
  const jobStates = useMemo(() => {
    const map = new Map<string, JobState>();
    for (const job of jobs) {
      map.set(job.id, getJobState(job, started));
    }
    return map;
  }, [jobs, started]);

  const counts = useMemo(() => {
    let inProgress = 0;
    let waiting = 0;
    let completed = 0;
    let unassigned = 0;
    let cancelled = 0;

    for (const job of jobs) {
      const state = jobStates.get(job.id);
      if (state === "in_progress") inProgress++;
      else if (state === "waiting") waiting++;
      else if (state === "completed") completed++;
      else if (state === "unassigned") unassigned++;
      else if (state === "cancelled") cancelled++;
    }

    return {
      all: jobs.length,
      in_progress: inProgress,
      waiting: waiting,
      completed: completed,
      unassigned: unassigned,
      cancelled: cancelled,
    };
  }, [jobs, jobStates]);

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru");
    return jobs.filter(job => {
      const state = jobStates.get(job.id)!;
      if (filter !== "all" && state !== filter) return false;
      if (!q) return true;
      const engineer = job.engineerId ? byEngineer.get(job.engineerId) : undefined;
      const idNum = String(parseInt(job.id, 10));
      return (
        job.id.toLocaleLowerCase("ru").includes(q) ||
        (!Number.isNaN(Number(idNum)) && idNum === q) ||
        job.address.toLocaleLowerCase("ru").includes(q) ||
        job.kind.toLocaleLowerCase("ru").includes(q) ||
        (engineer?.name ?? "").toLocaleLowerCase("ru").includes(q)
      );
    });
  }, [jobs, filter, query, jobStates, byEngineer]);

  return (
    <div className="task-board-panel">
      {/* Search box */}
      <div className="task-search-row">
        <Search size={14} className="task-search-icon" />
        <input
          type="text"
          className="task-search-input"
          placeholder="Поиск по номеру, адресу или инженеру…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="task-search-clear" onClick={() => setQuery("")}>
            <X size={13} />
          </button>
        )}
      </div>

      {/* 5 Main Filters with special colors */}
      <div className="task-filter-group" role="tablist" aria-label="Фильтры состояния заявок">
        <button
          type="button"
          className={`filter-btn btn-all ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          Все <b>{counts.all}</b>
        </button>
        <button
          type="button"
          className={`filter-btn btn-in-progress ${filter === "in_progress" ? "active" : ""}`}
          onClick={() => setFilter("in_progress")}
        >
          В работе <b>{counts.in_progress}</b>
        </button>
        <button
          type="button"
          className={`filter-btn btn-waiting ${filter === "waiting" ? "active" : ""}`}
          onClick={() => setFilter("waiting")}
        >
          Ожидают <b>{counts.waiting}</b>
        </button>
        <button
          type="button"
          className={`filter-btn btn-completed ${filter === "completed" ? "active" : ""}`}
          onClick={() => setFilter("completed")}
        >
          Завершены <b>{counts.completed}</b>
        </button>
        <button
          type="button"
          className={`filter-btn btn-unassigned ${filter === "unassigned" ? "active" : ""}`}
          onClick={() => setFilter("unassigned")}
        >
          Не удаётся назначить <b>{counts.unassigned}</b>
        </button>
        <button type="button" className={`filter-btn btn-cancelled ${filter === "cancelled" ? "active" : ""}`} onClick={() => setFilter("cancelled")}>
          Отменены <b>{counts.cancelled}</b>
        </button>
      </div>

      {/* Cards list: single column, ~5 cards visible, 6th peeking */}
      <div className="task-cards-column" role="list">
        {filteredJobs.length > 0 ? (
          filteredJobs.map(job => {
            const state = jobStates.get(job.id) || "waiting";
            const engineer = job.engineerId ? byEngineer.get(job.engineerId) : undefined;
            const isUrgent = jobPriorityLevel(job) === 2;
            const isSelected = selectedJobId === job.id;

            return (
              <article
                key={job.id}
                className={`task-item-card state-${state} ${isSelected ? "selected" : ""}`}
                onClick={() => onSelectJob(job.id)}
                role="listitem"
              >
                {/* Row 1: ID, urgent badge, state pill */}
                <div className="card-row-top">
                  <div className="card-id-cluster">
                    <strong className="card-id">{job.id}</strong>
                    {isUrgent && (
                      <span className="card-badge-urgent">
                        <Zap size={10} /> Срочная
                      </span>
                    )}
                  </div>
                  <span className={`card-state-pill ${state}`}>
                    {job.cancelled ? "Отменена" : STATE_LABELS[state]}
                  </span>
                </div>

                {/* Row 2: Window, duration, skill */}
                <div className="card-row-mid">
                  <span className="card-window">
                    <Clock size={12} /> {job.time}
                  </span>
                  <span className="card-duration">{job.serviceMinutes} мин</span>
                  <span className="card-skill-tag" title={`Требуемый навык: ${job.kind}`}>
                    1 навык · {job.kind}
                  </span>
                </div>

                {/* Row 3: Address, assigned engineer */}
                <div className="card-row-bottom">
                  <span className="card-address" title={job.address}>
                    <MapPin size={11} /> {job.address}
                  </span>
                  {engineer ? (
                    <span
                      className="card-engineer-chip"
                      onClick={e => {
                        e.stopPropagation();
                        onSelectEngineer(engineer.id);
                      }}
                      title={`Назначен: ${engineer.name}`}
                    >
                      <span className="chip-avatar" style={{ background: engineer.color }}>
                        {engineer.initials}
                      </span>
                      <span className="chip-name">{engineer.name.split(" ")[0]}</span>
                    </span>
                  ) : (
                    <span className="card-no-engineer">Без исполнителя</span>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="task-empty-state">
            {loading ? "Идёт расчёт маршрутов…" : "В этой категории нет заявок"}
          </div>
        )}
      </div>

      {(selectedEngineerId || selectedJobId) && (
        <div className="task-board-footer">
          <button type="button" className="task-show-all-btn" onClick={onShowAll}>
            Показать все заявки и маршруты
          </button>
        </div>
      )}
    </div>
  );
}
