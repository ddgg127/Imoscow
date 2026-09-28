"use client";

import { AlertTriangle, Clock3, MapPin, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JobStatus } from "@/components/job-status";
import { jobPriorityLevel, minutesLabel, type Engineer, type Job, type RoutePlan } from "@/lib/vrptw";

export function JobDetailsDialog({ job, executionStatus, engineer, plan, started, loading, actionNotice, onClose, onShowOnMap, onToggleCancelled }: {
  job: Job | null; executionStatus?: Job["executionStatus"]; engineer?: Engineer; plan?: RoutePlan;
  started: boolean; loading: boolean; actionNotice: string; onClose: () => void;
  onShowOnMap: (id: string) => void; onToggleCancelled: (id: string) => void;
}) {
  const stop = job ? plan?.stops.find(item => item.jobId === job.id) : undefined;
  return <Dialog open={Boolean(job)} onOpenChange={open => !open && onClose()}>
    <DialogContent className="job-inspect-dialog job-compact-dialog">
      <DialogHeader><DialogTitle>Заявка №{job?.id}</DialogTitle><DialogDescription className="sr-only">Адрес, время, приоритет и исполнитель заявки. Дополнительные параметры доступны в разделе «Подробнее».</DialogDescription></DialogHeader>
      {job && <div className="job-inspect-body" key={job.id}>
        <div className="job-hero-card">
          <div className="hero-address-row"><MapPin size={18} className="hero-pin-icon" /><strong>{job.address}</strong></div>
          <div className="job-summary-meta"><span><Clock3 size={16} />Окно {job.time}</span><span className={`hero-priority-badge ${jobPriorityLevel(job) === 2 ? "urgent" : "normal"}`}>{jobPriorityLevel(job) === 2 && <Zap size={13} />}{jobPriorityLevel(job) === 2 ? "Повышенный приоритет" : "Обычный приоритет"}</span><JobStatus job={{ ...job, executionStatus: executionStatus ?? job.executionStatus }} started={started} /></div>
        </div>
        <section className="job-assignee-summary" aria-label="Назначенный инженер">
          {job.cancelled ? <p className="job-pending-assignment-note">Заявка отменена и исключена из смены.</p> : engineer && stop && plan ? <div className="job-assigned-card">
            <div className="assigned-engineer-header"><span className="assigned-avatar" style={{ background: `${engineer.color}20`, color: engineer.color }}>{engineer.initials}</span><div><small>Назначенный инженер</small><strong>{engineer.name}</strong></div></div>
            <div className="assigned-schedule-row"><span>Работа <b>{minutesLabel(stop.start)}–{minutesLabel(stop.end)}</b></span><span>Остановка <b>{plan.stops.findIndex(item => item.jobId === job.id) + 1}/{plan.stops.length}</b></span></div>
          </div> : (executionStatus ?? job.executionStatus) === "completed" ? <p className="job-pending-assignment-note">Работа завершена. Повторное назначение не требуется.</p> : started ? <div className="job-unassigned-card"><AlertTriangle size={18} /><div><strong>Не назначена</strong><p>{job.unassignedReason ?? "Не удалось встроить в текущую смену."}</p></div></div> : <div className="job-pending-assignment-note"><Clock3 size={16} /><div><strong>{loading ? "Рассчитываем план…" : "Исполнитель пока не назначен"}</strong><p>Инженер и время обслуживания появятся после расчёта.</p></div></div>}
        </section>
        <details className="job-more-details"><summary>Подробнее</summary><div className="job-detail-grid">
          <div className="detail-item"><small>Требуемый навык</small><strong>{job.kind}</strong></div>
          <div className="detail-item"><small>Длительность работ</small><strong>{job.serviceMinutes} мин</strong></div>
          <div className="detail-item"><small>Расчётное время в пути</small><strong>{stop ? `${stop.travelMinutes ?? job.estimatedTravelMinutes ?? 0} мин` : "После назначения"}</strong></div>
          <div className="detail-item"><small>Требуемый транспорт</small><strong>{job.requiredTransport || "Не ограничен"}</strong></div>
          <div className="detail-item"><small>Оборудование</small><strong>{job.equipment}</strong></div>
          <div className="detail-item"><small>Зона</small><strong>{job.region}</strong></div>
          {engineer && <div className="detail-item"><small>Транспорт инженера</small><strong>{engineer.transport}</strong></div>}
        </div></details>
      </div>}
      {actionNotice && <p role="alert" className="job-action-notice">{actionNotice}</p>}
      <DialogFooter><Button variant="outline" disabled={loading} onClick={() => { if (job) onToggleCancelled(job.id); }}>{job?.cancelled ? "Восстановить заявку" : "Отменить заявку"}</Button><Button variant="outline" disabled={!job?.engineerId || job.cancelled} onClick={() => { if (job) onShowOnMap(job.id); }}>Показать на карте</Button><Button onClick={onClose}>Закрыть</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
