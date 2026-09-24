"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Engineer, Job, RoutePlan } from "@/lib/vrptw";

type Filter = "all" | "assigned" | "unassigned";

export function AssignmentBoard({ jobs, engineers, routes, selectedJobId, selectedEngineerId, loading, onSelectJob, onSelectEngineer, onShowAll }: {
  jobs: Job[];
  engineers: Engineer[];
  routes: RoutePlan[];
  selectedJobId: string | null;
  selectedEngineerId: string | null;
  loading: boolean;
  onSelectJob: (id: string) => void;
  onSelectEngineer: (id: string) => void;
  onShowAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    // Restore plan-tab controls after hydration without changing server markup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(window.sessionStorage.getItem("fieldflow-assignments-query") ?? "");
    const saved = window.sessionStorage.getItem("fieldflow-assignments-filter");
    if (saved === "all" || saved === "assigned" || saved === "unassigned") setFilter(saved);
    setRestored(true);
  }, []);
  useEffect(() => { if (restored) window.sessionStorage.setItem("fieldflow-assignments-query", query); }, [query, restored]);
  useEffect(() => { if (restored) window.sessionStorage.setItem("fieldflow-assignments-filter", filter); }, [filter, restored]);
  const byEngineer = useMemo(() => new Map(engineers.map(engineer => [engineer.id, engineer])), [engineers]);
  const positionByJob = useMemo(() => new Map(routes.flatMap(route => route.stops.map((stop, index) => [stop.jobId, `${index + 1}/${route.stops.length}`] as const))), [routes]);
  const assignedCount = jobs.filter(job => job.engineerId && byEngineer.has(job.engineerId)).length;
  const shown = jobs.filter(job => {
    const engineer = job.engineerId ? byEngineer.get(job.engineerId) : undefined;
    if (filter === "assigned" && !engineer) return false;
    if (filter === "unassigned" && engineer) return false;
    const needle = query.trim().toLocaleLowerCase("ru");
    return !needle || [job.id, job.address, job.kind, engineer?.name ?? ""].some(value => value.toLocaleLowerCase("ru").includes(needle));
  });

  return <div className="assignment-board">
    <div className="assignment-tools">
      <div className="assignment-search"><Search aria-hidden="true" /><input aria-label="Поиск заявки или инженера в маршрутах" placeholder="№, адрес или инженер" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Очистить поиск маршрутов" onClick={() => setQuery("")}><X /></button>}</div>
      <div className="assignment-filters" aria-label="Фильтр назначений">
        <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Все {jobs.length}</button>
        <button type="button" className={filter === "assigned" ? "active" : ""} aria-pressed={filter === "assigned"} onClick={() => setFilter("assigned")}>Назначены {assignedCount}</button>
        <button type="button" className={filter === "unassigned" ? "active" : ""} aria-pressed={filter === "unassigned"} onClick={() => setFilter("unassigned")}>Без маршрута {jobs.length - assignedCount}</button>
      </div>
    </div>
    <div className="assignment-table-head"><span>Заявка</span><span>Назначенный инженер</span></div>
    <div className="assignment-table" role="list" aria-label="Заявки и назначенные инженеры">
      {shown.map(job => {
        const engineer = job.engineerId ? byEngineer.get(job.engineerId) : undefined;
        return <div className="assignment-row" role="listitem" key={job.id}>
          <button type="button" className={`assignment-job${selectedJobId === job.id ? " selected" : ""}`} onClick={() => onSelectJob(job.id)} title={`${job.address} · ${job.kind}`} aria-label={`Открыть заявку № ${job.id}, ${job.address}`}>
            <span className={`assignment-tone ${job.tone}`} aria-hidden="true" />
            <span className="assignment-cell-copy"><strong>№ {job.id}</strong><small>{job.time} · {job.area}</small></span>
          </button>
          {engineer ? <button type="button" className={`assignment-engineer${selectedEngineerId === engineer.id ? " selected" : ""}`} onClick={() => onSelectEngineer(engineer.id)} title={`Показать маршрут: ${engineer.name}`} aria-label={`Показать маршрут инженера ${engineer.name} для заявки № ${job.id}`}>
            <span className="assignment-avatar" style={{ background: `${engineer.color}20`, color: engineer.color }}>{engineer.initials}</span>
            <span className="assignment-cell-copy"><strong>{engineer.name.replace(/^Инженер\s+/i, "")}</strong><small>{positionByJob.get(job.id) ?? "—"} в маршруте</small></span>
          </button> : <span className="assignment-unassigned">{loading ? "Расчёт…" : "Не назначен"}</span>}
        </div>;
      })}
      {!shown.length && <div className="assignment-no-results">По этому запросу заявок нет.</div>}
    </div>
    {selectedEngineerId && <button className="assignment-show-all" type="button" onClick={onShowAll}>Показать все маршруты на карте</button>}
  </div>;
}
