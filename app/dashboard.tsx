"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Bell, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Contrast, Database, Layers3, MapPin, Menu, MoreHorizontal, Play, Plus, Route, Search, Sparkles, SunMoon, UsersRound, Wrench, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { MapCanvas, actionAtSimTime, actionCopy, type RoutingState } from "@/components/map-canvas";
import { TimeDrum } from "@/components/time-drum";
import { BackendGeocodingProvider, type Coordinate } from "@/lib/map-providers";
import { loadRoadTravel } from "@/lib/road-travel";
import { csvEngineers, csvJobs, csvMeta } from "@/lib/csv-data.generated";
import { applyAverageWindows, idleOptimization, minutesLabel, optimizeVrptw, reoptimizeUrgent, scaleEngineers, scaleJobs, type Engineer, type Job, type OptimizationResult, type Region, type RoutePlan, type TravelMatrix } from "@/lib/vrptw";

type ThemeId = "light" | "dark" | "beeline" | "ocean" | "graphite" | "contrast";
type ViewId = "plan" | "requests" | "team" | "analytics";
type PlanConfig = { engineers: number; jobs: number; speedKmh: number; windowMinutes: number };
const sourceJobs = csvJobs as Job[];
const sourceEngineers = csvEngineers as Engineer[];
const defaultConfig: PlanConfig = { engineers: sourceEngineers.length, jobs: sourceJobs.length, speedKmh: 32, windowMinutes: 240 };

function composePlanJobs(count: number, windowMinutes: number, extras: Job[]) {
  return [...applyAverageWindows(scaleJobs(sourceJobs, count), windowMinutes), ...extras];
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

function JobTable({ jobs, engineers, onOpen, limit }: { jobs: Job[]; engineers: Engineer[]; onOpen: (id: string) => void; limit?: number }) { return <div className="job-table"><div className="job-row table-head"><span>Время</span><span>Заявка</span><span>Адрес</span><span>Инженер</span><span>Статус SLA</span><span /></div>{jobs.slice(0, limit ?? jobs.length).map(job => { const engineer = engineers.find(item => item.id === job.engineerId); return <button className="job-row job-row-button" key={job.id} onClick={() => onOpen(job.id)}><span className="job-time">{job.time}</span><span><i className={`job-tone ${job.tone}`} /><b>№ {job.id}</b><small>{job.kind}</small></span><span><b>{job.area}</b><small>{job.address}</small></span><span className="assigned">{engineer ? <><i style={{ background: engineer.color }}>{engineer.initials}</i><b>{engineer.name}</b></> : <b>Не назначена</b>}</span><span><Badge className={job.risk ? "sla risk" : "sla"}>{job.risk ? <AlertTriangle /> : <Clock3 />}{job.risk ? "Нет маршрута" : "В окне"}</Badge></span><span className="row-location"><MapPin /></span></button>; })}</div>; }
function RequestsView({ jobs, engineers, onOpen, onAdd }: { jobs: Job[]; engineers: Engineer[]; onOpen: (id: string) => void; onAdd: () => void }) { const unassigned = jobs.filter(job => !job.engineerId).length; return <section className="page-view"><div className="view-summary"><article><span>Из CSV и формы</span><strong>{jobs.length}</strong><small>заявок в текущем плане</small></article><article><span>Назначено VRPTW</span><strong>{jobs.length - unassigned}</strong><small>{jobs.length ? ((jobs.length - unassigned) / jobs.length * 100).toFixed(1) : "0.0"}% плана</small></article><article><span>Без назначения</span><strong>{unassigned}</strong><small>нет допустимого окна или ресурса</small></article></div><section className="panel queue-panel full-table"><div className="panel-header"><div><h2>Все заявки</h2><p>Источник CSV · три региона</p></div><button className="plain-button" onClick={onAdd}><Plus />Добавить заявку</button></div><JobTable jobs={jobs} engineers={engineers} onOpen={onOpen} limit={250} /></section></section>; }
function EngineersView({ engineers, result, onOpen }: { engineers: Engineer[]; result: OptimizationResult; onOpen: (id: string) => void }) { const plans = new Map(result.routes.map(route => [route.engineerId, route])); const active = result.routes.length; const avg = active ? Math.round(result.routes.reduce((sum, route) => sum + route.load, 0) / active) : 0; const shown = engineers.slice(0, 48); return <section className="page-view"><div className="view-summary"><article><span>Доступно</span><strong>{engineers.length}</strong><small>бригад в текущем запуске</small></article><article><span>На маршрутах</span><strong>{active}</strong><small>имеют назначенные работы</small></article><article><span>Средняя загрузка</span><strong>{avg}%</strong><small>по длительности смены</small></article></div>{engineers.length > shown.length && <p className="list-cap">На экране {shown.length} из {engineers.length} инженеров</p>}<div className="engineer-card-grid">{shown.map(engineer => { const route = plans.get(engineer.id); return <button key={engineer.id} className="engineer-card" onClick={() => onOpen(engineer.id)}><div className="engineer-card-head"><span className="avatar large" style={{ background: `${engineer.color}18`, color: engineer.color }}>{engineer.initials}</span><div><strong>{engineer.name}</strong><small>{engineer.region} · {engineer.route}</small></div><b style={{ color: engineer.color }}>{route?.load ?? 0}%</b></div><Progress value={route?.load ?? 0} className="load-progress" style={{ ["--primary" as string]: engineer.color }} /><div className="engineer-card-meta"><span><b>{route?.stops.length ?? 0}</b> заявок</span><span><b>{formatDistance(route?.distanceKm ?? 0)}</b></span><span><b>{engineer.skills.length}</b> навыков</span></div><small className="open-route">Открыть маршрут на карте</small></button>; })}</div></section>; }
function AnalyticsView({ result }: { result: OptimizationResult }) { const saved = result.baseline.distanceKm ? Math.round((1 - result.metrics.distanceKm / result.baseline.distanceKm) * 100) : 0; const maxJobs = Math.max(1, ...result.zones.map(item => item.jobs)); return <section className="page-view"><div className="view-summary"><article><span>SLA вовремя</span><strong>{result.metrics.slaPercent}%</strong><small>{result.metrics.late} опозданий</small></article><article><span>Изменение пробега</span><strong>{saved > 0 ? "−" : "+"}{Math.abs(saved)}%</strong><small>{formatDistance(Math.abs(result.baseline.distanceKm - result.metrics.distanceKm))}</small></article><article><span>Назначено</span><strong>{result.metrics.assigned}/{result.metrics.total}</strong><small>VRPTW за {result.runtimeMs} мс</small></article></div><div className="analytics-grid"><article className="panel analytics-panel"><div className="panel-header"><div><h2>Заявки по зонам</h2><p>Пересчитывается из CSV и срочных заявок</p></div></div><div className="zone-chart">{result.zones.map(zone => <div key={zone.name}><span>{zone.name}</span><div><i style={{ width: `${zone.jobs / maxJobs * 100}%` }} /></div><strong>{zone.jobs}</strong></div>)}</div></article><article className="panel analytics-panel"><div className="panel-header"><div><h2>SLA по зонам</h2><p>Доля допустимых назначений</p></div></div><div className="sla-chart">{result.zones.map(zone => <div key={zone.name}><div className="sla-ring" style={{ ["--value" as string]: `${zone.sla * 3.6}deg` }}><strong>{zone.sla}%</strong></div><span>{zone.name}</span></div>)}</div></article><article className="panel analytics-panel wide"><div className="panel-header"><div><h2>Пробег: исходный и VRPTW</h2><p>Контрольное распределение сравнивается с текущим планом</p></div></div><div className="distance-bars">{result.zones.map(zone => { const ratio = zone.baselineDistance ? Math.min(100, zone.distance / zone.baselineDistance * 100) : 0; return <div key={zone.name}><span>{zone.name}</span><div className="distance-track"><i className="baseline" style={{ width: "100%" }} /><i className="optimized" style={{ width: `${ratio}%` }} /></div><strong>{formatDistance(zone.distance)}</strong></div>; })}</div><div className="analytics-legend"><span><i className="baseline" />Контрольное распределение</span><span><i className="optimized" />VRPTW-план</span></div></article></div></section>; }

function JobDetailsDialog({ job, engineer, plan, jobs, onClose }: { job: Job | null; engineer?: Engineer; plan?: RoutePlan; jobs: Job[]; onClose: () => void }) {
  const byId = useMemo(() => new Map(jobs.map(item => [item.id, item])), [jobs]);
  return <Dialog open={Boolean(job)} onOpenChange={open => !open && onClose()}>
    <DialogContent className="explain-dialog job-inspect-dialog">
      <DialogHeader>
        <DialogTitle>Заявка № {job?.id}</DialogTitle>
        <DialogDescription>{job?.kind} · {job?.area} · {job?.address}</DialogDescription>
      </DialogHeader>
      {job && <>
        <div className="dialog-grid">
          <label><span>Тип работы</span><b>{job.kind}</b></label>
          <label><span>Приоритет</span><b>{job.priority > 1 ? "P1 срочная" : "P2"}</b></label>
          <label className="wide"><span>Адрес</span><b>{job.address}</b></label>
          <label><span>Окно SLA</span><b>{job.time}</b></label>
          <label><span>Норматив</span><b>{job.serviceMinutes} мин</b></label>
          <label><span>Навык</span><b>{job.kind}</b></label>
          <label><span>Оборудование</span><b>{job.equipment}</b></label>
          <label><span>Транспорт</span><b>{job.requiredTransport}</b></label>
          <label><span>Источник</span><b>{job.source}</b></label>
        </div>
        {engineer && plan ? <>
          <div className="decision-score"><span><Sparkles /></span><div><b>{engineer.name}</b><p>Назначение VRPTW · {engineer.region}</p></div><strong>{plan.stops.findIndex(stop => stop.jobId === job.id) + 1}/{plan.stops.length}</strong></div>
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
        </> : <div className="dialog-note"><AlertTriangle /><span><b>Нет допустимого назначения</b>Не совпали навык, ресурс или свободное время в окне.</span></div>}
      </>}
      <DialogFooter><Button onClick={onClose}>Закрыть</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function Dashboard() {
  const [view, setView] = useState<ViewId>("plan"); const [region, setRegion] = useState<"Все зоны" | Region>("Все зоны"); const [compare, setCompare] = useState(false); const [replanned, setReplanned] = useState(false); const [urgentOpen, setUrgentOpen] = useState(false); const [mobileNavOpen, setMobileNavOpen] = useState(false); const [selectedJobId, setSelectedJobId] = useState<string | null>(null); const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null); const [simTime, setSimTime] = useState(480); const [simPlaying, setSimPlaying] = useState(false); const [playbackMinutesPerSecond, setPlaybackMinutesPerSecond] = useState(1); const [theme, setTheme] = useState<ThemeId>("light"); const [themeOpen, setThemeOpen] = useState(false); const [routingState, setRoutingState] = useState<RoutingState>("idle"); const [extraJobs, setExtraJobs] = useState<Job[]>([]); const [optimizing, setOptimizing] = useState(false); const [formError, setFormError] = useState(""); const [planResult, setPlanResult] = useState<OptimizationResult | null>(null); const [travel, setTravel] = useState<TravelMatrix | undefined>(undefined); const [matrixFallback, setMatrixFallback] = useState(false);
  const [draft, setDraft] = useState<PlanConfig>(defaultConfig); const [applied, setApplied] = useState<PlanConfig | null>(null);
  const [urgentForm, setUrgentForm] = useState({ address: "", region: "Юго-восток" as Region, start: "13:00", end: "14:30", kind: "Авария", equipment: "Рефлектометр", transport: "Автомобиль" });
  const started = Boolean(applied);
  const activeEngineers = useMemo(() => applied ? scaleEngineers(sourceEngineers, applied.engineers) : sourceEngineers, [applied]);
  const activeJobs = useMemo(() => applied ? composePlanJobs(applied.jobs, applied.windowMinutes, extraJobs) : [...applyAverageWindows(sourceJobs, draft.windowMinutes), ...extraJobs], [applied, extraJobs, draft.windowMinutes]);
  const result = planResult ?? idleOptimization(sourceEngineers, activeJobs);
  const plannedJobs = result.jobs; const visibleJobs = useMemo(() => plannedJobs.filter(job => region === "Все зоны" || job.region === region), [plannedJobs, region]); const baselineJobs = useMemo(() => activeJobs.filter(job => region === "Все зоны" || job.region === region), [activeJobs, region]); const selectedJob = plannedJobs.find(job => job.id === selectedJobId) ?? null; const selectedEngineer = activeEngineers.find(item => item.id === selectedJob?.engineerId); const routeByEngineer = useMemo(() => new Map(result.routes.map(route => [route.engineerId, route])), [result.routes]); const visibleEngineers = useMemo(() => activeEngineers.filter(engineer => region === "Все зоны" || engineer.region === region), [activeEngineers, region]);
  const simRange = useMemo(() => {
    const pool = visibleEngineers.length ? visibleEngineers : activeEngineers;
    const start = pool.reduce((min, item) => Math.min(min, item.shiftStart), 480);
    const fromRoutes = result.routes.reduce((max, route) => Math.max(max, route.stops[route.stops.length - 1]?.end ?? 0), 0);
    const end = Math.max(fromRoutes, pool.reduce((max, item) => Math.max(max, item.shiftEnd), 1320));
    return { start, end };
  }, [visibleEngineers, activeEngineers, result.routes]);
  const simulationOn = started && Boolean(planResult);
  useEffect(() => {
    if (!simulationOn) { setSimPlaying(false); return; }
    setSimTime(current => Math.min(simRange.end, Math.max(simRange.start, current)));
  }, [simulationOn, simRange.start, simRange.end]);
  useEffect(() => { const saved = window.localStorage.getItem("fieldflow-theme") as ThemeId | null; if (saved && themes.some(item => item.id === saved)) { // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved); } }, []); useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("fieldflow-theme", theme); }, [theme]);
  const selectEngineer = useCallback((id: string) => { setSelectedEngineerId(current => current === id ? null : id); setSelectedJobId(null); }, []); const selectJob = useCallback((id: string) => { setSelectedJobId(id); setSelectedEngineerId(plannedJobs.find(item => item.id === id)?.engineerId ?? null); }, [plannedJobs]); const updateRoutingState = useCallback((state: RoutingState) => setRoutingState(state), []); const navigate = useCallback((next: ViewId) => { setView(next); setMobileNavOpen(false); }, []);
  const focusEngineer = useCallback((id: string) => { setSelectedEngineerId(id); setSelectedJobId(null); setView("plan"); }, []);
  const inspectJob = useCallback((id: string) => { setSelectedJobId(id); }, []);
  const openEngineerOnMap = focusEngineer;
  const runOptimize = useCallback(async (engineers: Engineer[], jobs: Job[], speedKmh: number, urgentId?: string) => {
    setOptimizing(true);
    setRoutingState("loading");
    let nextTravel = travel;
    try {
      const urgentJob = urgentId ? jobs.find(job => job.id === urgentId) : undefined;
      const loaded = await loadRoadTravel(engineers, jobs, speedKmh, urgentJob && travel ? { region: urgentJob.region, previous: travel } : undefined);
      nextTravel = loaded.travel;
      setTravel(loaded.travel);
      setMatrixFallback(loaded.provider === "fallback");
    } catch {
      nextTravel = undefined;
      setMatrixFallback(true);
    }
    const optimized = urgentId
      ? reoptimizeUrgent(engineers, jobs, urgentId, { speedKmh, travel: nextTravel, innerBudget: 160, zoneBudget: 320 })
      : optimizeVrptw(engineers, jobs, { speedKmh, travel: nextTravel });
    setPlanResult(optimized);
    setReplanned(true);
    setCompare(true);
    setOptimizing(false);
  }, [travel]);
  const startPlanning = useCallback(() => {
    const config = { ...draft };
    setApplied(config);
    const engineers = scaleEngineers(sourceEngineers, config.engineers);
    const jobs = composePlanJobs(config.jobs, config.windowMinutes, extraJobs);
    void runOptimize(engineers, jobs, config.speedKmh);
  }, [draft, extraJobs, runOptimize]);
  const addUrgent = useCallback(async () => { setFormError(""); if (!urgentForm.address.trim()) { setFormError("Укажите адрес заявки"); return; } const start = Number(urgentForm.start.slice(0, 2)) * 60 + Number(urgentForm.start.slice(3)); const end = Number(urgentForm.end.slice(0, 2)) * 60 + Number(urgentForm.end.slice(3)); if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { setFormError("Проверьте временное окно"); return; } let coordinates = regionCenters[urgentForm.region]; try { coordinates = await new BackendGeocodingProvider("nominatim").geocode(urgentForm.address) ?? coordinates; } catch { /* fallback */ } const id = `URG-${Date.now().toString().slice(-6)}`; const job: Job = { id, time: `${urgentForm.start}–${urgentForm.end}`, windowStart: start, windowEnd: end, area: urgentForm.region, address: urgentForm.address, kind: urgentForm.kind, tone: "amber", region: urgentForm.region, engineerId: null, baselineEngineerId: null, coordinates, risk: false, equipment: urgentForm.equipment, requiredTransport: urgentForm.transport, priority: 10, serviceMinutes: 60, source: "Срочная форма", status: "Новая" }; const nextExtras = [...extraJobs, job]; setExtraJobs(nextExtras); setUrgentOpen(false); setSelectedJobId(id); setUrgentForm(current => ({ ...current, address: "" })); if (applied) { const engineers = scaleEngineers(sourceEngineers, applied.engineers); const merged = composePlanJobs(applied.jobs, applied.windowMinutes, nextExtras).map(item => planResult?.jobs.find(prev => prev.id === item.id) ?? item); void runOptimize(engineers, merged, applied.speedKmh, job.id); } }, [urgentForm, applied, extraJobs, planResult, runOptimize]);
  const titles = { plan: ["План работ", started ? "17 августа 2026 · VRPTW по трём регионам" : "Задайте параметры справа и запустите построение маршрутов"], requests: ["Заявки", "CSV и срочные работы"], team: ["Инженеры", "Ресурсы и рассчитанная загрузка"], analytics: ["Аналитика", "Показатели текущего VRPTW-плана"] } as const; const saving = result.baseline.distanceKm ? Math.round((1 - result.metrics.distanceKm / result.baseline.distanceKm) * 100) : 0;
  const heavyRun = draft.engineers > 500 || draft.jobs > 500 || draft.engineers * draft.jobs > 150000;
  const routingLabel = optimizing || routingState === "loading" ? "Строим маршруты" : matrixFallback ? "Резервный режим" : routingState === "ready" ? "OSRM подключён" : routingState === "idle" ? "Ожидание запуска" : "Резервный режим";
  return <main className="app-shell">{mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} />}<aside className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`}><div className="sidebar-brand-row"><Logo /><button className="mobile-nav-close" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)}><X /></button></div><nav aria-label="Основная навигация"><button className={`nav-item${view === "plan" ? " active" : ""}`} onClick={() => navigate("plan")}><Route /><span>Планирование</span></button><button className={`nav-item${view === "requests" ? " active" : ""}`} onClick={() => navigate("requests")}><Wrench /><span>Заявки</span><b>{plannedJobs.length}</b></button><button className={`nav-item${view === "team" ? " active" : ""}`} onClick={() => navigate("team")}><UsersRound /><span>Инженеры</span></button><button className={`nav-item${view === "analytics" ? " active" : ""}`} onClick={() => navigate("analytics")}><BarChart3 /><span>Аналитика</span></button></nav><div className="sidebar-bottom"><button className="nav-item theme-nav" onClick={() => setThemeOpen(open => !open)}><SunMoon /><span>Тема</span></button><button className="nav-item"><CircleHelp /><span>Помощь</span></button><div className="profile"><span>ДК</span><div><strong>Диспетчер</strong><small>В сети</small></div><MoreHorizontal size={17} /></div></div></aside><section className="workspace" id="plan"><header className="topbar"><button className="mobile-menu" aria-label="Открыть меню" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu /></button><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div><div className="top-actions"><button className="theme-button" onClick={() => setThemeOpen(open => !open)}><Contrast /><span>{themes.find(item => item.id === theme)?.name}</span><ChevronDown /></button><button className="search"><Search /><span>Найти заявку</span><kbd>⌘ K</kbd></button><button className="icon-button" aria-label="Уведомления"><Bell /><i /></button><Button className="urgent-button" onClick={() => setUrgentOpen(true)}><Zap />Срочная заявка</Button></div></header>
    {themeOpen && <div className="theme-menu" role="menu">{themes.map(item => <button key={item.id} className={theme === item.id ? "active" : ""} onClick={() => { setTheme(item.id); setThemeOpen(false); }}><span className="theme-swatches">{item.colors.map(color => <i key={color} style={{ background: color }} />)}</span><b>{item.name}</b>{theme === item.id && <Check />}</button>)}</div>}
    {view === "plan" && <><div className="filter-row"><Tabs defaultValue="day"><TabsList><TabsTrigger value="day">День</TabsTrigger><TabsTrigger value="week">Неделя</TabsTrigger></TabsList></Tabs><button className="date-control"><CalendarDays />17 авг. 2026<ChevronDown /></button><div className="region-select">{(["Все зоны", "Восток", "Юго-восток", "Югоцентр"] as const).map(item => <button key={item} className={region === item ? "selected" : ""} onClick={() => { setRegion(item); setSelectedEngineerId(null); setSelectedJobId(null); }}>{item}</button>)}</div><div className="plan-state"><span className={routingState === "ready" ? "state-dot" : routingState === "loading" ? "state-dot changed" : routingState === "idle" ? "state-dot idle" : "state-dot risk-dot"} />{routingLabel}</div></div>
      {replanned && started && <div className="impact-banner"><span><Sparkles /></span><div><strong>VRPTW-план рассчитан за {result.runtimeMs} мс</strong><p>Назначено {result.metrics.assigned} из {result.metrics.total}; временные окна и ресурсы проверены.</p></div><button onClick={() => { setReplanned(false); setCompare(false); }}>Скрыть сравнение</button></div>}
      <section className="metric-grid"><article><div className="metric-head"><span className="metric-icon purple"><Wrench /></span><small>Назначено</small><Badge className="metric-badge">{started ? `${result.metrics.unassigned} без маршрута` : "не запущено"}</Badge></div><strong>{result.metrics.assigned}<em>/ {result.metrics.total}</em></strong><p>{started ? "из CSV и срочных заявок" : "после запуска алгоритма"}</p></article><article><div className="metric-head"><span className="metric-icon teal"><Route /></span><small>Пробег VRPTW</small><Badge className="metric-badge good">{started ? `${saving > 0 ? "−" : "+"}${Math.abs(saving)}%` : "ожидание"}</Badge></div><strong>{result.metrics.distanceKm.toFixed(1).replace(".", ",")}<em> км</em></strong><p>исходный: {formatDistance(result.baseline.distanceKm)}</p></article><article><div className="metric-head"><span className="metric-icon orange"><Clock3 /></span><small>SLA вовремя</small><Badge className="metric-badge good">{started ? `${result.metrics.late} опозданий` : "ожидание"}</Badge></div><strong>{result.metrics.slaPercent}%</strong><p>жёсткие временные окна</p></article><article><div className="metric-head"><span className="metric-icon blue"><Database /></span><small>Данные CSV</small><Badge className="metric-badge">{csvMeta.regions.length} зоны</Badge></div><strong>{csvMeta.rows}<em> строк</em></strong><p>{sourceEngineers.length} бригад из контроля</p></article></section>
      <section className="content-grid"><article className="panel map-panel"><div className="panel-header"><div><h2>Маршруты</h2><p>{visibleEngineers.length} инженеров · {visibleJobs.length} заявок · {region}{simulationOn ? ` · ${minutesLabel(simTime)}` : ""}</p></div><div className="legend"><span><i className="legend-solid" />VRPTW</span><span><i className="legend-dash" />Исходный</span><button className={compare ? "active" : ""} disabled={!started} onClick={() => setCompare(value => !value)}><Layers3 />{compare ? "Скрыть сравнение" : "Сравнить"}</button></div></div><div className="map-stage"><MapCanvas visibleJobs={visibleJobs} baselineJobs={baselineJobs} engineers={activeEngineers} selectedEngineerId={selectedEngineerId} selectedJobId={selectedJobId} simTime={simulationOn ? simTime : null} simPlaying={simPlaying} simSpeed={playbackMinutesPerSecond} simEnd={simRange.end} onSimTime={setSimTime} onSimPlaying={setSimPlaying} compare={compare} routingEnabled={started && Boolean(planResult)} routes={result.routes} onSelectEngineer={selectEngineer} onSelectJob={selectJob} onInspectJob={inspectJob} onRoutingState={updateRoutingState} />{simulationOn && <TimeDrum start={simRange.start} end={simRange.end} time={simTime} playing={simPlaying} speed={playbackMinutesPerSecond} onTime={setSimTime} onPlaying={setSimPlaying} onSpeed={setPlaybackMinutesPerSecond} disabled={optimizing} />}</div></article><article className="panel routes-panel"><div className="panel-header"><div><h2>Конфигурация</h2><p>{started ? "Выделите инженера — карта не останавливает остальных" : "Перед построением дорог"}</p></div>{started && <button className="plain-button" onClick={() => { setSelectedEngineerId(null); setSelectedJobId(null); }}>Все</button>}</div><div className="config-body"><ConfigNumberField label="Инженеры" hint={`В CSV ${sourceEngineers.length}. Свыше — синтетические копии. Shift — без привязки.`} value={draft.engineers} onChange={value => setDraft(current => ({ ...current, engineers: value }))} sliderMax={500} snapStep={50} suffix="чел." /><ConfigNumberField label="Заявки" hint={`В CSV ${sourceJobs.length}. Свыше — синтетические копии. Shift — без привязки.`} value={draft.jobs} onChange={value => setDraft(current => ({ ...current, jobs: value }))} sliderMax={500} snapStep={50} suffix="шт." /><ConfigNumberField label="Среднее окно заявки" hint="Не норматив работ, а SLA. В CSV слоты по 2 ч. Шире — заявки пересекаются, алгоритм выбирает порядок визитов." value={draft.windowMinutes} onChange={value => setDraft(current => ({ ...current, windowMinutes: value }))} sliderMin={60} sliderMax={480} inputMin={60} inputMax={840} snapStep={30} suffix="мин" /><ConfigNumberField label="Средняя скорость" hint="Влияет на оценку времени в пути. Shift — без привязки." value={draft.speedKmh} onChange={value => setDraft(current => ({ ...current, speedKmh: value }))} sliderMin={10} sliderMax={80} inputMin={5} inputMax={200} snapStep={10} suffix="км/ч" />{heavyRun && <p className="config-warning">Большой объём: расчёт и построение дорог могут занять заметное время.</p>}<button className="optimize-button start-run-button" disabled={optimizing || routingState === "loading"} onClick={startPlanning}><Play />{optimizing ? "Считаем…" : routingState === "loading" ? "Строим дороги…" : started ? "Пересчитать и построить дороги" : "Построить маршруты"}<span>OSRM</span></button></div>{started && <div className="engineer-list">{visibleEngineers.slice(0, 12).map(engineer => { const route = routeByEngineer.get(engineer.id); const action = simulationOn ? actionAtSimTime(engineer, route ?? null, simTime) : null; return <button className={`engineer${selectedEngineerId === engineer.id ? " selected" : ""}`} key={engineer.id} onClick={() => focusEngineer(engineer.id)} aria-label={`Показать на карте ${engineer.name}`}><div className="avatar" style={{ background: `${engineer.color}18`, color: engineer.color }}>{engineer.initials}</div><div className="engineer-main"><div><strong>{engineer.name}</strong><span>{action ? actionCopy(action.phase) : `${minutesLabel(engineer.shiftStart)}–${minutesLabel(engineer.shiftEnd)}`}</span></div><Progress value={route?.load ?? 0} className="load-progress" style={{ ["--primary" as string]: engineer.color }} /></div><div className="engineer-meta"><strong>{route?.stops.length ?? 0}</strong><span>заявок</span><small>{formatDistance(route?.distanceKm ?? 0)}</small></div></button>; })}</div>}</article></section>
      <section className="panel queue-panel"><div className="panel-header"><div><h2>Ближайшие работы</h2><p>{visibleJobs.length} заявок из текущего плана</p></div><button className="plain-button" onClick={() => setUrgentOpen(true)}><Plus />Добавить заявку</button></div><JobTable jobs={visibleJobs} engineers={activeEngineers} onOpen={selectJob} limit={12} /></section></>}
    {view === "requests" && <RequestsView jobs={plannedJobs} engineers={activeEngineers} onOpen={selectJob} onAdd={() => setUrgentOpen(true)} />}{view === "team" && <EngineersView engineers={activeEngineers} result={result} onOpen={openEngineerOnMap} />}{view === "analytics" && <AnalyticsView result={result} />}</section>
  <Dialog open={urgentOpen} onOpenChange={setUrgentOpen}><DialogContent className="urgent-dialog"><DialogHeader><DialogTitle>Новая срочная заявка</DialogTitle><DialogDescription>Адрес будет геокодирован, затем заявка войдёт в VRPTW с повышенным приоритетом.</DialogDescription></DialogHeader><div className="urgent-form"><label className="wide"><span>Адрес</span><Input value={urgentForm.address} onChange={event => setUrgentForm(value => ({ ...value, address: event.target.value }))} placeholder="Москва, ул. Люблинская, 72" /></label><label><span>Регион</span><select value={urgentForm.region} onChange={event => setUrgentForm(value => ({ ...value, region: event.target.value as Region }))}><option>Восток</option><option>Юго-восток</option><option>Югоцентр</option></select></label><label><span>Тип работы</span><Input value={urgentForm.kind} onChange={event => setUrgentForm(value => ({ ...value, kind: event.target.value }))} /></label><label><span>Начало окна</span><Input type="time" value={urgentForm.start} onChange={event => setUrgentForm(value => ({ ...value, start: event.target.value }))} /></label><label><span>Окончание окна</span><Input type="time" value={urgentForm.end} onChange={event => setUrgentForm(value => ({ ...value, end: event.target.value }))} /></label><label><span>Оборудование</span><select value={urgentForm.equipment} onChange={event => setUrgentForm(value => ({ ...value, equipment: event.target.value }))}><option>Рефлектометр</option><option>GPON</option><option>ONT</option></select></label><label><span>Транспорт</span><select value={urgentForm.transport} onChange={event => setUrgentForm(value => ({ ...value, transport: event.target.value }))}><option>Автомобиль</option></select></label></div>{formError && <p className="form-error">{formError}</p>}<div className="dialog-note"><Sparkles /><span><b>Что учтёт оптимизатор</b>Навыки, оборудование, транспорт, смену, приоритет и временное окно.</span></div><DialogFooter><Button variant="outline" onClick={() => setUrgentOpen(false)}>Отмена</Button><Button onClick={() => void addUrgent()}><Zap />{started ? "Добавить и пересчитать" : "Добавить заявку"}</Button></DialogFooter></DialogContent></Dialog>
  <JobDetailsDialog job={selectedJob} engineer={selectedEngineer} plan={selectedJob?.engineerId ? routeByEngineer.get(selectedJob.engineerId) : undefined} jobs={plannedJobs} onClose={() => setSelectedJobId(null)} /></main>;
}
