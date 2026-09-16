"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { AlertTriangle, BarChart3, Bell, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Contrast, Layers3, MapPin, Menu, MoreHorizontal, Navigation, Plus, Route, Search, Sparkles, SunMoon, UsersRound, Wrench, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Coordinate } from "@/lib/map-providers";

type Region = "Восток" | "Юго-восток" | "Югоцентр";
type ThemeId = "light" | "dark" | "beeline" | "ocean" | "graphite" | "contrast";
type Engineer = { id: string; initials: string; name: string; route: string; jobs: number; distance: string; load: number; color: string; region: Region; start: Coordinate };
type Job = { id: string; time: string; area: string; address: string; kind: string; tone: string; region: Region; engineerId: string; coordinates: Coordinate; risk?: boolean };

const themes: Array<{ id: ThemeId; name: string; colors: string[] }> = [
  { id: "light", name: "Светлая", colors: ["#fff", "#6547e7"] },
  { id: "dark", name: "Тёмная", colors: ["#111522", "#8e7cff"] },
  { id: "beeline", name: "Билайн", colors: ["#ffd400", "#151515"] },
  { id: "ocean", name: "Океан", colors: ["#e9fbff", "#007f8b"] },
  { id: "graphite", name: "Графит", colors: ["#dfe3e8", "#38414d"] },
  { id: "contrast", name: "Высокий контраст", colors: ["#fff", "#0047ff"] },
];

const engineers: Engineer[] = [
  { id: "sokolov", initials: "АС", name: "Алексей Соколов", route: "Маршрут 01", jobs: 5, distance: "24,8 км", load: 78, color: "#7657ff", region: "Восток", start: [37.784, 55.705] },
  { id: "melnikov", initials: "ДМ", name: "Денис Мельников", route: "Маршрут 02", jobs: 4, distance: "19,2 км", load: 64, color: "#00a89d", region: "Восток", start: [37.69, 55.748] },
  { id: "parshin", initials: "АП", name: "Антон Паршин", route: "Маршрут 03", jobs: 6, distance: "31,4 км", load: 89, color: "#ff8b3d", region: "Юго-восток", start: [37.753, 55.61] },
  { id: "andreev", initials: "ИА", name: "Илья Андреев", route: "Маршрут 04", jobs: 5, distance: "27,1 км", load: 72, color: "#2d82d7", region: "Юго-восток", start: [37.686, 55.57] },
  { id: "kapitanchuk", initials: "АК", name: "Александр Капитанчук", route: "Маршрут 05", jobs: 5, distance: "22,6 км", load: 81, color: "#e84f87", region: "Югоцентр", start: [37.618, 55.69] },
  { id: "volkov", initials: "МВ", name: "Михаил Волков", route: "Маршрут 06", jobs: 4, distance: "18,9 км", load: 59, color: "#8b5e34", region: "Югоцентр", start: [37.598, 55.655] },
];

const jobs: Job[] = [
  { id: "74198", time: "10:00–12:00", area: "Кузьминки", address: "Волгоградский пр-т, 128 к5", kind: "Конвергенция", tone: "violet", region: "Восток", engineerId: "sokolov", coordinates: [37.789, 55.703] },
  { id: "86160", time: "12:00–14:00", area: "Таганский", address: "пер. Маяковского, 2", kind: "Подключение", tone: "blue", region: "Восток", engineerId: "sokolov", coordinates: [37.657, 55.745] },
  { id: "50104", time: "14:00–16:00", area: "Текстильщики", address: "ул. Грайвороновская, 10 к2", kind: "Гигабит", tone: "amber", region: "Восток", engineerId: "melnikov", coordinates: [37.731, 55.708], risk: true },
  { id: "57299", time: "16:00–18:00", area: "Лефортово", address: "ул. Авиамоторная, 28", kind: "Авария", tone: "green", region: "Восток", engineerId: "melnikov", coordinates: [37.716, 55.752] },
  { id: "67472", time: "10:00–12:00", area: "Домодедово", address: "1-й Советский проезд, 1А", kind: "Дозаказ", tone: "green", region: "Юго-восток", engineerId: "parshin", coordinates: [37.768, 55.44] },
  { id: "84466", time: "12:00–14:00", area: "Орехово-Борисово", address: "Гурьевский проезд, 23 к1", kind: "Конвергенция", tone: "blue", region: "Юго-восток", engineerId: "parshin", coordinates: [37.755, 55.608] },
  { id: "1287", time: "14:00–16:00", area: "Бирюлёво Восточное", address: "Бирюлёвская ул., 44", kind: "Авария", tone: "amber", region: "Юго-восток", engineerId: "andreev", coordinates: [37.667, 55.585], risk: true },
  { id: "31495", time: "16:00–18:00", area: "Бирюлёво Западное", address: "Булатниковский проезд, 6 к1", kind: "Авария", tone: "violet", region: "Юго-восток", engineerId: "andreev", coordinates: [37.638, 55.586] },
  { id: "32840", time: "10:00–12:00", area: "Даниловский", address: "3-й Павелецкий проезд, 9", kind: "Конвергенция", tone: "blue", region: "Югоцентр", engineerId: "kapitanchuk", coordinates: [37.642, 55.705] },
  { id: "78540", time: "12:00–14:00", area: "Даниловский", address: "ул. Восточная, 2 к2", kind: "Подключение", tone: "green", region: "Югоцентр", engineerId: "kapitanchuk", coordinates: [37.656, 55.713] },
  { id: "17896", time: "14:00–16:00", area: "Зюзино", address: "ул. Керченская, 10 к2", kind: "IP-адрес 169", tone: "amber", region: "Югоцентр", engineerId: "volkov", coordinates: [37.58, 55.657] },
  { id: "18023", time: "16:00–18:00", area: "Гагаринский", address: "Ленинский пр-т, 70/11", kind: "Информация", tone: "violet", region: "Югоцентр", engineerId: "volkov", coordinates: [37.558, 55.686] },
];

function Logo() { return <div className="brand"><span className="brand-mark"><Route size={18} /></span><span>FieldFlow</span></div>; }
function routeCoordinates(engineer: Engineer, list: Job[], replanned: boolean) {
  const points = list.filter(job => job.engineerId === engineer.id).map(job => job.coordinates);
  return [engineer.start, ...points, ...(replanned && engineer.id === "sokolov" ? [[37.744, 55.676] as Coordinate] : [])];
}

function MapCanvas({ visibleJobs, visibleEngineers, selectedEngineerId, selectedJobId, replanned, compare, onSelectEngineer, onSelectJob }: { visibleJobs: Job[]; visibleEngineers: Engineer[]; selectedEngineerId: string | null; selectedJobId: string | null; replanned: boolean; compare: boolean; onSelectEngineer: (id: string) => void; onSelectJob: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const loadedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const latestRef = useRef({ visibleJobs, visibleEngineers, selectedEngineerId, selectedJobId, replanned, compare });
  latestRef.current = { visibleJobs, visibleEngineers, selectedEngineerId, selectedJobId, replanned, compare };

  const routeData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => ({ type: "FeatureCollection", features: visibleEngineers.map(engineer => ({ type: "Feature", properties: { id: engineer.id, color: engineer.color, selected: selectedEngineerId === engineer.id ? 1 : 0 }, geometry: { type: "LineString", coordinates: routeCoordinates(engineer, visibleJobs, replanned) } })) }), [visibleEngineers, visibleJobs, selectedEngineerId, replanned]);
  const baselineData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => ({ type: "FeatureCollection", features: visibleEngineers.map(engineer => { const coordinates = routeCoordinates(engineer, visibleJobs, false); const detour = coordinates.length > 1 ? [coordinates[0], [coordinates[0][0] + .025, coordinates[0][1] + .018] as Coordinate, ...coordinates.slice(1)] : coordinates; return { type: "Feature", properties: { id: engineer.id, color: engineer.color }, geometry: { type: "LineString", coordinates: detour } }; }) }), [visibleEngineers, visibleJobs]);

  const fitVisible = useCallback(async () => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    const all = [...visibleJobs.map(job => job.coordinates), ...visibleEngineers.map(engineer => engineer.start)]; if (!all.length) return;
    const { LngLatBounds } = await import("maplibre-gl"); const bounds = new LngLatBounds(all[0], all[0]); all.slice(1).forEach(point => bounds.extend(point));
    map.fitBounds(bounds, { padding: 54, maxZoom: 12.8, duration: 650 });
  }, [visibleJobs, visibleEngineers]);

  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then(maplibre => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const map = new maplibre.Map({ container: containerRef.current, center: [37.67, 55.67], zoom: 10.1, attributionControl: false, style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] } });
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
      map.on("style.load", () => {
        loadedRef.current = true; const current = latestRef.current;
        const initialRoutes: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features: current.visibleEngineers.map(engineer => ({ type: "Feature", properties: { id: engineer.id, color: engineer.color, selected: current.selectedEngineerId === engineer.id ? 1 : 0 }, geometry: { type: "LineString", coordinates: routeCoordinates(engineer, current.visibleJobs, current.replanned) } })) };
        map.addSource("baseline-routes", { type: "geojson", data: initialRoutes });
        map.addLayer({ id: "baseline-routes", type: "line", source: "baseline-routes", layout: { visibility: current.compare ? "visible" : "none" }, paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": .42, "line-dasharray": [1, 1.5] } });
        map.addSource("routes", { type: "geojson", data: initialRoutes });
        map.addLayer({ id: "route-shadow", type: "line", source: "routes", paint: { "line-color": "#fff", "line-width": ["case", ["==", ["get", "selected"], 1], 10, 7], "line-opacity": .82 } });
        map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "selected"], 1], 6, 3.5], "line-opacity": ["case", ["==", ["get", "selected"], 1], 1, .75] } });
        setMapReady(true);
      }); mapRef.current = map;
    });
    return () => { cancelled = true; markersRef.current.forEach(marker => marker.remove()); markersRef.current = []; mapRef.current?.remove(); mapRef.current = null; loadedRef.current = false; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return;
    (map.getSource("routes") as { setData: (data: GeoJSON.FeatureCollection) => void } | undefined)?.setData(routeData);
    (map.getSource("baseline-routes") as { setData: (data: GeoJSON.FeatureCollection) => void } | undefined)?.setData(baselineData);
    if (map.getLayer("baseline-routes")) map.setLayoutProperty("baseline-routes", "visibility", compare ? "visible" : "none");
    markersRef.current.forEach(marker => marker.remove()); markersRef.current = [];
    void import("maplibre-gl").then(({ Marker }) => {
      if (!mapRef.current) return;
      visibleEngineers.forEach(engineer => { const el = document.createElement("button"); el.className = `engineer-map-marker${selectedEngineerId === engineer.id ? " selected" : ""}`; el.textContent = engineer.initials; el.style.setProperty("--marker", engineer.color); el.title = engineer.name; el.onclick = () => onSelectEngineer(engineer.id); markersRef.current.push(new Marker({ element: el }).setLngLat(engineer.start).addTo(mapRef.current!)); });
      visibleJobs.forEach((job, index) => { const engineer = engineers.find(item => item.id === job.engineerId)!; const el = document.createElement("button"); el.className = `job-map-marker${selectedJobId === job.id ? " selected" : ""}`; el.textContent = String(index + 1); el.style.setProperty("--marker", engineer.color); el.title = `№ ${job.id} · ${job.address}`; el.onclick = () => onSelectJob(job.id); markersRef.current.push(new Marker({ element: el }).setLngLat(job.coordinates).addTo(mapRef.current!)); });
    });
  }, [routeData, baselineData, compare, selectedEngineerId, selectedJobId, visibleEngineers, visibleJobs, onSelectEngineer, onSelectJob, mapReady]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !loadedRef.current) return; const job = jobs.find(item => item.id === selectedJobId); const engineer = engineers.find(item => item.id === selectedEngineerId);
    if (job) map.flyTo({ center: job.coordinates, zoom: 13.3, duration: 650 });
    else if (engineer) { const points = routeCoordinates(engineer, visibleJobs, replanned); void import("maplibre-gl").then(({ LngLatBounds }) => { const bounds = new LngLatBounds(points[0], points[0]); points.slice(1).forEach(point => bounds.extend(point)); map.fitBounds(bounds, { padding: 70, maxZoom: 13, duration: 650 }); }); }
    else void fitVisible();
  }, [selectedJobId, selectedEngineerId, visibleJobs, replanned, fitVisible]);

  return <div className="map-canvas real-map" aria-label="Интерактивная карта маршрутов инженеров"><div ref={containerRef} className="maplibre-host" /><div className="map-tools"><button aria-label="Показать все маршруты" onClick={() => void fitVisible()}><Layers3 size={17} /></button><span /><button aria-label="Увеличить карту" onClick={() => mapRef.current?.zoomIn()}>+</button><button aria-label="Уменьшить карту" onClick={() => mapRef.current?.zoomOut()}>−</button></div><div className="map-caption"><Navigation size={14} />OSM · 205 заявок загружено из CSV</div></div>;
}

export default function Home() {
  const [region, setRegion] = useState<"Все зоны" | Region>("Все зоны"); const [replanned, setReplanned] = useState(false); const [compare, setCompare] = useState(false); const [urgentOpen, setUrgentOpen] = useState(false); const [selectedJobId, setSelectedJobId] = useState<string | null>(null); const [selectedEngineerId, setSelectedEngineerId] = useState<string | null>(null); const [theme, setTheme] = useState<ThemeId>("light"); const [themeOpen, setThemeOpen] = useState(false);
  const visibleJobs = useMemo(() => jobs.filter(job => region === "Все зоны" || job.region === region), [region]); const visibleEngineers = useMemo(() => engineers.filter(engineer => region === "Все зоны" || engineer.region === region), [region]); const selectedJob = jobs.find(job => job.id === selectedJobId) ?? null;
  const metrics = useMemo(() => replanned ? { done: 204, total: 206, distance: "−16%", sla: "96%", alert: "1 изменение" } : { done: 203, total: 205, distance: "−18%", sla: "97%", alert: "План стабилен" }, [replanned]);
  useEffect(() => { const saved = window.localStorage.getItem("fieldflow-theme") as ThemeId | null; if (saved && themes.some(item => item.id === saved)) setTheme(saved); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("fieldflow-theme", theme); }, [theme]);
  const selectEngineer = useCallback((id: string) => { setSelectedEngineerId(current => current === id ? null : id); setSelectedJobId(null); }, []); const selectJob = useCallback((id: string) => { setSelectedJobId(id); setSelectedEngineerId(jobs.find(item => item.id === id)?.engineerId ?? null); }, []);

  useEffect(() => { const controller = new AbortController(); const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext; if (!context?.registerTool) return; const validate = (input: unknown) => { if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("Ожидается пустой объект."); }; void Promise.resolve(context.registerTool({ name: "read_plan_summary", title: "Сводка плана", description: "Возвращает текущие показатели плана.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: (input: unknown) => { validate(input); return { assigned: metrics.done, total: metrics.total, sla: metrics.sla, region, replanned }; } }, { signal: controller.signal })); void Promise.resolve(context.registerTool({ name: "apply_urgent_job", title: "Добавить срочную заявку", description: "Запускает демонстрационное перепланирование.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false }, execute: (input: unknown) => { validate(input); setReplanned(true); return { status: "replanned", changedRoutes: 1 }; } }, { signal: controller.signal })); return () => controller.abort(); }, [metrics, region, replanned]);

  return <main className="app-shell"><aside className="sidebar"><Logo /><nav aria-label="Основная навигация"><a className="nav-item active" href="#plan"><Route /><span>Планирование</span></a><a className="nav-item" href="#requests"><Wrench /><span>Заявки</span><b>205</b></a><a className="nav-item" href="#team"><UsersRound /><span>Инженеры</span></a><a className="nav-item" href="#analytics"><BarChart3 /><span>Аналитика</span></a></nav><div className="sidebar-bottom"><button className="nav-item theme-nav" onClick={() => setThemeOpen(open => !open)}><SunMoon /><span>Тема</span></button><a className="nav-item" href="#help"><CircleHelp /><span>Помощь</span></a><div className="profile"><span>ДК</span><div><strong>Диспетчер</strong><small>В сети</small></div><MoreHorizontal size={17} /></div></div></aside><section className="workspace" id="plan">
    <header className="topbar"><button className="mobile-menu" aria-label="Открыть меню"><Menu /></button><div><h1>План работ</h1><p>Понедельник, 17 августа · Московский регион</p></div><div className="top-actions"><button className="theme-button" onClick={() => setThemeOpen(open => !open)}><Contrast /><span>{themes.find(item => item.id === theme)?.name}</span><ChevronDown /></button><button className="search"><Search /><span>Найти заявку</span><kbd>⌘ K</kbd></button><button className="icon-button" aria-label="Уведомления"><Bell /><i /></button><Button className="urgent-button" onClick={() => setUrgentOpen(true)}><Zap />Срочная заявка</Button></div></header>
    {themeOpen && <div className="theme-menu" role="menu" aria-label="Выбор темы">{themes.map(item => <button key={item.id} className={theme === item.id ? "active" : ""} onClick={() => { setTheme(item.id); setThemeOpen(false); }}><span className="theme-swatches">{item.colors.map(color => <i key={color} style={{ background: color }} />)}</span><b>{item.name}</b>{theme === item.id && <Check />}</button>)}</div>}
    <div className="filter-row"><Tabs defaultValue="day"><TabsList><TabsTrigger value="day">День</TabsTrigger><TabsTrigger value="week">Неделя</TabsTrigger></TabsList></Tabs><button className="date-control"><CalendarDays />17 авг. 2026<ChevronDown /></button><div className="region-select">{(["Все зоны", "Восток", "Юго-восток", "Югоцентр"] as const).map(item => <button key={item} className={region === item ? "selected" : ""} onClick={() => { setRegion(item); setSelectedEngineerId(null); setSelectedJobId(null); }}>{item}</button>)}</div><div className="plan-state"><span className={replanned ? "state-dot changed" : "state-dot"} />{metrics.alert}</div></div>
    {replanned && <div className="impact-banner"><span><Sparkles /></span><div><strong>План пересчитан за 1,8 сек.</strong><p>Срочная заявка добавлена в маршрут Алексея. Слой «до» доступен на карте.</p></div><button onClick={() => { setReplanned(false); setCompare(false); }}>Вернуть исходный план</button></div>}
    <section className="metric-grid" aria-label="Основные показатели"><article><div className="metric-head"><span className="metric-icon purple"><Wrench /></span><small>Заявки</small><Badge className="metric-badge">{replanned ? "+1 срочная" : "2 без назначения"}</Badge></div><strong>{metrics.done}<em>/ {metrics.total}</em></strong><p>назначено на сегодня</p></article><article><div className="metric-head"><span className="metric-icon teal"><Route /></span><small>Общий пробег</small><Badge className="metric-badge good">{metrics.distance}</Badge></div><strong>{replanned ? "254,1" : "248,6"}<em> км</em></strong><p>baseline: 303,4 км</p></article><article><div className="metric-head"><span className="metric-icon orange"><Clock3 /></span><small>SLA вовремя</small><Badge className="metric-badge good">выше цели</Badge></div><strong>{metrics.sla}</strong><p>цель не ниже 95%</p></article><article><div className="metric-head"><span className="metric-icon blue"><UsersRound /></span><small>Данные CSV</small><Badge className="metric-badge">3 зоны</Badge></div><strong>205<em> строк</em></strong><p>структура определена автоматически</p></article></section>
    <section className="content-grid"><article className="panel map-panel"><div className="panel-header"><div><h2>Маршруты</h2><p>{visibleEngineers.length} инженеров на карте · {region}</p></div><div className="legend"><span><i className="legend-solid" />После</span><span><i className="legend-dash" />До</span><button className={compare ? "active" : ""} onClick={() => setCompare(value => !value)}><Layers3 />{compare ? "Скрыть сравнение" : "Сравнить до/после"}</button></div></div><MapCanvas visibleJobs={visibleJobs} visibleEngineers={visibleEngineers} selectedEngineerId={selectedEngineerId} selectedJobId={selectedJobId} replanned={replanned} compare={compare} onSelectEngineer={selectEngineer} onSelectJob={selectJob} /></article><article className="panel routes-panel" id="team"><div className="panel-header"><div><h2>Загрузка</h2><p>Нажмите на инженера</p></div><button className="plain-button" onClick={() => { setSelectedEngineerId(null); setSelectedJobId(null); }}>Все маршруты</button></div><div className="engineer-list">{visibleEngineers.map(engineer => <button className={`engineer${selectedEngineerId === engineer.id ? " selected" : ""}`} key={engineer.id} onClick={() => selectEngineer(engineer.id)}><div className="avatar" style={{ background: `${engineer.color}18`, color: engineer.color }}>{engineer.initials}</div><div className="engineer-main"><div><strong>{engineer.name}</strong><span>{engineer.route}</span></div><Progress value={engineer.load} className="load-progress" style={{ ["--primary" as string]: engineer.color }} /></div><div className="engineer-meta"><strong>{engineer.jobs}</strong><span>заявок</span><small>{engineer.distance}</small></div></button>)}</div><button className="optimize-button" onClick={() => { setReplanned(true); setCompare(true); }}><Sparkles />Оптимизировать план<span>OR-Tools</span></button></article></section>
    <section className="panel queue-panel" id="requests"><div className="panel-header"><div><h2>Ближайшие работы</h2><p>{region} · показано {visibleJobs.length} контрольных точек из 205</p></div><button className="plain-button" onClick={() => setUrgentOpen(true)}><Plus />Добавить заявку</button></div><div className="job-table"><div className="job-row table-head"><span>Время</span><span>Заявка</span><span>Адрес</span><span>Инженер</span><span>Статус SLA</span><span /></div>{visibleJobs.map(job => { const engineer = engineers.find(item => item.id === job.engineerId)!; return <button className={`job-row job-row-button${selectedJobId === job.id ? " selected" : ""}`} key={job.id} onClick={() => selectJob(job.id)}><span className="job-time">{job.time}</span><span><i className={`job-tone ${job.tone}`} /><b>№ {job.id}</b><small>{job.kind}</small></span><span><b>{job.area}</b><small>{job.address}</small></span><span className="assigned"><i style={{ background: engineer.color }}>{engineer.initials}</i><b>{engineer.name.split(" ")[0]}</b></span><span><Badge className={job.risk ? "sla risk" : "sla"}>{job.risk ? <AlertTriangle /> : <Clock3 />}{job.risk ? "Риск 14 мин" : "Вовремя"}</Badge></span><span className="row-location"><MapPin /></span></button>; })}</div></section>
  </section>
  <Dialog open={urgentOpen} onOpenChange={setUrgentOpen}><DialogContent className="urgent-dialog"><DialogHeader><DialogTitle>Новая срочная заявка</DialogTitle><DialogDescription>Будущая часть маршрута перестроится, выполненные работы останутся зафиксированы.</DialogDescription></DialogHeader><div className="dialog-grid"><label><span>Адрес</span><b>ул. Люблинская, 72</b></label><label><span>Временное окно</span><b>13:00–14:30</b></label><label><span>Навык</span><b>Аварийные работы</b></label><label><span>Транспорт</span><b>Автомобиль</b></label><label className="wide"><span>Оборудование</span><b>Оптический рефлектометр · GPON</b></label></div><div className="dialog-note"><Sparkles /><span><b>Прогноз влияния</b>Изменится один маршрут, риск опоздания не превысит 6 минут.</span></div><DialogFooter><Button variant="outline" onClick={() => setUrgentOpen(false)}>Отмена</Button><Button onClick={() => { setReplanned(true); setCompare(true); setUrgentOpen(false); }}><Zap />Добавить и перестроить</Button></DialogFooter></DialogContent></Dialog>
  <Dialog open={Boolean(selectedJob)} onOpenChange={open => !open && setSelectedJobId(null)}><DialogContent className="explain-dialog"><DialogHeader><DialogTitle>Почему выбрано это назначение</DialogTitle><DialogDescription>Заявка № {selectedJob?.id} · {selectedJob?.area}</DialogDescription></DialogHeader><div className="decision-score"><span><Sparkles /></span><div><b>{engineers.find(item => item.id === selectedJob?.engineerId)?.name}</b><p>Лучший допустимый вариант среди 7 кандидатов</p></div><strong>92<small>/100</small></strong></div><div className="reason-list"><p><i>1</i><span><b>Навык подтверждён</b>Инженер допущен к типу «{selectedJob?.kind}».</span></p><p><i>2</i><span><b>Окно и SLA соблюдены</b>Прибытие запланировано на {selectedJob?.time.split("–")[0]}.</span></p><p><i>3</i><span><b>Маршрут эффективен</b>Назначение не сдвигает следующие визиты.</span></p></div><DialogFooter><Button onClick={() => setSelectedJobId(null)}>Понятно</Button></DialogFooter></DialogContent></Dialog></main>;
}
