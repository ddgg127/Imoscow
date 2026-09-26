"use client";

import { useMemo, useState } from "react";
import { Database, RotateCcw, Route } from "lucide-react";
import { executionAtTime, executionLabels, matchesEditorQuery, parseTime, timeInput } from "@/lib/data-editor";
import { engineerSpeedKmh } from "@/lib/transport-speed";
import { regions, type Engineer, type Job, type Region } from "@/lib/vrptw";

type Props = {
  jobs: Job[];
  engineers: Engineer[];
  carSpeedKmh: number;
  simTime: number | null;
  stopsByJob: Map<string, { arrival: number; end: number }>;
  unavailableIds: string[];
  dirty: boolean;
  optimizing: boolean;
  error: string;
  onJobs: (jobs: Job[]) => void;
  onEngineers: (engineers: Engineer[]) => void;
  onUnavailable: (ids: string[]) => void;
  onApply: () => void;
  onReset: () => void;
};

const PAGE_SIZE = 50;
const transports = ["Автомобиль", "Пешком", "Велосипед", "Общественный транспорт"];
const skills = ["Локальные работы", "Подключение и модернизация", "Аварийно-восстановительные работы"];
const statuses = Object.entries(executionLabels) as Array<[NonNullable<Job["executionStatus"]>, string]>;
const list = (value: string) => [...new Set(value.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean))];

function Cell({ label, value, onChange, type = "text", min, max, step, className = "" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; min?: number; max?: number; step?: number | string; className?: string }) {
  return <input className={className} aria-label={label} title={label} type={type} min={min} max={max} step={step} value={value} onChange={event => onChange(event.target.value)} />;
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <select aria-label={label} title={label} value={value} onChange={event => onChange(event.target.value)}>{!options.includes(value) && <option value={value}>{value || "—"}</option>}{options.map(option => <option key={option} value={option}>{option}</option>)}</select>;
}

function Coordinates({ label, point, onChange }: { label: string; point: [number, number]; onChange: (point: [number, number]) => void }) {
  return <span className="sheet-coordinates"><Cell label={`${label}: долгота`} value={point[0]} type="number" step="0.00001" onChange={value => onChange([Number(value), point[1]])} /><Cell label={`${label}: широта`} value={point[1]} type="number" step="0.00001" onChange={value => onChange([point[0], Number(value)])} /></span>;
}

export function DataEditor({ jobs, engineers, carSpeedKmh, simTime, stopsByJob, unavailableIds, dirty, optimizing, error, onJobs, onEngineers, onUnavailable, onApply, onReset }: Props) {
  const [entity, setEntity] = useState<"jobs" | "engineers">("jobs");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const updateJob = (index: number, patch: Partial<Job>) => onJobs(jobs.map((job, i) => i === index ? { ...job, ...patch } : job));
  const updateEngineer = (index: number, patch: Partial<Engineer>) => onEngineers(engineers.map((engineer, i) => i === index ? { ...engineer, ...patch } : engineer));
  const matchedJobs = useMemo(() => jobs.map((item, index) => ({ item, index })).filter(({ item }) => matchesEditorQuery(item, query)), [jobs, query]);
  const matchedEngineers = useMemo(() => engineers.map((item, index) => ({ item, index })).filter(({ item }) => matchesEditorQuery(item, query, unavailableIds.includes(item.id))), [engineers, query, unavailableIds]);
  const rows = entity === "jobs" ? matchedJobs : matchedEngineers;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const shown = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return <section className="page-view data-editor-view">
    <div className="panel sheet-panel">
      <div className="sheet-heading"><div><h2>Таблица исходных данных</h2><p>Редактируйте параметры планирования в ячейках. Назначения, пробег и загрузка рассчитываются заново и поэтому здесь не редактируются.</p></div><span className={dirty ? "sheet-dirty" : "sheet-clean"}>{dirty ? "Есть несохранённые изменения" : "Данные синхронизированы"}</span></div>
      <div className="sheet-toolbar"><div className="sheet-tabs"><button type="button" className={entity === "jobs" ? "active" : ""} onClick={() => { setEntity("jobs"); setPage(0); }}>Заявки · {query ? matchedJobs.length : jobs.length}</button><button type="button" className={entity === "engineers" ? "active" : ""} onClick={() => { setEntity("engineers"); setPage(0); }}>Инженеры · {query ? matchedEngineers.length : engineers.length}</button></div><input className="sheet-search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Поиск по любому полю обеих таблиц" aria-label="Поиск по всем данным заявок и инженеров" /><button type="button" className="plain-button" disabled={!dirty || optimizing} onClick={onReset}><RotateCcw /> Сбросить правки</button><button type="button" className="optimize-button sheet-apply" disabled={optimizing} onClick={onApply}><Route />{optimizing ? "Пересчитываем…" : "Применить и построить маршруты"}</button></div>
      {error && <p className="sheet-error" role="alert">{error}</p>}
      <p className="sheet-help"><Database size={15} />{query ? `Найдено: заявок — ${matchedJobs.length}, инженеров — ${matchedEngineers.length}. Поиск охватывает все поля, включая координаты, время, норматив, ресурсы, транспорт и статусы.` : entity === "jobs" ? "Время — местное, координаты — долгота/широта. Статус выполнения можно изменить вручную; при проигрывании плана он обновляется по прибытии и завершении работ." : "Навыки и оборудование перечисляйте через запятую. Скорость задаётся для каждого инженера; пустое поле использует значение транспорта по умолчанию."}</p>
      <div className="sheet-scroll" role="region" aria-label={`Редактор ${entity === "jobs" ? "заявок" : "инженеров"}`} tabIndex={0}>
        {entity === "jobs" ? <table className="data-sheet"><thead><tr><th>№</th><th>ID</th><th>Адрес</th><th>Район</th><th>Регион</th><th>Координаты</th><th>Окно с</th><th>Окно до</th><th>Работа, мин</th><th>Норматив</th><th>Резерв дороги</th><th>Расчёт дороги</th><th>Источник нормы</th><th>Навык</th><th>Вид работ</th><th>Оборудование</th><th>Транспорт</th><th>Явные альтернативы</th><th>Класс работ</th><th>Приоритет</th><th>Выполнение</th><th>Отменена</th><th>Источник</th></tr></thead><tbody>{shown.map(({ item, index }) => { const job = item as Job; const label = `Заявка ${job.id}`; return <tr key={index}>
          <th scope="row">{index + 1}</th><td><Cell label={`${label}: ID`} value={job.id} onChange={id => updateJob(index, { id })} /></td>
          <td><Cell label={`${label}: адрес`} value={job.address} onChange={address => updateJob(index, { address })} className="sheet-wide" /></td>
          <td><Cell label={`${label}: район`} value={job.area} onChange={area => updateJob(index, { area })} /></td>
          <td><Choice label={`${label}: регион`} value={job.region} options={regions} onChange={region => updateJob(index, { region: region as Region })} /></td>
          <td><Coordinates label={label} point={job.coordinates} onChange={coordinates => updateJob(index, { coordinates, geocodeVerified: false, geocodeQuality: "fallback" })} /></td>
          <td><Cell label={`${label}: начало окна`} type="time" value={timeInput(job.windowStart)} onChange={value => updateJob(index, { windowStart: parseTime(value), time: `${value}–${timeInput(job.windowEnd)}` })} /></td>
          <td><Cell label={`${label}: конец окна`} type="time" value={timeInput(job.windowEnd)} onChange={value => updateJob(index, { windowEnd: parseTime(value), time: `${timeInput(job.windowStart)}–${value}` })} /></td>
          <td><Cell label={`${label}: работа`} type="number" min={1} max={1440} value={job.serviceMinutes} onChange={value => updateJob(index, { serviceMinutes: Number(value), normSource: "введено пользователем" })} /></td>
          <td><Cell label={`${label}: норматив`} type="number" min={0} max={1440} value={job.normativeMinutes ?? ""} onChange={value => updateJob(index, { normativeMinutes: value ? Number(value) : undefined, normSource: "введено пользователем" })} /></td>
          <td><Cell label={`${label}: резерв поездки`} type="number" min={0} max={480} value={job.travelReserveMinutes ?? 0} onChange={value => updateJob(index, { travelReserveMinutes: Number(value) })} /></td>
          <td>{job.engineerId ? `${job.estimatedTravelMinutes ?? 0} мин` : "после расчёта"}</td>
          <td>{job.normSource ?? "демонстрационное допущение"}</td>
          <td><Choice label={`${label}: навык`} value={job.kind} options={skills} onChange={kind => updateJob(index, { kind })} /></td>
          <td><Cell label={`${label}: вид работ`} value={job.workType ?? ""} onChange={workType => updateJob(index, { workType })} /></td>
          <td><Cell label={`${label}: оборудование`} value={job.equipment} onChange={equipment => updateJob(index, { equipment })} /></td>
          <td><select aria-label={`${label}: требуемый транспорт`} value={job.requiredTransport} onChange={event => updateJob(index, { requiredTransport: event.target.value })}><option value="">Не ограничен</option>{transports.map(mode => <option key={mode}>{mode}</option>)}</select></td>
          <td><textarea aria-label={`${label}: допустимый транспорт через запятую`} key={(job.allowedTransports ?? []).join(",")} defaultValue={(job.allowedTransports ?? []).join(", ")} rows={2} onBlur={event => { const options = list(event.target.value); updateJob(index, { allowedTransports: options.length ? options : undefined }); }} /></td>
          <td><select aria-label={`${label}: класс работ`} value={job.workClass ?? "repair"} onChange={event => updateJob(index, { workClass: event.target.value as Job["workClass"] })}><option value="emergency">Авария</option><option value="connection">Подключение</option><option value="repair">Ремонт / дозаказ</option></select></td>
          <td><select aria-label={`${label}: приоритет`} value={job.urgency === "urgent" || job.priority === 2 ? "2" : "1"} onChange={event => updateJob(index, { priority: Number(event.target.value), urgency: event.target.value === "2" ? "urgent" : "normal" })}><option value="1">Обычный</option><option value="2">Повышенный</option></select></td>
          <td><select aria-label={`${label}: выполнение`} value={executionAtTime(job, stopsByJob.get(job.id), simTime)} onChange={event => updateJob(index, { executionStatus: event.target.value as Job["executionStatus"] })}>{statuses.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></td>
          <td><input type="checkbox" aria-label={`${label}: отменена`} checked={Boolean(job.cancelled)} onChange={event => updateJob(index, { cancelled: event.target.checked })} /></td>
          <td><Cell label={`${label}: источник`} value={job.source} onChange={source => updateJob(index, { source })} /></td>
        </tr>; })}</tbody></table>
          : <table className="data-sheet"><thead><tr><th>№</th><th>ID</th><th>Имя</th><th>Инициалы</th><th>Регион</th><th>Стартовая точка</th><th>Смена с</th><th>Смена до</th><th>Навыки</th><th>Оборудование</th><th>Транспорт</th><th>Скорость, км/ч</th><th>Цвет маршрута</th></tr></thead><tbody>{shown.map(({ item, index }) => { const engineer = item as Engineer; const label = `Инженер ${engineer.name}`; return <tr key={index}><th scope="row">{index + 1}</th><td><Cell label={`${label}: ID`} value={engineer.id} onChange={id => updateEngineer(index, { id })} /></td><td><Cell label={`${label}: имя`} value={engineer.name} onChange={name => updateEngineer(index, { name })} className="sheet-wide" /></td><td><Cell label={`${label}: инициалы`} value={engineer.initials} onChange={initials => updateEngineer(index, { initials })} /></td><td><Choice label={`${label}: регион`} value={engineer.region} options={regions} onChange={region => updateEngineer(index, { region: region as Region })} /></td><td><Coordinates label={label} point={engineer.start} onChange={start => updateEngineer(index, { start })} /></td><td><Cell label={`${label}: начало смены`} type="time" value={timeInput(engineer.shiftStart)} onChange={value => updateEngineer(index, { shiftStart: parseTime(value) })} /></td><td><Cell label={`${label}: конец смены`} type="time" value={timeInput(engineer.shiftEnd)} onChange={value => updateEngineer(index, { shiftEnd: parseTime(value) })} /></td><td><textarea aria-label={`${label}: навыки через запятую`} key={engineer.skills.join(",")} defaultValue={engineer.skills.join(", ")} rows={2} onBlur={event => updateEngineer(index, { skills: list(event.target.value) })} /></td><td><textarea aria-label={`${label}: оборудование через запятую`} key={engineer.equipment.join(",")} defaultValue={engineer.equipment.join(", ")} rows={2} onBlur={event => updateEngineer(index, { equipment: list(event.target.value) })} /></td><td><Choice label={`${label}: транспорт`} value={engineer.transport} options={transports} onChange={transport => updateEngineer(index, { transport })} /></td><td><Cell label={`${label}: скорость`} type="number" min={2} max={200} value={engineer.speedKmh ?? ""} onChange={value => updateEngineer(index, { speedKmh: value === "" ? undefined : Number(value) })} /><small>{engineer.speedKmh == null ? `по умолчанию ${engineerSpeedKmh(engineer.transport, undefined, carSpeedKmh)}` : "индивидуальная"}</small></td><td><input aria-label={`${label}: цвет маршрута`} type="color" value={/^#[0-9a-fA-F]{6}$/.test(engineer.color) ? engineer.color : "#7657ff"} onChange={event => updateEngineer(index, { color: event.target.value })} /></td></tr>; })}</tbody></table>}
      </div>
      {entity === "engineers" && <div className="sheet-availability"><b>Доступность инженеров</b><div>{shown.map(({ item }) => { const engineer = item as Engineer; return <label key={engineer.id}><input type="checkbox" checked={!unavailableIds.includes(engineer.id)} onChange={event => onUnavailable(event.target.checked ? unavailableIds.filter(id => id !== engineer.id) : [...unavailableIds, engineer.id])} />{engineer.name}</label>; })}</div></div>}
      <div className="sheet-footer"><span>Показано {shown.length} из {rows.length} · страница {currentPage + 1} из {pages}</span><div><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← Назад</button><button type="button" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Далее →</button></div></div>
    </div>
  </section>;
}
