"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, Check, ChevronDown, Clock3, Contrast, Database, Download, FileJson, Layers3, MapPin, Menu, MoreHorizontal, Play, Plus, Route, Search, Sparkles, SunMoon, Table2, Upload, UsersRound, Waypoints, Wrench, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { MapCanvas, type RoutingState } from "@/components/map-canvas";
import { AssignmentBoard } from "@/components/assignment-board";
import { TimeDrum } from "@/components/time-drum";
import { AlgorithmDemoView } from "@/components/algorithm-demo";
import { DataEditor } from "@/components/data-editor";
import { PlanAnalysisView } from "@/components/plan-analysis";
import { BackendGeocodingProvider, type Coordinate } from "@/lib/map-providers";
import { loadRoadTravel } from "@/lib/road-travel";
import { csvEngineers, csvJobs, csvMeta } from "@/lib/csv-data.generated";
import demoScenario from "@/data/demo-scenario.json";
import { downloadPlan } from "@/lib/export-plan";
import { downloadGeneratedDataset, generateDataset, type GeneratedDataset } from "@/lib/generator-files";
import { importPlanFile } from "@/lib/import-data";
import { executionAtTime, executionLabels, parseTime, validateEditedData } from "@/lib/data-editor";
import { solveCounterfactualServer, solveVrptwServer, type SolverEngine } from "@/lib/server-solver";
import { applyAverageWindows, compareReplannedPlans, explainAssignment, fallbackTravel, idleOptimization, minutesLabel, resultFromRouteOrder, scaleEngineers, scaleJobs, transportAllowed, type Engineer, type Job, type OptimizationResult, type Region, type ReplanChange, type RoutePlan, type TravelMatrix } from "@/lib/vrptw";
import { cancelUnassignedJob, insertOrdinaryJob, mergeTemporalResult, prepareTemporalReplan, type DispatchEvent } from "@/lib/temporal-replan";

type ThemeId = "light" | "dark" | "beeline" | "ocean" | "graphite" | "contrast";
type ViewId = "plan" | "requests" | "team" | "analytics" | "generator" | "editor" | "demo";
type PlanConfig = { engineers: number; jobs: number; speedKmh: number; windowMinutes: number; highPriority: boolean };
type CounterfactualAssessment = { status: "loading" | "success" | "error"; summary?: string; error?: string; runtimeMs?: number };
const sourceJobs = csvJobs as Job[];
const sourceEngineers = csvEngineers as Engineer[];
const defaultConfig: PlanConfig = { engineers: sourceEngineers.length, jobs: sourceJobs.length, speedKmh: 24, windowMinutes: 240, highPriority: false };

function useSavedFilter<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // Restore the last tab-specific filter after hydration; the server has no sessionStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const saved = window.sessionStorage.getItem(`fieldflow-${key}`); if (saved != null) setValue(JSON.parse(saved) as T); } catch { /* invalid previous filter */ }
    setLoaded(true);
  }, [key]);
  useEffect(() => { if (loaded) window.sessionStorage.setItem(`fieldflow-${key}`, JSON.stringify(value)); }, [key, value, loaded]);
  return [value, setValue];
}

function composePlanJobs(base: Job[], count: number, windowMinutes: number | null, extras: Job[], cancelledIds: string[] = []) {
  const cancelled = new Set(cancelledIds);
  const scaled = scaleJobs(base, count);
  return [...(windowMinutes == null ? scaled : applyAverageWindows(scaled, windowMinutes)), ...extras].map(job => ({ ...job, cancelled: cancelled.has(job.id) ? !job.cancelled : Boolean(job.cancelled), status: cancelled.has(job.id) ? (job.cancelled ? "Новая" : "Отменена") : job.status }));
}
const regionCenters: Record<Region, Coordinate> = {
  "Восток": csvMeta.offices["Восток"].coordinates as Coordinate,
  "Юго-восток": csvMeta.offices["Юго-восток"].coordinates as Coordinate,
  "Югоцентр": csvMeta.offices["Югоцентр"].coordinates as Coordinate,
};
const themes: Array<{ id: ThemeId; name: string; colors: string[] }> = [
  { id: "light", name: "Светлая", colors: ["#fff", "#6547e7"] }, { id: "dark", name: "Тёмная", colors: ["#111522", "#8e7cff"] }, { id: "beeline", name: "Билайн", colors: ["#ffd400", "#151515"] }, { id: "ocean", name: "Океан", colors: ["#e9fbff", "#007f8b"] }, { id: "graphite", name: "Графит", colors: ["#dfe3e8", "#38414d"] }, { id: "contrast", name: "Высокий контраст", colors: ["#fff", "#0047ff"] },
];
function Logo() { return <div className="brand"><span className="brand-mark"><Route size={18} /></span><span>FieldFlow</span></div>; }
function formatDistance(value: number) { return `${value.toFixed(1).replace(".", ",")} км`; }
const solverLabels: Record<SolverEngine, string> = { ortools: "OR-Tools", "heuristic-server": "Серверный резерв", "heuristic-browser": "Локальный резерв" };

function ExportButtons({ result, engineers, solver, speedKmh }: { result: OptimizationResult; engineers: Engineer[]; solver: SolverEngine; speedKmh: number }) {
  return <div className="export-actions" aria-label="Экспорт результата">
    <button type="button" onClick={() => downloadPlan(result, engineers, "csv", { solver, speedKmh })}><Download />CSV</button>
    <button type="button" onClick={() => downloadPlan(result, engineers, "json", { solver, speedKmh })}><FileJson />JSON</button>
  </div>;
}

function snapPoints(min: number, max: number, step: number) {
  const points: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let n = start; n <= max + 1e-9; n += step) points.push(Math.round(n));
  if (points[0] !== min) points.unshift(min);
  if (points[points.length - 1] !== max) points.push(max);
  return points;
}
function nearestSnap(value: number, points: number[]) {
  return points.reduce((best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best);
}
function tickMarks(min: number, max: number, step: number) {
  const start = min % step === 0 ? min : Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let n = start; n <= max + 1e-9; n += step) ticks.push(Math.round(n));
  return ticks;
}

function ConfigNumberField({ label, hint, value, onChange, sliderMin = 1, sliderMax = 500, inputMin = 1, inputMax = 10000, snapStep, suffix }: { label: string; hint?: string; value: number; onChange: (value: number) => void; sliderMin?: number; sliderMax?: number; inputMin?: number; inputMax?: number; snapStep: number; suffix?: string }) {
  const [text, setText] = useState(String(value));
  const shiftHeld = useRef(false);
  const pointerActive = useRef(false);
  // The text buffer intentionally mirrors slider/parent changes while still
  // allowing a temporarily empty value during keyboard editing.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setText(String(value)); }, [value]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Shift") shiftHeld.current = event.type === "keydown"; };
    const onBlur = () => { shiftHeld.current = false; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); window.removeEventListener("blur", onBlur); };
  }, []);
  const clamp = (raw: string) => {
    const parsed = Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed)) return value;
    return Math.min(inputMax, Math.max(inputMin, Math.round(parsed)));
  };
  const points = useMemo(() => snapPoints(sliderMin, sliderMax, snapStep), [sliderMin, sliderMax, snapStep]);
  const ticks = useMemo(() => tickMarks(sliderMin, sliderMax, snapStep), [sliderMin, sliderMax, snapStep]);
  const sliderValue = Math.min(sliderMax, Math.max(sliderMin, value));
  const applySlider = (raw: number) => {
    const clamped = Math.min(sliderMax, Math.max(sliderMin, Math.round(raw)));
    if (shiftHeld.current) { onChange(clamped); return; }
    if (!pointerActive.current && Math.abs(clamped - value) <= 1) {
      if (clamped > value) onChange(points.find(point => point > value) ?? value);
      else if (clamped < value) onChange([...points].reverse().find(point => point < value) ?? value);
      return;
    }
    onChange(nearestSnap(clamped, points));
  };
  return <div className="config-field"><div className="config-field-head"><Label>{label}</Label><div className="config-input-wrap"><Input inputMode="numeric" value={text} aria-label={label} onChange={event => { const next = event.target.value.replace(/[^\d]/g, ""); setText(next); if (next === "") return; onChange(clamp(next)); }} onBlur={() => { const next = clamp(text); onChange(next); setText(String(next)); }} /><span>{suffix}</span></div></div><div className="config-slider-wrap"><Slider min={sliderMin} max={sliderMax} step={1} value={[sliderValue]} className="w-full" onPointerDown={event => { shiftHeld.current = event.shiftKey; pointerActive.current = true; }} onPointerMove={event => { shiftHeld.current = event.shiftKey; }} onPointerUp={() => { pointerActive.current = false; }} onPointerCancel={() => { pointerActive.current = false; }} onValueChange={values => { const next = values[0]; if (typeof next === "number") applySlider(next); }} /><div className="config-slider-ticks" aria-hidden>{ticks.map(tick => <i key={tick} style={{ left: `${(tick - sliderMin) / (sliderMax - sliderMin) * 100}%` }} title={String(tick)} />)}</div></div><div className="config-field-meta"><span>{sliderMin}</span><small>{value > sliderMax ? `Ползунок до ${sliderMax}. В расчёт идёт ${value}.` : hint}</small><span>{sliderMax}</span></div></div>;
}

function JobTable({ jobs, engineers, onOpen, limit }: { jobs: Job[]; engineers: Engineer[]; onOpen: (id: string) => void; limit?: number }) { return <div className="job-table"><div className="job-row table-head"><span>Время</span><span>Заявка</span><span>Адрес</span><span>Инженер</span><span>Выполнение</span><span>Статус SLA</span><span /></div>{jobs.slice(0, limit ?? jobs.length).map(job => { const engineer = engineers.find(item => item.id === job.engineerId); const routeStatus = job.cancelled ? "Отменена" : job.executionStatus === "completed" && !engineer ? "Завершена" : engineer ? "В окне" : "Нет маршрута"; return <button className="job-row job-row-button" key={job.id} onClick={() => onOpen(job.id)}><span className="job-time">{job.time}</span><span><i className={`job-tone ${job.tone}`} /><b>№ {job.id}</b><small>{job.kind}</small></span><span><b>{job.area}</b><small>{job.address}</small></span><span className="assigned">{engineer ? <><i style={{ background: engineer.color }}>{engineer.initials}</i><b>{engineer.name}</b></> : <b>{routeStatus === "Завершена" ? "Работа закрыта" : "Не назначена"}</b>}</span><span className={`execution-pill ${job.executionStatus ?? "not_started"}`}>{executionLabels[job.executionStatus ?? "not_started"]}</span><span><Badge className={!engineer && routeStatus === "Нет маршрута" ? "sla risk" : "sla"}>{routeStatus === "Нет маршрута" ? <AlertTriangle /> : <Clock3 />}{routeStatus}</Badge></span><span className="row-location"><MapPin /></span></button>; })}</div>; }
function InstantSearch({ value, onChange, placeholder, children }: { value: string; onChange: (value: string) => void; placeholder: string; children?: ReactNode }) {
  return <div className="instant-search"><div className="instant-search-field"><Search /><input type="text" role="searchbox" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />{value && <button type="button" onClick={() => onChange("")} aria-label="Очистить поиск"><X /></button>}</div>{value.trim() && children}</div>;
}
type FacetGroup = { key: string; label: string; values: string[] };
function facetOptions(values: string[]) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")); }
function matchesFacets(selected: string[], strict: boolean, values: Record<string, string[]>) {
  if (!selected.length) return true;
  const matches = (entry: string) => { const [key, value] = entry.split("\u0000"); return values[key]?.includes(value) ?? false; };
  return strict ? selected.every(matches) : selected.some(matches);
}
function FacetFilters({ groups, selected, onSelected, strict, onStrict, count, total }: { groups: FacetGroup[]; selected: string[]; onSelected: (values: string[]) => void; strict: boolean; onStrict: (value: boolean) => void; count: number; total: number }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  return <section className="facet-filters" aria-label="Фильтры"><div className="facet-head"><div><strong>Фильтры</strong><span>Показано {count} из {total}</span></div><label className="facet-strict"><input type="checkbox" checked={strict} onChange={event => onStrict(event.target.checked)} /> Строгий фильтр <small>{strict ? "все выбранные" : "хотя бы один"}</small></label>{selected.length > 0 && <button type="button" onClick={() => onSelected([])}>Сбросить</button>}</div><div className="facet-groups">{groups.map(group => <details key={group.key} className="facet-group" open={openGroup === group.key} onToggle={event => { if (event.currentTarget.open) setOpenGroup(group.key); else if (openGroup === group.key) setOpenGroup(null); }}><summary>{group.label}{selected.filter(value => value.startsWith(`${group.key}\u0000`)).length > 0 && <b>{selected.filter(value => value.startsWith(`${group.key}\u0000`)).length}</b>}</summary><div className="facet-options">{group.values.map(value => { const id = `${group.key}\u0000${value}`; return <label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={event => onSelected(event.target.checked ? [...selected, id] : selected.filter(item => item !== id))} /><span>{value}</span></label>; })}</div></details>)}</div>{selected.length > 0 && <p className="facet-selected">{selected.map(value => { const [key, label] = value.split("\u0000"); return <button type="button" key={value} onClick={() => onSelected(selected.filter(item => item !== value))} aria-label={`Убрать фильтр ${label}`}>{groups.find(group => group.key === key)?.label}: {label} ×</button>; })}</p>}</section>;
}
function RequestsView({ jobs, engineers, onOpen, onAdd, onImport, importStatus }: { jobs: Job[]; engineers: Engineer[]; onOpen: (id: string) => void; onAdd: () => void; onImport: (file: File) => void; importStatus: string }) {
  const [selected, setSelected] = useSavedFilter<string[]>("requests-selected", []); const [strict, setStrict] = useSavedFilter("requests-strict", false); const [showAll, setShowAll] = useSavedFilter("requests-all", false); const [query, setQuery] = useSavedFilter("requests-query", ""); const [fromTime, setFromTime] = useSavedFilter("requests-from", ""); const [toTime, setToTime] = useSavedFilter("requests-to", ""); const [normFrom, setNormFrom] = useSavedFilter("requests-norm-from", ""); const [normTo, setNormTo] = useSavedFilter("requests-norm-to", "");
  const unassigned = jobs.filter(job => !job.cancelled && job.executionStatus !== "completed" && !job.engineerId).length;
  const cancelled = jobs.filter(job => job.cancelled).length;
  const completed = jobs.filter(job => !job.cancelled && job.executionStatus === "completed").length;
  const assigned = jobs.filter(job => !job.cancelled && job.engineerId).length;
  const groups: FacetGroup[] = [{ key: "kind", label: "Навык / работа", values: facetOptions(jobs.map(job => job.kind)) }, { key: "equipment", label: "Оборудование", values: facetOptions(jobs.map(job => job.equipment)) }, { key: "transport", label: "Транспорт", values: facetOptions(jobs.map(job => job.requiredTransport)) }, { key: "status", label: "Статус маршрута", values: ["В окне", "Нет маршрута", "Отменена", "Завершена"] }, { key: "execution", label: "Выполнение", values: Object.values(executionLabels) }, { key: "priority", label: "Приоритет", values: facetOptions(jobs.map(job => String(job.priority))) }];
  const normalized = query.trim().toLocaleLowerCase("ru"); const fromMinutes = fromTime ? Number(fromTime.slice(0, 2)) * 60 + Number(fromTime.slice(3)) : null; const toMinutes = toTime ? Number(toTime.slice(0, 2)) * 60 + Number(toTime.slice(3)) : null; const minNorm = normFrom === "" ? null : Number(normFrom); const maxNorm = normTo === "" ? null : Number(normTo);
  const searched = jobs.filter(job => !normalized || job.id.toLocaleLowerCase("ru").includes(normalized) || job.address.toLocaleLowerCase("ru").includes(normalized));
  const filtered = searched.filter(job => matchesFacets(selected, strict, { kind: [job.kind], equipment: [job.equipment], transport: [job.requiredTransport], status: [job.cancelled ? "Отменена" : job.executionStatus === "completed" && !job.engineerId ? "Завершена" : job.engineerId ? "В окне" : "Нет маршрута"], execution: [executionLabels[job.executionStatus ?? "not_started"]], priority: [String(job.priority)] }) && (fromMinutes == null || job.windowStart >= fromMinutes) && (toMinutes == null || job.windowEnd <= toMinutes) && (minNorm == null || job.serviceMinutes >= minNorm) && (maxNorm == null || job.serviceMinutes <= maxNorm));
  const resetRanges = () => { setFromTime(""); setToTime(""); setNormFrom(""); setNormTo(""); };
  return <section className="page-view"><InstantSearch value={query} onChange={setQuery} placeholder="Номер заявки или адрес"><div className="instant-results">{searched.slice(0, 8).map(job => <button type="button" key={job.id} onClick={() => onOpen(job.id)}><span><b>№ {job.id}</b><small>{job.address}</small></span><em>{job.cancelled ? "Отменена" : job.time}</em></button>)}{!searched.length && <p>Совпадений не найдено</p>}</div></InstantSearch><div className="import-strip"><label className="plain-button import-button"><Upload />Загрузить CSV / JSON<input type="file" accept=".csv,.json,text/csv,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} /></label><span>{importStatus || "CSV заявок, CSV инженеров или JSON генератора (jobs + engineers). Наборы из generator/datasets подходят без перекодирования."}</span></div><div className="view-summary"><article><span>Из данных и формы</span><strong>{jobs.length}</strong><small>заявок в текущем плане</small></article><article><span>Назначено VRPTW</span><strong>{assigned}</strong><small>{jobs.length - cancelled ? (assigned / (jobs.length - cancelled) * 100).toFixed(1) : "0.0"}% неотменённых · завершено {completed} · отменено {cancelled}</small></article><article><span>Без назначения</span><strong>{unassigned}</strong><small>проверьте причину в карточке заявки</small></article></div><FacetFilters groups={groups} selected={selected} onSelected={setSelected} strict={strict} onStrict={setStrict} count={filtered.length} total={jobs.length} /><section className="range-filters" aria-label="Диапазоны заявки"><label><span>Окно с</span><input type="time" value={fromTime} onChange={event => setFromTime(event.target.value)} /></label><label><span>Окно до</span><input type="time" value={toTime} onChange={event => setToTime(event.target.value)} /></label><label><span>Норматив от, мин</span><input type="number" min="0" value={normFrom} onChange={event => setNormFrom(event.target.value)} placeholder="0" /></label><label><span>Норматив до, мин</span><input type="number" min="0" value={normTo} onChange={event => setNormTo(event.target.value)} placeholder="240" /></label>{(fromTime || toTime || normFrom || normTo) && <button type="button" onClick={resetRanges}>Сбросить диапазоны</button>}</section><section className="panel queue-panel full-table"><div className="panel-header"><div><h2>Заявки</h2><p>CSV / JSON · {filtered.length} по фильтру</p></div><button className="plain-button" onClick={onAdd}><Plus />Добавить заявку</button></div>{filtered.length ? <JobTable jobs={filtered} engineers={engineers} onOpen={onOpen} limit={showAll ? undefined : 250} /> : <p className="facet-empty">По поиску и выбранным условиям заявок нет.</p>}{!showAll && filtered.length > 250 && <button type="button" className="facet-show-all" onClick={() => setShowAll(true)}>Показать все {filtered.length} заявок</button>}</section></section>;
}
function EngineersView({ engineers, jobs, result, unavailableIds, onOpenDetails, onOpenRoute }: { engineers: Engineer[]; jobs: Job[]; result: OptimizationResult; unavailableIds: string[]; onOpenDetails: (id: string) => void; onOpenRoute: (id: string) => void }) {
  const [showAll, setShowAll] = useSavedFilter("engineers-all", false);
  const [selected, setSelected] = useSavedFilter<string[]>("engineers-selected", []); const [strict, setStrict] = useSavedFilter("engineers-strict", false); const [query, setQuery] = useSavedFilter("engineers-query", "");
  const plans = new Map(result.routes.map(route => [route.engineerId, route]));
  const active = result.routes.length;
  const avg = active ? Math.round(result.routes.reduce((sum, route) => sum + route.load, 0) / active) : 0;
  const groups: FacetGroup[] = [{ key: "skills", label: "Навыки", values: facetOptions(engineers.flatMap(item => item.skills)) }, { key: "equipment", label: "Оборудование", values: facetOptions(engineers.flatMap(item => item.equipment)) }, { key: "transport", label: "Транспорт", values: facetOptions(engineers.map(item => item.transport)) }];
  const normalized = query.trim().toLocaleLowerCase("ru"); const jobIdsByEngineer = new Map(engineers.map(engineer => [engineer.id, jobs.filter(job => job.engineerId === engineer.id || (!job.engineerId && job.baselineEngineerId === engineer.id)).map(job => job.id)]));
  const searched = engineers.filter(engineer => !normalized || engineer.name.toLocaleLowerCase("ru").includes(normalized) || engineer.id.toLocaleLowerCase("ru").includes(normalized) || (jobIdsByEngineer.get(engineer.id) ?? []).some(id => id.toLocaleLowerCase("ru").includes(normalized)));
  const filtered = searched.filter(engineer => matchesFacets(selected, strict, { skills: engineer.skills, equipment: engineer.equipment, transport: [engineer.transport] }));
  const ordered = [...filtered].sort((a, b) => Number(plans.has(b.id)) - Number(plans.has(a.id)));
  const shown = showAll ? ordered : ordered.slice(0, 80);
  return <section className="page-view">
    <InstantSearch value={query} onChange={setQuery} placeholder="Имя инженера или номер заявки"><div className="instant-results">{searched.slice(0, 8).map(engineer => <button type="button" key={engineer.id} onClick={() => onOpenDetails(engineer.id)}><span><b>{engineer.name}</b><small>{engineer.region} · {(jobIdsByEngineer.get(engineer.id) ?? []).length} заявок</small></span><em>{(jobIdsByEngineer.get(engineer.id) ?? []).filter(id => id.toLocaleLowerCase("ru").includes(normalized)).slice(0, 2).map(id => `№ ${id}`).join(", ")}</em></button>)}{!searched.length && <p>Совпадений не найдено</p>}</div></InstantSearch>
    <div className="view-summary">
      <article><span>Доступно</span><strong>{engineers.length - unavailableIds.length}</strong><small>из {engineers.length} бригад в текущем запуске</small></article>
      <article><span>На маршрутах</span><strong>{active}</strong><small>имеют назначенные работы</small></article>
      <article><span>Средняя загрузка</span><strong>{avg}%</strong><small>по длительности смены</small></article>
    </div>
    <FacetFilters groups={groups} selected={selected} onSelected={setSelected} strict={strict} onStrict={setStrict} count={filtered.length} total={engineers.length} />
    {filtered.length > shown.length && <p className="list-cap">На экране {shown.length} из {filtered.length} инженеров. <button type="button" className="plain-button" onClick={() => setShowAll(true)}>Показать всех</button></p>}
    {!filtered.length && <p className="facet-empty">По выбранным условиям инженеров нет.</p>}
    <div className="engineer-card-grid">{shown.map(engineer => {
      const route = plans.get(engineer.id);
      return <article key={engineer.id} className="engineer-card">
        <button type="button" className="engineer-card-main" onClick={() => onOpenDetails(engineer.id)} aria-label={`Навыки и данные: ${engineer.name}`}>
          <div className="engineer-card-head"><span className="avatar large" style={{ background: `${engineer.color}18`, color: engineer.color }}>{engineer.initials}</span><div><strong>{engineer.name}</strong><small>{unavailableIds.includes(engineer.id) ? "Недоступен · исключён из расчёта" : `${engineer.region} · ${engineer.route}`}</small></div><b style={{ color: unavailableIds.includes(engineer.id) ? "var(--danger)" : engineer.color }}>{unavailableIds.includes(engineer.id) ? "OFF" : `${route?.load ?? 0}%`}</b></div>
          <Progress value={route?.load ?? 0} className="load-progress" style={{ ["--primary" as string]: engineer.color }} />
          <div className="engineer-card-meta"><span><b>{route?.stops.length ?? 0}</b> заявок</span><span><b>{formatDistance(route?.distanceKm ?? 0)}</b></span><span><b>{engineer.skills.length}</b> навыков</span></div>
          <small className="engineer-details-hint">Нажмите, чтобы посмотреть навыки и ресурсы</small>
        </button>
        <button type="button" className="open-route" disabled={!route?.stops.length} onClick={() => onOpenRoute(engineer.id)}>{route?.stops.length ? "Открыть маршрут на карте" : "Маршрут не назначен"}</button>
      </article>;
    })}</div>
  </section>;
}

function EngineerDetailsDialog({ engineer, route, unavailable, onClose, onOpenRoute, onToggleAvailability }: { engineer: Engineer | null; route?: RoutePlan; unavailable: boolean; onClose: () => void; onOpenRoute: (id: string) => void; onToggleAvailability: (id: string) => void }) {
  return <Dialog open={Boolean(engineer)} onOpenChange={open => !open && onClose()}>
    <DialogContent className="engineer-details-dialog">
      <DialogHeader>
        <DialogTitle>{engineer?.name}</DialogTitle>
        <DialogDescription>{engineer?.region} · {engineer?.route}{unavailable ? " · инженер недоступен" : ""}</DialogDescription>
      </DialogHeader>
      {engineer && <div className="engineer-details-content">
        <div className="engineer-details-stats"><span><b>{route?.stops.length ?? 0}</b> заявок</span><span><b>{formatDistance(route?.distanceKm ?? 0)}</b> пробег</span><span><b>{route?.load ?? 0}%</b> загрузка</span></div>
        <section><h3>Навыки</h3><div className="engineer-skill-list">{engineer.skills.length ? engineer.skills.map(skill => <span key={skill}>{skill}</span>) : <em>Навыки не указаны</em>}</div></section>
        <section><h3>Старт и комплект</h3><p><b>Точка выезда:</b> {engineer.startAddress || engineer.start.join(", ")}</p><p><b>Выдача:</b> {engineer.startMode === "local" ? "комплект выдан заранее, старт в своём городе (демонстрационное допущение)" : "в офисе до начала смены"}</p><p><b>Закреплённый комплект:</b> {engineer.equipment.length ? engineer.equipment.join(", ") : "не указан"}</p><p><b>При перепланировании:</b> только оборудование из этого комплекта, без довыдачи.</p><p><b>Транспорт:</b> {engineer.transport || "не указан"}</p><p><b>Смена:</b> {minutesLabel(engineer.shiftStart)}–{minutesLabel(engineer.shiftEnd)}</p></section>
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => { if (engineer) onToggleAvailability(engineer.id); }}>{unavailable ? "Вернуть в смену" : "Отметить недоступным"}</Button><Button variant="outline" onClick={onClose}>Закрыть</Button><Button disabled={!route?.stops.length || unavailable} onClick={() => { if (engineer) onOpenRoute(engineer.id); }}>{route?.stops.length ? "Открыть маршрут на карте" : "Нет маршрута"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
function AnalyticsView({ result, engineers, distanceReady, distanceWarning, solver, speedKmh, travel, metrics }: { result: OptimizationResult; engineers: Engineer[]; distanceReady: boolean; distanceWarning: string; solver: SolverEngine; speedKmh: number; travel?: TravelMatrix; metrics: ReactNode }) {
  const maxJobs = Math.max(1, ...result.zones.map(item => item.jobs));
  const maxDistance = Math.max(1, ...result.zones.flatMap(zone => [zone.distance, zone.baselineDistance]));
  const baselineByEngineer = new Map(result.baselineRoutes.map(route => [route.engineerId, route]));
  const optimizedByEngineer = new Map(result.routes.map(route => [route.engineerId, route]));
  const activeEngineers = engineers.filter(engineer => baselineByEngineer.has(engineer.id) || optimizedByEngineer.has(engineer.id));
  return <section className="page-view"><div className="analytics-actions"><span>Solver: <b>{solverLabels[solver]}</b></span><ExportButtons result={result} engineers={engineers} solver={solver} speedKmh={speedKmh} /></div>{metrics}
    <p className={distanceReady ? "comparison-note ready" : "comparison-note"}>{`Строго сопоставимый пробег на ${result.comparison.commonAssigned} общих заявках: ${formatDistance(result.comparison.baselineComparableDistanceKm ?? 0)} → ${formatDistance(result.comparison.optimizedComparableDistanceKm ?? 0)}. Baseline-only: ${result.comparison.baselineOnly}; VRPTW-only: ${result.comparison.optimizedOnly}. ${distanceReady ? "Дорожная матрица едина, процент сравнения достоверен." : distanceWarning}`}</p>
    <div className="analytics-grid">
      <article className="panel analytics-panel"><div className="panel-header"><div><h2>Заявки по зонам</h2><p>Источник CSV и срочные заявки</p></div></div><div className="zone-chart">{result.zones.map(zone => <div key={zone.name}><span>{zone.name}</span><div><i style={{ width: `${zone.jobs / maxJobs * 100}%` }} /></div><strong>{zone.jobs}</strong></div>)}</div></article>
      <article className="panel analytics-panel"><div className="panel-header"><div><h2>В срок от всех заявок</h2><p>Знаменатель включает и заявки без маршрута</p></div></div><div className="sla-chart">{result.zones.map(zone => <div key={zone.name}><div className="sla-ring" style={{ ["--value" as string]: `${zone.sla * 3.6}deg` }}><strong>{zone.sla}%</strong></div><span>{zone.name}<small>{zone.assigned} из {zone.jobs} назначено</small></span></div>)}</div></article>
      <article className="panel analytics-panel wide"><div className="panel-header"><div><h2>Сравнение по зонам</h2><p>Покрытие, число бригад и полный пробег каждого плана показаны раздельно</p></div></div><div className="distance-bars">{result.zones.map(zone => <div key={zone.name}><span>{zone.name}</span><div className="distance-track"><i className="baseline" style={{ width: `${zone.baselineDistance / maxDistance * 100}%` }} /><i className="optimized" style={{ width: `${zone.distance / maxDistance * 100}%` }} /></div><strong>{zone.baselineAssigned} → {zone.assigned} заявок<br />{zone.baselineEngineers} → {zone.engineers} инженеров<br />{formatDistance(zone.baselineDistance)} → {formatDistance(zone.distance)}</strong></div>)}</div><div className="analytics-legend"><span><i className="baseline" />Baseline ТЗ</span><span><i className="optimized" />VRPTW-план</span></div></article>
      <article className="panel analytics-panel wide"><div className="panel-header"><div><h2>Маршруты по инженерам</h2><p>Число заявок и пробег каждого плана; «—» означает отсутствие маршрута</p></div></div><div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>Инженер</th><th>Baseline · заявок</th><th>VRPTW · заявок</th><th>Baseline · км</th><th>VRPTW · км</th></tr></thead><tbody>{activeEngineers.map(engineer => { const base = baselineByEngineer.get(engineer.id); const optimized = optimizedByEngineer.get(engineer.id); return <tr key={engineer.id}><th scope="row">{engineer.name}<small>{engineer.region}</small></th><td>{base?.stops.length ?? "—"}</td><td>{optimized?.stops.length ?? "—"}</td><td>{base ? formatDistance(base.distanceKm) : "—"}</td><td>{optimized ? formatDistance(optimized.distanceKm) : "—"}</td></tr>; })}</tbody></table></div></article>
    </div>
    <PlanAnalysisView result={result} engineers={engineers} travel={travel} />
  </section>;
}

function GeneratorView({ draft, setDraft, generated, generatedFrom, onGenerate, onPlan, onDemo }: { draft: PlanConfig; setDraft: React.Dispatch<React.SetStateAction<PlanConfig>>; generated: GeneratedDataset | null; generatedFrom: PlanConfig | null; onGenerate: () => void; onPlan: () => void; onDemo: () => void }) {
  const fresh = generated && generatedFrom && Object.keys(draft).every(key => draft[key as keyof PlanConfig] === generatedFrom[key as keyof PlanConfig]);
  const heavyRun = draft.engineers * draft.jobs > 150000;
  const widths = generated?.jobs.map(job => job.windowEnd - job.windowStart) ?? [];
  const minWindow = widths.length ? Math.min(...widths) : 0;
  const maxWindow = widths.length ? Math.max(...widths) : 0;
  const meanWindow = widths.length ? Math.round(widths.reduce((sum, width) => sum + width, 0) / widths.length) : 0;
  return <section className="page-view generator-view">
    <div className="generator-layout">
      <article className="panel generator-config">
        <div className="panel-header"><div><h2>Параметры набора</h2><p>Заявки и инженеры из исходного набора всех регионов</p></div></div>
        <div className="config-body">
          <ConfigNumberField label="Инженеры" hint={`В исходном наборе ${sourceEngineers.length}. При сокращении команда подбирается по регионам и ресурсам.`} value={draft.engineers} onChange={value => setDraft(current => ({ ...current, engineers: value }))} sliderMax={500} snapStep={50} suffix="чел." />
          <ConfigNumberField label="Заявки" hint={`В исходном наборе ${sourceJobs.length}. Дополнительные работы распределяются по всем регионам.`} value={draft.jobs} onChange={value => setDraft(current => ({ ...current, jobs: value }))} sliderMax={500} snapStep={50} suffix="шт." />
          <ConfigNumberField label="Среднее окно заявки" hint="Окна будут разной длины, но их среднее останется выбранным. Норматив работ не меняется." value={draft.windowMinutes} onChange={value => setDraft(current => ({ ...current, windowMinutes: value }))} sliderMin={60} sliderMax={480} inputMin={60} inputMax={840} snapStep={30} suffix="мин" />
          <ConfigNumberField label="Средняя скорость" hint="Сохраняется в CSV/JSON и применяется при расчёте дорог после загрузки." value={draft.speedKmh} onChange={value => setDraft(current => ({ ...current, speedKmh: value }))} sliderMin={10} sliderMax={80} inputMin={5} inputMax={200} snapStep={10} suffix="км/ч" />
          <label className="generator-priority-option"><input type="checkbox" checked={draft.highPriority} onChange={event => setDraft(current => ({ ...current, highPriority: event.target.checked }))} /><span><strong>Добавить заявки повышенной срочности</strong><small>Каждая седьмая заявка получит срочность «Срочная» и приоритет не ниже 10. Выключено — исходные приоритеты.</small></span></label>
          {heavyRun && <p className="config-warning">Большой набор: построение дорожной матрицы и расчёт могут занять заметное время.</p>}
          <button className="optimize-button start-run-button" onClick={onGenerate}><Sparkles />Создать набор заявок</button>
          <button className="plain-button" type="button" onClick={onDemo}>Загрузить эталонный набор: 12 инженеров / 51 заявка</button>
        </div>
      </article>
      <article className="panel generator-output">
        <div className="panel-header"><div><h2>Готовый набор</h2><p>Файлы подходят для загрузки во вкладке «Заявки»</p></div></div>
        {generated ? <div className="generator-result">
          <div className="generator-facts"><span><b>{generated.jobs.length}</b>заявок</span><span><b>{generated.engineers.length}</b>инженеров</span><span><b>{generated.speedKmh}</b>км/ч</span></div>
          <p>Окна: {minWindow}–{maxWindow} мин, среднее {meanWindow} мин. Срочных заявок: {generated.jobs.filter(job => job.urgency === "urgent").length}.</p>
          <p>{fresh ? "Набор подключён к текущему плану. Скачайте файл или перейдите к построению маршрутов." : "Параметры изменены. Нажмите «Создать набор заявок», чтобы обновить данные и файлы."}</p>
          <div className="generator-actions"><button type="button" disabled={!fresh} onClick={() => downloadGeneratedDataset(generated, "csv")}><Download /> Скачать CSV</button><button type="button" disabled={!fresh} onClick={() => downloadGeneratedDataset(generated, "json")}><FileJson /> Скачать JSON</button></div>
          <button type="button" className="generator-plan-link" disabled={!fresh} onClick={onPlan}><Route /> Перейти к планированию</button>
        </div> : <div className="generator-empty"><Database /><strong>Набор ещё не создан</strong><p>Выберите объём работ и нажмите «Создать набор заявок». Затем можно работать с ним здесь или скачать файл.</p></div>}
      </article>
    </div>
  </section>;
}

function ReplanImpactPanel({ changes }: { changes: ReplanChange[] }) {
  if (!changes.length) return null;
  const counts = changes.reduce<Record<ReplanChange["kind"], number>>((acc, item) => { acc[item.kind] += 1; return acc; }, { assignment: 0, order: 0, route: 0, fleet: 0, time: 0, event: 0 });
  const labels: Record<ReplanChange["kind"], string> = { assignment: "Назначения", order: "Порядок", route: "Маршруты", fleet: "Инженеры", time: "Время клиента", event: "События" };
  return <section className="panel replan-impact" aria-label="Изменения после перепланирования">
    <div className="panel-header"><div><h2>Что изменилось после перепланирования</h2><p>Сравнение последнего плана с предыдущим результатом OR-Tools</p></div><Badge>{changes.length} изменений</Badge></div>
    <div className="replan-counters">{(Object.keys(labels) as ReplanChange["kind"][]).map(kind => <span key={kind}><b>{counts[kind]}</b>{labels[kind]}</span>)}</div>
    <div className="replan-list">{changes.slice(0, 12).map(item => <p key={item.key} data-kind={item.kind}><i />{item.message}</p>)}</div>
    {changes.length > 12 && <details><summary>Показать ещё {changes.length - 12}</summary><div className="replan-list extra">{changes.slice(12).map(item => <p key={item.key} data-kind={item.kind}><i />{item.message}</p>)}</div></details>}
  </section>;
}

function routeAssignments(routes: RoutePlan[]) {
  return new Map(routes.flatMap(route => route.stops.map(stop => [stop.jobId, route.engineerId] as const)));
}
function signed(value: number, digits = 1) { return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits).replace(".", ",")}`; }
function summarizeCounterfactual(current: OptimizationResult, forced: OptimizationResult, jobId: string, engineerId: string) {
  const currentAssignments = routeAssignments(current.routes);
  const forcedAssignments = routeAssignments(forced.routes);
  const comparedJobIds = new Set([...currentAssignments.keys(), ...forcedAssignments.keys()]);
  const changed = [...comparedJobIds].filter(id => currentAssignments.get(id) !== forcedAssignments.get(id)).length;
  const forcedRoute = forced.routes.find(route => route.engineerId === engineerId);
  const stop = forcedRoute?.stops.find(item => item.jobId === jobId);
  const distanceDelta = forced.metrics.distanceKm - current.metrics.distanceKm;
  const fleetDelta = forced.metrics.activeEngineers - current.metrics.activeEngineers;
  const assignedDelta = forced.metrics.assigned - current.metrics.assigned;
  const lateDelta = forced.metrics.late - current.metrics.late;
  const verdict = assignedDelta < 0
    ? `Сценарий хуже: теряется ${Math.abs(assignedDelta)} заявок.`
    : fleetDelta > 0
      ? `Сценарий хуже: требуется ${fleetDelta} дополнительный инженер.`
      : lateDelta > 0
        ? `Сценарий хуже: появляется ${lateDelta} дополнительных опозданий.`
        : distanceDelta > 0.05
          ? `Сценарий хуже: общий пробег увеличивается на ${distanceDelta.toFixed(1).replace(".", ",")} км.`
          : changed > 1
            ? `По целевой функции сценарий равноценен, но дестабилизирует план: меняются назначения ${changed} заявок; текущий вариант сохраняется по tie-break OR-Tools.`
            : `По целевой функции сценарий равноценен; текущий инженер выбран по стабильному tie-break OR-Tools.`;
  const effects = [
    `пробег ${signed(distanceDelta)} км`,
    `активные инженеры ${signed(fleetDelta, 0)}`,
    `назначенные заявки ${signed(assignedDelta, 0)}`,
    `опоздания ${signed(lateDelta, 0)}`,
    `SLA среди назначенных ${signed(forced.metrics.slaPercent - current.metrics.slaPercent)} п.п.`,
    `переназначений ${changed}`,
  ];
  return `${verdict} Если назначить принудительно: ${stop ? `прибытие ${minutesLabel(stop.arrival)}, работа ${minutesLabel(stop.start)}–${minutesLabel(stop.end)}; ` : ""}${effects.join("; ")}.`;
}

function summarizeUnassignedCounterfactual(current: OptimizationResult, forced: OptimizationResult, jobId: string, engineerName: string) {
  const before = routeAssignments(current.routes);
  const after = routeAssignments(forced.routes);
  if (!after.has(jobId)) return "Принудительный расчёт не включил эту заявку; проверьте ограничения solver-а.";
  const displaced = [...before.keys()].filter(id => !after.has(id));
  const gained = [...after.keys()].filter(id => !before.has(id));
  const count = forced.metrics.assigned - current.metrics.assigned;
  const conclusion = count < 0
    ? `Подтверждено: принудительное включение снижает покрытие на ${Math.abs(count)} заявку(и).`
    : count === 0 && displaced.length
      ? `При том же покрытии заявка вытеснит № ${displaced.slice(0, 5).join(", № ")}${displaced.length > 5 ? " и другие" : ""}; текущий набор выбран целевой функцией OR-Tools.`
      : count > 0
        ? `Принудительный расчёт нашёл на ${count} назначение(я) больше: исходный план был не лучшим найденным решением.`
        : "Покрытие не меняется; различаются стоимость или порядок маршрута.";
  return `${conclusion} Сценарий с ${engineerName}: назначено ${current.metrics.assigned} → ${forced.metrics.assigned}, без маршрута ${current.metrics.unassigned} → ${forced.metrics.unassigned}, активных инженеров ${current.metrics.activeEngineers} → ${forced.metrics.activeEngineers}, пробег ${signed(forced.metrics.distanceKm - current.metrics.distanceKm)} км${gained.length > 1 ? `, дополнительно вошли № ${gained.filter(id => id !== jobId).slice(0, 3).join(", № ")}` : ""}.`;
}

function JobDetailsDialog({ job, executionStatus, engineer, plan, baselineEngineer, baselinePlan, jobs, engineers, routes, result, travel, speedKmh, onClose, onShowOnMap, onToggleCancelled }: { job: Job | null; executionStatus?: Job["executionStatus"]; engineer?: Engineer; plan?: RoutePlan; baselineEngineer?: Engineer; baselinePlan?: RoutePlan; jobs: Job[]; engineers: Engineer[]; routes: RoutePlan[]; result: OptimizationResult; travel?: TravelMatrix; speedKmh: number; onClose: () => void; onShowOnMap: (id: string) => void; onToggleCancelled: (id: string) => void }) {
  const byId = useMemo(() => new Map(jobs.map(item => [item.id, item])), [jobs]);
  const explanation = useMemo(() => job && engineer && plan ? explainAssignment(job, engineer, plan, engineers, routes, jobs, speedKmh, travel) : null, [job, engineer, plan, engineers, routes, jobs, speedKmh, travel]);
  const forcedCandidate = useMemo(() => baselineEngineer ?? (job?.unassignedCategory !== "no_executor" && job ? engineers.find(item => item.region === job.region && item.skills.includes(job.kind) && item.equipment.includes(job.equipment) && transportAllowed(job, item.transport)) : undefined), [baselineEngineer, job, engineers]);
  const [counterfactuals, setCounterfactuals] = useState<Record<string, CounterfactualAssessment>>({});
  const counterfactualIds = useMemo(() => explanation?.alternatives.filter(item => item.feasible).map(item => item.engineerId) ?? (!engineer && forcedCandidate ? [forcedCandidate.id] : []), [explanation, engineer, forcedCandidate]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!job || !travel || !counterfactualIds.length) { if (active) setCounterfactuals({}); return; }
      setCounterfactuals(Object.fromEntries(counterfactualIds.map(id => [id, { status: "loading" as const }])));
      await Promise.all(counterfactualIds.map(async engineerId => {
        try {
          const forced = await solveCounterfactualServer(engineers, jobs, speedKmh, travel, job.id, engineerId);
          if (active) setCounterfactuals(current => ({ ...current, [engineerId]: { status: "success", summary: engineer ? summarizeCounterfactual(result, forced, job.id, engineerId) : summarizeUnassignedCounterfactual(result, forced, job.id, forcedCandidate?.name ?? engineerId), runtimeMs: forced.runtimeMs } }));
        } catch (error) {
          if (active) setCounterfactuals(current => ({ ...current, [engineerId]: { status: "error", error: error instanceof Error ? error.message : "Контрфактический расчёт недоступен" } }));
        }
      }));
    });
    return () => { active = false; };
  }, [job, engineer, forcedCandidate, engineers, jobs, result, speedKmh, travel, counterfactualIds]);
  return <Dialog open={Boolean(job)} onOpenChange={open => !open && onClose()}>
    <DialogContent className="explain-dialog job-inspect-dialog">
      <DialogHeader>
        <DialogTitle>Заявка № {job?.id}</DialogTitle>
        <DialogDescription>{job?.kind} · {job?.area} · {job?.address}{job?.cancelled ? " · отменена" : ""}</DialogDescription>
      </DialogHeader>
      {job && <div className="job-inspect-body">
        <div className="dialog-grid">
          <label><span>Тип работы</span><b>{job.workType ?? job.kind}</b></label>
          <label><span>Срочность</span><b>{job.urgency === "urgent" ? "Срочная" : "Обычная"}</b></label>
          <label><span>Класс работ</span><b>{job.workClass === "emergency" ? "Авария" : job.workClass === "connection" ? "Подключение" : "Ремонт / дозаказ"}</b></label>
          <label className="wide"><span>Адрес</span><b>{job.address}</b></label>
          <label><span>Окно SLA</span><b>{job.time}</b></label>
          <label><span>Работа на точке</span><b>{job.serviceMinutes} мин</b></label>
          <label><span>Поездка</span><b>{job.engineerId ? `${job.estimatedTravelMinutes ?? 0} мин по маршруту` : job.travelReserveMinutes ? `${job.travelReserveMinutes} мин · предварительный резерв` : "После назначения"}</b></label>
          <label><span>Норматив и источник</span><b>{job.normativeMinutes ? `${job.normativeMinutes} мин · ` : ""}{job.normSource ?? "демонстрационное допущение"}</b></label>
          <label><span>Выполнение</span><b>{executionLabels[executionStatus ?? "not_started"]}</b></label>
          <label><span>Навык</span><b>{job.kind}</b></label>
          <label><span>Оборудование</span><b>{job.equipment}</b></label>
          <label><span>Транспорт</span><b>{job.allowedTransports?.length ? `Допустимы: ${job.allowedTransports.join(", ")}` : job.requiredTransport || "Не ограничен"}</b></label>
          <label><span>Источник</span><b>{job.source}</b></label>
          <label><span>Геокодирование</span><b>{job.geocodeQuality === "house" ? "Дом подтверждён" : job.geocodeQuality === "street" ? "Уровень улицы" : "Требует проверки"}</b></label>
        </div>
        <div className="job-baseline"><b>Baseline по ТЗ · первый допустимый инженер</b><span>{baselineEngineer && baselinePlan ? `${baselineEngineer.name} · ${baselinePlan.stops.findIndex(stop => stop.jobId === job.id) + 1}-я остановка · ${formatDistance(baselinePlan.distanceKm)} за маршрут` : job.baselineUnassignedReason ?? "Без назначения"}</span></div>
        {engineer && plan ? <>
          <div className="decision-score"><span><Sparkles /></span><div><b>{engineer.name}</b><p>Назначение VRPTW · {engineer.region}</p></div><strong>{plan.stops.findIndex(stop => stop.jobId === job.id) + 1}/{plan.stops.length}</strong></div>
          {explanation && <div className="assignment-explanation">
            <div className="explanation-summary"><Sparkles /><p><b>Почему выбран этот инженер</b>{explanation.summary}</p></div>
            <div className="reason-list">{explanation.checks.map((reason, index) => <p key={reason}><i>{index + 1}</i><span>{reason}</span></p>)}</div>
            <div className="alternative-list"><b>Строгая проверка альтернатив</b><em>Для допустимых кандидатов запускается отдельный OR-Tools с принудительным назначением этой заявки.</em>{explanation.alternatives.length ? explanation.alternatives.map(item => { const check = counterfactuals[item.engineerId]; return <p key={item.engineerId}><span>{item.engineerName}</span><small>Предварительная вставка: {item.reason}</small>{item.feasible && <small className={`counterfactual ${check?.status ?? "loading"}`}>{!check || check.status === "loading" ? "OR-Tools рассчитывает сценарий…" : check.status === "success" ? `${check.summary} Расчёт ${check.runtimeMs?.toFixed(0)} мс.` : `Принудительный сценарий недопустим: ${check.error}`}</small>}</p>; }) : <p><small>Других инженеров в выбранном пуле нет.</small></p>}</div>
          </div>}
          <div className="pool-list">
            <b>Пулл выполнения</b>
            {plan.stops.map((stop, index) => {
              const item = byId.get(stop.jobId);
              return <p key={stop.jobId} className={stop.jobId === job.id ? "current" : ""}>
                <i>{index + 1}</i>
                <span>
                  <b>№ {stop.jobId}{stop.jobId === job.id ? " · эта заявка" : ""}</b>
                  {item?.kind ?? "Заявка"} · прибытие {minutesLabel(stop.arrival)} · работа {minutesLabel(stop.start)}–{minutesLabel(stop.end)}
                </span>
              </p>;
            })}
          </div>
        </> : <><div className="dialog-note"><AlertTriangle /><span><b>{job.cancelled ? "Заявка отменена" : executionStatus === "completed" ? "Заявка завершена" : job.unassignedCategory === "no_executor" ? "Нет подходящего исполнителя" : job.unassignedCategory === "cannot_insert" ? "Не удалось встроить в текущий план" : job.unassignedCategory === "alternative_plan" ? "Не вошла в выбранный план · вариант существует" : "План ещё не построен"}</b>{job.cancelled ? "Отменённая заявка исключена из расчёта." : executionStatus === "completed" ? "Завершённая заявка исключена из нового расчёта." : job.unassignedReason ?? "План ещё не построен."}</span></div>{!job.cancelled && executionStatus !== "completed" && forcedCandidate && <div className="alternative-list unassigned-counterfactual"><b>Принудительная проверка с {forcedCandidate.name}</b><em>Отдельный запуск OR-Tools показывает, какие назначения изменятся, если обязательно включить эту заявку.</em><p><small className={`counterfactual ${counterfactuals[forcedCandidate.id]?.status ?? "loading"}`}>{counterfactuals[forcedCandidate.id]?.status === "success" ? counterfactuals[forcedCandidate.id].summary : counterfactuals[forcedCandidate.id]?.status === "error" ? `Расчёт не завершён: ${counterfactuals[forcedCandidate.id].error}` : "OR-Tools рассчитывает сценарий…"}</small></p></div>}</>}
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => { if (job) onToggleCancelled(job.id); }}>{job?.cancelled ? "Восстановить заявку" : "Отменить заявку"}</Button><Button variant="outline" disabled={!job?.engineerId} onClick={() => { if (job) onShowOnMap(job.id); }}>Показать путь на карте</Button><Button onClick={onClose}>Закрыть</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function Dashboard() {
  const [view, setView] = useState<ViewId>("plan"); const [region, setRegion] = useState<"Все зоны" | Region>("Все зоны"); const [compare, setCompare] = useState(false); const [replanned, setReplanned] = useState(false); const [urgentOpen, setUrgentOpen] = useState(false); const [mobileNavOpen, setMobileNavOpen] = useState(false); const [selectedJobId, setSelectedJobId] = useState<string | null>(null); const [detailsJobId, setDetailsJobId] = useState<string | null>(null); const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null); const [selectedEngineerDetailsId, setSelectedEngineerDetailsId] = useState<string | null>(null); const [simTime, setSimTime] = useState(480); const [simPlaying, setSimPlaying] = useState(false); const [playbackMinutesPerSecond, setPlaybackMinutesPerSecond] = useState(1); const [theme, setTheme] = useState<ThemeId>("light"); const [themeOpen, setThemeOpen] = useState(false); const [routingState, setRoutingState] = useState<RoutingState>("idle"); const [extraJobs, setExtraJobs] = useState<Job[]>([]); const [importedJobs, setImportedJobs] = useState<Job[] | null>(null); const [importedEngineers, setImportedEngineers] = useState<Engineer[] | null>(null); const [unavailableEngineerIds, setUnavailableEngineerIds] = useState<string[]>([]); const [cancelledJobIds, setCancelledJobIds] = useState<string[]>([]); const [importStatus, setImportStatus] = useState(""); const [optimizing, setOptimizing] = useState(false); const [formError, setFormError] = useState(""); const [solverError, setSolverError] = useState(""); const [planResult, setPlanResult] = useState<OptimizationResult | null>(null); const [travel, setTravel] = useState<TravelMatrix | undefined>(undefined); const [matrixFallback, setMatrixFallback] = useState(false);
  const [draft, setDraft] = useState<PlanConfig>(defaultConfig); const [applied, setApplied] = useState<PlanConfig | null>(null); const [generated, setGenerated] = useState<GeneratedDataset | null>(null); const [generatedFrom, setGeneratedFrom] = useState<PlanConfig | null>(null);
  const [editorJobs, setEditorJobs] = useState<Job[]>(sourceJobs); const [editorEngineers, setEditorEngineers] = useState<Engineer[]>(sourceEngineers); const [editorUnavailableIds, setEditorUnavailableIds] = useState<string[]>([]); const [editorDirty, setEditorDirty] = useState(false); const [editorError, setEditorError] = useState("");
  const [urgentForm, setUrgentForm] = useState({ address: "", region: "Юго-восток" as Region, start: "13:00", end: "14:30", kind: "Аварийно-восстановительные работы", equipment: "Рефлектометр", transport: "", urgency: "urgent" as "normal" | "urgent" });
  const [eventTimeText, setEventTimeText] = useState("13:10");
  const [lastEventTime, setLastEventTime] = useState<number | null>(null);
  const [lastCalculationMethod, setLastCalculationMethod] = useState<"ortools" | "insert" | "no_change">("ortools");
  const [solverEngine, setSolverEngine] = useState<SolverEngine>("ortools");
  const [replanChanges, setReplanChanges] = useState<ReplanChange[]>([]);
  const [windowExperiment, setWindowExperiment] = useState(false);
  const [sourcePlanResult, setSourcePlanResult] = useState<OptimizationResult | null>(null);
  const [experimentPlanResult, setExperimentPlanResult] = useState<OptimizationResult | null>(null);
  const baseJobs = importedJobs ?? sourceJobs;
  const baseEngineers = importedEngineers?.length ? importedEngineers : sourceEngineers;
  const started = Boolean(applied);
  const activeJobs = useMemo(() => applied ? composePlanJobs(baseJobs, applied.jobs, windowExperiment ? applied.windowMinutes : null, extraJobs, cancelledJobIds) : composePlanJobs(baseJobs, baseJobs.length, null, extraJobs, cancelledJobIds), [applied, baseJobs, extraJobs, cancelledJobIds, windowExperiment]);
  const activeEngineers = useMemo(() => applied ? scaleEngineers(baseEngineers, applied.engineers, activeJobs) : baseEngineers, [applied, baseEngineers, activeJobs]);
  const availableEngineers = useMemo(() => activeEngineers.filter(engineer => !unavailableEngineerIds.includes(engineer.id)), [activeEngineers, unavailableEngineerIds]);
  const result = planResult ?? idleOptimization(availableEngineers, activeJobs, applied?.speedKmh ?? draft.speedKmh, travel);
  const stopByJob = useMemo(() => new Map(result.routes.flatMap(route => route.stops.map(stop => [stop.jobId, stop] as const))), [result.routes]);
  const plannedJobs = useMemo(() => result.jobs.map(job => ({ ...job, executionStatus: executionAtTime(job, stopByJob.get(job.id), started ? simTime : null) })), [result.jobs, stopByJob, started, simTime]); const visibleJobs = useMemo(() => result.jobs.filter(job => !job.cancelled && (region === "Все зоны" || job.region === region)), [result.jobs, region]); const baselineJobs = visibleJobs; const detailsJob = plannedJobs.find(job => job.id === detailsJobId) ?? null; const detailsJobRaw = result.jobs.find(job => job.id === detailsJobId) ?? null; const selectedEngineer = activeEngineers.find(item => item.id === detailsJob?.engineerId); const routeByEngineer = useMemo(() => new Map(result.routes.map(route => [route.engineerId, route])), [result.routes]); const visibleEngineers = useMemo(() => activeEngineers.filter(engineer => region === "Все зоны" || engineer.region === region), [activeEngineers, region]); const visibleBaselineRoutes = useMemo(() => result.baselineRoutes.filter(route => { const engineer = activeEngineers.find(item => item.id === route.engineerId); return Boolean(engineer) && (region === "Все зоны" || engineer?.region === region); }), [result.baselineRoutes, activeEngineers, region]);
  const simRange = useMemo(() => {
    const pool = visibleEngineers.length ? visibleEngineers : activeEngineers;
    const start = pool.reduce((min, item) => Math.min(min, item.shiftStart), 480);
    const fromRoutes = result.routes.reduce((max, route) => Math.max(max, route.stops[route.stops.length - 1]?.end ?? 0), 0);
    const end = Math.max(fromRoutes, pool.reduce((max, item) => Math.max(max, item.shiftEnd), 1320));
    return { start, end };
  }, [visibleEngineers, activeEngineers, result.routes]);
  const simulationOn = started && Boolean(planResult);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!simulationOn) { setSimPlaying(false); return; }
      setSimTime(current => Math.min(simRange.end, Math.max(simRange.start, current)));
    });
    return () => cancelAnimationFrame(frame);
  }, [simulationOn, simRange.start, simRange.end]);
  useEffect(() => { const saved = window.localStorage.getItem("fieldflow-theme") as ThemeId | null; if (saved && themes.some(item => item.id === saved)) { // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved); } }, []); useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("fieldflow-theme", theme); }, [theme]);
  const selectEngineer = useCallback((id: string) => { setSelectedEngineerId(current => current === id ? null : id); setSelectedJobId(null); setDetailsJobId(null); setCompare(false); }, []); const selectJob = useCallback((id: string) => { const job = result.jobs.find(item => item.id === id); setSelectedJobId(id); setDetailsJobId(id); setSelectedEngineerId(job?.engineerId ?? null); if (job) setRegion(job.region); setCompare(false); }, [result.jobs]); const updateRoutingState = useCallback((state: RoutingState) => setRoutingState(state), []); const navigate = useCallback((next: ViewId) => { setView(next); setMobileNavOpen(false); setThemeOpen(false); }, []);
  const focusEngineer = useCallback((id: string) => { setSelectedEngineerId(id); setSelectedJobId(null); setDetailsJobId(null); setSelectedEngineerDetailsId(null); setCompare(false); const engineer = activeEngineers.find(item => item.id === id); if (engineer) setRegion(engineer.region); setView("plan"); }, [activeEngineers]);
  const inspectJob = useCallback((id: string) => { setSelectedJobId(id); setDetailsJobId(id); setSelectedEngineerId(result.jobs.find(item => item.id === id)?.engineerId ?? null); }, [result.jobs]);
  const openEngineerOnMap = focusEngineer; const detailsEngineer = activeEngineers.find(item => item.id === selectedEngineerDetailsId) ?? null;
  const runOptimize = useCallback(async (engineers: Engineer[], jobs: Job[], speedKmh: number, urgentId?: string, scenario: "source" | "experiment" = "source") => {
    if (!engineers.length) { setSolverError("Нет доступных инженеров: верните хотя бы одного сотрудника в смену."); return; }
    setOptimizing(true);
    setSolverError("");
    setRoutingState("loading");
    let nextTravel = travel;
    try {
      const urgentJob = urgentId ? jobs.find(job => job.id === urgentId) : undefined;
      const loaded = await loadRoadTravel(engineers, jobs, speedKmh, urgentJob && travel ? { region: urgentJob.region, previous: travel } : undefined);
      nextTravel = loaded.travel;
      setTravel(loaded.travel);
      setMatrixFallback(loaded.provider === "fallback");
    } catch {
      nextTravel = fallbackTravel(speedKmh);
      setMatrixFallback(true);
    }
    try {
      const solved = await solveVrptwServer(engineers, jobs, speedKmh, nextTravel ?? fallbackTravel(speedKmh), urgentId);
      // Keep unavailable engineers in the name directory so the change log can
      // explain whose old route was removed instead of showing an internal id.
      setReplanChanges(scenario === "experiment" ? [] : planResult && !windowExperiment ? compareReplannedPlans(planResult, solved.result, activeEngineers) : []);
      setPlanResult(solved.result);
      if (scenario === "experiment") setExperimentPlanResult(solved.result);
      else setSourcePlanResult(solved.result);
      setSolverEngine(solved.engine);
      setLastCalculationMethod("ortools");
      setReplanned(true);
      setCompare(false);
    } catch (error) {
      setSolverError(error instanceof Error ? error.message : "OR-Tools недоступен");
      setRoutingState("fallback");
    } finally {
      setOptimizing(false);
    }
  }, [travel, planResult, activeEngineers, windowExperiment]);
  const runTemporalEvent = useCallback(async (event: DispatchEvent, jobs: Job[], unavailableIds: string[]) => {
    if (!applied || !planResult) return false;
    if (windowExperiment) { setSolverError("Переключитесь на исходные окна перед событием: эксперимент рассчитывается отдельно"); return false; }
    if (lastEventTime != null && event.time < lastEventTime) { setSolverError(`Следующее событие не может быть раньше ${minutesLabel(lastEventTime)}`); return false; }
    const cancelled = event.type === "cancel_job" ? planResult.jobs.find(job => job.id === event.id) : undefined;
    if (cancelled && !cancelled.engineerId && !cancelled.baselineEngineerId && jobs.some(job => job.id === event.id && job.cancelled)) {
      const unchanged = cancelUnassignedJob(planResult, event.id);
      setPlanResult(unchanged); setSourcePlanResult(unchanged); setExperimentPlanResult(null);
      setReplanChanges([{ kind: "event", key: `event-${event.id}`, message: `№${event.id} отменена в ${minutesLabel(event.time)}: заявка не была назначена ни в одном плане, поэтому маршруты и согласованное время клиентов не изменились.` }]);
      setLastCalculationMethod("no_change"); setLastEventTime(event.time); setSimTime(event.time); setSimPlaying(false); setReplanned(true); setSolverError("");
      return true;
    }
    setOptimizing(true); setSolverError(""); setRoutingState("loading");
    try {
      const fullEngineers = scaleEngineers(baseEngineers, applied.engineers, jobs);
      const prepared = prepareTemporalReplan(planResult, fullEngineers, jobs, unavailableIds, event);
      const available = prepared.continuationEngineers;
      const loaded = await loadRoadTravel(available, prepared.remainingJobs, applied.speedKmh, travel ? { previous: travel } : undefined);
      const nextTravel = loaded.travel;
      let suffix: OptimizationResult;
      let ordinaryInserted: boolean | null = null;
      const newJob = event.type === "new_job" ? prepared.remainingJobs.find(job => job.id === event.id) : undefined;
      if (newJob && newJob.workClass !== "emergency" && newJob.urgency !== "urgent") {
        const inserted = insertOrdinaryJob(planResult, prepared, newJob, applied.speedKmh, nextTravel);
        ordinaryInserted = inserted.inserted;
        suffix = resultFromRouteOrder(available, prepared.remainingJobs, inserted.orders, { speedKmh: applied.speedKmh, travel: nextTravel });
      } else if (!available.length) {
        suffix = resultFromRouteOrder([], prepared.remainingJobs, [], { speedKmh: applied.speedKmh, travel: nextTravel });
      } else {
        const solved = await solveVrptwServer(available, prepared.remainingJobs, applied.speedKmh, nextTravel, newJob?.workClass === "emergency" ? newJob.id : undefined, event);
        suffix = solved.result;
      }
      const merged = mergeTemporalResult(planResult, suffix, prepared, fullEngineers, jobs, applied.speedKmh, nextTravel);
      if (ordinaryInserted === false) merged.jobs = merged.jobs.map(job => job.id === event.id ? { ...job, unassignedCategory: "cannot_insert", unassignedReason: "Не найден свободный интервал без изменения уже согласованных работ. Обычная заявка оставлена без маршрута; полный пересчёт не выполнялся." } : job);
      setReplanChanges(compareReplannedPlans(planResult, merged, fullEngineers, event.time));
      setPlanResult(merged); setSourcePlanResult(merged); setExperimentPlanResult(null);
      setLastCalculationMethod(ordinaryInserted != null ? "insert" : "ortools"); setLastEventTime(event.time);
      setTravel(nextTravel); setMatrixFallback(loaded.provider === "fallback");
      setRoutingState("ready"); setReplanned(true); setCompare(false);
      setSimTime(event.time); setSimPlaying(false);
      return true;
    } catch (error) {
      setSolverError(error instanceof Error ? error.message : "Не удалось перепланировать оставшийся день");
      setRoutingState("fallback");
      return false;
    } finally { setOptimizing(false); }
  }, [applied, planResult, windowExperiment, baseEngineers, travel, lastEventTime]);
  const applyEditedData = useCallback(async () => {
    const error = validateEditedData(editorJobs, editorEngineers);
    if (error) { setEditorError(error); return; }
    if (editorEngineers.every(engineer => editorUnavailableIds.includes(engineer.id))) { setEditorError("Для расчёта нужен хотя бы один доступный инженер."); return; }
    const geocoder = new BackendGeocodingProvider("nominatim");
    const geocoded = new Map<string, Coordinate>();
    const jobs: Job[] = [];
    for (const [index, job] of editorJobs.entries()) {
      const previous = activeJobs[index];
      const addressChanged = previous && previous.address.trim() !== job.address.trim();
      const coordinatesChanged = previous && (previous.coordinates[0] !== job.coordinates[0] || previous.coordinates[1] !== job.coordinates[1]);
      let next = job;
      if (addressChanged && !coordinatesChanged) {
        setEditorError(`Геокодируем адрес заявки № ${job.id}…`);
        let coordinates = geocoded.get(job.address);
        if (!coordinates) {
          try { coordinates = (await geocoder.geocode(job.address)) ?? undefined; } catch { /* Leave the table unsaved. */ }
          if (coordinates) geocoded.set(job.address, coordinates);
        }
        if (!coordinates) { setEditorError(`Адрес заявки № ${job.id} не удалось геокодировать. Уточните адрес или задайте координаты вручную.`); return; }
        next = { ...job, coordinates, geocodeVerified: true, geocodeQuality: "street" };
      }
      jobs.push({ ...next, time: `${minutesLabel(job.windowStart)}–${minutesLabel(job.windowEnd)}`, engineerId: null, baselineEngineerId: null, unassignedReason: undefined });
    }
    const engineers = editorEngineers.map(engineer => ({ ...engineer, skills: [...engineer.skills], equipment: [...engineer.equipment] }));
    setPlanResult(null); setSourcePlanResult(null); setExperimentPlanResult(null); setWindowExperiment(false); setImportedJobs(jobs); setImportedEngineers(engineers); setEditorJobs(jobs); setExtraJobs([]); setCancelledJobIds([]); setUnavailableEngineerIds(editorUnavailableIds);
    setGenerated(null); setGeneratedFrom(null); setEditorDirty(false); setEditorError("");
    setSelectedJobId(null); setDetailsJobId(null); setSelectedEngineerId(null); setRegion("Все зоны");
    const config = { ...draft, jobs: jobs.length, engineers: engineers.length };
    setDraft(config); setApplied(config); setSimTime(480); setSimPlaying(false);
    void runOptimize(engineers.filter(engineer => !editorUnavailableIds.includes(engineer.id)), jobs, config.speedKmh);
  }, [editorJobs, editorEngineers, editorUnavailableIds, draft, runOptimize, activeJobs]);
  const startPlanning = useCallback(() => {
    if (editorDirty) { setEditorError("В таблице есть несохранённые изменения. Примените их или сбросьте перед новым расчётом."); setView("editor"); return; }
    if (lastEventTime != null) { void runTemporalEvent({ type: "recalculate", time: Math.max(lastEventTime, parseTime(eventTimeText) || lastEventTime), id: "plan" }, activeJobs, unavailableEngineerIds); return; }
    const config = { ...draft };
    setApplied(config);
    setLastEventTime(null);
    const jobs = composePlanJobs(baseJobs, config.jobs, windowExperiment ? config.windowMinutes : null, extraJobs, cancelledJobIds);
    const engineers = scaleEngineers(baseEngineers, config.engineers, jobs).filter(engineer => !unavailableEngineerIds.includes(engineer.id));
    setEditorJobs(jobs); setEditorEngineers(scaleEngineers(baseEngineers, config.engineers, jobs)); setEditorUnavailableIds(unavailableEngineerIds); setEditorError("");
    void runOptimize(engineers, jobs, config.speedKmh, undefined, windowExperiment ? "experiment" : "source");
  }, [draft, extraJobs, runOptimize, runTemporalEvent, baseEngineers, baseJobs, unavailableEngineerIds, cancelledJobIds, editorDirty, windowExperiment, lastEventTime, eventTimeText, activeJobs]);
  const toggleWindowExperiment = useCallback((enabled: boolean) => {
    if (!applied || !sourcePlanResult) return;
    setWindowExperiment(enabled);
    setReplanChanges([]);
    if (!enabled) { setPlanResult(sourcePlanResult); return; }
    if (experimentPlanResult) { setPlanResult(experimentPlanResult); return; }
    const jobs = composePlanJobs(baseJobs, applied.jobs, applied.windowMinutes, extraJobs, cancelledJobIds);
    const engineers = scaleEngineers(baseEngineers, applied.engineers, jobs).filter(engineer => !unavailableEngineerIds.includes(engineer.id));
    void runOptimize(engineers, jobs, applied.speedKmh, undefined, "experiment");
  }, [applied, sourcePlanResult, experimentPlanResult, baseJobs, baseEngineers, extraJobs, cancelledJobIds, unavailableEngineerIds, runOptimize]);
  const createGenerated = useCallback(() => {
    const dataset = generateDataset(sourceJobs, sourceEngineers, draft);
    setGenerated(dataset); setGeneratedFrom({ ...draft });
    setImportedJobs(dataset.jobs); setImportedEngineers(dataset.engineers);
    setEditorJobs(dataset.jobs); setEditorEngineers(dataset.engineers); setEditorUnavailableIds([]); setEditorDirty(false); setEditorError("");
    setExtraJobs([]); setCancelledJobIds([]); setUnavailableEngineerIds([]); setApplied(null); setPlanResult(null); setSourcePlanResult(null); setExperimentPlanResult(null); setWindowExperiment(false); setTravel(undefined); setMatrixFallback(false); setReplanChanges([]); setSelectedJobId(null); setSelectedEngineerId(null); setSolverError("");
    setImportStatus(`Создано ${dataset.jobs.length} заявок и ${dataset.engineers.length} инженеров. Данные готовы к расчёту.`);
  }, [draft]);
  const addUrgent = useCallback(async () => {
    setFormError("");
    if (!urgentForm.address.trim()) { setFormError("Укажите адрес заявки"); return; }
    const start = parseTime(urgentForm.start), end = parseTime(urgentForm.end), eventTime = parseTime(eventTimeText);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { setFormError("Проверьте временное окно"); return; }
    if (!Number.isFinite(eventTime) || end <= eventTime) { setFormError("Окно новой заявки должно заканчиваться после события"); return; }
    let coordinates = regionCenters[urgentForm.region]; let geocodeVerified = false;
    try { const resolved = await new BackendGeocodingProvider("nominatim").geocode(urgentForm.address); if (resolved) { coordinates = resolved; geocodeVerified = true; } } catch { /* Explicit fallback quality remains visible. */ }
    const id = `URG-${Date.now().toString().slice(-6)}`;
    const emergency = urgentForm.kind === "Аварийно-восстановительные работы";
    const serviceMinutes = emergency ? 80 : urgentForm.kind === "Подключение и модернизация" ? 60 : 30;
    const job: Job = { id, time: `${urgentForm.start}–${urgentForm.end}`, windowStart: start, windowEnd: end, area: urgentForm.region,
      address: urgentForm.address, kind: urgentForm.kind, workType: urgentForm.kind, tone: "amber", region: urgentForm.region,
      engineerId: null, baselineEngineerId: null, coordinates, geocodeVerified, geocodeQuality: geocodeVerified ? "street" : "fallback",
      risk: false, equipment: urgentForm.equipment, requiredTransport: urgentForm.transport, priority: emergency ? 5 : 2, serviceMinutes,
      normativeMinutes: emergency ? 100 : undefined, travelReserveMinutes: emergency ? 20 : 0, estimatedTravelMinutes: emergency ? 20 : 0,
      normSource: emergency ? "экспертный норматив" : "демонстрационное допущение", urgency: urgentForm.urgency,
      workClass: emergency ? "emergency" : urgentForm.kind === "Подключение и модернизация" ? "connection" : "repair",
      source: "Форма диспетчера", status: "Новая", executionStatus: "not_started" };
    const nextExtras = [...extraJobs, job];
    if (applied && planResult) {
      const jobs = composePlanJobs(baseJobs, applied.jobs, null, nextExtras, cancelledJobIds);
      if (!await runTemporalEvent({ type: "new_job", time: eventTime, id }, jobs, unavailableEngineerIds)) return;
    }
    setExtraJobs(nextExtras); setEditorJobs(current => [...current, job]); setUrgentOpen(false);
    setSelectedJobId(id); setDetailsJobId(id); setUrgentForm(current => ({ ...current, address: "" }));
  }, [urgentForm, eventTimeText, applied, extraJobs, planResult, runTemporalEvent, baseJobs, unavailableEngineerIds, cancelledJobIds]);
  const handleImport = useCallback(async (file: File) => {
    setImportStatus(`Читаем ${file.name}…`);
    try {
      const imported = await importPlanFile(file, regionCenters);
      const provider = new BackendGeocodingProvider("nominatim");
      const coordinates = new Map<string, Coordinate>();
      const missing = [...new Set(imported.jobs.filter(job => !job.geocodeVerified).map(job => job.address))];
      for (let index = 0; index < missing.length; index++) {
        const address = missing[index];
        setImportStatus(`Геокодирование ${index + 1}/${missing.length}: ${address}`);
        try { const point = await provider.geocode(address); if (point) coordinates.set(address, point); } catch { /* quality remains explicit */ }
        if (index + 1 < missing.length) await new Promise(resolve => window.setTimeout(resolve, 1100));
      }
      const jobs = imported.jobs.map(job => coordinates.has(job.address) ? { ...job, coordinates: coordinates.get(job.address)!, geocodeVerified: true, geocodeQuality: "street" as const } : job);
      const verified = jobs.filter(job => job.geocodeVerified).length;
      if (jobs.length) setImportedJobs(jobs);
      if (imported.engineers?.length) setImportedEngineers(imported.engineers);
      if (jobs.length) setEditorJobs(jobs);
      if (imported.engineers?.length) setEditorEngineers(imported.engineers);
      setEditorUnavailableIds([]); setEditorDirty(false); setEditorError("");
      setGenerated(null); setGeneratedFrom(null);
      if (jobs.length) { setExtraJobs([]); setCancelledJobIds([]); setUnavailableEngineerIds([]); }
      setApplied(null); setPlanResult(null); setSourcePlanResult(null); setExperimentPlanResult(null); setWindowExperiment(false); setTravel(undefined); setMatrixFallback(false); setReplanChanges([]); setSelectedJobId(null); setSelectedEngineerId(null);
      setDraft(current => ({ ...current, jobs: jobs.length || current.jobs, engineers: imported.engineers?.length || current.engineers, speedKmh: imported.speedKmh ?? current.speedKmh }));
      setImportStatus(`${file.name}: ${jobs.length ? `${jobs.length} заявок, координаты подтверждены ${verified}/${jobs.length}` : `${imported.engineers?.length ?? 0} инженеров`}${imported.warnings.length ? "; " + imported.warnings[0] : ""}.`);
    } catch (error) {
      setImportStatus(error instanceof Error ? `Ошибка: ${error.message}` : "Не удалось импортировать файл");
    }
  }, []);
  const toggleEngineerAvailability = useCallback(async (id: string) => {
    const next = unavailableEngineerIds.includes(id) ? unavailableEngineerIds.filter(item => item !== id) : [...unavailableEngineerIds, id];
    const time = parseTime(eventTimeText);
    if (!Number.isFinite(time)) { setSolverError("Укажите корректное время события"); return; }
    if (applied && planResult) {
      const jobs = composePlanJobs(baseJobs, applied.jobs, null, extraJobs, cancelledJobIds);
      if (!await runTemporalEvent({ type: "engineer_unavailable", time, id }, jobs, next)) return;
    }
    setUnavailableEngineerIds(next); setEditorUnavailableIds(next); setSelectedEngineerDetailsId(null);
  }, [unavailableEngineerIds, applied, planResult, baseJobs, extraJobs, cancelledJobIds, runTemporalEvent, eventTimeText]);
  const toggleJobCancelled = useCallback(async (id: string) => {
    const next = cancelledJobIds.includes(id) ? cancelledJobIds.filter(item => item !== id) : [...cancelledJobIds, id];
    const time = parseTime(eventTimeText);
    if (!Number.isFinite(time)) { setSolverError("Укажите корректное время события"); return; }
    if (applied && planResult) {
      const jobs = composePlanJobs(baseJobs, applied.jobs, null, extraJobs, next);
      if (!await runTemporalEvent({ type: "cancel_job", time, id }, jobs, unavailableEngineerIds)) return;
    }
    setCancelledJobIds(next);
    setEditorJobs(current => current.map(job => job.id === id ? { ...job, cancelled: !job.cancelled } : job));
    setDetailsJobId(null);
  }, [cancelledJobIds, applied, planResult, baseJobs, extraJobs, unavailableEngineerIds, runTemporalEvent, eventTimeText]);
const titles = { plan: ["План работ", started ? "VRPTW по трём регионам" : "Постройте маршруты для текущего набора заявок"], requests: ["Заявки", "CSV, JSON и срочные работы"], team: ["Инженеры", "Ресурсы, доступность и рассчитанная загрузка"], analytics: ["Аналитика", "Показатели текущего VRPTW-плана"], generator: ["Генератор заявок", "Создание набора для расчёта и экспорта"], editor: ["Редактор данных", "Изменение заявок и инженеров в таблице"], demo: ["Демонстрация алгоритма", "Как жадина и 2-opt ищут маршрут на плоскости"] } as const; const distanceDataReady = baseJobs.every(job => job.geocodeVerified === true) && (applied?.jobs ?? 0) <= baseJobs.length && (applied?.engineers ?? 0) <= baseEngineers.length && extraJobs.every(job => job.geocodeVerified === true) && !matrixFallback; const distanceReady = started && result.comparison.commonAssigned > 0 && result.comparison.distanceDeltaPercent != null && distanceDataReady; const distanceWarning = !started ? "Запустите построение маршрутов для сравнения." : !distanceDataReady ? ((applied?.jobs ?? 0) > baseJobs.length || (applied?.engineers ?? 0) > baseEngineers.length ? "Синтетически добавленные точки не геокодированы. Пробег показан как оценка." : baseJobs.some(job => job.geocodeVerified !== true) ? "Не все адреса импортированного набора геокодированы. Пробег показан как оценка." : extraJobs.some(job => job.geocodeVerified !== true) ? "У срочной заявки не подтверждены координаты. Пробег показан как оценка." : activeEngineers.some(engineer => engineer.transport === "Общественный транспорт") ? "Для общественного транспорта нет матрицы расписания: план использует оценочную скорость и дорожное расстояние. Строгий процент пробега скрыт." : "Часть дорожной матрицы заменена приближённым расстоянием. Пробег показан как оценка.") : result.comparison.reason ?? "Нет сопоставимых назначений для расчёта пробега.";
  const routingLabel = optimizing || routingState === "loading" ? "Строим маршруты" : matrixFallback ? "Матрица оценочная" : routingState === "ready" ? "Дорожный граф подключён" : routingState === "idle" ? "Ожидание запуска" : "Часть дорог недоступна";
  const metricCards = <section className="metric-grid"><article><div className="metric-head"><span className="metric-icon purple"><Wrench /></span><small>Назначено заявок</small><Badge className="metric-badge">{started ? `${result.metrics.unassigned} без маршрута` : "не запущено"}</Badge></div><strong>{result.metrics.assigned}<em>/ {result.metrics.total}</em></strong><p>Покрытие {result.metrics.total ? (result.metrics.assigned / result.metrics.total * 100).toFixed(1).replace(".", ",") : "0"}% · baseline {result.baseline.assigned}</p></article><article><div className="metric-head"><span className="metric-icon teal"><Route /></span><small>Пробег VRPTW</small><Badge className="metric-badge good">{distanceReady && result.comparison.distanceDeltaPercent != null ? `${result.comparison.distanceDeltaPercent < 0 ? "−" : "+"}${Math.abs(result.comparison.distanceDeltaPercent).toFixed(1).replace(".", ",")}%` : "оценка"}</Badge></div><strong>{result.metrics.distanceKm.toFixed(1).replace(".", ",")}<em> км</em></strong><p>baseline: {formatDistance(result.baseline.distanceKm)}{distanceReady ? "" : " · без сравнения %"}</p></article><article><div className="metric-head"><span className="metric-icon orange"><UsersRound /></span><small>Активные инженеры</small><Badge className="metric-badge">{started ? "baseline → VRPTW" : "ожидание"}</Badge></div><strong>{result.baseline.activeEngineers}<em> → {result.metrics.activeEngineers}</em></strong><p>из {availableEngineers.length} доступных · {unavailableEngineerIds.length} вне смены</p></article><article><div className="metric-head"><span className="metric-icon blue"><Database /></span><small>Геокодирование</small><Badge className="metric-badge">{csvMeta.regions.length} зоны</Badge></div><strong>{baseJobs.filter(job => job.geocodeVerified).length}<em>/ {baseJobs.length}</em></strong><p>дом: {baseJobs.filter(job => job.geocodeQuality === "house").length} · улица: {baseJobs.filter(job => job.geocodeQuality === "street").length}</p></article></section>;
  return <main className="app-shell">{mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} />}<aside className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`}><div className="sidebar-brand-row"><Logo /><button className="mobile-nav-close" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)}><X /></button></div><nav aria-label="Основная навигация"><button className={`nav-item${view === "plan" ? " active" : ""}`} onClick={() => navigate("plan")}><Route /><span>Планирование</span></button><button className={`nav-item${view === "requests" ? " active" : ""}`} onClick={() => navigate("requests")}><Wrench /><span>Заявки</span><b>{plannedJobs.length}</b></button><button className={`nav-item${view === "team" ? " active" : ""}`} onClick={() => navigate("team")}><UsersRound /><span>Инженеры</span></button><button className={`nav-item${view === "analytics" ? " active" : ""}`} onClick={() => navigate("analytics")}><BarChart3 /><span>Аналитика</span></button><button className={`nav-item${view === "generator" ? " active" : ""}`} onClick={() => navigate("generator")}><Sparkles /><span>Генератор заявок</span></button><button className={`nav-item${view === "editor" ? " active" : ""}`} onClick={() => navigate("editor")}><Table2 /><span>Редактор данных</span>{editorDirty && <b>●</b>}</button><button className={`nav-item${view === "demo" ? " active" : ""}`} onClick={() => navigate("demo")}><Waypoints /><span>Демонстрация</span></button></nav><div className="sidebar-bottom"><button className="nav-item theme-nav" onClick={() => setThemeOpen(open => !open)}><SunMoon /><span>Тема</span></button><div className="profile"><span>ДК</span><div><strong>Диспетчер</strong><small>В сети</small></div><MoreHorizontal size={17} /></div></div></aside><section className="workspace" id="plan"><header className="topbar"><button className="mobile-menu" aria-label="Открыть меню" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu /></button><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div><div className="top-actions"><button className="theme-button" onClick={() => setThemeOpen(open => !open)}><Contrast /><span>{themes.find(item => item.id === theme)?.name}</span><ChevronDown /></button><Button className="urgent-button" onClick={() => setUrgentOpen(true)}><Zap />Срочная заявка</Button></div></header>
    {themeOpen && <div className="theme-menu" role="menu">{themes.map(item => <button key={item.id} className={theme === item.id ? "active" : ""} onClick={() => { setTheme(item.id); setThemeOpen(false); }}><span className="theme-swatches">{item.colors.map(color => <i key={color} style={{ background: color }} />)}</span><b>{item.name}</b>{theme === item.id && <Check />}</button>)}</div>}
    {view === "plan" && <><div className="filter-row"><div className="region-select" role="group" aria-label="Показать заявки и маршруты по зоне"><span className="region-select-label">Зона карты</span>{(["Все зоны", "Восток", "Юго-восток", "Югоцентр"] as const).map(item => <button type="button" key={item} aria-pressed={region === item} className={region === item ? "selected" : ""} onClick={() => { setRegion(item); setSelectedEngineerId(null); setSelectedJobId(null); }}>{item}</button>)}</div><div className="plan-state"><span className={routingState === "ready" ? "state-dot" : routingState === "loading" ? "state-dot changed" : routingState === "idle" ? "state-dot idle" : "state-dot risk-dot"} />{routingLabel}{started ? ` · ${solverLabels[solverEngine]}` : ""}</div><button className="plan-run-button" disabled={optimizing || routingState === "loading"} onClick={startPlanning}><Play />{optimizing ? "Считаем…" : routingState === "loading" ? "Строим дороги…" : started ? "Пересчитать маршруты" : "Построить маршруты"}</button>{started && <ExportButtons result={result} engineers={activeEngineers} solver={solverEngine} speedKmh={applied?.speedKmh ?? draft.speedKmh} />}</div>
      <div className="window-scenario-control"><label><input type="checkbox" checked={windowExperiment} disabled={!sourcePlanResult || optimizing} onChange={event => toggleWindowExperiment(event.target.checked)} /><span>Эксперимент с окнами</span></label><small>{windowExperiment ? `Эксперимент: среднее окно ${applied?.windowMinutes ?? draft.windowMinutes} мин; исходные CSV не изменены.` : "Основной план: исходные окна CSV без расширения."}</small><label className="event-time-control"><span>Время события</span><input type="time" value={eventTimeText} onChange={event => setEventTimeText(event.target.value)} /><small>Для новой заявки, отмены и недоступности инженера. Прошедшие работы закрепляются.</small></label></div>
      {windowExperiment && sourcePlanResult && experimentPlanResult && <div className="window-experiment-comparison"><b>Отдельное сравнение сценариев</b><span>Исходные окна: {sourcePlanResult.metrics.assigned}/{sourcePlanResult.metrics.total} назначено, {sourcePlanResult.metrics.activeEngineers} инженеров.</span><span>Эксперимент: {experimentPlanResult.metrics.assigned}/{experimentPlanResult.metrics.total} назначено, {experimentPlanResult.metrics.activeEngineers} инженеров.</span><small>Изменённые окна относятся только к эксперименту; это не улучшение основного плана.</small></div>}
      {solverError && <div className="impact-banner error-banner"><span><AlertTriangle /></span><div><strong>Расчёт OR-Tools не завершён</strong><p>{solverError}. Эвристический fallback намеренно не используется.</p></div><button onClick={() => setSolverError("")}>Скрыть</button></div>}
      {replanned && started && !solverError && <div className="impact-banner"><span><Sparkles /></span><div><strong>{lastCalculationMethod === "no_change" ? "Отмена без изменения маршрутов" : lastCalculationMethod === "insert" ? "Обычная заявка проверена для вставки в свободный интервал" : `OR-Tools VRPTW рассчитан за ${result.runtimeMs} мс`}</strong><p>{lastCalculationMethod === "no_change" ? "Отменённая заявка не была назначена; повторная оптимизация не потребовалась." : lastCalculationMethod === "insert" ? "Прошедшие и согласованные работы не перестраивались; серверный solver для этой вставки не запускался." : `Назначено ${result.metrics.assigned} из ${result.metrics.total}; движок подтверждён ответом сервера.`}</p></div><button onClick={() => setReplanned(false)}>Скрыть уведомление</button></div>}
      <ReplanImpactPanel changes={replanChanges} />
      <section className="content-grid assignment-layout">
        <article className="panel map-panel"><div className="panel-header"><div><h2>Маршруты</h2><p>{visibleEngineers.length} инженеров · {visibleJobs.length} заявок · {region}{simulationOn ? ` · ${minutesLabel(simTime)}` : ""}</p></div><div className="legend"><span><i className="legend-solid" />VRPTW</span><span><i className="legend-dash" />Baseline</span><button className={compare ? "active" : ""} disabled={!started} onClick={() => setCompare(value => !value)}><Layers3 />{compare ? "Скрыть сравнение" : "Сравнить"}</button></div></div><div className="map-stage"><MapCanvas visibleJobs={visibleJobs} baselineJobs={baselineJobs} engineers={activeEngineers} selectedEngineerId={selectedEngineerId} selectedJobId={selectedJobId} simTime={simulationOn ? simTime : null} simPlaying={simPlaying} simSpeed={playbackMinutesPerSecond} carSpeedKmh={applied?.speedKmh ?? draft.speedKmh} simEnd={simRange.end} onSimTime={setSimTime} onSimPlaying={setSimPlaying} compare={compare} routingEnabled={started && Boolean(planResult)} routes={result.routes} baselineRoutes={visibleBaselineRoutes} onSelectEngineer={selectEngineer} onSelectJob={selectJob} onInspectJob={inspectJob} onRoutingState={updateRoutingState} />{simulationOn && <TimeDrum start={simRange.start} end={simRange.end} time={simTime} playing={simPlaying} speed={playbackMinutesPerSecond} onTime={setSimTime} onPlaying={setSimPlaying} onSpeed={setPlaybackMinutesPerSecond} disabled={optimizing} />}</div></article>
        <article className="panel routes-panel"><div className="panel-header"><div><h2>Назначения по заявкам</h2><p>{started ? "Заявка и её инженер — нажмите для подробностей" : "Постройте маршруты для просмотра назначений"}</p></div></div>{!started && <div className="route-empty">Для другого объёма работ откройте «Генератор заявок».</div>}{started && <AssignmentBoard jobs={visibleJobs} engineers={activeEngineers} routes={result.routes} selectedJobId={selectedJobId} selectedEngineerId={selectedEngineerId} loading={optimizing} onSelectJob={selectJob} onSelectEngineer={focusEngineer} onShowAll={() => { setRegion("Все зоны"); setSelectedEngineerId(null); setSelectedJobId(null); }} />}</article>
      </section>
      <section className="panel queue-panel"><div className="panel-header"><div><h2>Ближайшие работы</h2><p>{visibleJobs.length} заявок из текущего плана</p></div><button className="plain-button" onClick={() => setUrgentOpen(true)}><Plus />Добавить заявку</button></div><JobTable jobs={plannedJobs.filter(job => !job.cancelled && (region === "Все зоны" || job.region === region))} engineers={activeEngineers} onOpen={selectJob} limit={12} /></section></>}
    {view === "requests" && <RequestsView jobs={plannedJobs} engineers={activeEngineers} onOpen={selectJob} onAdd={() => setUrgentOpen(true)} onImport={file => void handleImport(file)} importStatus={importStatus} />}
    {view === "team" && <EngineersView engineers={activeEngineers} jobs={plannedJobs} result={result} unavailableIds={unavailableEngineerIds} onOpenDetails={setSelectedEngineerDetailsId} onOpenRoute={openEngineerOnMap} />}
    {view === "analytics" && <AnalyticsView result={result} engineers={activeEngineers} distanceReady={distanceReady} distanceWarning={distanceWarning} solver={solverEngine} speedKmh={applied?.speedKmh ?? draft.speedKmh} metrics={metricCards} travel={travel} />}
    {view === "generator" && <GeneratorView draft={draft} setDraft={setDraft} generated={generated} generatedFrom={generatedFrom} onGenerate={createGenerated} onPlan={() => navigate("plan")} onDemo={() => { void handleImport(new File([JSON.stringify(demoScenario)], "demo-scenario.json", { type: "application/json" })).then(() => navigate("plan")); }} />}
    {view === "editor" && <DataEditor jobs={editorJobs} engineers={editorEngineers} carSpeedKmh={applied?.speedKmh ?? draft.speedKmh} simTime={simulationOn ? simTime : null} stopsByJob={stopByJob} unavailableIds={editorUnavailableIds} dirty={editorDirty} optimizing={optimizing} error={editorError || solverError} onJobs={jobs => { setEditorJobs(jobs); setEditorDirty(true); setEditorError(""); }} onEngineers={engineers => { setEditorEngineers(engineers); setEditorDirty(true); setEditorError(""); }} onUnavailable={ids => { setEditorUnavailableIds(ids); setEditorDirty(true); }} onApply={applyEditedData} onReset={() => { setEditorJobs(activeJobs); setEditorEngineers(activeEngineers); setEditorUnavailableIds(unavailableEngineerIds); setEditorDirty(false); setEditorError(""); }} />}
    {view === "demo" && <AlgorithmDemoView />}</section>
  <Dialog open={urgentOpen} onOpenChange={setUrgentOpen}><DialogContent className="urgent-dialog"><DialogHeader><DialogTitle>Новая заявка</DialogTitle><DialogDescription>Событие в {eventTimeText}: выполненные и начатые работы останутся на своих местах.</DialogDescription></DialogHeader><div className="urgent-form">
    <label className="wide"><span>Адрес</span><Input value={urgentForm.address} onChange={event => setUrgentForm(value => ({ ...value, address: event.target.value }))} placeholder="Москва, ул. Люблинская, 72" /></label>
    <label><span>Регион</span><select value={urgentForm.region} onChange={event => setUrgentForm(value => ({ ...value, region: event.target.value as Region }))}><option>Восток</option><option>Юго-восток</option><option>Югоцентр</option></select></label>
    <label><span>Навык из справочника</span><select value={urgentForm.kind} onChange={event => setUrgentForm(value => ({ ...value, kind: event.target.value }))}><option>Локальные работы</option><option>Подключение и модернизация</option><option>Аварийно-восстановительные работы</option></select></label>
    <label><span>Начало окна</span><Input type="time" value={urgentForm.start} onChange={event => setUrgentForm(value => ({ ...value, start: event.target.value }))} /></label><label><span>Окончание окна</span><Input type="time" value={urgentForm.end} onChange={event => setUrgentForm(value => ({ ...value, end: event.target.value }))} /></label>
    <label><span>Оборудование</span><select value={urgentForm.equipment} onChange={event => setUrgentForm(value => ({ ...value, equipment: event.target.value }))}><option>Рефлектометр</option><option>Комплект GPON</option><option>ONT</option><option>Диагностический комплект</option></select></label>
    <label><span>Требуемый транспорт</span><select value={urgentForm.transport} onChange={event => setUrgentForm(value => ({ ...value, transport: event.target.value }))}><option value="">Не ограничен</option><option>Автомобиль</option><option>Общественный транспорт</option><option>Велосипед</option><option>Пешком</option></select></label>
    <label><span>Срочность</span><select value={urgentForm.urgency} onChange={event => setUrgentForm(value => ({ ...value, urgency: event.target.value as "normal" | "urgent" }))}><option value="urgent">Срочная</option><option value="normal">Обычная</option></select></label>
  </div>{formError && <p className="form-error">{formError}</p>}<div className="dialog-note"><Sparkles /><span><b>Что учтёт оптимизатор</b>Навыки, оборудование, транспорт, смену, приоритет и временное окно.</span></div><DialogFooter><Button variant="outline" onClick={() => setUrgentOpen(false)}>Отмена</Button><Button onClick={() => void addUrgent()}><Zap />{started ? "Добавить и пересчитать" : "Добавить заявку"}</Button></DialogFooter></DialogContent></Dialog>
<EngineerDetailsDialog engineer={detailsEngineer} route={detailsEngineer ? routeByEngineer.get(detailsEngineer.id) : undefined} unavailable={Boolean(detailsEngineer && unavailableEngineerIds.includes(detailsEngineer.id))} onClose={() => setSelectedEngineerDetailsId(null)} onOpenRoute={openEngineerOnMap} onToggleAvailability={toggleEngineerAvailability} />
    <JobDetailsDialog job={detailsJobRaw} executionStatus={detailsJob?.executionStatus} engineer={selectedEngineer} plan={detailsJob?.engineerId ? routeByEngineer.get(detailsJob.engineerId) : undefined} baselineEngineer={activeEngineers.find(item => item.id === detailsJob?.baselineEngineerId)} baselinePlan={result.baselineRoutes.find(route => route.engineerId === detailsJob?.baselineEngineerId)} jobs={result.jobs} engineers={availableEngineers} routes={result.routes} result={result} travel={travel} speedKmh={applied?.speedKmh ?? draft.speedKmh} onClose={() => setDetailsJobId(null)} onShowOnMap={id => { const job = result.jobs.find(item => item.id === id); if (job) setRegion(job.region); setSelectedJobId(id); setSelectedEngineerId(job?.engineerId ?? null); setDetailsJobId(null); setView("plan"); }} onToggleCancelled={toggleJobCancelled} /></main>;
}
