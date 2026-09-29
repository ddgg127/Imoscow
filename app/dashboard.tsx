"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, Bell, LoaderCircle, Check, ChevronDown, Clipboard, Clock3, Compass, Contrast, Database, Download, FileJson, FileUp, Layers3, MapPin, Menu, MoreHorizontal, Play, Plus, RefreshCw, Route, Search, ShieldAlert, Sliders, Sparkles, SunMoon, Table2, Upload, Users, UsersRound, Waypoints, Wrench, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { MapCanvas, type RoutingState } from "@/components/map-canvas";
import { AssignmentBoard } from "@/components/assignment-board";
import { HelpHint } from "@/components/help-hint";
import { JobStatus } from "@/components/job-status";
import { JobDetailsDialog } from "@/components/job-details-dialog";
import { NotificationJournal, useNotificationJournal } from "@/components/notification-journal";
import { getJobState, jobStateLabels } from "@/lib/job-presentation";
import { reassignmentNotifications } from "@/lib/notification-journal";
import { ScheduledEventsEditor, type EventEditorDraft } from "@/components/scheduled-events-editor";
import { MileageExplanation } from "@/components/mileage-explanation";
import { usePersistentWorkspace } from "@/components/use-persistent-workspace";
import { saveTravel, restoreTravel } from "@/lib/workspace-storage";
import { eventKey, nextDueEvent, planAtTime, invalidateFutureEvents, scheduledEventChange, type EventOutcomes } from "@/lib/scheduled-events";
import { EngineerWorkspace, type EngineerAbsenceReason } from "@/components/engineer-workspace";
import { EngineerTimeline } from "@/components/engineer-timeline";
import { TimeDrum } from "@/components/time-drum";
import { AboutSolutionView } from "@/components/about-solution";
import { DataEditor } from "@/components/data-editor";
import { PlanAnalysisView } from "@/components/plan-analysis";
import { BackendGeocodingProvider, type Coordinate } from "@/lib/map-providers";
import { loadRoadTravel } from "@/lib/road-travel";
import { mapJobsForRegion } from "@/lib/map-region";
import demoScenario from "@/data/demo-scenario.json";
import { downloadPlan } from "@/lib/export-plan";
import { downloadAllTzCsvs, downloadBlob, downloadGeneratedDataset, downloadTzJson, engineersToTzCsv, eventsToTzCsv, generateDataset, generateTzDataset, jobsToTzCsv, type GeneratedDataset, type GeneratedTzDataset, type GenerateTzOptions, type TzReplanEvent } from "@/lib/generator-files";
import { importPlanFile } from "@/lib/import-data";
import { absenceImpact, engineerAbsenceMoment, type AbsenceImpact, type AbsenceMoment } from "@/lib/engineer-absence";
import { issueDailyEquipment } from "@/lib/equipment-issue";
import { executionAtTime, parseTime, validateEditedData } from "@/lib/data-editor";
import { eventTimeError, unavailableAtTime, type AvailabilityChange } from "@/lib/event-time";
import { solveVrptwServer, type SolverEngine } from "@/lib/server-solver";
import { compareReplannedPlans, fallbackTravel, idleOptimization, jobPriorityLevel, minutesLabel, regions, resultFromRouteOrder, routeTimeBreakdown, scaleEngineers, scaleJobs, type Engineer, type Job, type OptimizationResult, type Region, type ReplanChange, type RoutePlan, type TravelMatrix, uniquePoints } from "@/lib/vrptw";
import { cancelJobLocally, cancelUnassignedJob, insertOrdinaryJob, mergeTemporalResult, prepareTemporalReplan, type DispatchEvent } from "@/lib/temporal-replan";

type ThemeId = "light" | "dark" | "beeline" | "ocean" | "graphite" | "contrast";
type ViewId = "plan" | "generator" | "requests" | "team" | "analytics" | "editor" | "about" | "engineer";
type GeneratorPreferences = { engineerCounts: number[]; jobKindCounts: number[]; urgentCount: number; vehicleCount: number; seed: number; cancelEvents: number; unavailableEvents: number; urgentEvents: number; previewTab: "jobs" | "engineers" | "events"; paramsOpen: boolean };
type PlanConfig = { engineers: number; jobs: number; speedKmh: number; windowMinutes: number; highPriority?: boolean };
const defaultConfig: PlanConfig = { engineers: 12, jobs: 40, speedKmh: 24, windowMinutes: 240, highPriority: false };

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

function composePlanJobs(base: Job[], count: number, extras: Job[], cancelledIds: string[] = []) {
  const cancelled = new Set(cancelledIds);
  const scaled = scaleJobs(base, count);
  return [...scaled, ...extras].map(job => ({ ...job, cancelled: cancelled.has(job.id) ? !job.cancelled : Boolean(job.cancelled), status: cancelled.has(job.id) ? (job.cancelled ? "Новая" : "Отменена") : job.status }));
}
const regionCenters: Record<Region, Coordinate> = {
  "Восток": [37.7739593, 55.7022013],
  "Юго-восток": [37.6653422, 55.6020854],
  "Югоцентр": [37.6158385, 55.6647568],
};
const themes: Array<{ id: ThemeId; name: string; colors: string[] }> = [
  { id: "light", name: "Светлая", colors: ["#fff", "#6547e7"] }, { id: "dark", name: "Тёмная", colors: ["#111522", "#8e7cff"] }, { id: "beeline", name: "Билайн", colors: ["#ffd400", "#151515"] }, { id: "ocean", name: "Океан", colors: ["#e9fbff", "#007f8b"] }, { id: "graphite", name: "Графит", colors: ["#dfe3e8", "#38414d"] }, { id: "contrast", name: "Высокий контраст", colors: ["#fff", "#0047ff"] },
];
function Logo() { return <div className="brand"><span className="brand-mark"><Route size={18} /></span><span>FieldFlow</span></div>; }
function formatDistance(value: number) { return `${value.toFixed(1).replace(".", ",")} км`; }
const solverLabels: Record<SolverEngine, string> = { ortools: "OR-Tools", "heuristic-server": "Серверный алгоритм", "heuristic-browser": "Локальный алгоритм" };

function ExportButtons({ result, engineers, solver, speedKmh }: { result: OptimizationResult; engineers: Engineer[]; solver: SolverEngine; speedKmh: number }) {
  return <div className="export-actions" aria-label="Экспорт результата">
    <button type="button" title="Скачать таблицу рассчитанного плана для Excel" onClick={() => downloadPlan(result, engineers, "csv", { solver, speedKmh })}><Download />Скачать CSV</button>
    <button type="button" title="Скачать все данные рассчитанного плана для повторной обработки" onClick={() => downloadPlan(result, engineers, "json", { solver, speedKmh })}><FileJson />Скачать JSON</button>
    <HelpHint label="Скачивание плана">CSV — таблица заявок и маршрутов для Excel. JSON — полный результат с данными, которые можно обработать программно. Обе кнопки скачивают файлы; загрузка данных находится в «Генераторе».</HelpHint>
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

function ConfigNumberField({ label, value, onChange, sliderMin = 1, sliderMax = 500, inputMin = 1, inputMax = 10000, snapStep, suffix }: { label: string; hint?: string; value: number; onChange: (value: number) => void; sliderMin?: number; sliderMax?: number; inputMin?: number; inputMax?: number; snapStep: number; suffix?: string }) {
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
  return <div className="config-field"><div className="config-field-head"><Label>{label}</Label><div className="config-input-wrap"><Input inputMode="numeric" value={text} aria-label={label} onChange={event => { const next = event.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, ""); setText(next); if (next === "") return; onChange(clamp(next)); }} onBlur={() => { const next = clamp(text); onChange(next); setText(String(next)); }} /><span>{suffix}</span></div></div><div className="config-slider-wrap"><Slider min={sliderMin} max={sliderMax} step={1} value={[sliderValue]} className="w-full" onPointerDown={event => { shiftHeld.current = event.shiftKey; pointerActive.current = true; }} onPointerMove={event => { shiftHeld.current = event.shiftKey; }} onPointerUp={() => { pointerActive.current = false; }} onPointerCancel={() => { pointerActive.current = false; }} onValueChange={values => { const next = values[0]; if (typeof next === "number") applySlider(next); }} /><div className="config-slider-ticks" aria-hidden>{ticks.map(tick => <i key={tick} style={{ left: `${(tick - sliderMin) / (sliderMax - sliderMin) * 100}%` }} title={String(tick)} />)}</div></div><div className="config-field-meta"><span>{sliderMin}</span><small>{value > sliderMax ? `Диапазон до ${sliderMax}` : ""}</small><span>{sliderMax}</span></div></div>;
}

function JobTable({ jobs, engineers, onOpen, limit, started }: { started: boolean; jobs: Job[]; engineers: Engineer[]; onOpen: (id: string) => void; limit?: number }) { return <div className="job-table"><div className="job-row table-head"><span>Время</span><span>Заявка</span><span>Адрес</span><span>Инженер</span><span>Состояние</span><span>Статус SLA</span></div>{jobs.slice(0, limit ?? jobs.length).map(job => { const engineer = engineers.find(item => item.id === job.engineerId); const routeStatus = job.cancelled ? "Отменена" : job.executionStatus === "completed" ? "Завершена" : engineer ? "В окне" : started ? "Нет маршрута" : "После расчёта"; return <button className="job-row job-row-button" key={job.id} onClick={() => onOpen(job.id)}><span className="job-time">{job.time}</span><span><i className={`job-tone ${job.tone}`} /><b>{job.id}</b><small>{job.kind}</small></span><span><b>{job.area}</b><small>{job.address}</small></span><span className="assigned">{engineer ? <><i style={{ background: engineer.color }}>{engineer.initials}</i><b>{engineer.name}</b></> : <b>{routeStatus === "Завершена" ? "Работа закрыта" : "Не назначена"}</b>}</span><JobStatus job={job} started={started} /><span><Badge className={!engineer && routeStatus === "Нет маршрута" ? "sla risk" : "sla"}>{routeStatus === "Нет маршрута" ? <AlertTriangle /> : <Clock3 />}{routeStatus}</Badge></span></button>; })}</div>; }
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
function FacetFilters({ groups, selected, onSelected, strict, onStrict, count, total, resetActive, onReset }: { resetActive: boolean; onReset: () => void; groups: FacetGroup[]; selected: string[]; onSelected: (values: string[]) => void; strict: boolean; onStrict: (value: boolean) => void; count: number; total: number }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  return <section className="facet-filters" aria-label="Фильтры"><div className="facet-head"><div><strong>Фильтры</strong><span>Показано {count} из {total}</span></div><label className="facet-strict"><input type="checkbox" checked={strict} onChange={event => onStrict(event.target.checked)} /> Строгий фильтр <small>{strict ? "все выбранные" : "хотя бы один"}</small></label>{resetActive && <button type="button" className="reset-filters-button" onClick={() => { onReset(); setOpenGroup(null); }}><X size={14} />Сбросить фильтры</button>}</div><div className="facet-groups">{groups.map(group => <details key={group.key} className="facet-group" open={openGroup === group.key} onToggle={event => { if (event.currentTarget.open) setOpenGroup(group.key); else if (openGroup === group.key) setOpenGroup(null); }}><summary>{group.label}{selected.filter(value => value.startsWith(`${group.key}\u0000`)).length > 0 && <b>{selected.filter(value => value.startsWith(`${group.key}\u0000`)).length}</b>}</summary><div className="facet-options">{group.values.map(value => { const id = `${group.key}\u0000${value}`; return <label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={event => onSelected(event.target.checked ? [...selected, id] : selected.filter(item => item !== id))} /><span>{value}</span></label>; })}</div></details>)}</div>{selected.length > 0 && <p className="facet-selected">{selected.map(value => { const [key, label] = value.split("\u0000"); return <button type="button" key={value} onClick={() => onSelected(selected.filter(item => item !== value))} aria-label={`Убрать фильтр ${label}`}>{groups.find(group => group.key === key)?.label}: {label} ×</button>; })}</p>}</section>;
}
function RequestsView({ jobs, engineers, onOpen, onAdd, onImport, importStatus, started }: { started: boolean; jobs: Job[]; engineers: Engineer[]; onOpen: (id: string) => void; onAdd: () => void; onImport: (file: File) => void; importStatus: string }) {
  const [selected, setSelected] = useSavedFilter<string[]>("requests-selected-v2", []); const [strict, setStrict] = useSavedFilter("requests-strict", false); const [showAll, setShowAll] = useSavedFilter("requests-all", false); const [query, setQuery] = useSavedFilter("requests-query", ""); const [fromTime, setFromTime] = useSavedFilter("requests-from", ""); const [toTime, setToTime] = useSavedFilter("requests-to", ""); const [normFrom, setNormFrom] = useSavedFilter("requests-norm-from", ""); const [normTo, setNormTo] = useSavedFilter("requests-norm-to", "");
  const unassigned = jobs.filter(job => getJobState(job, started) === "unassigned").length;
  const cancelled = jobs.filter(job => job.cancelled).length;
  const assigned = jobs.filter(job => !job.cancelled && job.engineerId).length;
  const groups: FacetGroup[] = [{ key: "kind", label: "Навык / работа", values: facetOptions(jobs.map(job => job.kind)) }, { key: "equipment", label: "Оборудование", values: facetOptions(jobs.map(job => job.equipment)) }, { key: "transport", label: "Транспорт", values: facetOptions(jobs.map(job => job.requiredTransport)) }, { key: "status", label: "Статус маршрута", values: ["В окне", "Нет маршрута", "Отменена", "Завершена"] }, { key: "execution", label: "Выполнение", values: Object.values(jobStateLabels) }, { key: "priority", label: "Приоритет", values: ["Обычный", "Повышенный"] }];
  const normalized = query.trim().toLocaleLowerCase("ru"); const fromMinutes = fromTime ? Number(fromTime.slice(0, 2)) * 60 + Number(fromTime.slice(3)) : null; const toMinutes = toTime ? Number(toTime.slice(0, 2)) * 60 + Number(toTime.slice(3)) : null; const minNorm = normFrom === "" ? null : Number(normFrom); const maxNorm = normTo === "" ? null : Number(normTo);
  const searched = jobs.filter(job => !normalized || job.id.toLocaleLowerCase("ru").includes(normalized) || (!Number.isNaN(parseInt(job.id, 10)) && String(parseInt(job.id, 10)) === normalized) || job.address.toLocaleLowerCase("ru").includes(normalized));
  const filtered = searched.filter(job => matchesFacets(selected, strict, { kind: [job.kind], equipment: [job.equipment], transport: [job.requiredTransport], status: [job.cancelled ? "Отменена" : job.executionStatus === "completed" && !job.engineerId ? "Завершена" : job.engineerId ? "В окне" : "Нет маршрута"], execution: [jobStateLabels[getJobState(job, started)]], priority: [jobPriorityLevel(job) === 2 ? "Повышенный" : "Обычный"] }) && (fromMinutes == null || job.windowStart >= fromMinutes) && (toMinutes == null || job.windowEnd <= toMinutes) && (minNorm == null || job.serviceMinutes >= minNorm) && (maxNorm == null || job.serviceMinutes <= maxNorm));
  const resetFilters = () => { setSelected([]); setStrict(false); setQuery(""); setFromTime(""); setToTime(""); setNormFrom(""); setNormTo(""); };
  return <section className="page-view"><InstantSearch value={query} onChange={setQuery} placeholder="Номер заявки или адрес"><div className="instant-results">{searched.slice(0, 8).map(job => <button type="button" key={job.id} onClick={() => onOpen(job.id)}><span><b>{job.id}</b><small>{job.address}</small></span><em>{job.cancelled ? "Отменена" : job.time}</em></button>)}{!searched.length && <p>Совпадений не найдено</p>}</div></InstantSearch><div className="import-strip"><label className="plain-button import-button"><Upload />Загрузить CSV / JSON<input type="file" accept=".csv,.json,text/csv,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.currentTarget.value = ""; }} /></label><HelpHint label="Загрузка данных">Загрузите CSV заявок, CSV инженеров или JSON набора перед построением плана. Новые данные заменят соответствующую часть текущего набора; прежний план будет сброшен.</HelpHint><span>{importStatus || "Файлы CSV заявок и инженеров или JSON набора."}</span></div><div className="view-summary"><article><span>Всего заявок</span><strong>{jobs.length}</strong><small>{jobs.filter(job => job.cancelled).length} отменено</small></article><article><span>Назначено</span><strong>{assigned}</strong><small>{jobs.length - cancelled ? (assigned / (jobs.length - cancelled) * 100).toFixed(1) : "0.0"}% от неотменённых</small></article><article><span>Без назначения</span><strong>{unassigned}</strong><small>требуют ручного распределения</small></article></div><FacetFilters groups={groups} selected={selected} onSelected={setSelected} strict={strict} onStrict={setStrict} count={filtered.length} total={jobs.length} resetActive={Boolean(selected.length || strict || query.trim() || fromTime || toTime || normFrom || normTo)} onReset={resetFilters} /><section className="range-filters" aria-label="Диапазоны заявки"><label><span>Окно с</span><input type="time" value={fromTime} onChange={event => setFromTime(event.target.value)} /></label><label><span>Окно до</span><input type="time" value={toTime} onChange={event => setToTime(event.target.value)} /></label><label><span>Норматив от, мин</span><input type="number" min="0" value={normFrom} onChange={event => setNormFrom(event.target.value)} placeholder="0" /></label><label><span>Норматив до, мин</span><input type="number" min="0" value={normTo} onChange={event => setNormTo(event.target.value)} placeholder="240" /></label></section><section className="panel queue-panel full-table"><div className="panel-header"><div><h2>Заявки</h2><p>{filtered.length} по фильтру</p></div><button className="plain-button" onClick={onAdd}><Plus />Добавить заявку</button></div>{filtered.length ? <JobTable started={started} jobs={filtered} engineers={engineers} onOpen={onOpen} limit={showAll ? undefined : 250} /> : <p className="facet-empty">По поиску и выбранным условиям заявок нет.</p>}{!showAll && filtered.length > 250 && <button type="button" className="facet-show-all" onClick={() => setShowAll(true)}>Показать все {filtered.length} заявок</button>}</section></section>;
}
function EngineersView({ engineers, jobs, result, unavailableIds, absenceReasons, absenceMoments, simTime, onOpenDetails, onOpenRoute }: { engineers: Engineer[]; jobs: Job[]; result: OptimizationResult; unavailableIds: string[]; absenceReasons: Record<string, EngineerAbsenceReason>; absenceMoments: Record<string, AbsenceMoment>; simTime: number; onOpenDetails: (id: string) => void; onOpenRoute: (id: string) => void }) {
  const [showAll, setShowAll] = useSavedFilter("engineers-all", false);
  const [selected, setSelected] = useSavedFilter<string[]>("engineers-selected", []); const [strict, setStrict] = useSavedFilter("engineers-strict", false); const [query, setQuery] = useSavedFilter("engineers-query", "");
  const plans = new Map(result.routes.map(route => [route.engineerId, route]));
  const unavailableNow = (id: string) => unavailableIds.includes(id) && (!absenceMoments[id] || simTime >= absenceMoments[id].effectiveAt);
  const activeRoutes = result.routes.filter(route => !unavailableNow(route.engineerId));
  const active = activeRoutes.length;
  const avg = active ? Math.round(activeRoutes.reduce((sum, route) => sum + route.load, 0) / active) : 0;
  const groups: FacetGroup[] = [{ key: "skills", label: "Навыки", values: facetOptions(engineers.flatMap(item => item.skills)) }, { key: "equipment", label: "Оборудование", values: facetOptions(engineers.flatMap(item => item.equipment)) }, { key: "transport", label: "Транспорт", values: facetOptions(engineers.map(item => item.transport)) }];
  const normalized = query.trim().toLocaleLowerCase("ru"); const jobIdsByEngineer = new Map(engineers.map(engineer => [engineer.id, jobs.filter(job => job.engineerId === engineer.id || (!job.engineerId && job.baselineEngineerId === engineer.id)).map(job => job.id)]));
  const searched = engineers.filter(engineer => !normalized || engineer.name.toLocaleLowerCase("ru").includes(normalized) || engineer.id.toLocaleLowerCase("ru").includes(normalized) || (jobIdsByEngineer.get(engineer.id) ?? []).some(id => id.toLocaleLowerCase("ru").includes(normalized)));
  const filtered = searched.filter(engineer => matchesFacets(selected, strict, { skills: engineer.skills, equipment: engineer.equipment, transport: [engineer.transport] }));
  const ordered = [...filtered].sort((a, b) => Number(plans.has(b.id)) - Number(plans.has(a.id)));
  const shown = showAll ? ordered : ordered.slice(0, 80);
  return <section className="page-view">
    <InstantSearch value={query} onChange={setQuery} placeholder="Имя инженера или номер заявки"><div className="instant-results">{searched.slice(0, 8).map(engineer => <button type="button" key={engineer.id} onClick={() => onOpenDetails(engineer.id)}><span><b>{engineer.name}</b><small>{engineer.region} · {(jobIdsByEngineer.get(engineer.id) ?? []).length} заявок</small></span><em>{(jobIdsByEngineer.get(engineer.id) ?? []).filter(id => id.toLocaleLowerCase("ru").includes(normalized)).slice(0, 2).map(id => `${id}`).join(", ")}</em></button>)}{!searched.length && <p>Совпадений не найдено</p>}</div></InstantSearch>
    <div className="view-summary">
      <article><span>Доступно</span><strong>{engineers.filter(engineer => !unavailableNow(engineer.id)).length}</strong><small>из {engineers.length} инженеров · на {minutesLabel(simTime)}</small></article>
      <article><span>На маршрутах</span><strong>{active}</strong><small>имеют назначенные работы</small></article>
      <article><span>Средняя загрузка</span><strong>{avg}%</strong><small>работа и дорога без ожидания</small></article>
    </div>
    <FacetFilters groups={groups} selected={selected} onSelected={setSelected} strict={strict} onStrict={setStrict} count={filtered.length} total={engineers.length} resetActive={Boolean(selected.length || strict || query.trim())} onReset={() => { setSelected([]); setStrict(false); setQuery(""); }} />
    {filtered.length > shown.length && <p className="list-cap">На экране {shown.length} из {filtered.length} инженеров. <button type="button" className="plain-button" onClick={() => setShowAll(true)}>Показать всех</button></p>}
    {!filtered.length && <p className="facet-empty">По выбранным условиям инженеров нет.</p>}
    <div className="engineer-card-grid">{shown.map(engineer => {
      const route = plans.get(engineer.id);
      const timing = routeTimeBreakdown(route?.stops ?? [], engineer.shiftEnd - engineer.shiftStart);
      return <article key={engineer.id} className="engineer-card">
        <button type="button" className="engineer-card-main" onClick={() => onOpenDetails(engineer.id)} aria-label={`Навыки и данные: ${engineer.name}`}>
          <div className="engineer-card-head"><span className="avatar large" style={{ background: `${engineer.color}18`, color: engineer.color }}>{engineer.initials}</span><div><strong>{engineer.name}</strong><small>{unavailableNow(engineer.id) ? absenceReasons[engineer.id] === "emergency" ? `ЧС с ${minutesLabel(absenceMoments[engineer.id]?.effectiveAt ?? simTime)} · вне смены` : absenceReasons[engineer.id] === "left" ? `Вышел с ${minutesLabel(absenceMoments[engineer.id]?.effectiveAt ?? simTime)} · вне смены` : "Недоступен · исключён из расчёта" : absenceMoments[engineer.id] && simTime >= absenceMoments[engineer.id].reportedAt ? `Завершает №${absenceMoments[engineer.id].currentJobId} до ${minutesLabel(absenceMoments[engineer.id].effectiveAt)}` : `${engineer.region} · ${engineer.route}`}</small></div><b style={{ color: unavailableNow(engineer.id) ? "var(--danger)" : engineer.color }}>{unavailableNow(engineer.id) ? "OFF" : `${route?.load ?? 0}%`}</b></div>
          <Progress value={route?.load ?? 0} className="load-progress" style={{ ["--primary" as string]: engineer.color }} />
          <div className="engineer-card-meta"><span><b>{route?.stops.length ?? 0}</b> заявок</span><span><b>{formatDistance(route?.distanceKm ?? 0)}</b></span><span><b>{engineer.skills.length}</b> навыков</span></div>
          <small className="engineer-details-hint">Работа {Math.round(timing.service)} мин · дорога {Math.round(timing.travel)} мин · ожидание {Math.round(timing.waiting)} мин</small>
        </button>
        <button type="button" className="open-route" onClick={() => onOpenRoute(engineer.id)}>Открыть расписание и таймлайн</button>
      </article>;
    })}</div>
  </section>;
}

function EngineerDetailsDialog({ engineer, route, unavailable, onClose, onOpenRoute, onToggleAvailability }: { engineer: Engineer | null; route?: RoutePlan; unavailable: boolean; onClose: () => void; onOpenRoute: (id: string) => void; onToggleAvailability: (id: string) => void }) {
  const timing = routeTimeBreakdown(route?.stops ?? [], engineer ? engineer.shiftEnd - engineer.shiftStart : 1);
  return <Dialog open={Boolean(engineer)} onOpenChange={open => !open && onClose()}>
    <DialogContent className="engineer-details-dialog">
      <DialogHeader>
        <DialogTitle>{engineer?.name}</DialogTitle>
        <DialogDescription>{engineer?.region} · {engineer?.route}{unavailable ? " · инженер недоступен" : ""}</DialogDescription>
      </DialogHeader>
      {engineer && <div className="engineer-details-content">
        <div className="engineer-details-stats"><span><b>{route?.stops.length ?? 0}</b> заявок</span><span><b>{formatDistance(route?.distanceKm ?? 0)}</b> пробег</span><span><b>{route?.load ?? 0}%</b> загрузка</span></div>
        <p>Выполнение: {Math.round(timing.service)} мин · дорога: {Math.round(timing.travel)} мин · ожидание окна и свободное время: {Math.round(timing.waiting)} мин.</p>
        <section><h3>Навыки</h3><div className="engineer-skill-list">{engineer.skills.length ? engineer.skills.map(skill => <span key={skill}>{skill}</span>) : <em>Навыки не указаны</em>}</div></section>
        <section><h3>Старт и комплект</h3><p><b>Точка выезда:</b> {engineer.startAddress || engineer.start.join(", ")}</p><p><b>Выдача:</b> {engineer.startMode === "local" ? "комплект выдан заранее, старт в своём городе (демонстрационное допущение)" : "в офисе до начала смены"}</p><p><b>Закреплённый комплект:</b> {engineer.equipment.length ? engineer.equipment.join(", ") : "не указан"}</p><p><b>При перепланировании:</b> только оборудование из этого комплекта, без довыдачи.</p><p><b>Транспорт:</b> {engineer.transport || "не указан"}</p><p><b>Смена:</b> {minutesLabel(engineer.shiftStart)}–{minutesLabel(engineer.shiftEnd)}</p></section>
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => { if (engineer) onToggleAvailability(engineer.id); }}>{unavailable ? "Вернуть в смену" : "Отметить недоступным"}</Button><Button variant="outline" onClick={onClose}>Закрыть</Button><Button onClick={() => { if (engineer) { onClose(); onOpenRoute(engineer.id); } }}>Открыть таймлайн инженера</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
function AnalyticsView({ result, engineers, distanceReady, distanceWarning, estimated, calculated, solver, speedKmh, travel, metrics, replanChanges }: { result: OptimizationResult; engineers: Engineer[]; distanceReady: boolean; distanceWarning: string; estimated:boolean; calculated:boolean; solver: SolverEngine; speedKmh: number; travel?: TravelMatrix; metrics: ReactNode; replanChanges: ReplanChange[] }) {
  const maxJobs = Math.max(1, ...result.zones.map(item => item.jobs));
  const maxDistance = Math.max(1, ...result.zones.flatMap(zone => [zone.distance, zone.baselineDistance]));
  const baselineByEngineer = new Map(result.baselineRoutes.map(route => [route.engineerId, route]));
  const optimizedByEngineer = new Map(result.routes.map(route => [route.engineerId, route]));
  const activeEngineers = engineers.filter(engineer => baselineByEngineer.has(engineer.id) || optimizedByEngineer.has(engineer.id));
  return <section className="page-view"><div className="analytics-actions"><ExportButtons result={result} engineers={engineers} solver={solver} speedKmh={speedKmh} /></div>{metrics}
    <MileageExplanation estimated={estimated} calculated={calculated} />
    <ReplanImpactPanel changes={replanChanges} />
    <p className={distanceReady ? "comparison-note ready" : "comparison-note"}>{`Сопоставимый пробег (${result.comparison.commonAssigned} общих заявок): ${formatDistance(result.comparison.baselineComparableDistanceKm ?? 0)} → ${formatDistance(result.comparison.optimizedComparableDistanceKm ?? 0)}. ${distanceReady ? "Расчёт выполнен по единой дорожной матрице." : distanceWarning}`}</p>
    <div className="analytics-grid">
      <article className="panel analytics-panel"><div className="panel-header"><div><h2>Заявки по зонам</h2></div></div><div className="zone-chart">{result.zones.map(zone => <div key={zone.name}><span>{zone.name}</span><div><i style={{ width: `${zone.jobs / maxJobs * 100}%` }} /></div><strong>{zone.jobs}</strong></div>)}</div></article>
      <article className="panel analytics-panel"><div className="panel-header"><div><h2>Выполнение в срок</h2></div></div><div className="sla-chart">{result.zones.map(zone => <div key={zone.name}><div className="sla-ring" style={{ ["--value" as string]: `${zone.sla * 3.6}deg` }}><strong>{zone.sla}%</strong></div><span>{zone.name}<small>{zone.assigned} из {zone.jobs} назначено</small></span></div>)}</div></article>
      <article className="panel analytics-panel wide"><div className="panel-header"><div><h2>Сравнение планов по зонам</h2></div></div><div className="distance-bars">{result.zones.map(zone => <div key={zone.name}><span>{zone.name}</span><div className="distance-track"><i className="baseline" style={{ width: `${zone.baselineDistance / maxDistance * 100}%` }} /><i className="optimized" style={{ width: `${zone.distance / maxDistance * 100}%` }} /></div><strong>{zone.baselineAssigned} → {zone.assigned} заявок<br />{zone.baselineEngineers} → {zone.engineers} инж.<br />{formatDistance(zone.baselineDistance)} → {formatDistance(zone.distance)}</strong></div>)}</div><div className="analytics-legend"><span><i className="baseline" />Контрольный последовательный план</span><span><i className="optimized" />VRPTW-план</span></div></article>
      <article className="panel analytics-panel wide"><div className="panel-header"><div><h2>Маршруты по инженерам</h2></div></div><div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>Инженер</th><th>Базовый · заявок</th><th>VRPTW · заявок</th><th>Базовый · км</th><th>VRPTW · км</th></tr></thead><tbody>{activeEngineers.map(engineer => { const base = baselineByEngineer.get(engineer.id); const optimized = optimizedByEngineer.get(engineer.id); return <tr key={engineer.id}><th scope="row">{engineer.name}<small>{engineer.region}</small></th><td>{base?.stops.length ?? "—"}</td><td>{optimized?.stops.length ?? "—"}</td><td>{base ? formatDistance(base.distanceKm) : "—"}</td><td>{optimized ? formatDistance(optimized.distanceKm) : "—"}</td></tr>; })}</tbody></table></div></article>
    </div>
    <PlanAnalysisView result={result} engineers={engineers} travel={travel} />
  </section>;
}

function apportion(weights: number[], total: number): number[] {
  const safeTotal = Math.max(0, Math.round(total));
  if (!weights.length) return [];
  const floors = weights.map(weight => Math.max(0, Math.floor(Number.isFinite(weight) ? weight : 0)));
  let left = safeTotal - floors.reduce((sum, value) => sum + value, 0);
  const result = floors.slice();
  if (left > 0) {
    const ranked = weights
      .map((weight, index) => ({ index, frac: (Number.isFinite(weight) ? weight : 0) - Math.floor(Number.isFinite(weight) ? weight : 0) }))
      .sort((a, b) => b.frac - a.frac || a.index - b.index);
    for (const item of ranked) {
      if (left <= 0) break;
      result[item.index] += 1;
      left -= 1;
    }
  } else if (left < 0) {
    const ranked = result.map((value, index) => ({ index, value })).sort((a, b) => b.value - a.value || a.index - b.index);
    for (const item of ranked) {
      if (left >= 0) break;
      const take = Math.min(result[item.index], -left);
      result[item.index] -= take;
      left += take;
    }
  }
  return result;
}

function sharesToCounts(shares: number[], total: number): number[] {
  const sum = shares.reduce((acc, share) => acc + share, 0) || 1;
  return apportion(shares.map(share => (share / sum) * Math.max(0, total)), total);
}

function scaleCounts(counts: number[], total: number): number[] {
  const sum = counts.reduce((acc, count) => acc + count, 0);
  if (sum === total) return counts;
  if (sum <= 0) return sharesToCounts(counts.map(() => 1), total);
  return apportion(counts.map(count => (count / sum) * total), total);
}

function rebalanceCounts(counts: number[], index: number, next: number, total: number): number[] {
  const clamped = Math.max(0, Math.min(total, Math.round(Number.isFinite(next) ? next : 0)));
  const others = counts.map((_, item) => item).filter(item => item !== index);
  if (!others.length) return [clamped];
  const othersSum = others.reduce((sum, item) => sum + counts[item], 0);
  const remain = total - clamped;
  const raw = othersSum <= 0
    ? others.map(() => remain / others.length)
    : others.map(item => (counts[item] / othersSum) * remain);
  const parts = apportion(raw, remain);
  const result = counts.slice();
  result[index] = clamped;
  others.forEach((item, part) => { result[item] = parts[part]; });
  return result;
}

function countPercent(count: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

function DigitField({ value, max, label, onCommit }: { value: number; max: number; label: string; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = (raw: string) => {
    if (raw === "") return 0;
    return Math.max(0, Math.min(max, Number(raw)));
  };
  return (
    <input
      className="dual-num-field"
      inputMode="numeric"
      aria-label={label}
      value={text}
      onFocus={event => {
        focused.current = true;
        event.currentTarget.select();
      }}
      onChange={event => {
        let next = event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
        if (next !== "" && Number(next) > max) next = String(max);
        setText(next);
        if (next === "") return;
        onCommit(commit(next));
      }}
      onBlur={() => {
        focused.current = false;
        const next = commit(text);
        onCommit(next);
        setText(String(next));
      }}
    />
  );
}

function ShareGroup({
  rows,
  total,
  unit,
  counts,
  onChange,
}: {
  rows: string[];
  total: number;
  unit: string;
  counts: number[];
  onChange: (update: (current: number[]) => number[]) => void;
}) {
  return (
    <div className="zone-subfields-grid">
      {rows.map((label, index) => {
        const count = counts[index] ?? 0;
        const pct = countPercent(count, total);
        return (
          <div className="dual-param-row" key={label}>
            <div className="dual-param-info">
              <span className="dual-param-name">{label}</span>
            </div>
            <div className="dual-param-controls">
              <div className="dual-input-wrap">
                <DigitField
                  value={pct}
                  max={100}
                  label={`${label}, проценты`}
                  onCommit={next => onChange(current => rebalanceCounts(current, index, Math.round((next / 100) * total), total))}
                />
                <span className="dual-field-suffix">%</span>
              </div>
              <span className="dual-sync-eq">=</span>
              <div className="dual-input-wrap">
                <DigitField
                  value={count}
                  max={total}
                  label={`${label}, количество`}
                  onCommit={next => onChange(current => rebalanceCounts(current, index, next, total))}
                />
                <span className="dual-field-suffix">{unit}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CappedShare({
  label,
  total,
  unit,
  count,
  onCount,
}: {
  label: string;
  total: number;
  unit: string;
  count: number;
  onCount: (count: number) => void;
}) {
  const pct = countPercent(count, total);
  return (
    <div className="dual-param-row">
      <div className="dual-param-info">
        <span className="dual-param-name">{label}</span>
      </div>
      <div className="dual-param-controls">
        <div className="dual-input-wrap">
          <DigitField
            value={pct}
            max={100}
            label={`${label}, проценты`}
            onCommit={next => onCount(Math.max(0, Math.min(total, Math.round((next / 100) * total))))}
          />
          <span className="dual-field-suffix">%</span>
        </div>
        <span className="dual-sync-eq">=</span>
        <div className="dual-input-wrap">
          <DigitField value={count} max={total} label={`${label}, количество`} onCommit={onCount} />
          <span className="dual-field-suffix">{unit}</span>
        </div>
      </div>
    </div>
  );
}

function CompactCount({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="gen-compact-count">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={event => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          onChange(Math.max(min, Math.min(max, Math.round(next))));
        }}
      />
    </label>
  );
}

function joinCounts(record: Record<string, number>, limit?: number) {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1]);
  const shown = limit ? entries.slice(0, limit) : entries;
  const rest = entries.length - shown.length;
  const text = shown.map(([name, count]) => `${name} ${count}`).join(" · ");
  return rest > 0 ? `${text} · ещё ${rest}` : text;
}

function GeneratorView({
  draft,
  setDraft,
  generated,
  generatedFrom,
  generatedTz,
  onGenerate,
  onAddEvent, onRemoveEvent, onRewindEvent, eventOutcomes, simTime, started, busy, preferences, onPreferences, eventDraft, onEventDraft, plannedStarts,
  onDemo,
  onPlan,
  onClear,
  onImportFile,
  importStatus,
  importedJobs,
  importedEngineers,
}: {
  draft: PlanConfig;
  setDraft: React.Dispatch<React.SetStateAction<PlanConfig>>;
  generated: GeneratedDataset | null;
  generatedFrom: PlanConfig | null;
  generatedTz: GeneratedTzDataset | null;
  onGenerate: (opts?: Partial<GenerateTzOptions>) => void;
  onAddEvent: (event: TzReplanEvent, oldKey?: string) => void; onRemoveEvent: (key: string) => void; onRewindEvent:(time:number)=>void; eventOutcomes: EventOutcomes; simTime: number; started: boolean; busy: boolean; preferences: GeneratorPreferences | null; onPreferences: (value:GeneratorPreferences) => void; eventDraft:EventEditorDraft | null; onEventDraft:(value:EventEditorDraft)=>void; plannedStarts:Record<string,number>;
  onDemo: () => void;
  onPlan: () => void;
  onClear: () => void;
  onImportFile?: (file: File) => Promise<void>;
  importStatus?: string;
  importedJobs?: Job[];
  importedEngineers?: Engineer[];
}) {
  const [engineerCounts, setEngineerCounts] = useState(() => preferences?.engineerCounts ?? sharesToCounts([30, 45, 25], draft.engineers));
  const [jobKindCounts, setJobKindCounts] = useState(() => preferences?.jobKindCounts ?? sharesToCounts([40, 35, 25], draft.jobs));
  const [urgentCount, setUrgentCount] = useState(() => preferences?.urgentCount ?? Math.round(draft.jobs * 0.15));
  const [vehicleCount, setVehicleCount] = useState(() => preferences?.vehicleCount ?? Math.round(draft.jobs * 0.25));
  const urgentRatio = useRef(preferences && draft.jobs ? preferences.urgentCount / draft.jobs : 0.15);
  const vehicleRatio = useRef(preferences && draft.jobs ? preferences.vehicleCount / draft.jobs : 0.25);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEngineerCounts(current => scaleCounts(current, draft.engineers));
  }, [draft.engineers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobKindCounts(current => scaleCounts(current, draft.jobs));
    setUrgentCount(Math.max(0, Math.min(draft.jobs, Math.round(draft.jobs * urgentRatio.current))));
    setVehicleCount(Math.max(0, Math.min(draft.jobs, Math.round(draft.jobs * vehicleRatio.current))));
  }, [draft.jobs]);

  const [seed, setSeed] = useState(preferences?.seed ?? 42);
  const [cancelEvents, setCancelEvents] = useState(preferences?.cancelEvents ?? 1);
  const [unavailableEvents, setUnavailableEvents] = useState(preferences?.unavailableEvents ?? 1);
  const [urgentEvents, setUrgentEvents] = useState(preferences?.urgentEvents ?? 1);
  const [previewTab, setPreviewTab] = useState<"jobs" | "engineers" | "events">(preferences?.previewTab ?? "jobs");
  const [showAllRows, setShowAllRows] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(() => preferences?.paramsOpen ?? !(generatedTz?.jobs.length || generated?.jobs.length || importedJobs?.length));

  useEffect(() => { onPreferences({ engineerCounts, jobKindCounts, urgentCount, vehicleCount, seed, cancelEvents, unavailableEvents, urgentEvents, previewTab, paramsOpen }); }, [engineerCounts, jobKindCounts, urgentCount, vehicleCount, seed, cancelEvents, unavailableEvents, urgentEvents, previewTab, paramsOpen, onPreferences]);

  // Dropzone drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Global & Dropzone Clipboard Paste Listener (Ctrl+V / Ctrl+C)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");

      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        void onImportFile?.(files[0]);
        return;
      }

      const text = e.clipboardData?.getData("text");
      if (text) {
        const trimmed = text.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          if (!isInput) {
            e.preventDefault();
            const file = new File([trimmed], "clipboard.json", { type: "application/json" });
            void onImportFile?.(file);
          }
        } else if (trimmed.includes(";") || trimmed.includes(",") || trimmed.includes("\t")) {
          if (!isInput) {
            e.preventDefault();
            const file = new File([trimmed], "clipboard.csv", { type: "text/csv" });
            void onImportFile?.(file);
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [onImportFile]);

  const shareOf = (count: number, total: number) => (total > 0 ? (count / total) * 100 : 0);

  const handleRunGenerate = () => {
    onGenerate({
      jobs: draft.jobs,
      engineers: draft.engineers,
      windowMinutes: draft.windowMinutes,
      jobEasy: shareOf(jobKindCounts[0] ?? 0, draft.jobs),
      jobMedium: shareOf(jobKindCounts[1] ?? 0, draft.jobs),
      jobHard: shareOf(jobKindCounts[2] ?? 0, draft.jobs),
      novice: shareOf(engineerCounts[0] ?? 0, draft.engineers),
      specialist: shareOf(engineerCounts[1] ?? 0, draft.engineers),
      pro: shareOf(engineerCounts[2] ?? 0, draft.engineers),
      urgentShare: shareOf(urgentCount, draft.jobs),
      vehicleConstraintShare: shareOf(vehicleCount, draft.jobs),
      cancelEvents,
      unavailableEvents,
      urgentEvents,
      seed,
    });
    setPreviewTab("jobs");
    setParamsOpen(false);
  };

  const handleDemo = () => {
    onDemo();
    setPreviewTab("jobs");
    setParamsOpen(false);
  };

  const currentDataset = generatedTz;
  const currentJobs = currentDataset ? currentDataset.jobs : (generated?.jobs ?? importedJobs ?? []);
  const currentEngineers = currentDataset ? currentDataset.engineers : (generated?.engineers ?? importedEngineers ?? []);
  const currentEvents = currentDataset?.events ?? [];
  const hasData = currentJobs.length > 0 || currentEngineers.length > 0;
  const eventTotal = cancelEvents + unavailableEvents + urgentEvents;
  const showImportStatus = Boolean(importStatus && /Геокодирование|Читаем|Ошибка|Не удалось/.test(importStatus));

  const fresh = generated && generatedFrom && Object.keys(draft).every(key => draft[key as keyof PlanConfig] === generatedFrom[key as keyof PlanConfig]);
  const heavyRun = draft.engineers * draft.jobs > 150000;

  const widths = currentJobs.map(job => job.windowEnd - job.windowStart);
  const minWindow = widths.length ? Math.min(...widths) : 0;
  const maxWindow = widths.length ? Math.max(...widths) : 0;
  const meanWindow = widths.length ? Math.round(widths.reduce((sum, width) => sum + width, 0) / widths.length) : 0;

  const openFilePicker = () => fileInputRef.current?.click();
  const handleDropFile = (file?: File) => {
    if (file) void onImportFile?.(file);
  };

  return (
    <section className="page-view generator-view">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void onImportFile?.(file);
          event.target.value = "";
        }}
      />

      <article className={`panel generator-form${paramsOpen ? " is-open" : ""}`}>
        <div className="generator-form-bar">
          <button
            type="button"
            className="generator-form-toggle"
            aria-expanded={paramsOpen}
            onClick={() => setParamsOpen(open => !open)}
          >
            <ChevronDown size={16} />
            <span>Параметры набора</span>
            {!paramsOpen && (
              <em>{draft.engineers} инж. · {draft.jobs} заявок · {eventTotal} соб.</em>
            )}
          </button>
          <div className="generator-form-actions">
            <button type="button" className="generator-ghost-btn" onClick={openFilePicker}>
              <Upload size={14} /> Импорт
            </button>
            <HelpHint label="Загрузка данных">Загрузите CSV заявок и инженеров или JSON набора до расчёта маршрутов. Импорт сбрасывает прежний план; для готового сценария используйте JSON.</HelpHint>
            <button type="button" className="generator-ghost-btn" onClick={handleDemo}>
              Пример 12 / 51
            </button>
            <button type="button" className="generator-primary-btn" onClick={handleRunGenerate}>
              Сгенерировать
            </button>
          </div>
        </div>

        {paramsOpen && (
          <div className="generator-form-grid">
          <div className="generator-form-col">
            <h3>Инженеры</h3>
            <div className="gen-volume">
              <ConfigNumberField
                label="Штат"
                value={draft.engineers}
                onChange={value => setDraft(current => ({ ...current, engineers: value }))}
                sliderMin={4}
                sliderMax={100}
                snapStep={1}
                suffix="чел."
              />
            </div>
            <ShareGroup
              rows={["Новички", "Специалисты", "Профи"]}
              total={draft.engineers}
              unit="чел."
              counts={engineerCounts}
              onChange={setEngineerCounts}
            />
          </div>

          <div className="generator-form-col">
            <h3>Заявки</h3>
            <div className="gen-volume-pair">
              <div className="gen-volume">
                <ConfigNumberField
                  label="Количество"
                  value={draft.jobs}
                  onChange={value => setDraft(current => ({ ...current, jobs: value }))}
                  sliderMin={10}
                  sliderMax={300}
                  snapStep={5}
                  suffix="шт."
                />
              </div>
              <div className="gen-volume">
                <ConfigNumberField
                  label="Среднее окно"
                  value={draft.windowMinutes}
                  onChange={value => setDraft(current => ({ ...current, windowMinutes: value }))}
                  sliderMin={60}
                  sliderMax={360}
                  inputMin={60}
                  inputMax={600}
                  snapStep={15}
                  suffix="мин"
                />
              </div>
            </div>
            <ShareGroup
              rows={["Локальные", "Подключение", "Аварийные"]}
              total={draft.jobs}
              unit="шт."
              counts={jobKindCounts}
              onChange={setJobKindCounts}
            />
            <div className="gen-share-pair">
              <CappedShare
                label="Срочные"
                total={draft.jobs}
                unit="шт."
                count={urgentCount}
                onCount={count => {
                  const next = Math.max(0, Math.min(draft.jobs, count));
                  urgentRatio.current = draft.jobs > 0 ? next / draft.jobs : 0;
                  setUrgentCount(next);
                }}
              />
              <CappedShare
                label="Ограничение ТС"
                total={draft.jobs}
                unit="шт."
                count={vehicleCount}
                onCount={count => {
                  const next = Math.max(0, Math.min(draft.jobs, count));
                  vehicleRatio.current = draft.jobs > 0 ? next / draft.jobs : 0;
                  setVehicleCount(next);
                }}
              />
            </div>
          </div>

          <div className="generator-form-col">
            <h3>События дня</h3>
            <div className="gen-event-counts">
              <CompactCount label="Отмены" value={cancelEvents} onChange={setCancelEvents} min={0} max={20} />
              <CompactCount label="Недоступность" value={unavailableEvents} onChange={setUnavailableEvents} min={0} max={20} />
              <CompactCount label="Срочные заявки" value={urgentEvents} onChange={setUrgentEvents} min={0} max={20} />
            </div>
            <label className="gen-compact-count gen-seed-field">
              <span>Зерно</span>
              <input
                type="number"
                value={seed}
                aria-label="Зерно"
                onChange={event => setSeed(Number(event.target.value))}
              />
            </label>
          </div>
        </div>
        )}
        {paramsOpen && heavyRun && <p className="config-warning">Большой объём: расчёт дорожной матрицы займёт дополнительное время.</p>}
        {showImportStatus && (
          <p className="generator-status-line">
            <RefreshCw size={13} className={importStatus?.includes("Геокодирование") ? "spin-active" : ""} />
            {importStatus}
          </p>
        )}
      </article>

      <article
        className={`panel generator-stage ${isDragging ? "drag-active" : ""} ${hasData ? "has-data" : ""}`}
        onDragOver={event => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setIsDragging(false);
          handleDropFile(event.dataTransfer.files?.[0]);
        }}
      >
        {hasData ? (
          <>
            <div className="generator-stage-bar">
              <div className="generator-stage-summary">
                <strong>{currentJobs.length} заявок</strong>
                <span>{currentEngineers.length} инженеров</span>
                <span>{currentEvents.length} событий</span>
                {currentDataset && <span>окно {minWindow}–{maxWindow} мин, среднее {meanWindow}</span>}
              </div>
              <div className="generator-stage-actions">
                <button type="button" className="generator-primary-btn" disabled={busy} onClick={onPlan}>
                  <Route size={14} /> Рассчитать маршруты
                </button>
                <button type="button" className="generator-ghost-btn" disabled={busy} onClick={onClear}>Удалить текущий сценарий</button>
              </div>
            </div>
            {currentDataset && Object.keys(currentDataset.stats.jobsBySkill).length>0 && (
              <p className="generator-stage-meta">
                {joinCounts(currentDataset.stats.jobsBySkill)}
                {" · "}
                {joinCounts(currentDataset.stats.jobsByEquipment, 5)}
              </p>
            )}
            <div className="generator-stage-tools">
              <div className="generator-tabs" role="tablist">
                <button type="button" className={previewTab === "jobs" ? "active" : ""} onClick={() => setPreviewTab("jobs")}>
                  Заявки ({currentJobs.length})
                </button>
                <button type="button" className={previewTab === "engineers" ? "active" : ""} onClick={() => setPreviewTab("engineers")}>
                  Инженеры ({currentEngineers.length})
                </button>
                <button type="button" className={previewTab === "events" ? "active" : ""} onClick={() => setPreviewTab("events")}>
                  События ({currentEvents.length})
                </button>
              </div>
              <div className="generator-export">
                <button type="button" title="Скачать исходные заявки для Excel" onClick={() => downloadBlob("jobs.csv", jobsToTzCsv(currentJobs))}>Скачать заявки CSV</button>
                <button type="button" title="Скачать список инженеров для Excel" onClick={() => downloadBlob("engineers.csv", engineersToTzCsv(currentEngineers))}>Скачать инженеров CSV</button>
                {currentEvents.length > 0 && (
                  <button type="button" title="Скачать расписание событий для Excel" onClick={() => downloadBlob("replan_events.csv", eventsToTzCsv(currentEvents))}>Скачать события CSV</button>
                )}
                {currentDataset && <button type="button" title="Скачать три отдельных CSV: заявки, инженеры и события" onClick={() => downloadAllTzCsvs(currentDataset)}>Скачать все CSV</button>}
                {currentDataset && <button type="button" title="Скачать весь набор одним файлом, включая события" onClick={() => downloadTzJson(currentDataset)}>Скачать набор JSON</button>}
              </div>
            </div>

            {previewTab === "events" && <ScheduledEventsEditor jobs={currentJobs} engineers={currentEngineers} events={currentEvents} outcomes={eventOutcomes} time={simTime} started={started} busy={busy} draft={eventDraft} plannedStarts={plannedStarts} onDraft={onEventDraft} onSave={onAddEvent} onRemove={onRemoveEvent} onRewind={onRewindEvent} />}

            <div className="generator-table-wrap" hidden={previewTab === "events"}>
              {previewTab === "jobs" && (
                <table className="generator-preview-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Задача</th>
                      <th>Адрес</th>
                      <th>Координаты</th>
                      <th>Длительность</th>
                      <th>Окно</th>
                      <th>Приоритет</th>
                      <th>Навык</th>
                      <th>Оборудование</th>
                      <th>Транспорт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllRows ? currentJobs : currentJobs.slice(0, 30)).map(job => (
                      <tr key={job.id}>
                        <td><b>{job.id}</b></td>
                        <td>{job.workType ?? job.kind}</td>
                        <td>{job.address}</td>
                        <td>{job.coordinates[1].toFixed(5)}, {job.coordinates[0].toFixed(5)}</td>
                        <td>{job.serviceMinutes} мин</td>
                        <td>{job.time}</td>
                        <td>
                          <span className={`generator-badge ${jobPriorityLevel(job) === 2 ? "urgent" : "normal"}`}>
                            {jobPriorityLevel(job) === 2 ? "Срочная" : "Обычная"}
                          </span>
                        </td>
                        <td><span className="generator-badge skill">{job.kind}</span></td>
                        <td><span className="generator-badge equip">{job.equipment}</span></td>
                        <td>{job.requiredTransport ? <span className="generator-badge vehicle">{job.requiredTransport}</span> : "Не ограничен"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {previewTab === "engineers" && (
                <table className="generator-preview-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Имя</th>
                      <th>Адрес старта</th>
                      <th>Координаты</th>
                      <th>Смена</th>
                      <th>Транспорт</th>
                      <th>Навыки</th>
                      <th>Оборудование</th>
                      <th>Уровень</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentEngineers.map(engineer => (
                      <tr key={engineer.id}>
                        <td><b>{engineer.id}</b></td>
                        <td>{engineer.name}</td>
                        <td>{(engineer as Engineer & { address?: string }).address ?? "Москва"}</td>
                        <td>{engineer.start[1].toFixed(5)}, {engineer.start[0].toFixed(5)}</td>
                        <td>{minutesLabel(engineer.shiftStart)}–{minutesLabel(engineer.shiftEnd)}</td>
                        <td><span className="generator-badge vehicle">{engineer.transport}</span></td>
                        <td>
                          {engineer.skills.map(skill => (
                            <span key={skill} className="generator-badge skill">{skill}</span>
                          ))}
                        </td>
                        <td>
                          {engineer.equipment.map(item => (
                            <span key={item} className="generator-badge equip">{item}</span>
                          ))}
                        </td>
                        <td>{(engineer as Engineer & { level?: string }).level ?? (engineer.skills.length === 1 ? "новичок" : engineer.skills.length === 2 ? "специалист" : "профи")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}


            </div>
            {previewTab === "jobs" && currentJobs.length > 30 && (
              <button type="button" className="generator-more-rows" onClick={() => setShowAllRows(prev => !prev)}>
                {showAllRows ? "Показать первые 30" : `Показать все ${currentJobs.length}`}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="generator-empty" onClick={openFilePicker}>
            <Database />
            <strong>Набора ещё нет</strong>
            <p>Задайте параметры сверху и нажмите «Сгенерировать», либо перетащите сюда CSV или JSON. Вставка файла с клавиатуры тоже работает.</p>
          </button>
        )}
      </article>
    </section>
  );
}

function changeWord(count: number) { return count % 10 === 1 && count % 100 !== 11 ? "изменение" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "изменения" : "изменений"; }

function ReplanImpactPanel({ changes }: { changes: ReplanChange[] }) {
  if (!changes.length) return null;
  const counts = changes.reduce<Record<ReplanChange["kind"], number>>((acc, item) => { acc[item.kind] += 1; return acc; }, { assignment: 0, order: 0, route: 0, fleet: 0, time: 0, event: 0 });
  const labels: Record<ReplanChange["kind"], string> = { assignment: "Назначения", order: "Порядок", route: "Маршруты", fleet: "Инженеры", time: "Время клиента", event: "События" };
  const required = changes.filter(change => change.necessity === "required");
  const other = changes.filter(change => change.necessity !== "required");
  const ordered = [...required, ...other];
  return <section className="panel replan-impact" aria-label="Изменения после перепланирования">
    <div className="panel-header"><div><h2>Что изменилось после перепланирования</h2><p>Подтверждённо вынужденных событием: {required.length}. {other.length ? `Ещё ${other.length} ${changeWord(other.length)} требуют проверки диспетчером; их необходимость не доказана.` : "Других изменений нет."}</p></div><Badge>{changes.length} {changeWord(changes.length)}</Badge></div>
    <div className="replan-counters">{(Object.keys(labels) as ReplanChange["kind"][]).map(kind => <span key={kind}><b>{counts[kind]}</b>{labels[kind]}</span>)}</div>
    <div className="replan-list">{ordered.slice(0, 12).map(item => <p key={item.key} data-kind={item.kind}><i />{item.necessity === "required" ? "Вынуждено событием: " : ""}{item.message}</p>)}</div>
    {ordered.length > 12 && <details><summary>Показать ещё {ordered.length - 12}</summary><div className="replan-list extra">{ordered.slice(12).map(item => <p key={item.key} data-kind={item.kind}><i />{item.necessity === "required" ? "Вынуждено событием: " : ""}{item.message}</p>)}</div></details>}
  </section>;
}

export default function Dashboard() {
  const { entries: journalEntries, append: appendNotifications, replace: replaceNotifications, storageError: journalStorageError } = useNotificationJournal();
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalReadIds,setJournalReadIds] = useState<string[]>([]);
  const [filterResetVersion, setFilterResetVersion] = useState(0);
  const [view, setView] = useState<ViewId>("generator"); const [region, setRegion] = useState<"Все зоны" | Region>("Все зоны"); const [compare, setCompare] = useState(false); const [replanned, setReplanned] = useState(false); const [urgentOpen, setUrgentOpen] = useState(false); const [mobileNavOpen, setMobileNavOpen] = useState(false); const [selectedJobId, setSelectedJobId] = useState<string | null>(null); const [detailsJobId, setDetailsJobId] = useState<string | null>(null); const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null); const [selectedEngineerDetailsId, setSelectedEngineerDetailsId] = useState<string | null>(null); const [simTime, setSimTime] = useState(480); const [simPlaying, setSimPlaying] = useState(false); const [playbackMinutesPerSecond, setPlaybackMinutesPerSecond] = useState(1); const [theme, setTheme] = useState<ThemeId>("light"); const [themeOpen, setThemeOpen] = useState(false); const [routingState, setRoutingState] = useState<RoutingState>("idle"); const [extraJobs, setExtraJobs] = useState<Job[]>([]); const [importedJobs, setImportedJobs] = useState<Job[]>([]); const [importedEngineers, setImportedEngineers] = useState<Engineer[]>([]); const [unavailableEngineerIds, setUnavailableEngineerIds] = useState<string[]>([]); const [cancelledJobIds, setCancelledJobIds] = useState<string[]>([]); const [importStatus, setImportStatus] = useState(""); const [optimizing, setOptimizing] = useState(false); const [formError, setFormError] = useState(""); const [solverError, setSolverError] = useState(""); const [planResult, setPlanResult] = useState<OptimizationResult | null>(null); const [travel, setTravel] = useState<TravelMatrix | undefined>(undefined); const [matrixFallback, setMatrixFallback] = useState(false);
  const [draft, setDraft] = useState<PlanConfig>(defaultConfig); const [applied, setApplied] = useState<PlanConfig | null>(null); const [generated, setGenerated] = useState<GeneratedDataset | null>(null); const [generatedFrom, setGeneratedFrom] = useState<PlanConfig | null>(null);
  const [generatedTz, setGeneratedTz] = useState<GeneratedTzDataset | null>(null);
  const [editorJobs, setEditorJobs] = useState<Job[]>([]); const [editorEngineers, setEditorEngineers] = useState<Engineer[]>([]); const [editorUnavailableIds, setEditorUnavailableIds] = useState<string[]>([]); const [editorDirty, setEditorDirty] = useState(false); const [editorError, setEditorError] = useState("");
  const [urgentForm, setUrgentForm] = useState({
    address: "",
    longitude: "",
    latitude: "",
    region: "Юго-восток" as Region,
    start: "13:00",
    end: "14:30",
    kind: "Аварийно-восстановительные работы",
    transport: "",
    urgency: "urgent" as "normal" | "urgent",
  });
  const [eventOutcomes,setEventOutcomes] = useState<EventOutcomes>({});
  const [scheduledProcessing,setScheduledProcessing] = useState(false);
  const scheduledLock = useRef(false);
  const requestedTime = useRef<{ time:number; playing:boolean } | null>(null);
  const [clearOpen,setClearOpen] = useState(false);
  const [eventDraft,setEventDraft] = useState<EventEditorDraft | null>(null);
  const [generatorPreferences,setGeneratorPreferences] = useState<GeneratorPreferences | null>(null);
  const [engineerPersonaId, setEngineerPersonaId] = useState<string | null>(null);
  const [engineerSelectedJobId, setEngineerSelectedJobId] = useState<string | null>(null);
  const [pendingEngineerAction, setPendingEngineerAction] = useState<EngineerAbsenceReason | null>(null);
  const [absenceReasons, setAbsenceReasons] = useState<Record<string, EngineerAbsenceReason>>({});
  const [absenceMoments, setAbsenceMoments] = useState<Record<string, AbsenceMoment>>({});
  const [availabilityChanges, setAvailabilityChanges] = useState<AvailabilityChange[]>([]);
  const [absenceNotices, setAbsenceNotices] = useState<Array<{ engineerId: string; engineerName: string; reason: EngineerAbsenceReason; impact: AbsenceImpact; moment: AbsenceMoment }>>([]);
  const [planHistory, setPlanHistory] = useState<Array<{ time: number; before: OptimizationResult }>>([]);
  const [issuedEngineers, setIssuedEngineers] = useState<Engineer[] | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState("");
  const [jobActionNotice, setJobActionNotice] = useState("");
  const workdayStarted = useRef(false);
  const [dayStarted,setDayStarted] = useState(false);
  const [cancellationNotices, setCancellationNotices] = useState<Array<{ engineerId: string; jobId: string; replacementId: string | null; time: number }>>([]);
  const [engineerActionError, setEngineerActionError] = useState("");
  const [lastEventTime, setLastEventTime] = useState<number | null>(null);
  const [lastCalculationMethod, setLastCalculationMethod] = useState<"ortools" | "insert" | "cancel_local" | "no_change">("ortools");
  const [solverEngine, setSolverEngine] = useState<SolverEngine>("ortools");
  const [replanChanges, setReplanChanges] = useState<ReplanChange[]>([]);
  const [showReplanSummary, setShowReplanSummary] = useState(true);
  const baseJobs = importedJobs;
  const baseEngineers = importedEngineers;
  const started = Boolean(applied && planResult);
  const activeJobs = useMemo(() => applied ? composePlanJobs(baseJobs, applied.jobs, extraJobs, cancelledJobIds) : composePlanJobs(baseJobs, baseJobs.length, extraJobs, cancelledJobIds), [applied, baseJobs, extraJobs, cancelledJobIds]);
  const activeEngineers = useMemo(() => issuedEngineers ?? (applied ? scaleEngineers(baseEngineers, applied.engineers, activeJobs) : baseEngineers), [issuedEngineers, applied, baseEngineers, activeJobs]);
  const recordPlanChanges = useCallback((before: OptimizationResult, after: OptimizationResult, time: number) => {
    appendNotifications(reassignmentNotifications(before.jobs, after.jobs, activeEngineers, time));
  }, [appendNotifications, activeEngineers]);
  const urgentSkills = useMemo(() => [...new Set(activeEngineers.flatMap(engineer => engineer.skills))], [activeEngineers]);
  const selectedUrgentSkill = urgentSkills.includes(urgentForm.kind) ? urgentForm.kind : urgentSkills.find(skill => skill === "Аварийные работы" || skill === "Аварийно-восстановительные работы") ?? urgentSkills[0] ?? urgentForm.kind;
  const availableEngineers = useMemo(() => activeEngineers.filter(engineer => !unavailableEngineerIds.includes(engineer.id)), [activeEngineers, unavailableEngineerIds]);
  const playbackUnavailableIds = useMemo(() => unavailableAtTime(unavailableEngineerIds, availabilityChanges, simTime), [unavailableEngineerIds, availabilityChanges, simTime]);
  const latestResult = planResult ?? idleOptimization(availableEngineers, activeJobs, applied?.speedKmh ?? draft.speedKmh, travel);
  const playbackResult = started ? planAtTime(latestResult, planHistory, simTime) : latestResult;
  const result = playbackResult;
  const stopByJob = useMemo(() => new Map(playbackResult.routes.flatMap(route => route.stops.map(stop => [stop.jobId, stop] as const))), [playbackResult.routes]);
  const plannedJobs = useMemo(() => playbackResult.jobs.map(job => ({ ...job, executionStatus: executionAtTime(job, stopByJob.get(job.id), started ? simTime : null) })), [playbackResult.jobs, stopByJob, started, simTime]);
  const visibleJobs = useMemo(() => plannedJobs.filter(job => region === "Все зоны" || job.region === region || Boolean(selectedEngineerId && job.engineerId === selectedEngineerId)), [plannedJobs, region, selectedEngineerId]);
  const mapJobs = useMemo(() => mapJobsForRegion(playbackResult.jobs, region, selectedEngineerId), [playbackResult.jobs, region, selectedEngineerId]);
  const detailsJob = plannedJobs.find(job => job.id === detailsJobId) ?? null;
  const detailsJobRaw = playbackResult.jobs.find(job => job.id === detailsJobId) ?? null;
  const selectedEngineer = activeEngineers.find(item => item.id === detailsJob?.engineerId);
  const focusedEngineer = activeEngineers.find(item => item.id === selectedEngineerId) ?? null;
  const routeByEngineer = useMemo(() => new Map(playbackResult.routes.map(route => [route.engineerId, route])), [playbackResult.routes]);
  const engineerPersona = activeEngineers.find(item => item.id === engineerPersonaId) ?? null;
  const visibleEngineers = useMemo(() => activeEngineers.filter(engineer => region === "Все зоны" || engineer.region === region || mapJobs.some(job => job.engineerId === engineer.id)), [activeEngineers, region, mapJobs]);
  const visibleBaselineRoutes = useMemo(() => result.baselineRoutes.filter(route => region === "Все зоны" || route.stops.some(stop => result.jobs.some(job => job.id === stop.jobId && job.region === region)) || route.engineerId === selectedEngineerId), [result.baselineRoutes, result.jobs, region, selectedEngineerId]);
  const simRange = useMemo(() => {
    const pool = visibleEngineers.length ? visibleEngineers : activeEngineers;
    const start = 450;
    const fromRoutes = result.routes.reduce((max, route) => Math.max(max, route.stops[route.stops.length - 1]?.end ?? 0), 0);
    const end = Math.max(fromRoutes, pool.reduce((max, item) => Math.max(max, item.shiftEnd), 1320));
    return { start, end };
  }, [visibleEngineers, activeEngineers, result.routes]);
  const simulationOn = started && Boolean(planResult);
  const travelPointsKey = JSON.stringify(uniquePoints(activeEngineers, [...baseJobs,...extraJobs]));
  const transportKey = JSON.stringify([...new Set(activeEngineers.map(engineer=>engineer.transport))]);
  const travelSaved = useMemo(() => saveTravel(travel, JSON.parse(travelPointsKey), JSON.parse(transportKey)), [travel,travelPointsKey,transportKey]);
  const workspaceSnapshot = useMemo(() => ({ view, region, compare, replanned, selectedJobId, detailsJobId, selectedEngineerId, selectedEngineerDetailsId, simTime, playbackMinutesPerSecond, theme, extraJobs, importedJobs, importedEngineers, unavailableEngineerIds, cancelledJobIds, importStatus, solverError, planResult, matrixFallback, draft, applied, generated, generatedFrom, generatedTz, editorJobs, editorEngineers, editorUnavailableIds, editorDirty, editorError, urgentForm, urgentOpen, engineerPersonaId, engineerSelectedJobId, absenceReasons, absenceMoments, availabilityChanges, absenceNotices, planHistory, issuedEngineers, dispatchNotice, jobActionNotice, cancellationNotices, engineerActionError, lastEventTime, lastCalculationMethod, solverEngine, replanChanges, showReplanSummary, eventOutcomes, generatorPreferences, eventDraft, dayStarted, journalEntries, journalReadIds, travelSaved }), [view, region, compare, replanned, selectedJobId, detailsJobId, selectedEngineerId, selectedEngineerDetailsId, simTime, playbackMinutesPerSecond, theme, extraJobs, importedJobs, importedEngineers, unavailableEngineerIds, cancelledJobIds, importStatus, solverError, planResult, matrixFallback, draft, applied, generated, generatedFrom, generatedTz, editorJobs, editorEngineers, editorUnavailableIds, editorDirty, editorError, urgentForm, urgentOpen, engineerPersonaId, engineerSelectedJobId, absenceReasons, absenceMoments, availabilityChanges, absenceNotices, planHistory, issuedEngineers, dispatchNotice, jobActionNotice, cancellationNotices, engineerActionError, lastEventTime, lastCalculationMethod, solverEngine, replanChanges, showReplanSummary, eventOutcomes, generatorPreferences, eventDraft, dayStarted, journalEntries, journalReadIds, travelSaved]);
  const restoreWorkspace = useCallback((value:typeof workspaceSnapshot) => {
    if (!value || !Array.isArray(value.importedJobs) || !Array.isArray(value.importedEngineers) || !Array.isArray(value.planHistory) || !value.draft || !["plan","generator","requests","team","analytics","editor","about","engineer"].includes(value.view)) throw new Error("Некорректное сохранение сценария");
    const restoredTravel=restoreTravel(value.travelSaved,value.applied?.speedKmh ?? value.draft.speedKmh);
    setView(value.view);
    setRegion(value.region);
    setCompare(value.compare);
    setReplanned(value.replanned);
    setSelectedJobId(value.selectedJobId);
    setDetailsJobId(value.detailsJobId);
    setSelectedEngineerId(value.selectedEngineerId);
    setSelectedEngineerDetailsId(value.selectedEngineerDetailsId);
    setSimTime(value.simTime);
    setPlaybackMinutesPerSecond(value.playbackMinutesPerSecond);
    setTheme(value.theme);
    setExtraJobs(value.extraJobs);
    setImportedJobs(value.importedJobs);
    setImportedEngineers(value.importedEngineers);
    setUnavailableEngineerIds(value.unavailableEngineerIds);
    setCancelledJobIds(value.cancelledJobIds);
    setImportStatus(value.importStatus);
    setSolverError(value.solverError);
    setPlanResult(value.planResult);
    setMatrixFallback(value.matrixFallback);
    setDraft(value.draft);
    setApplied(value.applied);
    setGenerated(value.generated);
    setGeneratedFrom(value.generatedFrom);
    setGeneratedTz(value.generatedTz);
    setEditorJobs(value.editorJobs);
    setEditorEngineers(value.editorEngineers);
    setEditorUnavailableIds(value.editorUnavailableIds);
    setEditorDirty(value.editorDirty);
    setEditorError(value.editorError);
    setUrgentForm(value.urgentForm);
    setUrgentOpen(value.urgentOpen);
    setEngineerPersonaId(value.engineerPersonaId);
    setEngineerSelectedJobId(value.engineerSelectedJobId);
    setAbsenceReasons(value.absenceReasons);
    setAbsenceMoments(value.absenceMoments);
    setAvailabilityChanges(value.availabilityChanges);
    setAbsenceNotices(value.absenceNotices);
    setPlanHistory(value.planHistory);
    setIssuedEngineers(value.issuedEngineers);
    setDispatchNotice(value.dispatchNotice);
    setJobActionNotice(value.jobActionNotice);
    setCancellationNotices(value.cancellationNotices);
    setEngineerActionError(value.engineerActionError);
    setLastEventTime(value.lastEventTime);
    setLastCalculationMethod(value.lastCalculationMethod);
    setSolverEngine(value.solverEngine);
    setReplanChanges(value.replanChanges);
    setShowReplanSummary(value.showReplanSummary);
    setEventOutcomes(value.eventOutcomes);
    setGeneratorPreferences(value.generatorPreferences); setEventDraft(value.eventDraft ?? null);
    setDayStarted(value.dayStarted); replaceNotifications(value.journalEntries ?? []); setJournalReadIds(value.journalReadIds ?? []);
    setTravel(restoredTravel); setSimPlaying(false); workdayStarted.current=value.dayStarted;
    setRoutingState(value.planResult ? "ready" : "idle");
  }, [replaceNotifications]);
  const { ready:workspaceReady, error:workspaceStorageError, saveNow:saveWorkspaceNow } = usePersistentWorkspace(workspaceSnapshot,restoreWorkspace,!optimizing && !scheduledProcessing);
  const changeSimulationTime = useCallback((time: number) => {
    if (scheduledLock.current) return;
    const due = started ? nextDueEvent(generatedTz?.events ?? [], eventOutcomes, time) : null;
    if (due) { requestedTime.current = { time, playing: simPlaying }; setSimPlaying(false); setSimTime(parseTime(due.time)); }
    else setSimTime(time);
  }, [started, generatedTz?.events, eventOutcomes, simPlaying]);
  useEffect(() => { if (simulationOn && simTime > 480 && !dayStarted) { workdayStarted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDayStarted(true); } }, [simulationOn, simTime, dayStarted]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!simulationOn) { setSimPlaying(false); return; }
      setSimTime(current => Math.min(simRange.end, Math.max(simRange.start, current)));
    });
    return () => cancelAnimationFrame(frame);
  }, [simulationOn, simRange.start, simRange.end]);
  useEffect(() => { const saved = window.localStorage.getItem("fieldflow-theme") as ThemeId | null; if (saved && themes.some(item => item.id === saved)) { // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved); } }, []); useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("fieldflow-theme", theme); }, [theme]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        if (detailsJobId || selectedEngineerDetailsId || urgentOpen) return;
        if (selectedEngineerId || selectedJobId) {
          setSelectedEngineerId(null);
          setSelectedJobId(null);
          setRegion("Все зоны");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEngineerId, selectedJobId, detailsJobId, selectedEngineerDetailsId, urgentOpen]);
  const selectEngineer = useCallback((id: string) => {
    if (selectedEngineerId === id) setRegion("Все зоны");
    setSelectedEngineerId(current => current === id ? null : id);
    setSelectedJobId(null);
    setDetailsJobId(null);
    setCompare(false);
  }, [selectedEngineerId]);
  const selectJob = useCallback((id: string) => {
    setJobActionNotice("");
    if (selectedJobId === id) {
      setSelectedJobId(null);
      setDetailsJobId(null);
      setSelectedEngineerId(null);
      setRegion("Все зоны");
      return;
    }
    const job = result.jobs.find(item => item.id === id);
    setSelectedJobId(id);
    setDetailsJobId(id);
    if (job?.engineerId) {
      setSelectedEngineerId(job.engineerId);
    } else {
      setSelectedEngineerId(null);
    }
    if (job) setRegion(job.region);
    setCompare(false);
  }, [result.jobs, selectedJobId]);
  const updateRoutingState = useCallback((state: RoutingState) => setRoutingState(state), []);
  const showAllRoutes = useCallback(() => {
    setRegion("Все зоны");
    setSelectedEngineerId(null);
    setSelectedJobId(null);
    setDetailsJobId(null);
  }, []);
  const navigate = useCallback((next: ViewId) => { setView(next); setMobileNavOpen(false); setThemeOpen(false); }, []);
  const focusEngineer = useCallback((id: string) => {
    if (selectedEngineerId === id) {
      showAllRoutes();
      return;
    }
    setSelectedEngineerId(current => current === id ? null : id);
    setSelectedJobId(null);
    setDetailsJobId(null);
    setSelectedEngineerDetailsId(null);
    setCompare(false);
    const engineer = activeEngineers.find(item => item.id === id);
    if (engineer) setRegion(engineer.region);
    setView("plan");
  }, [activeEngineers, selectedEngineerId, showAllRoutes]);
  const inspectJob = useCallback((id: string) => {
    setJobActionNotice("");
    if (selectedJobId === id) {
      setSelectedJobId(null);
      setDetailsJobId(null);
      setSelectedEngineerId(null);
      setRegion("Все зоны");
      return;
    }
    const job = result.jobs.find(item => item.id === id);
    setSelectedJobId(id);
    setDetailsJobId(id);
    setSelectedEngineerId(job?.engineerId ?? null);
  }, [result.jobs, selectedJobId]);
  const openEngineerOnMap = focusEngineer; const detailsEngineer = activeEngineers.find(item => item.id === selectedEngineerDetailsId) ?? null;
  const runOptimize = useCallback(async (engineers: Engineer[], jobs: Job[], speedKmh: number, urgentId?: string) => {
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
      const preShift = !workdayStarted.current && simTime <= 480 && (lastEventTime === null || lastEventTime <= 480);
      const planningEngineers = preShift ? issueDailyEquipment(engineers, jobs, nextTravel ?? fallbackTravel(speedKmh), speedKmh) : engineers;
      if (preShift) {
        const mergeIssued = (current: Engineer[] | null) => {
          const updated = new Map(planningEngineers.map(engineer => [engineer.id, engineer]));
          return (current ?? engineers).map(engineer => updated.get(engineer.id) ?? engineer);
        };
        setIssuedEngineers(mergeIssued);
      }
      const solved = await solveVrptwServer(planningEngineers, jobs, speedKmh, nextTravel ?? fallbackTravel(speedKmh), urgentId);
      // Keep unavailable engineers in the name directory so the change log can
      // explain whose old route was removed instead of showing an internal id.
      setReplanChanges(planResult ? compareReplannedPlans(planResult, solved.result, activeEngineers) : []);
      setPlanResult(solved.result);
      if (planResult) recordPlanChanges(planResult, solved.result, Math.floor(simTime));
      if (preShift) { setPlanHistory([]); setAvailabilityChanges([]); }
      if (preShift) { setSimTime(480); setSimPlaying(false); }
      setSolverEngine(solved.engine);
      setLastCalculationMethod("ortools");
      setReplanned(true);
      setCompare(false);
    } catch (error) {
      setSolverError(error instanceof Error ? error.message : "OR-Tools недоступен");
      // Keep the last valid equipment issue when a recalculation fails.
      setIssuedEngineers(issuedEngineers);
      setRoutingState("fallback");
    } finally {
      setOptimizing(false);
    }
  }, [travel, planResult, activeEngineers, simTime, lastEventTime, issuedEngineers, recordPlanChanges]);
  const runTemporalEvent = useCallback(async (event: DispatchEvent, jobs: Job[], unavailableIds: string[], context?: { previous:OptimizationResult; previousEventTime:number | null }) => {
    const previous = context?.previous ?? planResult;
    if (!applied || !previous) return false;
    const timeError = eventTimeError(event.time, context ? context.previousEventTime : lastEventTime, simRange.end);
    if (timeError) { setSolverError(timeError); setDispatchNotice(timeError); return false; }
    const saveScenario = (next: OptimizationResult) => { setPlanResult(next); recordPlanChanges(previous, next, event.time); };
    const cancelled = event.type === "cancel_job" ? previous.jobs.find(job => job.id === event.id) : undefined;
    if (cancelled?.engineerId && event.type === "cancel_job") {
      try {
        const changed = cancelJobLocally(previous, activeEngineers, jobs, event, applied.speedKmh, travel ?? fallbackTravel(applied.speedKmh));
        saveScenario(changed.result);
        setPlanHistory(current => [...current, { time: event.time, before: previous }]);
        setReplanChanges(compareReplannedPlans(previous, changed.result, activeEngineers, event.time, event));
        setShowReplanSummary(true); setLastCalculationMethod("cancel_local"); setLastEventTime(event.time);
        setSimTime(event.time); setSimPlaying(false); setReplanned(true); setCompare(false); setSolverError("");
        setCancellationNotices(current => [...current, { engineerId: changed.engineerId, jobId: event.id, replacementId: changed.replacementId, time: event.time }]);
        appendNotifications([{ kind: "cancelled", time: event.time, title: `Заявка №${event.id} отменена`, message: `Инженер ${activeEngineers.find(item => item.id === changed.engineerId)?.name ?? changed.engineerId} уведомлён. ${changed.replacementId ? `Вместо неё назначена №${changed.replacementId}.` : "Подходящей свободной заявки для замены нет."} Расписание коллег сохранено.`, engineerIds: [changed.engineerId] }]);
        setDispatchNotice(`Заявка №${event.id} отменена. Инженер уведомлён.${changed.replacementId ? ` Вместо неё назначена №${changed.replacementId}.` : " Подходящей свободной заявки для этого инженера нет."}`);
        return changed.result;
      } catch (error) { const message = error instanceof Error ? error.message : "Не удалось отменить заявку"; setSolverError(message); setJobActionNotice(message); setDispatchNotice(message); return false; }
    }
    if (event.type === "cancel_job" && cancelled && !cancelled.engineerId && jobs.some(job => job.id === event.id && job.cancelled)) {
      try {
        const unchanged = cancelUnassignedJob(previous, event.id, activeEngineers, applied.speedKmh, travel);
        saveScenario(unchanged);
        setPlanHistory(current => [...current, { time: event.time, before: previous }]);
        setReplanChanges([{ kind: "event", key: `event-${event.id}`, message: `№${event.id} отменена в ${minutesLabel(event.time)}: её не было в рабочем маршруте, поэтому согласованные визиты и маршруты инженеров не изменились.`, necessity: "required" }]);
        setLastCalculationMethod("no_change"); setLastEventTime(event.time); setSimTime(event.time); setSimPlaying(false); setReplanned(true); setSolverError("");
        setDispatchNotice(`Заявка №${event.id} отменена. Назначения и маршруты инженеров не изменились.`);
        appendNotifications([{ kind: "cancelled", time: event.time, title: `Заявка №${event.id} отменена`, message: "У заявки не было назначенного инженера. Маршруты остальных заявок сохранены." }]);
        return unchanged;
      } catch (error) { const message = error instanceof Error ? error.message : "Не удалось отменить заявку"; setSolverError(message); setJobActionNotice(message); setDispatchNotice(message); return false; }
    }
    setOptimizing(true); setSolverError(""); setRoutingState("loading");
    try {
      const fullEngineers = activeEngineers;
      const prepared = prepareTemporalReplan(previous, fullEngineers, jobs, unavailableIds, event);
      const available = prepared.continuationEngineers;
      const loaded = await loadRoadTravel(available, prepared.remainingJobs, applied.speedKmh, travel ? { previous: travel } : undefined);
      const nextTravel = loaded.travel;
      let suffix: OptimizationResult;
      let ordinaryInserted: boolean | null = null;
      const newJob = event.type === "new_job" ? prepared.remainingJobs.find(job => job.id === event.id) : undefined;
      if (newJob && jobPriorityLevel(newJob) === 1) {
        const inserted = insertOrdinaryJob(previous, prepared, newJob, applied.speedKmh, nextTravel);
        ordinaryInserted = inserted.inserted;
        suffix = resultFromRouteOrder(available, prepared.remainingJobs, inserted.orders, { speedKmh: applied.speedKmh, travel: nextTravel });
      } else if (!available.length) {
        suffix = resultFromRouteOrder([], prepared.remainingJobs, [], { speedKmh: applied.speedKmh, travel: nextTravel });
      } else {
        const solved = await solveVrptwServer(available, prepared.remainingJobs, applied.speedKmh, nextTravel, newJob && jobPriorityLevel(newJob) === 2 ? newJob.id : undefined, event, previous);
        suffix = solved.result;
      }
      const calculated = mergeTemporalResult(previous, suffix, prepared, fullEngineers, jobs, applied.speedKmh, nextTravel);
      const merged = ordinaryInserted === false ? { ...calculated, jobs: calculated.jobs.map(job => job.id === event.id ? { ...job, unassignedCategory: "cannot_insert" as const, unassignedReason: "Не найден свободный интервал без изменения уже согласованных работ. Обычная заявка оставлена без маршрута; полный пересчёт не выполнялся." } : job) } : calculated;
      setReplanChanges(compareReplannedPlans(previous, merged, fullEngineers, event.time, event));
      setShowReplanSummary(true);
      saveScenario(merged);
      setPlanHistory(current => [...current, { time: event.time, before: previous }]);
      setLastCalculationMethod(ordinaryInserted != null ? "insert" : "ortools"); setLastEventTime(event.time);
      setTravel(nextTravel); setMatrixFallback(loaded.provider === "fallback");
      setRoutingState("ready"); setReplanned(true); setCompare(false);
      setSimTime(event.time); setSimPlaying(false);
      return merged;
    } catch (error) {
      setSolverError(error instanceof Error ? error.message : "Не удалось перепланировать оставшийся день");
      setRoutingState("fallback");
      return false;
    } finally { setOptimizing(false); }
  }, [applied, planResult, activeEngineers, travel, lastEventTime, simRange.end, recordPlanChanges, appendNotifications]);
  useEffect(() => {
    if (!workspaceReady || !started || optimizing || scheduledProcessing || scheduledLock.current || !planResult) return;
    const events=generatedTz?.events ?? [];
    const event=nextDueEvent(events,eventOutcomes,simTime);
    if (!event) return;
    scheduledLock.current=true;
    const target=requestedTime.current ?? { time:simTime, playing:simPlaying };
    requestedTime.current=target;
    const minute=parseTime(event.time), key=eventKey(event), previous=planResult;
    // State transitions are driven by the asynchronous event runner.
    const process=async () => {
      setScheduledProcessing(true); setSimPlaying(false); setSimTime(minute);
      let outcome:EventOutcomes[string];
      try {
        const change=scheduledEventChange(event,previous,activeEngineers,unavailableEngineerIds);
        const updated=await runTemporalEvent(change.dispatch,change.jobs,change.unavailableIds,{ previous, previousEventTime:lastEventTime });
        if (!updated) throw new Error("Перепланирование не выполнено. Проверьте сообщение расчёта и вернитесь до времени события и выполните ручной пересчёт, чтобы повторить его.");
        setEditorJobs(updated.jobs);
        if ((event.type === "срочная заявка" || event.type === "новая заявка") && event.job) {
          setExtraJobs(current=>[...current.filter(job=>job.id!==event.entityId),event.job!]);
          appendNotifications([{ kind:"reassigned", time:minute, title:`Появилась ${event.type === "срочная заявка" ? "срочная" : "обычная"} заявка №${event.entityId}`, message:`${event.job.address}. ${updated.jobs.find(job=>job.id===event.entityId)?.engineerId ? "Назначен инженер; оставшийся день пересчитан." : "Доступного назначения нет; заявка требует решения диспетчера."}` }]);
        } else if (event.type === "срочная заявка") {
          appendNotifications([{ kind:"reassigned",time:minute,title:`Заявка №${event.entityId} стала срочной`,message:"Приоритет повышен; оставшийся день пересчитан." }]);
        } else if (event.type === "отмена заявки") {
          setCancelledJobIds(current=>current.includes(event.entityId) ? current : [...current,event.entityId]);
        } else if (event.type === "недоступность инженера") {
          const engineer=activeEngineers.find(item=>item.id===event.entityId)!;
          const moment=engineerAbsenceMoment(previous,engineer,minute);
          const impact=absenceImpact(previous,updated,engineer.id,minute,activeEngineers);
          setUnavailableEngineerIds(change.unavailableIds); setEditorUnavailableIds(change.unavailableIds);
          setAvailabilityChanges(current=>[...current,{ engineerId:engineer.id,time:moment.effectiveAt,unavailable:true }]);
          setAbsenceReasons(current=>({...current,[engineer.id]:"left"}));
          setAbsenceMoments(current=>({...current,[engineer.id]:moment}));
          setAbsenceNotices(current=>[...current,{ engineerId:engineer.id,engineerName:engineer.name,reason:"left",impact,moment }]);
          appendNotifications([{ kind:"left",time:minute,title:`${engineer.name}: вне смены`,message:`${moment.phase==="service" ? `Завершит №${moment.currentJobId} к ${minutesLabel(moment.effectiveAt)} и выйдет.` : "Инженер вышел из смены."} Переназначено: ${impact.reassigned.length}. Без замены: ${impact.unassigned.length}.`,engineerIds:[engineer.id] }]);
        }
        outcome={ status:"applied",time:minute,message:"Событие применено" };
      } catch (error) {
        const message=error instanceof Error ? error.message : "Не удалось применить событие";
        outcome={ status:"failed",time:minute,message };
        setDispatchNotice(`${event.time} · ${event.type}: ${message}`);
        appendNotifications([{ kind:"unassigned",time:minute,title:`Событие ${event.time} не применено`,message:`${event.type}: ${message}` }]);
      }
      const outcomes={...eventOutcomes,[key]:outcome};
      setEventOutcomes(outcomes);
      const next=nextDueEvent(events,outcomes,target.time);
      scheduledLock.current=false; setScheduledProcessing(false);
      if (next) setSimTime(parseTime(next.time));
      else { requestedTime.current=null; setSimTime(target.time); setSimPlaying(target.playing); }
    };
    void process();
  }, [workspaceReady,started,optimizing,scheduledProcessing,planResult,generatedTz,eventOutcomes,simTime,simPlaying,activeEngineers,unavailableEngineerIds,lastEventTime,runTemporalEvent,appendNotifications]);
  const applyEditedData = useCallback(async () => {
    if (optimizing || scheduledLock.current) return;
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
    if (workdayStarted.current) { setEditorError("Рабочий день уже начался: оборудование и исходный план смены нельзя перевыдать через редактор. Создайте новый набор для нового дня."); return; }
    const engineers = issueDailyEquipment(editorEngineers, jobs);
    setIssuedEngineers(engineers);
    setCancellationNotices([]); setDispatchNotice("");
    setPlanResult(null); setEventOutcomes({}); setLastEventTime(null); setPlanHistory([]); setImportedJobs(jobs); setImportedEngineers(engineers); setEditorJobs(jobs); setExtraJobs([]); setCancelledJobIds([]); setUnavailableEngineerIds(editorUnavailableIds); setAbsenceReasons({}); setAbsenceMoments({}); setAvailabilityChanges([]); setAbsenceNotices([]); setEngineerPersonaId(null);
    setGenerated(null); setGeneratedFrom(null); setEditorDirty(false); setEditorError("");
    setSelectedJobId(null); setDetailsJobId(null); setSelectedEngineerId(null); setRegion("Все зоны");
    const config = { ...draft, jobs: jobs.length, engineers: engineers.length };
    setDraft(config); setApplied(config); setSimTime(480); setSimPlaying(false);
    void runOptimize(engineers.filter(engineer => !editorUnavailableIds.includes(engineer.id)), jobs, config.speedKmh);
  }, [editorJobs, editorEngineers, editorUnavailableIds, draft, runOptimize, activeJobs, workdayStarted, optimizing]);
  const invalidateFutureScenario = useCallback(() => {
    const retained=invalidateFutureEvents(eventOutcomes,planHistory,simTime);
    const effectiveChanges=availabilityChanges.filter(change => change.time<=simTime || (absenceMoments[change.engineerId]?.reportedAt ?? Infinity)<=simTime);
    setPlanHistory(retained.history); setEventOutcomes(retained.outcomes); setPlanResult(playbackResult);
    const planningUnavailableIds=[...new Set([...playbackUnavailableIds,...Object.entries(absenceMoments).filter(([,moment])=>moment.reportedAt<=simTime).map(([id])=>id)])];
    setUnavailableEngineerIds(planningUnavailableIds); setEditorUnavailableIds(planningUnavailableIds);
    setAvailabilityChanges(effectiveChanges);
    setAbsenceMoments(Object.fromEntries(Object.entries(absenceMoments).filter(([,moment])=>moment.reportedAt<=simTime)));
    setAbsenceReasons(Object.fromEntries(Object.entries(absenceReasons).filter(([id])=>!absenceMoments[id] || absenceMoments[id].reportedAt<=simTime)));
    setAbsenceNotices(current=>current.filter(notice=>notice.moment.reportedAt<=simTime));
    setCancellationNotices(current=>current.filter(notice=>notice.time<=simTime));
    replaceNotifications(journalEntries.filter(entry=>entry.time<=simTime));
    const extras=playbackResult.jobs.filter(job=>!baseJobs.some(base=>base.id===job.id));
    setExtraJobs(extras);
    const flags=baseJobs.filter(base=>Boolean(playbackResult.jobs.find(job=>job.id===base.id)?.cancelled)!==Boolean(base.cancelled)).map(job=>job.id);
    setCancelledJobIds(flags);
    setLastEventTime(retained.history.length ? Math.max(...retained.history.map(snapshot=>snapshot.time)) : null);
    setReplanChanges([]); setReplanned(false); setDispatchNotice(""); setJobActionNotice(""); setEngineerActionError(""); requestedTime.current=null;
    return { previous:playbackResult, unavailableIds:planningUnavailableIds, extras, flags };
  }, [eventOutcomes,planHistory,simTime,availabilityChanges,absenceMoments,absenceReasons,playbackResult,playbackUnavailableIds,baseJobs,journalEntries,replaceNotifications]);
  const startPlanning = useCallback(() => {
    if (optimizing || scheduledLock.current || routingState === "loading") return;
    if (editorDirty) { setEditorError("В таблице есть несохранённые изменения. Примените их или сбросьте перед новым расчётом."); setView("editor"); return; }
    if (!baseJobs.length || !baseEngineers.length) { setView("generator"); setImportStatus("Сначала сгенерируйте или загрузите заявки и инженеров."); return; }
    if (applied && planResult) {
      const current=invalidateFutureScenario();
      if (!workdayStarted.current && simTime<=480) void runOptimize(activeEngineers.filter(engineer=>!current.unavailableIds.includes(engineer.id)),current.previous.jobs,applied.speedKmh);
      else void runTemporalEvent({ type:"recalculate", time:Math.floor(simTime), id:"plan" },current.previous.jobs,current.unavailableIds,{ previous:current.previous, previousEventTime:null });
      return;
    }
    const config = { ...draft };
    setApplied(config);
    setLastEventTime(null);
    const jobs = composePlanJobs(baseJobs, config.jobs, extraJobs, cancelledJobIds);
    const engineers = !workdayStarted.current && simTime <= 480 ? issueDailyEquipment(scaleEngineers(baseEngineers, config.engineers, jobs), jobs) : issuedEngineers ?? issueDailyEquipment(scaleEngineers(baseEngineers, config.engineers, jobs), jobs);
    setIssuedEngineers(engineers);
    setEditorJobs(jobs); setEditorEngineers(engineers); setEditorUnavailableIds(unavailableEngineerIds); setEditorError("");
    void runOptimize(engineers.filter(engineer => !unavailableEngineerIds.includes(engineer.id)), jobs, config.speedKmh);
  }, [draft, extraJobs, runOptimize, runTemporalEvent, baseEngineers, baseJobs, unavailableEngineerIds, cancelledJobIds, editorDirty, applied, planResult, simTime, issuedEngineers, workdayStarted, optimizing, routingState, invalidateFutureScenario, activeEngineers]);
  const createGenerated = useCallback((opts?: Partial<GenerateTzOptions>) => {
    if (optimizing || scheduledLock.current) return;
    replaceNotifications([]); setEventDraft(null);
    const jobsCount = opts?.jobs ?? draft.jobs;
    const engCount = opts?.engineers ?? draft.engineers;
    const windowMin = opts?.windowMinutes ?? draft.windowMinutes;
    const speed = opts?.speedKmh ?? draft.speedKmh;
    const tzData = generateTzDataset({
      jobs: jobsCount,
      engineers: engCount,
      windowMinutes: windowMin,
      speedKmh: speed,
      ...opts,
    });
    const initialEngineers = issueDailyEquipment(tzData.engineers, tzData.jobs);
    setGeneratedTz({ ...tzData, engineers: initialEngineers });
    setGenerated({ jobs: tzData.jobs, engineers: initialEngineers, speedKmh: tzData.speedKmh });
    setDraft(current => ({ ...current, jobs: jobsCount, engineers: engCount, windowMinutes: windowMin, speedKmh: speed }));
    setGeneratedFrom({ engineers: engCount, jobs: jobsCount, windowMinutes: windowMin, speedKmh: speed });
    setImportedJobs(tzData.jobs);
    setImportedEngineers(initialEngineers);
    setEditorJobs(tzData.jobs);
    setEditorEngineers(initialEngineers);
    setIssuedEngineers(null);
    setCancellationNotices([]); setDispatchNotice(""); workdayStarted.current = false; setDayStarted(false); setSimTime(480); setSimPlaying(false);
    setEditorUnavailableIds([]);
    setEditorDirty(false);
    setEditorError("");
    setExtraJobs([]);
    setCancelledJobIds([]);
    setUnavailableEngineerIds([]);
    setAbsenceReasons({}); setAbsenceMoments({}); setAvailabilityChanges([]); setAbsenceNotices([]); setPlanHistory([]); setEngineerPersonaId(null);
    setApplied(null);
    setPlanResult(null); setEventOutcomes({});
    setLastEventTime(null);
    setTravel(undefined);
    setMatrixFallback(false);
    setReplanChanges([]);
    setSelectedJobId(null);
    setSelectedEngineerId(null);
    setSolverError("");
    setImportStatus(`Сгенерирован набор: ${tzData.jobs.length} заявок, ${tzData.engineers.length} инженеров, ${tzData.events.length} ${tzData.events.length === 1 ? "событие" : tzData.events.length >= 2 && tzData.events.length <= 4 ? "события" : "событий"} перепланирования.`);
  }, [draft,optimizing,replaceNotifications]);
  const addGeneratedEvent = useCallback((event:TzReplanEvent,oldKey?:string) => {
    if (scheduledLock.current || optimizing) return;
    if (started && parseTime(event.time)<Math.floor(simTime)) { setDispatchNotice("Сначала установите время просмотра до появления события."); return; }
    if (started) invalidateFutureScenario();
    setGeneratedTz(current => {
      const dataset=current ?? { jobs:importedJobs, engineers:importedEngineers, events:[], speedKmh:draft.speedKmh, stats:{ totalJobs:importedJobs.length,totalEngineers:importedEngineers.length,jobsBySkill:{},jobsByEquipment:{},engineersByLevel:{},engineersByVehicle:{},engineersBySkill:{},urgentJobsCount:0,constrainedTransportJobsCount:0 } };
      return { ...dataset, events:[...dataset.events.filter(item=>eventKey(item)!==oldKey),event].sort((a,b)=>a.time.localeCompare(b.time)) };
    });
  }, [draft.speedKmh,importedEngineers,importedJobs,started,simTime,invalidateFutureScenario,optimizing]);
  const removeGeneratedEvent = useCallback((key:string) => {
    if (scheduledLock.current || optimizing) return;
    const event=generatedTz?.events.find(item=>eventKey(item)===key);
    if (!event || (started && parseTime(event.time)<=simTime)) return;
    if (started) invalidateFutureScenario();
    setGeneratedTz(current=>current ? { ...current,events:current.events.filter(event=>eventKey(event)!==key) } : null);
  }, [generatedTz,simTime,started,invalidateFutureScenario,optimizing]);
  const clearDataset = useCallback(() => {
    if (optimizing || scheduledLock.current) return;
    const cleared:typeof workspaceSnapshot={ ...workspaceSnapshot, view:"generator",region:"Все зоны",compare:false,replanned:false,
      importedJobs:[],importedEngineers:[],issuedEngineers:null,generated:null,generatedFrom:null,generatedTz:null,
      editorJobs:[],editorEngineers:[],editorUnavailableIds:[],editorDirty:false,editorError:"",extraJobs:[],cancelledJobIds:[],unavailableEngineerIds:[],
      absenceReasons:{},absenceMoments:{},availabilityChanges:[],absenceNotices:[],planHistory:[],engineerPersonaId:null,engineerSelectedJobId:null,
      applied:null,planResult:null,eventOutcomes:{},travelSaved:null,matrixFallback:false,replanChanges:[],selectedJobId:null,selectedEngineerId:null,
      detailsJobId:null,selectedEngineerDetailsId:null,solverError:"",lastEventTime:null,simTime:480,dayStarted:false,eventDraft:null,dispatchNotice:"",jobActionNotice:"",
      cancellationNotices:[],engineerActionError:"",urgentOpen:false,journalEntries:[],journalReadIds:[],importStatus:"Сценарий удалён. Сгенерируйте или загрузите данные заново." };
    requestedTime.current=null; setPendingEngineerAction(null);
    restoreWorkspace(cleared);
    void saveWorkspaceNow(cleared);
  }, [workspaceSnapshot,restoreWorkspace,saveWorkspaceNow,optimizing]);
  const addUrgent = useCallback(async () => {
    if (optimizing || scheduledLock.current) return;
    setFormError("");
    if (!urgentForm.address.trim()) { setFormError("Укажите адрес заявки"); return; }
    const start = parseTime(urgentForm.start), end = parseTime(urgentForm.end), eventTime = Math.floor(simTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { setFormError("Проверьте временное окно"); return; }
    if (!Number.isFinite(eventTime) || end <= eventTime) { setFormError("Окно новой заявки должно заканчиваться после события"); return; }
    const manualLongitude = urgentForm.longitude.trim(), manualLatitude = urgentForm.latitude.trim();
    if (Boolean(manualLongitude) !== Boolean(manualLatitude)) { setFormError("Укажите обе координаты: долготу и широту."); return; }
    let coordinates: Coordinate | null = null;
    let geocodeQuality: Job["geocodeQuality"] = "street";
    if (manualLongitude && manualLatitude) {
      const longitude = Number(manualLongitude.replace(",", ".")), latitude = Number(manualLatitude.replace(",", "."));
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < 36 || longitude > 39 || latitude < 54 || latitude > 57) { setFormError("Координаты должны находиться в зоне обслуживания: долгота 36–39, широта 54–57."); return; }
      coordinates = [longitude, latitude];
      geocodeQuality = "manual";
    } else {
      try { coordinates = await new BackendGeocodingProvider("nominatim").geocode(urgentForm.address); } catch { /* Keep form open for correction. */ }
      if (!coordinates) { setFormError("Адрес не удалось определить. Уточните его или задайте координаты вручную; заявка пока не добавлена в план."); return; }
    }
    const reservedIds=[...baseJobs,...extraJobs,...(generatedTz?.events.flatMap(event=>event.job ? [event.job] : []) ?? [])].map(job=>job.id);
    let nextIndex=Math.max(0,...reservedIds.map(Number).filter(Number.isFinite))+1;
    while(reservedIds.includes(String(nextIndex).padStart(4,"0"))) nextIndex++;
    const id=String(nextIndex).padStart(4,"0");
    const emergency = selectedUrgentSkill === "Аварийно-восстановительные работы" || selectedUrgentSkill === "Аварийные работы";
    const connection = selectedUrgentSkill === "Подключение и модернизация" || selectedUrgentSkill === "Работы на подключение и дозаказы";
    const serviceMinutes = emergency ? 80 : connection ? 60 : 30;
    const equipment = emergency
      ? "Рефлектометр"
      : connection
      ? "ONT"
      : "Диагностический комплект";
    const job: Job = { id, time: `${urgentForm.start}–${urgentForm.end}`, windowStart: start, windowEnd: end, area: urgentForm.region,
      address: urgentForm.address, kind: selectedUrgentSkill, workType: selectedUrgentSkill, tone: "amber", region: urgentForm.region,
      engineerId: null, baselineEngineerId: null, coordinates, geocodeVerified: true, geocodeQuality,
      risk: false, equipment, requiredTransport: urgentForm.transport, priority: urgentForm.urgency === "urgent" ? 2 : 1, serviceMinutes,
      normativeMinutes: emergency ? 100 : undefined, travelReserveMinutes: emergency ? 20 : 0, estimatedTravelMinutes: emergency ? 20 : 0,
      normSource: emergency ? "экспертный норматив" : "демонстрационное допущение", urgency: urgentForm.urgency,
      workClass: emergency ? "emergency" : connection ? "connection" : "repair",
      source: "Форма диспетчера", status: "Новая", executionStatus: "not_started" };
    const current=applied && planResult ? invalidateFutureScenario() : null;
    const nextExtras=[...(current?.extras ?? extraJobs),job];
    if (current) {
      const jobs=[...current.previous.jobs,job];
      if (!await runTemporalEvent({ type:"new_job",time:eventTime,id },jobs,current.unavailableIds,{ previous:current.previous,previousEventTime:null })) return;
    }
    setExtraJobs(nextExtras); setEditorJobs(current => [...current, job]); setUrgentOpen(false);
    setSelectedJobId(id); setDetailsJobId(id); setUrgentForm(current => ({ ...current, address: "", longitude: "", latitude: "" }));
  }, [urgentForm, selectedUrgentSkill, simTime, applied, extraJobs, planResult, runTemporalEvent, baseJobs, generatedTz, invalidateFutureScenario, optimizing]);
  const handleImport = useCallback(async (file: File) => {
    if (optimizing || scheduledLock.current) return;
    setImportStatus(`Читаем ${file.name}…`);
    try {
      const imported = await importPlanFile(file, regionCenters);
      const provider = new BackendGeocodingProvider("nominatim");
      const coordinates = new Map<string, Coordinate>();
      const missing = [...new Set([...imported.jobs,...(imported.events?.flatMap(event=>event.job ? [event.job] : []) ?? [])].filter(job => !job.geocodeVerified).map(job => job.address))];
      for (let index = 0; index < missing.length; index++) {
        const address = missing[index];
        setImportStatus(`Геокодирование ${index + 1}/${missing.length}: ${address}`);
        try { const point = await provider.geocode(address); if (point) coordinates.set(address, point); } catch { /* quality remains explicit */ }
        if (index + 1 < missing.length) await new Promise(resolve => window.setTimeout(resolve, 1100));
      }
      const jobs = imported.jobs.map(job => coordinates.has(job.address) ? { ...job, coordinates: coordinates.get(job.address)!, geocodeVerified: true, geocodeQuality: "street" as const } : job);
      const events=imported.events?.map(event=>event.job && coordinates.has(event.job.address) ? {...event,job:{...event.job,coordinates:coordinates.get(event.job.address)!,geocodeVerified:true,geocodeQuality:"street" as const}} : event);
      if (events && !jobs.length && !imported.engineers?.length) {
        if (started && events.some(event=>parseTime(event.time)<Math.floor(simTime))) { setImportStatus("Ошибка: события раньше времени просмотра. Сначала переместите шкалу до их появления."); return; }
        if (started) invalidateFutureScenario();
        setGeneratedTz(current=>({...current!,jobs:current?.jobs ?? baseJobs,engineers:current?.engineers ?? baseEngineers,events,speedKmh:draft.speedKmh,stats:current?.stats ?? {totalJobs:baseJobs.length,totalEngineers:baseEngineers.length,jobsBySkill:{},jobsByEquipment:{},engineersByLevel:{},engineersByVehicle:{},engineersBySkill:{},urgentJobsCount:0,constrainedTransportJobsCount:0}}));
        setImportStatus(`${file.name}: загружено ${events.length} событий.`); return;
      }
      const verified = jobs.filter(job => job.geocodeVerified).length;
      if (jobs.length) setImportedJobs(jobs);
      const importedCrew = imported.engineers?.length ? issueDailyEquipment(imported.engineers, jobs.length ? jobs : baseJobs) : undefined;
      if (importedCrew?.length) setImportedEngineers(importedCrew);
      if (jobs.length) setEditorJobs(jobs);
      if (importedCrew?.length) setEditorEngineers(importedCrew);
      replaceNotifications([]); setEventDraft(null);
      setIssuedEngineers(null);
      setCancellationNotices([]); setDispatchNotice(""); workdayStarted.current = false; setDayStarted(false); setSimTime(480); setSimPlaying(false);
      setEditorUnavailableIds([]); setEditorDirty(false); setEditorError("");
      setGeneratedTz(events ? {jobs,engineers:importedCrew ?? baseEngineers,events,speedKmh:imported.speedKmh ?? draft.speedKmh,stats:{totalJobs:jobs.length,totalEngineers:(importedCrew ?? baseEngineers).length,jobsBySkill:{},jobsByEquipment:{},engineersByLevel:{},engineersByVehicle:{},engineersBySkill:{},urgentJobsCount:0,constrainedTransportJobsCount:0}} : null);
      setGenerated(null); setGeneratedFrom(null);
      if (jobs.length) { setExtraJobs([]); setCancelledJobIds([]); setUnavailableEngineerIds([]); setAbsenceReasons({}); setAbsenceMoments({}); setAvailabilityChanges([]); setAbsenceNotices([]); setPlanHistory([]); setEngineerPersonaId(null); }
      setApplied(null); setPlanResult(null); setEventOutcomes({}); setLastEventTime(null); setTravel(undefined); setMatrixFallback(false); setReplanChanges([]); setSelectedJobId(null); setSelectedEngineerId(null); setRegion("Все зоны");
      setDraft(current => ({ ...current, jobs: jobs.length || current.jobs, engineers: imported.engineers?.length || current.engineers, speedKmh: imported.speedKmh ?? current.speedKmh }));
      setImportStatus(`${file.name}: ${jobs.length ? `${jobs.length} заявок, координаты подтверждены ${verified}/${jobs.length}` : `${imported.engineers?.length ?? 0} инженеров`}${imported.warnings.length ? "; " + imported.warnings[0] : ""}.`);
    } catch (error) {
      setImportStatus(error instanceof Error ? `Ошибка: ${error.message}` : "Не удалось импортировать файл");
    }
  }, [baseJobs,baseEngineers,draft.speedKmh,started,simTime,invalidateFutureScenario,optimizing,replaceNotifications]);
  const toggleEngineerAvailability = useCallback(async (id:string) => {
    if (optimizing || scheduledLock.current) return;
    const time=Math.floor(simTime), engineer=activeEngineers.find(item=>item.id===id);
    if (!engineer) return;
    const current=started ? invalidateFutureScenario() : null;
    const ids=current?.unavailableIds ?? unavailableEngineerIds;
    const becomingUnavailable=!ids.includes(id);
    const next=becomingUnavailable ? [...ids,id] : ids.filter(item=>item!==id);
    const previous=current?.previous;
    const moment=previous ? engineerAbsenceMoment(previous,engineer,time) : null;
    if (previous) {
      if (!await runTemporalEvent({ type:"engineer_unavailable",time,id },previous.jobs,next,{ previous,previousEventTime:null })) return;
      setAvailabilityChanges(changes=>[...changes,{ engineerId:id,time:becomingUnavailable ? moment!.effectiveAt : time,unavailable:becomingUnavailable }]);
    }
    if (becomingUnavailable) {
      appendNotifications([{ kind:"left",time,title:`${engineer.name}: исключён из смены`,message:moment?.phase==="service" ? `Завершит №${moment.currentJobId} к ${minutesLabel(moment.effectiveAt)}, затем выйдет. Будущие заявки проверены для переназначения.` : "Будущие заявки проверены для передачи другим инженерам.",engineerIds:[id] }]);
      if (moment) setAbsenceMoments(moments=>({...moments,[id]:moment}));
    } else setAbsenceMoments(moments=>{ const updated={...moments};delete updated[id];return updated; });
    setUnavailableEngineerIds(next);setEditorUnavailableIds(next);setSelectedEngineerDetailsId(null);
    setAbsenceReasons(reasons=>{const updated={...reasons};delete updated[id];return updated;});
    setAbsenceNotices(notices=>notices.filter(item=>item.engineerId!==id));
  }, [optimizing,simTime,activeEngineers,started,invalidateFutureScenario,unavailableEngineerIds,runTemporalEvent,appendNotifications]);
  const reportEngineerUnavailable = useCallback(async () => {
    const id = engineerPersonaId;
    const reason = pendingEngineerAction;
    if (!id || !reason || optimizing || scheduledLock.current || playbackUnavailableIds.includes(id) || (absenceMoments[id]?.reportedAt ?? Infinity)<=simTime) return;
    const engineer = activeEngineers.find(item => item.id === id);
    if (!engineer) return;
    setPendingEngineerAction(null);
    setEngineerActionError("");
    const eventTime = Math.round(simTime);
    const current=started ? invalidateFutureScenario() : null;
    const next=[...(current?.unavailableIds ?? unavailableEngineerIds),id];
    let impact: AbsenceImpact = { reassigned: [], unassigned: [], preserved: [] };
    let moment: AbsenceMoment = { reportedAt: eventTime, effectiveAt: eventTime, phase: "idle", currentJobId: null, completedBefore: 0 };
    if (applied && planResult) {
      const previous=current!.previous;
      moment=engineerAbsenceMoment(previous,engineer,eventTime);
      const updated=await runTemporalEvent({ type:"engineer_unavailable",time:eventTime,id },previous.jobs,next,{ previous,previousEventTime:null });
      if (!updated) { setEngineerActionError("Перепланирование не выполнено. Проверьте сообщение об ошибке у диспетчера и повторите действие."); return; }
      impact = absenceImpact(previous, updated, id, eventTime, activeEngineers);
    }
    setUnavailableEngineerIds(next);
    if (applied && planResult) setAvailabilityChanges(current => [...current, { engineerId: id, time: moment.effectiveAt, unavailable: true }]);
    setEditorUnavailableIds(next);
    setAbsenceReasons(current => ({ ...current, [id]: reason }));
    setAbsenceMoments(current => ({ ...current, [id]: moment }));
    setAbsenceNotices(current => [...current, { engineerId: id, engineerName: engineer.name, reason, impact, moment }]);
    appendNotifications([{ kind: reason, time: moment.reportedAt, title: `${engineer.name}: ${reason === "emergency" ? "ЧС" : "выход из смены"}`, message: `${moment.phase === "service" ? `Завершит №${moment.currentJobId} к ${minutesLabel(moment.effectiveAt)}, затем выйдет из смены.` : `Вне смены с ${minutesLabel(moment.effectiveAt)}.`} Передано другим инженерам: ${impact.reassigned.length}. ${impact.unassigned.length ? `Нет доступной замены для №${impact.unassigned.join(", №")}.` : "Заявок без доступной замены нет."}`, engineerIds: [id] }]);
    setEngineerSelectedJobId(null);
  }, [engineerPersonaId, pendingEngineerAction, optimizing, unavailableEngineerIds, activeEngineers, simTime, playbackUnavailableIds, absenceMoments, started, invalidateFutureScenario, applied, planResult, runTemporalEvent, appendNotifications]);
  const toggleJobCancelled = useCallback(async (id: string) => {
    if (optimizing || scheduledLock.current) return;
    const wasCancelled = Boolean((started ? playbackResult.jobs : activeJobs).find(job=>job.id===id)?.cancelled);
    const time = Math.floor(simTime);
    if (!Number.isFinite(time)) { setDispatchNotice("Укажите корректное время события."); setJobActionNotice("Укажите корректное время события."); return; }
    const stop=started ? playbackResult.routes.flatMap(route=>route.stops).find(item=>item.jobId===id) : undefined;
    if (!wasCancelled && playbackResult.jobs.find(item=>item.id===id)?.executionStatus === "completed") {
      const message = `Заявка №${id} уже отмечена выполненной. Отменить её нельзя.`;
      setDispatchNotice(message); setJobActionNotice(message); return;
    }
    if (!wasCancelled && stop && time >= stop.start) {
      const message = time >= stop.end ? `Заявка №${id} уже выполнена к ${minutesLabel(time)}. Отменить её нельзя.` : `Заявка №${id} выполняется с ${minutesLabel(stop.start)}. Отменить её нельзя.`;
      setDispatchNotice(message); setJobActionNotice(message);
      return;
    }
    const current=started ? invalidateFutureScenario() : null;
    const flags=current?.flags ?? cancelledJobIds;
    const next=flags.includes(id) ? flags.filter(item=>item!==id) : [...flags,id];
    if (applied && current) {
      const jobs=current.previous.jobs.map(job=>job.id===id ? {...job,cancelled:!wasCancelled,executionStatus:"not_started" as const} : job);
      if (!await runTemporalEvent({type:wasCancelled ? "new_job" : "cancel_job",time,id},jobs,current.unavailableIds,{previous:current.previous,previousEventTime:null})) return;
      if (wasCancelled) setDispatchNotice(`Заявка №${id} восстановлена в ${minutesLabel(time)} и проверена для включения в оставшийся план.`);
    }
    appendNotifications(wasCancelled ? [{ kind: "restored", time, title: `Заявка №${id} восстановлена`, message: "Заявка возвращена для включения в план." }] : !applied || !planResult ? [{ kind: "cancelled", time, title: `Заявка №${id} отменена`, message: "Заявка исключена до построения плана." }] : []);
    setJobActionNotice("");
    setCancelledJobIds(next);
    setEditorJobs(current => current.map(job => job.id === id ? { ...job, cancelled: !wasCancelled } : job));
    setDetailsJobId(null);
  }, [cancelledJobIds, applied, planResult, activeJobs, playbackResult, started, invalidateFutureScenario, runTemporalEvent, simTime, optimizing, appendNotifications]);
  const titles = { plan: ["План работ", ""], generator: ["Генератор", ""], requests: ["Заявки", ""], team: ["Инженеры", ""], analytics: ["Аналитика", ""], editor: ["Редактор данных", ""], about: ["О решении", ""], engineer: ["Моя смена", ""] } as const; const distanceDataReady = baseJobs.every(job => job.geocodeVerified === true) && (applied?.jobs ?? 0) <= baseJobs.length && (applied?.engineers ?? 0) <= baseEngineers.length && extraJobs.every(job => job.geocodeVerified === true) && !matrixFallback; const distanceReady = started && result.comparison.commonAssigned > 0 && result.comparison.distanceDeltaPercent != null && distanceDataReady; const distanceWarning = !started ? "" : !distanceDataReady ? ((applied?.jobs ?? 0) > baseJobs.length || (applied?.engineers ?? 0) > baseEngineers.length ? "Синтетические точки не геокодированы." : baseJobs.some(job => job.geocodeVerified !== true) ? "Часть адресов не геокодирована." : extraJobs.some(job => job.geocodeVerified !== true) ? "Координаты новой заявки требуют подтверждения." : activeEngineers.some(engineer => engineer.transport === "Общественный транспорт") ? "Для общественного транспорта расписание рассчитывается оценочно." : "Использовано приближённое расстояние.") : "";
  const routingLabel = optimizing || routingState === "loading" ? "Строим маршруты" : matrixFallback ? "Матрица оценочная" : routingState === "ready" ? "Дорожный граф подключён" : routingState === "idle" ? "Ожидание запуска" : "Часть дорог недоступна";
  const unservedElevated = started && !optimizing ? result.jobs.filter(job => jobPriorityLevel(job) === 2 && !job.cancelled && job.executionStatus !== "completed" && !job.engineerId) : [];
  const metricCards = <section className="metric-grid"><article><div className="metric-head"><span className="metric-icon purple"><Wrench /></span><small>Назначено заявок</small><Badge className="metric-badge">{started ? `${result.metrics.unassigned} без маршрута` : "ожидание"}</Badge></div><strong>{result.metrics.assigned}<em>/ {result.metrics.total}</em></strong><p>Покрытие {result.metrics.total ? (result.metrics.assigned / result.metrics.total * 100).toFixed(1).replace(".", ",") : "0"}% · базовый {result.baseline.assigned}</p></article><article><div className="metric-head"><span className="metric-icon teal"><Route /></span><small>Пробег</small><Badge className="metric-badge good">{distanceReady && result.comparison.distanceDeltaPercent != null ? `${result.comparison.distanceDeltaPercent < 0 ? "−" : "+"}${Math.abs(result.comparison.distanceDeltaPercent).toFixed(1).replace(".", ",")}%` : "расчёт"}</Badge></div><strong>{result.metrics.distanceKm.toFixed(1).replace(".", ",")}<em> км</em></strong><p>базовый: {formatDistance(result.baseline.distanceKm)}</p></article><article><div className="metric-head"><span className="metric-icon orange"><UsersRound /></span><small>Активные инженеры</small><Badge className="metric-badge">{started ? "активно" : "ожидание"}</Badge></div><strong>{result.baseline.activeEngineers}<em> → {result.metrics.activeEngineers}</em></strong><p>из {activeEngineers.length-playbackUnavailableIds.length} доступных · {playbackUnavailableIds.length} вне смены</p></article><article><div className="metric-head"><span className="metric-icon blue"><Database /></span><small>Геокодирование</small><Badge className="metric-badge">{regions.length} зоны</Badge></div><strong>{baseJobs.filter(job => job.geocodeVerified).length}<em>/ {baseJobs.length}</em></strong><p>дом: {baseJobs.filter(job => job.geocodeQuality === "house").length} · улица: {baseJobs.filter(job => job.geocodeQuality === "street").length}</p></article></section>;
  const visibleJournalEntries=journalEntries.filter(entry=>!started || entry.time<=simTime);
  const unreadNotifications=visibleJournalEntries.filter(entry=>!journalReadIds.includes(entry.id)).length;
  const visibleReplanChanges=lastEventTime!==null && simTime<lastEventTime ? [] : replanChanges;
  const busy=optimizing || scheduledProcessing;
  if (!workspaceReady) return <main className="workspace-restoring" role="status">Восстанавливаем сохранённый сценарий…</main>;
  return <main className="app-shell">{mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`}>
      <div className="sidebar-brand-row"><Logo /><button className="mobile-nav-close" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)}><X /></button></div>
      {view === "engineer" ? <nav aria-label="Навигация инженера"><button className="nav-item active" onClick={() => navigate("engineer")}><Route /><span>Моя смена</span></button></nav> : <nav aria-label="Основная навигация"><button className={`nav-item${view === "plan" ? " active" : ""}`} onClick={() => navigate("plan")}><Route /><span>Планирование</span></button><button className={`nav-item${view === "generator" ? " active" : ""}`} onClick={() => navigate("generator")}><Sparkles /><span>Генератор</span></button><button className={`nav-item${view === "requests" ? " active" : ""}`} onClick={() => navigate("requests")}><Wrench /><span>Заявки</span><b>{plannedJobs.length}</b></button><button className={`nav-item${view === "team" ? " active" : ""}`} onClick={() => navigate("team")}><UsersRound /><span>Инженеры</span></button><button className={`nav-item${view === "analytics" ? " active" : ""}`} onClick={() => navigate("analytics")}><BarChart3 /><span>Аналитика</span></button><button className={`nav-item${view === "editor" ? " active" : ""}`} onClick={() => navigate("editor")}><Table2 /><span>Редактор данных</span>{editorDirty && <b>●</b>}</button><button className={`nav-item${view === "about" ? " active" : ""}`} onClick={() => navigate("about")}><Compass /><span>О решении</span></button></nav>}
      <div className="sidebar-bottom"><button className="nav-item theme-nav" onClick={() => setThemeOpen(open => !open)}><SunMoon /><span>Тема</span></button><button type="button" className="profile profile-switch" aria-label={view === "engineer" ? "Перейти в окно диспетчера" : "Перейти в окно инженера"} onClick={() => { if (view === "engineer") navigate("plan"); else { setEngineerPersonaId(current => current && activeEngineers.some(item => item.id === current) ? current : null); setEngineerSelectedJobId(null); navigate("engineer"); } }}><span>{view === "engineer" ? engineerPersona?.initials ?? "ИН" : "ДК"}</span><div><strong>{view === "engineer" ? engineerPersona?.name ?? "Инженер" : "Диспетчер"}</strong><small>{view === "engineer" ? "Открыть диспетчера" : "Открыть инженера"}</small></div><MoreHorizontal size={17} /></button></div>
    </aside><section className="workspace" id="plan"><header className="topbar"><button className="mobile-menu" aria-label="Открыть меню" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu /></button><div><h1>{titles[view][0]}</h1>{titles[view][1] ? <p>{titles[view][1]}</p> : null}</div><div className="top-actions"><button type="button" className={`journal-button${unreadNotifications ? " unread" : ""}`} aria-label={`Журнал уведомлений: ${visibleJournalEntries.length} записей, ${unreadNotifications} новых`} onClick={() => {setJournalReadIds(current=>[...new Set([...current,...visibleJournalEntries.map(entry=>entry.id)])]);setJournalOpen(true);}}><Bell size={18} /><span>Уведомления</span>{visibleJournalEntries.length > 0 && <b>{visibleJournalEntries.length}</b>}</button><button className="theme-button" onClick={() => setThemeOpen(open => !open)}><Contrast /><span>{themes.find(item => item.id === theme)?.name}</span><ChevronDown /></button></div></header>
    {workspaceStorageError && <p role="alert" className="workspace-storage-error">{workspaceStorageError}</p>}
    {themeOpen && <div className="theme-menu" role="menu">{themes.map(item => <button key={item.id} className={theme === item.id ? "active" : ""} onClick={() => { setTheme(item.id); setThemeOpen(false); }}><span className="theme-swatches">{item.colors.map(color => <i key={color} style={{ background: color }} />)}</span><b>{item.name}</b>{theme === item.id && <Check />}</button>)}</div>}
    {busy && <div className="calculation-notice" role="status" aria-live="polite"><LoaderCircle className="loading-spinner" size={18} /><span>Рассчитываем план…</span></div>}
    {view !== "engineer" && dispatchNotice && (lastEventTime===null || simTime>=lastEventTime) && <div className="impact-banner engineer-absence-notice" role="alert"><span><AlertTriangle /></span><div><strong>Уведомление диспетчеру</strong><p>{dispatchNotice}</p></div><button type="button" onClick={() => setDispatchNotice("")}>Скрыть</button></div>}
    {view !== "engineer" && absenceNotices.filter(notice=>notice.moment.reportedAt<=simTime).map(notice => <div key={notice.engineerId} className="impact-banner engineer-absence-notice" role="alert"><span><ShieldAlert /></span><div><strong>{notice.engineerName}: {notice.reason === "emergency" ? "сообщил о ЧС" : "вышел из смены"}</strong><p>Событие в {minutesLabel(notice.moment.reportedAt)} · {notice.moment.phase === "service" ? `завершит №${notice.moment.currentJobId} к ${minutesLabel(notice.moment.effectiveAt)} и выйдет` : `вне смены с ${minutesLabel(notice.moment.effectiveAt)}`} · выполнено до события: {notice.moment.completedBefore}.</p><p>Передано другим инженерам: {notice.impact.reassigned.length}{notice.impact.reassigned.length ? ` — ${notice.impact.reassigned.slice(0, 5).map(item => `№${item.jobId} → ${item.engineerName}`).join("; ")}` : ""}.</p>{notice.impact.reassigned.length > 5 && <details><summary>Показать остальные {notice.impact.reassigned.length - 5} назначений</summary><p>{notice.impact.reassigned.slice(5).map(item => `№${item.jobId} → ${item.engineerName}`).join("; ")}</p></details>}<p>{notice.impact.unassigned.length ? `Нет доступной замены для ${notice.impact.unassigned.map(id => `№${id}`).join(", ")}. Требуется решение диспетчера.` : "Все затронутые будущие задания получили назначение либо уже выполнялись."}</p></div><button type="button" onClick={() => setAbsenceNotices(current => current.filter(item => item.engineerId !== notice.engineerId))}>Скрыть</button></div>)}
    {view === "engineer" && <EngineerWorkspace engineer={engineerPersona} jobs={playbackResult.jobs} route={engineerPersona ? routeByEngineer.get(engineerPersona.id) : undefined} allEngineers={activeEngineers} unavailableIds={playbackUnavailableIds} absenceReasons={absenceReasons} absenceMoments={absenceMoments} cancellationNotices={cancellationNotices} selectedJobId={engineerSelectedJobId} onSelectEngineer={setEngineerPersonaId} onSelectJob={setEngineerSelectedJobId} onReport={setPendingEngineerAction} reporting={busy} error={engineerActionError} simTime={simTime} simEnd={simRange.end} simPlaying={simPlaying} simSpeed={playbackMinutesPerSecond} onSimTime={changeSimulationTime} onSimPlaying={setSimPlaying} onSimSpeed={setPlaybackMinutesPerSecond} speedKmh={applied?.speedKmh ?? draft.speedKmh} onRoutingState={updateRoutingState} />}
    {view === "plan" && <><div className="filter-row"><div className="region-select">{(["Все зоны", "Восток", "Юго-восток", "Югоцентр"] as const).map(item => <button key={item} className={region === item ? "selected" : ""} onClick={() => { setRegion(item); setSelectedEngineerId(null); setSelectedJobId(null); }}>{item}</button>)}</div><select aria-label="Инженер" className="engineer-quick-select" value={selectedEngineerId ?? ""} onChange={e => { const id = e.target.value; if (id) focusEngineer(id); else showAllRoutes(); }}><option value="">Все инженеры ({visibleEngineers.length})</option>{visibleEngineers.map(eng => <option key={eng.id} value={eng.id}>{eng.name} ({eng.id})</option>)}</select><div className="plan-state"><span className={routingState === "ready" ? "state-dot" : routingState === "loading" ? "state-dot changed" : routingState === "idle" ? "state-dot idle" : "state-dot risk-dot"} />{routingLabel}{started ? ` · ${solverLabels[solverEngine]}` : ""}</div><div className="plan-run-control"><button className="plan-run-button" disabled={busy || routingState === "loading" || !baseJobs.length || !baseEngineers.length} onClick={startPlanning}><span aria-hidden="true">{busy ? <LoaderCircle className="loading-spinner" /> : <Play />}</span>{busy ? "Рассчитываем план…" : routingState === "loading" ? "Строим дороги…" : started ? "Пересчитать маршруты" : "Построить маршруты"}</button><HelpHint label="Расчёт маршрутов">До начала смены распределяет оборудование и строит план. Во время смены пересчитывает оставшиеся задания на текущее время просмотра, сохраняя завершённые и начатые работы. Дождитесь окончания расчёта.</HelpHint></div><button disabled={busy} className="plain-button" style={{ border: "1px solid var(--border)", padding: "0 10px", borderRadius: "8px", height: "38px" }} onClick={() => setUrgentOpen(true)}><Zap size={14} /> Новая заявка</button>{started && <ExportButtons result={result} engineers={activeEngineers} solver={solverEngine} speedKmh={applied?.speedKmh ?? draft.speedKmh} />}</div>
      {!baseJobs.length && !baseEngineers.length && <div className="impact-banner"><span><Database /></span><div><strong>Набора данных нет</strong><p>Сгенерируйте заявки во вкладке «Генератор» или загрузите CSV / JSON. Новый набор полностью заменяет предыдущий.</p></div><button onClick={() => navigate("generator")}>Открыть генератор</button></div>}

      {solverError && <div className="impact-banner error-banner"><span><AlertTriangle /></span><div><strong>Не удалось выполнить действие</strong><p>{solverError}</p></div><button onClick={() => setSolverError("")}>Скрыть</button></div>}
      {unservedElevated.length > 0 && <div className="impact-banner error-banner" role="alert"><span><AlertTriangle /></span><div><strong>Повышенный приоритет: {unservedElevated.length} заявок без назначения</strong><p>№ {unservedElevated.slice(0, 8).map(job => job.id).join(", № ")}{unservedElevated.length > 8 ? "…" : ""}. Проверьте окна, инженеров и ресурсы в карточках; найденный план не выполнил все повышенные работы.</p></div></div>}
      {replanned && started && !solverError && (lastEventTime===null || simTime>=lastEventTime) && <div className="impact-banner"><span><Sparkles /></span><div><strong>{lastCalculationMethod === "cancel_local" ? "Заявка отменена у назначенного инженера" : lastCalculationMethod === "no_change" ? "Отмена без изменения маршрутов" : lastCalculationMethod === "insert" ? "Обычная заявка проверена для вставки в свободный интервал" : `OR-Tools VRPTW рассчитан за ${result.runtimeMs} мс`}</strong><p>{lastCalculationMethod === "cancel_local" ? "Инженер уведомлён; для него проверена подходящая замена. Расписание других инженеров сохранено." : lastCalculationMethod === "no_change" ? "Отменённая заявка не была назначена; повторная оптимизация не потребовалась." : lastCalculationMethod === "insert" ? "Прошедшие и согласованные работы не перестраивались; серверный solver для этой вставки не запускался." : `Назначено ${result.metrics.assigned} из ${result.metrics.total}; движок подтверждён ответом сервера.`}</p></div><button onClick={() => setReplanned(false)}>Скрыть уведомление</button></div>}
      {showReplanSummary && visibleReplanChanges.length > 0 && <section className="panel replan-compact" aria-label="Кратко об изменениях после перепланирования"><div><strong>Что изменилось после перепланирования</strong><p>{replanChanges.length} {changeWord(replanChanges.length)} · вынужденных событием: {replanChanges.filter(change => change.necessity === "required").length}. Подробности во вкладке «Аналитика».</p></div><button type="button" className="plain-button" onClick={() => navigate("analytics")}>Открыть аналитику</button><button type="button" className="plain-button" onClick={() => setShowReplanSummary(false)}>Скрыть</button></section>}
      <section className="content-grid assignment-layout">
        <article className="panel map-panel"><div className="panel-header map-panel-header"><div><h2>Карта маршрутов</h2><p>{visibleEngineers.length} инж. · {mapJobs.length} заявок · {region}{simulationOn ? ` · ${minutesLabel(simTime)}` : ""}</p></div><button type="button" className="show-all-routes-button" title="Снять выбор инженера и заявки, показать маршруты во всех зонах" aria-pressed={region === "Все зоны" && !selectedEngineerId && !selectedJobId} onClick={showAllRoutes}><Route size={16} />Все маршруты</button></div><div className="map-stage"><MapCanvas visibleJobs={mapJobs} baselineJobs={mapJobs} engineers={activeEngineers} selectedEngineerId={selectedEngineerId} selectedJobId={selectedJobId} simTime={simulationOn ? simTime : null} simPlaying={simPlaying} simSpeed={playbackMinutesPerSecond} carSpeedKmh={applied?.speedKmh ?? draft.speedKmh} simEnd={simRange.end} onSimTime={changeSimulationTime} onSimPlaying={setSimPlaying} compare={compare} routingEnabled={started && Boolean(planResult)} routes={playbackResult.routes} baselineRoutes={visibleBaselineRoutes} onSelectEngineer={selectEngineer} onShowAllRoutes={showAllRoutes} onSelectJob={selectJob} onInspectJob={inspectJob} onRoutingState={updateRoutingState} />{simulationOn && <TimeDrum start={simRange.start} end={simRange.end} time={simTime} playing={simPlaying} speed={playbackMinutesPerSecond} onTime={changeSimulationTime} onPlaying={setSimPlaying} onSpeed={setPlaybackMinutesPerSecond} disabled={busy} />}</div></article>
        <article className="panel routes-panel"><div className="panel-header"><div><h2>Заявки</h2></div></div><AssignmentBoard jobs={visibleJobs} engineers={activeEngineers} routes={playbackResult.routes} selectedJobId={selectedJobId} selectedEngineerId={selectedEngineerId} started={started} loading={busy} filtersActive={region !== "Все зоны" || selectedEngineerId !== null} resetVersion={filterResetVersion} onResetFilters={() => { showAllRoutes(); setFilterResetVersion(value => value + 1); }} onSelectJob={selectJob} onSelectEngineer={focusEngineer} onShowAll={() => { showAllRoutes(); setFilterResetVersion(value => value + 1); }} /></article>
      </section>
      {focusedEngineer && (
        <EngineerTimeline
          engineer={focusedEngineer}
          route={routeByEngineer.get(focusedEngineer.id)}
          jobs={playbackResult.jobs}
          simTime={simulationOn ? simTime : null}
          onSelectJob={selectJob}
          onClose={showAllRoutes}
        />
      )}
      <section className="panel queue-panel"><div className="panel-header"><div><h2>Ближайшие заявки</h2></div></div><JobTable started={started} jobs={plannedJobs.filter(job => !job.cancelled && (region === "Все зоны" || job.region === region))} engineers={activeEngineers} onOpen={selectJob} limit={12} /></section></>}
    {view === "requests" && <RequestsView started={started} jobs={plannedJobs} engineers={activeEngineers} onOpen={selectJob} onAdd={() => setUrgentOpen(true)} onImport={file => void handleImport(file)} importStatus={importStatus} />}
    {view === "team" && <EngineersView engineers={activeEngineers} jobs={plannedJobs} result={playbackResult} unavailableIds={playbackUnavailableIds} absenceReasons={absenceReasons} absenceMoments={absenceMoments} simTime={simTime} onOpenDetails={setSelectedEngineerDetailsId} onOpenRoute={openEngineerOnMap} />}
    {view === "analytics" && <AnalyticsView result={result} engineers={activeEngineers} distanceReady={distanceReady} distanceWarning={distanceWarning} estimated={!distanceDataReady} calculated={started} solver={solverEngine} speedKmh={applied?.speedKmh ?? draft.speedKmh} metrics={metricCards} travel={travel} replanChanges={visibleReplanChanges} />}
    {view === "generator" && (
      <GeneratorView
        draft={draft}
        setDraft={setDraft}
        generated={generated}
        generatedFrom={generatedFrom}
        generatedTz={generatedTz}
        onGenerate={createGenerated}
        onAddEvent={addGeneratedEvent} onRemoveEvent={removeGeneratedEvent} onRewindEvent={changeSimulationTime} plannedStarts={Object.fromEntries(playbackResult.routes.flatMap(route=>route.stops.map(stop=>[stop.jobId,stop.start])))} eventOutcomes={eventOutcomes} simTime={simTime} started={started} busy={optimizing || scheduledProcessing} preferences={generatorPreferences} onPreferences={setGeneratorPreferences} eventDraft={eventDraft} onEventDraft={setEventDraft}
        onClear={() => setClearOpen(true)}
        onDemo={() => { void handleImport(new File([JSON.stringify(demoScenario)], "demo-scenario.json", { type: "application/json" })); }}
        onPlan={() => {
          navigate("plan");
          if (!applied) startPlanning();
        }}
        onImportFile={handleImport}
        importStatus={importStatus}
        importedJobs={importedJobs}
        importedEngineers={importedEngineers}
      />
    )}
    {view === "editor" && <DataEditor jobs={editorJobs} engineers={editorEngineers} carSpeedKmh={applied?.speedKmh ?? draft.speedKmh} simTime={simulationOn ? simTime : null} stopsByJob={stopByJob} unavailableIds={editorUnavailableIds} dirty={editorDirty} optimizing={busy} error={editorError || solverError} onJobs={jobs => { setEditorJobs(jobs); setEditorDirty(true); setEditorError(""); }} onEngineers={engineers => { setEditorEngineers(engineers); setEditorDirty(true); setEditorError(""); }} onUnavailable={ids => { setEditorUnavailableIds(ids); setEditorDirty(true); }} onApply={applyEditedData} onReset={() => { setEditorJobs(activeJobs); setEditorEngineers(activeEngineers); setEditorUnavailableIds(unavailableEngineerIds); setEditorDirty(false); setEditorError(""); }} />}
    {view === "about" && <AboutSolutionView onOpenPlan={() => navigate("plan")} onOpenGenerator={() => navigate("generator")} />}</section>
  <Dialog open={clearOpen} onOpenChange={setClearOpen}><DialogContent><DialogHeader><DialogTitle>Удалить текущий сценарий?</DialogTitle><DialogDescription>Будут удалены текущие заявки, инженеры, события, рассчитанные маршруты, история перепланирования и несохранённые правки редактора. Это действие нельзя отменить. Затем можно создать или загрузить новый набор.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={()=>setClearOpen(false)}>Оставить сценарий</Button><Button variant="destructive" disabled={busy} onClick={()=>{ clearDataset(); setClearOpen(false); }}>Удалить сценарий</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={pendingEngineerAction !== null} onOpenChange={open => { if (!open) setPendingEngineerAction(null); }}><DialogContent><DialogHeader><DialogTitle>{pendingEngineerAction === "emergency" ? "Сообщить о ЧС?" : "Выйти с работы?"}</DialogTitle><DialogDescription>{engineerPersona?.name}: событие в {minutesLabel(Math.round(simTime))}. Если заявка выполняется, инженер завершит её и затем выйдет. При поездке или ожидании следующая заявка перейдёт в перепланирование. Уже выполненные заявки сохранятся. Если замена не найдётся, диспетчер увидит заявки без назначения.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPendingEngineerAction(null)}>Отмена</Button><Button onClick={() => void reportEngineerUnavailable()}>{pendingEngineerAction === "emergency" ? "Подтвердить ЧС" : "Подтвердить выход"}</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={urgentOpen} onOpenChange={setUrgentOpen}><DialogContent className="urgent-dialog"><DialogHeader><DialogTitle>Новая заявка</DialogTitle></DialogHeader><div className="urgent-form">
    <label className="wide"><span>Адрес</span><Input value={urgentForm.address} onChange={event => setUrgentForm(value => ({ ...value, address: event.target.value }))} placeholder="Москва, ул. Люблинская, 72" /></label>
    <label><span>Долгота, если адрес не найден</span><Input inputMode="decimal" value={urgentForm.longitude} onChange={event => setUrgentForm(value => ({ ...value, longitude: event.target.value }))} placeholder="37.62" /></label>
    <label><span>Широта, если адрес не найден</span><Input inputMode="decimal" value={urgentForm.latitude} onChange={event => setUrgentForm(value => ({ ...value, latitude: event.target.value }))} placeholder="55.75" /></label>
    <label><span>Регион</span><select value={urgentForm.region} onChange={event => setUrgentForm(value => ({ ...value, region: event.target.value as Region }))}><option>Восток</option><option>Юго-восток</option><option>Югоцентр</option></select></label>
    <label><span>Навык</span><select value={selectedUrgentSkill} onChange={event => setUrgentForm(value => ({ ...value, kind: event.target.value }))}>{urgentSkills.map(skill => <option key={skill}>{skill}</option>)}</select></label>
    <label><span>Начало окна</span><Input type="time" value={urgentForm.start} onChange={event => setUrgentForm(value => ({ ...value, start: event.target.value }))} /></label><label><span>Окончание окна</span><Input type="time" value={urgentForm.end} onChange={event => setUrgentForm(value => ({ ...value, end: event.target.value }))} /></label>
    <label><span>Требуемый транспорт</span><select value={urgentForm.transport} onChange={event => setUrgentForm(value => ({ ...value, transport: event.target.value }))}><option value="">Не ограничен</option><option>Автомобиль</option><option>Общественный транспорт</option><option>Велосипед</option><option>Пешком</option></select></label>
    <label><span>Приоритет</span><select value={urgentForm.urgency} onChange={event => setUrgentForm(value => ({ ...value, urgency: event.target.value as "normal" | "urgent" }))}><option value="urgent">Повышенный</option><option value="normal">Обычный</option></select></label>
  </div>{formError && <p className="form-error">{formError}</p>}<DialogFooter><Button variant="outline" onClick={() => setUrgentOpen(false)}>Отмена</Button><Button disabled={busy} onClick={() => void addUrgent()}><Zap />{started ? "Добавить и пересчитать" : "Добавить заявку"}</Button></DialogFooter></DialogContent></Dialog>
<EngineerDetailsDialog engineer={detailsEngineer} route={detailsEngineer ? routeByEngineer.get(detailsEngineer.id) : undefined} unavailable={Boolean(detailsEngineer && playbackUnavailableIds.includes(detailsEngineer.id) && (!absenceMoments[detailsEngineer.id] || simTime >= absenceMoments[detailsEngineer.id].effectiveAt))} onClose={() => setSelectedEngineerDetailsId(null)} onOpenRoute={openEngineerOnMap} onToggleAvailability={toggleEngineerAvailability} />
    <NotificationJournal entries={visibleJournalEntries} open={journalOpen} onOpenChange={setJournalOpen} storageError={journalStorageError} />
    <JobDetailsDialog job={detailsJobRaw} executionStatus={detailsJob?.executionStatus} engineer={selectedEngineer} plan={detailsJob?.engineerId ? routeByEngineer.get(detailsJob.engineerId) : undefined} started={started} loading={busy} actionNotice={jobActionNotice} onClose={() => { setDetailsJobId(null); setJobActionNotice(""); }} onShowOnMap={id => { const job = result.jobs.find(item => item.id === id); if (job) setRegion(job.region); setSelectedJobId(id); setSelectedEngineerId(job?.engineerId ?? null); setDetailsJobId(null); setView("plan"); }} onToggleCancelled={toggleJobCancelled} /></main>;
}
