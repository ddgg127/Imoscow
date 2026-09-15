"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Bell, CalendarDays, ChevronDown, CircleHelp, Clock3, Gauge, Layers3, MapPin, Menu, MoreHorizontal, Navigation, Plus, Route, Search, Settings2, Sparkles, UsersRound, Wrench, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const jobs = [
  { id: "74198", time: "10:00–12:00", area: "Кузьминки", address: "Волгоградский пр-т, 128 к5", kind: "Подключение", tone: "violet" },
  { id: "86160", time: "12:00–14:00", area: "Таганский", address: "пер. Маяковского, 2", kind: "Конвергенция", tone: "blue" },
  { id: "50104", time: "14:00–16:00", area: "Текстильщики", address: "ул. Грайвороновская, 10 к2", kind: "Гигабит", tone: "amber" },
  { id: "67472", time: "16:00–18:00", area: "Домодедово", address: "1-й Советский проезд, 1А", kind: "Дозаказ", tone: "green" },
];

const engineers = [
  { initials: "АС", name: "Алексей Соколов", route: "Маршрут 01", jobs: 5, distance: "24,8 км", load: 78, color: "#7857ff" },
  { initials: "ДМ", name: "Денис Мельников", route: "Маршрут 02", jobs: 4, distance: "19,2 км", load: 64, color: "#15a7a2" },
  { initials: "АП", name: "Антон Паршин", route: "Маршрут 03", jobs: 6, distance: "31,4 км", load: 89, color: "#ff914d" },
];

const pins = [
  { x: 23, y: 29, n: 1, c: "#7857ff" }, { x: 32, y: 40, n: 2, c: "#7857ff" }, { x: 43, y: 33, n: 3, c: "#7857ff" },
  { x: 56, y: 58, n: 1, c: "#15a7a2" }, { x: 66, y: 47, n: 2, c: "#15a7a2" }, { x: 74, y: 34, n: 3, c: "#15a7a2" },
  { x: 41, y: 70, n: 1, c: "#ff914d" }, { x: 52, y: 78, n: 2, c: "#ff914d" }, { x: 70, y: 71, n: 3, c: "#ff914d" },
];

function Logo() {
  return <div className="brand"><span className="brand-mark"><Route size={18} /></span><span>FieldFlow</span></div>;
}

function MapCanvas({ replanned }: { replanned: boolean }) {
  return (
    <div className="map-canvas" aria-label="Карта маршрутов инженеров">
      <svg className="map-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M-5 22 C18 29 23 8 45 18 S76 39 106 25" /><path d="M-8 71 C18 54 35 72 53 60 S78 42 108 52" /><path d="M11 -8 C18 20 5 37 23 56 S48 79 41 108" /><path d="M72 -6 C60 19 75 30 65 49 S54 82 70 106" />
        <path d="M-5 46 L108 88" className="minor" /><path d="M34 -5 L92 105" className="minor" /><path d="M4 90 L91 5" className="minor" />
        <polyline points={replanned ? "18,18 23,29 32,40 43,33 56,24" : "18,18 23,29 32,40 43,33"} className="route route-a" />
        <polyline points="52,62 56,58 66,47 74,34" className="route route-b" /><polyline points="35,82 41,70 52,78 70,71" className="route route-c" />
      </svg>
      <div className="map-label label-a">Таганский</div><div className="map-label label-b">Текстильщики</div><div className="map-label label-c">Кузьминки</div><div className="map-label label-d">Нагатинский затон</div>
      {pins.map((pin, index) => <div key={index} className="pin" style={{ left: `${pin.x}%`, top: `${pin.y}%`, background: pin.c }}>{pin.n}</div>)}
      {replanned && <div className="pin urgent-pin" style={{ left: "56%", top: "24%" }}><Zap size={12} /></div>}
      <div className="map-tools"><button aria-label="Настройки карты"><Layers3 size={17} /></button><span /><button aria-label="Увеличить карту">+</button><button aria-label="Уменьшить карту">−</button></div>
      <div className="map-caption"><Navigation size={14} /> Маршруты рассчитаны · 09:42</div>
    </div>
  );
}

export default function Home() {
  const [region, setRegion] = useState("Все зоны");
  const [replanned, setReplanned] = useState(false);
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<(typeof jobs)[number] | null>(null);
  const metrics = useMemo(() => replanned ? { done: 204, total: 206, distance: "−16%", sla: "96%", alert: "1 изменение" } : { done: 203, total: 205, distance: "−18%", sla: "97%", alert: "План стабилен" }, [replanned]);

  useEffect(() => {
    const controller = new AbortController();
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const validateEmptyInput = (input: unknown) => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 0) throw new Error("Ожидается пустой объект без дополнительных полей.");
    };
    void Promise.resolve(context.registerTool({
      name: "read_plan_summary", title: "Сводка плана", description: "Возвращает текущие показатели диспетчерского плана.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
      execute: (input: unknown) => { validateEmptyInput(input); return { assigned: metrics.done, total: metrics.total, sla: metrics.sla, distanceImprovement: metrics.distance, replanned }; },
    }, { signal: controller.signal }));
    void Promise.resolve(context.registerTool({
      name: "apply_urgent_job", title: "Добавить срочную заявку", description: "Добавляет демонстрационную срочную заявку и перестраивает будущую часть плана.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false },
      execute: (input: unknown) => { validateEmptyInput(input); setReplanned(true); return { status: "replanned", engineer: "Алексей Соколов", changedRoutes: 1 }; },
    }, { signal: controller.signal }));
    return () => controller.abort();
  }, [metrics, replanned]);
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Основная навигация">
          <a className="nav-item active" href="#plan"><Route /> <span>Планирование</span></a><a className="nav-item" href="#requests"><Wrench /> <span>Заявки</span><b>205</b></a><a className="nav-item" href="#team"><UsersRound /> <span>Инженеры</span></a><a className="nav-item" href="#analytics"><BarChart3 /> <span>Аналитика</span></a>
        </nav>
        <div className="sidebar-bottom"><a className="nav-item" href="#settings"><Settings2 /> <span>Настройки</span></a><a className="nav-item" href="#help"><CircleHelp /> <span>Помощь</span></a><div className="profile"><span>ДК</span><div><strong>Диспетчер</strong><small>В сети</small></div><MoreHorizontal size={17} /></div></div>
      </aside>
      <section className="workspace" id="plan">
        <header className="topbar"><button className="mobile-menu" aria-label="Открыть меню"><Menu /></button><div><h1>План работ</h1><p>Понедельник, 17 августа · Московский регион</p></div><div className="top-actions"><button className="search"><Search /> <span>Найти заявку</span><kbd>⌘ K</kbd></button><button className="icon-button" aria-label="Уведомления"><Bell /><i /></button><Button className="urgent-button" onClick={() => setUrgentOpen(true)}><Zap /> Срочная заявка</Button></div></header>
        <div className="filter-row"><Tabs defaultValue="day"><TabsList><TabsTrigger value="day">День</TabsTrigger><TabsTrigger value="week">Неделя</TabsTrigger></TabsList></Tabs><button className="date-control"><CalendarDays />17 авг. 2026<ChevronDown /></button><div className="region-select">{['Все зоны','Восток','Юго-восток','Югоцентр'].map(item => <button key={item} className={region === item ? 'selected' : ''} onClick={() => setRegion(item)}>{item}</button>)}</div><div className="plan-state"><span className={replanned ? "state-dot changed" : "state-dot"} />{metrics.alert}</div></div>
        {replanned && <div className="impact-banner"><span><Sparkles /></span><div><strong>План пересчитан за 1,8 сек.</strong><p>Срочная заявка добавлена в маршрут Алексея. Остальные назначения сохранены.</p></div><button onClick={() => setReplanned(false)}>Вернуть исходный план</button></div>}
        <section className="metric-grid" aria-label="Основные показатели">
          <article><div className="metric-head"><span className="metric-icon purple"><Wrench /></span><small>Заявки</small><Badge className="metric-badge">{replanned ? "+1 срочная" : "2 без назначения"}</Badge></div><strong>{metrics.done}<em>/ {metrics.total}</em></strong><p>назначено на сегодня</p></article>
          <article><div className="metric-head"><span className="metric-icon teal"><Route /></span><small>Общий пробег</small><Badge className="metric-badge good">{metrics.distance}</Badge></div><strong>{replanned ? '254,1' : '248,6'}<em> км</em></strong><p>baseline: 303,4 км</p></article>
          <article><div className="metric-head"><span className="metric-icon orange"><Clock3 /></span><small>SLA вовремя</small><Badge className="metric-badge good">выше цели</Badge></div><strong>{metrics.sla}</strong><p>цель не ниже 95%</p></article>
          <article><div className="metric-head"><span className="metric-icon blue"><UsersRound /></span><small>Инженеры</small><Badge className="metric-badge">−3 к baseline</Badge></div><strong>31<em>/ 34</em></strong><p>задействовано</p></article>
        </section>
        <section className="content-grid">
          <article className="panel map-panel"><div className="panel-header"><div><h2>Маршруты</h2><p>31 инженер · {metrics.done} назначений</p></div><div className="legend"><span><i className="l1" />Авто</span><span><i className="l2" />Пешком</span><button><Gauge /> Пробки: средние</button></div></div><MapCanvas replanned={replanned} /></article>
          <article className="panel routes-panel"><div className="panel-header"><div><h2>Загрузка</h2><p>По инженерам</p></div><button className="plain-button">Все маршруты</button></div><div className="engineer-list">{engineers.map(e => <div className="engineer" key={e.name}><div className="avatar" style={{ background: `${e.color}16`, color: e.color }}>{e.initials}</div><div className="engineer-main"><div><strong>{e.name}</strong><span>{e.route}</span></div><Progress value={e.load} className="load-progress" style={{ ['--primary' as string]: e.color }} /></div><div className="engineer-meta"><strong>{e.jobs}</strong><span>заявок</span><small>{e.distance}</small></div></div>)}</div><button className="optimize-button" onClick={() => setReplanned(true)}><Sparkles /> Оптимизировать план<span>OR-Tools</span></button></article>
        </section>
        <section className="panel queue-panel" id="requests"><div className="panel-header"><div><h2>Ближайшие работы</h2><p>{region} · расписание на сегодня</p></div><button className="plain-button" onClick={() => setUrgentOpen(true)}><Plus /> Добавить заявку</button></div><div className="job-table"><div className="job-row table-head"><span>Время</span><span>Заявка</span><span>Адрес</span><span>Инженер</span><span>Статус SLA</span><span /></div>{jobs.map((job, index) => <div className="job-row" key={job.id}><span className="job-time">{job.time}</span><span><i className={`job-tone ${job.tone}`} /><b>№ {job.id}</b><small>{job.kind}</small></span><span><b>{job.area}</b><small>{job.address}</small></span><span className="assigned"><i style={{ background: engineers[index % 3].color }}>{engineers[index % 3].initials}</i><b>{engineers[index % 3].name.split(' ')[0]}</b></span><span><Badge className={index === 2 ? "sla risk" : "sla"}>{index === 2 ? <AlertTriangle /> : <Clock3 />}{index === 2 ? 'Риск 14 мин' : 'Вовремя'}</Badge></span><button aria-label={`Открыть заявку ${job.id}`} onClick={() => setSelectedJob(job)}><MoreHorizontal /></button></div>)}</div></section>
      </section>

      <Dialog open={urgentOpen} onOpenChange={setUrgentOpen}><DialogContent className="urgent-dialog"><DialogHeader><DialogTitle>Новая срочная заявка</DialogTitle><DialogDescription>Демонстрационный сценарий перепланирования. Выполненные работы останутся зафиксированы.</DialogDescription></DialogHeader><div className="dialog-grid"><label><span>Адрес</span><b>ул. Люблинская, 72</b></label><label><span>Временное окно</span><b>13:00–14:30</b></label><label><span>Навык</span><b>Аварийные работы</b></label><label><span>Транспорт</span><b>Автомобиль</b></label><label className="wide"><span>Оборудование</span><b>Оптический рефлектометр · комплект GPON</b></label></div><div className="dialog-note"><Sparkles /><span><b>Прогноз влияния</b> Один маршрут изменится, риск опоздания не превысит 6 минут.</span></div><DialogFooter><Button variant="outline" onClick={() => setUrgentOpen(false)}>Отмена</Button><Button onClick={() => { setReplanned(true); setUrgentOpen(false); }}><Zap /> Добавить и перестроить</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(selectedJob)} onOpenChange={(open) => !open && setSelectedJob(null)}><DialogContent className="explain-dialog"><DialogHeader><DialogTitle>Почему выбрано это назначение</DialogTitle><DialogDescription>Заявка № {selectedJob?.id} · {selectedJob?.area}</DialogDescription></DialogHeader><div className="decision-score"><span><Sparkles /></span><div><b>{selectedJob ? engineers[jobs.indexOf(selectedJob) % 3].name : "Инженер"}</b><p>Лучший допустимый вариант среди 7 кандидатов</p></div><strong>92<small>/100</small></strong></div><div className="reason-list"><p><i>1</i><span><b>Навык подтверждён</b>Инженер допущен к работам типа «{selectedJob?.kind}».</span></p><p><i>2</i><span><b>Окно и SLA соблюдены</b>Прибытие запланировано на {selectedJob?.time.split("–")[0]}, запас до нарушения SLA — 28 минут.</span></p><p><i>3</i><span><b>Маршрут эффективен</b>Назначение добавляет 3,4 км и не сдвигает следующие визиты.</span></p></div><DialogFooter><Button onClick={() => setSelectedJob(null)}>Понятно</Button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}
