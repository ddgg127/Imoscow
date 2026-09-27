"use client";

import { AlertTriangle, Clock3, LogOut, MapPin, Route, ShieldAlert } from "lucide-react";
import { MapCanvas, type RoutingState } from "@/components/map-canvas";
import { TimeDrum } from "@/components/time-drum";
import { actionAtSimTime } from "@/components/map-canvas";
import { jobPriorityLevel, minutesLabel, type Engineer, type Job, type RoutePlan } from "@/lib/vrptw";
import type { AbsenceMoment } from "@/lib/engineer-absence";

export type EngineerAbsenceReason = "left" | "emergency";

type Props = {
  engineer: Engineer | null;
  jobs: Job[];
  route?: RoutePlan;
  allEngineers: Engineer[];
  unavailableIds: string[];
  absenceReasons: Record<string, EngineerAbsenceReason>;
  absenceMoments: Record<string, AbsenceMoment>;
  selectedJobId: string | null;
  onSelectEngineer: (id: string) => void;
  onSelectJob: (id: string | null) => void;
  onReport: (reason: EngineerAbsenceReason) => void;
  reporting: boolean;
  error: string;
  simTime: number;
  simEnd: number;
  simPlaying: boolean;
  simSpeed: number;
  onSimTime: (value: number) => void;
  onSimPlaying: (value: boolean) => void;
  onSimSpeed: (value: number) => void;
  speedKmh: number;
  onRoutingState: (state: RoutingState) => void;
};

export function EngineerWorkspace(props: Props) {
  const { engineer, jobs, route, allEngineers, unavailableIds, absenceReasons, absenceMoments, selectedJobId, onSelectEngineer, onSelectJob, onReport, reporting, error, simTime, simEnd, simPlaying, simSpeed, onSimTime, onSimPlaying, onSimSpeed, speedKmh, onRoutingState } = props;
  const ownJobs = engineer ? route?.stops.map(stop => jobs.find(job => job.id === stop.jobId)).filter((job): job is Job => Boolean(job)) ?? [] : [];
  const unavailable = Boolean(engineer && unavailableIds.includes(engineer.id));
  const absence = engineer ? absenceMoments[engineer.id] : undefined;
  const reported = Boolean(absence && simTime >= absence.reportedAt);
  const finishedExit = Boolean(absence && simTime >= absence.effectiveAt);
  const nextStop = reported && finishedExit ? undefined : route?.stops.find(stop => stop.end > simTime);
  const nextJob = ownJobs.find(job => job.id === nextStop?.jobId);
  const currentAction = engineer ? actionAtSimTime(engineer, route ?? null, simTime) : null;
  const activeCount = reported && finishedExit ? 0 : route?.stops.filter(stop => stop.end > simTime).length ?? 0;

  return <section className="engineer-workspace">
    <div className="engineer-identity panel">
      <div><span className="eyebrow">Рабочее место инженера</span><h2>{engineer ? engineer.name : "Выберите инженера"}</h2><p>{engineer ? `${engineer.region} · ${engineer.transport} · смена ${minutesLabel(engineer.shiftStart)}–${minutesLabel(engineer.shiftEnd)}` : "Выберите сотрудника из того же списка, который доступен диспетчеру."}</p></div>
      <label>Инженер<select aria-label="Выбрать инженера" value={engineer?.id ?? ""} onChange={event => { onSelectEngineer(event.target.value); onSelectJob(null); }}><option value="">Выберите инженера</option>{allEngineers.map(item => <option key={item.id} value={item.id}>{item.name} ({item.id}){unavailableIds.includes(item.id) && (!absenceMoments[item.id] || simTime >= absenceMoments[item.id].effectiveAt) ? " · вне смены" : absenceMoments[item.id] && simTime >= absenceMoments[item.id].reportedAt ? " · завершает заявку" : ""}</option>)}</select></label>
    </div>
    {engineer && <>
      {unavailable && absence && <div className="engineer-status-banner" role="status"><ShieldAlert size={19} /><div><strong>{absenceReasons[engineer.id] === "emergency" ? "ЧС передано диспетчеру" : "Выход из смены зарегистрирован"}</strong><p>Сообщено в {minutesLabel(absence.reportedAt)} · {absence.phase === "service" ? `завершение заявки №${absence.currentJobId} в ${minutesLabel(absence.effectiveAt)}, затем вне смены` : `вне смены с ${minutesLabel(absence.effectiveAt)}`} · уже завершено: {absence.completedBefore}.</p><p>{simTime < absence.reportedAt ? "На таймлайне показано время до события." : !finishedExit ? "Текущая заявка завершается." : "Будущие заявки переданы на перепланирование."}</p></div></div>}
      {error && <div className="engineer-status-banner error" role="alert"><AlertTriangle size={19} /><div><strong>Не удалось передать событие</strong><p>{error}</p></div></div>}
      <div className="engineer-overview">
        <article className="panel engineer-next"><span className="eyebrow"><Clock3 size={15} /> Следующее задание · {minutesLabel(simTime)}</span>{nextJob && nextStop ? <><h3>№{nextJob.id} · {nextJob.kind}</h3><p><MapPin size={15} />{nextJob.address}</p><div className="engineer-next-meta"><span>Окно {nextJob.time}</span><span>Прибытие {minutesLabel(nextStop.arrival)}</span><span>{jobPriorityLevel(nextJob) === 2 ? "Повышенный приоритет" : "Обычный приоритет"}</span></div><button type="button" className="engineer-link" onClick={() => onSelectJob(nextJob.id)}>Показать на карте</button></> : <><h3>{finishedExit ? "Новых заданий нет" : route?.stops.length ? "На это время задания завершены" : "Заданий пока нет"}</h3><p>{finishedExit ? "Будущие заявки переданы диспетчеру. Завершённые визиты сохранены в истории." : "Новые задания появятся после построения или обновления плана."}</p></> }</article>
        <article className="panel engineer-shift"><span className="eyebrow"><Route size={15} /> Моя смена</span><strong>{activeCount} <small>осталось из {route?.stops.length ?? 0}</small></strong><p>{finishedExit ? "Вне смены" : reported ? "Завершает текущую заявку" : currentAction?.phase === "travel" ? "В пути к заявке" : currentAction?.phase === "service" ? "Выполнение заявки" : currentAction?.phase === "wait" ? "Ожидание окна" : "В смене"}</p><div className="engineer-actions"><button type="button" className="engineer-emergency" disabled={unavailable || reporting} onClick={() => onReport("emergency")}><ShieldAlert size={16} />Случилось ЧС</button><button type="button" className="engineer-leave" disabled={unavailable || reporting} onClick={() => onReport("left")}><LogOut size={16} />Выйти с работы</button></div></article>
      </div>
      <div className="engineer-content">
        <article className="panel engineer-map"><div className="panel-header"><div><h2>Мой маршрут</h2><p>{ownJobs.length} заявок · только маршрут {engineer.name}</p></div></div><div className="map-stage"><MapCanvas visibleJobs={ownJobs} baselineJobs={ownJobs} engineers={[engineer]} selectedEngineerId={engineer.id} selectedJobId={selectedJobId} simTime={route ? simTime : null} simPlaying={simPlaying} simSpeed={simSpeed} carSpeedKmh={speedKmh} simEnd={simEnd} onSimTime={onSimTime} onSimPlaying={onSimPlaying} compare={false} routingEnabled={Boolean(route)} routes={route ? [route] : []} baselineRoutes={[]} onSelectEngineer={() => onSelectJob(null)} onSelectJob={id => onSelectJob(id)} onInspectJob={id => onSelectJob(id)} onRoutingState={onRoutingState} singleEngineerMode />{route && <TimeDrum start={engineer.shiftStart} end={simEnd} time={simTime} playing={simPlaying} speed={simSpeed} onTime={onSimTime} onPlaying={onSimPlaying} onSpeed={onSimSpeed} disabled={reporting} />}</div></article>
        <article className="panel engineer-task-list"><div className="panel-header"><div><h2>Мои задания</h2><p>По порядку маршрута</p></div></div>{route?.stops.length ? <div className="engineer-stops">{route.stops.map((stop, index) => { const job = ownJobs.find(item => item.id === stop.jobId); if (!job) return null; return <button type="button" key={stop.jobId} className={selectedJobId === stop.jobId ? "selected" : ""} onClick={() => onSelectJob(selectedJobId === stop.jobId ? null : stop.jobId)}><span className="engineer-stop-number">{index + 1}</span><span><strong>№{job.id} · {job.kind}</strong><small>{job.address}</small><small>{minutesLabel(stop.start)}–{minutesLabel(stop.end)} · {stop.end <= simTime ? "Завершено" : stop.start <= simTime ? "В работе" : "Ожидает"}</small></span></button>; })}</div> : <p className="engineer-empty">Назначенных заданий нет.</p>}</article>
      </div>
    </>}
  </section>;
}
