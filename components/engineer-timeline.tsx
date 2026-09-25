"use client";

import { useEffect, useMemo } from "react";
import {
  Clock,
  MapPin,
  Route,
  User,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { Engineer, Job, RoutePlan } from "@/lib/vrptw";

function minutesLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDistance(km: number) {
  return `${km.toFixed(1).replace(".", ",")} км`;
}

export function EngineerTimeline({
  engineer,
  route,
  jobs,
  simTime,
  onSelectJob,
  onClose,
}: {
  engineer: Engineer;
  route?: RoutePlan;
  jobs: Job[];
  simTime: number | null;
  onSelectJob: (id: string) => void;
  onClose: () => void;
}) {
  const jobMap = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs]);

  // Timeline bounds: 07:00 to 20:00 (780 mins total)
  const timelineStart = Math.min(7 * 60, Math.floor(engineer.shiftStart / 60) * 60);
  const timelineEnd = Math.max(20 * 60, Math.ceil(engineer.shiftEnd / 60) * 60);
  const totalMinutes = timelineEnd - timelineStart;

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let m = timelineStart; m <= timelineEnd; m += 60) {
      list.push(m);
    }
    return list;
  }, [timelineStart, timelineEnd]);

  const shiftLeft = Math.max(0, ((engineer.shiftStart - timelineStart) / totalMinutes) * 100);
  const shiftWidth = Math.min(100 - shiftLeft, ((engineer.shiftEnd - engineer.shiftStart) / totalMinutes) * 100);

  const scrubberPos = simTime != null && simTime >= timelineStart && simTime <= timelineEnd
    ? ((simTime - timelineStart) / totalMinutes) * 100
    : null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <section className="panel engineer-timeline-panel" aria-label="Маршрут и расписание выбранного инженера">
      <button
        type="button"
        className="timeline-close-compact-btn"
        onClick={onClose}
        aria-label="Снять выбор инженера (Esc)"
        title="Снять выбор (Esc)"
      >
        <X size={15} />
      </button>

      <div className="engineer-timeline-body">
        {/* Left identity card */}
        <div className="engineer-identity-card">
          <div className="identity-avatar-box" style={{ background: `${engineer.color}15`, borderColor: engineer.color }}>
            <User size={34} style={{ color: engineer.color }} />
          </div>
          <div className="identity-meta">
            <strong className="identity-name">{engineer.name}</strong>
            <span className="identity-id-badge" title="Идентификатор для поиска в базе данных">
              ID: {engineer.id}
            </span>
            <span className="identity-region">{engineer.region}</span>
          </div>
        </div>

        {/* Right timeline / video-editor Gantt track */}
        <div className="timeline-track-wrap">
          {/* Track board with integrated time ruler & playhead */}
          <div className="timeline-board">
            {/* Hour grid lines, ticks and labels inside the board */}
            <div className="timeline-board-ruler" aria-hidden="true">
              {hours.map(hour => {
                const leftPercent = ((hour - timelineStart) / totalMinutes) * 100;
                return (
                  <div key={hour} className="board-ruler-mark" style={{ left: `${leftPercent}%` }}>
                    <span className="board-ruler-grid-line" />
                    <span className="board-ruler-tick" />
                    <span className="board-ruler-label">{minutesLabel(hour)}</span>
                  </div>
                );
              })}
            </div>

            {/* Shift background highlight */}
            <div
              className="timeline-shift-backdrop"
              style={{ left: `${shiftLeft}%`, width: `${shiftWidth}%` }}
              title={`Смена: ${minutesLabel(engineer.shiftStart)}–${minutesLabel(engineer.shiftEnd)}`}
            >
              <span className="shift-boundary start">Старт {minutesLabel(engineer.shiftStart)}</span>
              <span className="shift-boundary end">Конец {minutesLabel(engineer.shiftEnd)}</span>
            </div>

            {/* Tasks / Stops clips on timeline */}
            {route && route.stops.length > 0 ? (
              <div className="timeline-clips-track">
                {route.stops.map((stop, idx) => {
                  const job = jobMap.get(stop.jobId);
                  const isUrgent = (job?.priority ?? 1) >= 10;
                  const travelMin = stop.travelMinutes ?? Math.round(stop.distanceKm * 2.5);
                  const travelStart = Math.max(timelineStart, stop.arrival - travelMin);
                  const travelLeft = Math.max(0, ((travelStart - timelineStart) / totalMinutes) * 100);
                  const travelWidth = Math.max(1.2, ((stop.arrival - travelStart) / totalMinutes) * 100);

                  const stopLeft = Math.max(0, ((stop.start - timelineStart) / totalMinutes) * 100);
                  const stopDuration = Math.max(15, stop.end - stop.start);
                  const stopWidth = Math.max(2.4, (stopDuration / totalMinutes) * 100);

                  const hasWait = stop.start > stop.arrival;
                  const waitLeft = ((stop.arrival - timelineStart) / totalMinutes) * 100;
                  const waitWidth = Math.max(0.8, ((stop.start - stop.arrival) / totalMinutes) * 100);

                  return (
                    <div key={stop.jobId} className="timeline-step-bundle">
                      {/* Travel strip */}
                      {travelMin > 0 && (
                        <div
                          className="travel-clip"
                          style={{ left: `${travelLeft}%`, width: `${travelWidth}%` }}
                          title={`Дорога: ${travelMin} мин (${stop.distanceKm.toFixed(1)} км)`}
                        >
                          <span className="clip-car">🚗</span>
                        </div>
                      )}

                      {/* Wait strip if engineer arrived earlier than window */}
                      {hasWait && (
                        <div
                          className="wait-clip"
                          style={{ left: `${waitLeft}%`, width: `${waitWidth}%` }}
                          title={`Ожидание открытия окна: ${stop.start - stop.arrival} мин`}
                        />
                      )}

                      {/* Task block (clip) */}
                      <div
                        className={`task-clip ${isUrgent ? "urgent" : ""}`}
                        style={{
                          left: `${stopLeft}%`,
                          width: `${stopWidth}%`,
                          borderColor: isUrgent ? "#b91c1c" : undefined,
                        }}
                        onClick={() => onSelectJob(stop.jobId)}
                        title={`Заявка ${stop.jobId}: ${minutesLabel(stop.start)}–${minutesLabel(stop.end)} (${job?.kind ?? ""})`}
                      >
                        <div className="clip-header">
                          <span className="clip-index">{idx + 1}</span>
                          <strong className="clip-id">{stop.jobId}</strong>
                          {isUrgent && <Zap size={10} className="clip-zap" />}
                        </div>
                        <span className="clip-time">
                          {minutesLabel(stop.start)}–{minutesLabel(stop.end)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="timeline-empty-msg">
                Маршрут ещё не построен или у инженера нет назначенных заявок на выбранную дату
              </div>
            )}

            {/* Simulation playhead / scrubber needle */}
            {scrubberPos !== null && (
              <div className="timeline-playhead" style={{ left: `${scrubberPos}%` }}>
                <span className="playhead-badge">{minutesLabel(simTime!)}</span>
                <span className="playhead-line" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Structured, separated engineer info below the timeline */}
      <div className="engineer-details-shelf">
        <div className="shelf-group">
          <div className="shelf-group-header">
            <Clock size={15} />
            <span>График и время</span>
          </div>
          <div className="shelf-items">
            <div className="shelf-item">
              <small>Смена</small>
              <strong>{minutesLabel(engineer.shiftStart)} – {minutesLabel(engineer.shiftEnd)}</strong>
            </div>
            <div className="shelf-item">
              <small>Длительность смены</small>
              <strong>{((engineer.shiftEnd - engineer.shiftStart) / 60).toFixed(0)} часов</strong>
            </div>
            <div className="shelf-item">
              <small>Транспорт</small>
              <strong>{engineer.transport}</strong>
            </div>
          </div>
        </div>

        <div className="shelf-group">
          <div className="shelf-group-header">
            <MapPin size={15} />
            <span>Старт и базирование</span>
          </div>
          <div className="shelf-items">
            <div className="shelf-item wide">
              <small>Адрес старта</small>
              <strong>{(engineer as any).address ?? "Жилой дом (Москва)"}</strong>
            </div>
            <div className="shelf-item">
              <small>Координаты</small>
              <strong>{engineer.start[1].toFixed(5)}, {engineer.start[0].toFixed(5)}</strong>
            </div>
          </div>
        </div>

        <div className="shelf-group">
          <div className="shelf-group-header">
            <Wrench size={15} />
            <span>Навыки и инструмент</span>
          </div>
          <div className="shelf-items-column">
            <div className="shelf-badge-list">
              <small>Навыки инженера ({engineer.skills.length}):</small>
              <div className="badges-row">
                {engineer.skills.map(s => (
                  <span key={s} className="shelf-skill-badge">{s}</span>
                ))}
              </div>
            </div>
            <div className="shelf-badge-list">
              <small>Инструмент по навыкам:</small>
              <div className="badges-row">
                {engineer.equipment.map(eq => (
                  <span key={eq} className="shelf-equip-badge">{eq}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="shelf-group stats-group">
          <div className="shelf-group-header">
            <Route size={15} />
            <span>Итоги смены</span>
          </div>
          <div className="shelf-items">
            <div className="shelf-item">
              <small>Заявок в плане</small>
              <strong className="stat-value">{route?.stops.length ?? 0}</strong>
            </div>
            <div className="shelf-item">
              <small>Загрузка смены</small>
              <strong className="stat-value">{route?.load ?? 0}%</strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
