import type { TzReplanEvent } from "./generator-files.ts";
import { parseTime } from "./data-editor.ts";
import type { Engineer, OptimizationResult } from "./vrptw.ts";
import type { DispatchEvent } from "./temporal-replan.ts";

export type EventOutcome = { status: "applied" | "failed"; time: number; message: string };
export type EventOutcomes = Record<string, EventOutcome>;
export type PlanSnapshot = { time: number; before: OptimizationResult };

export function eventKey(event: TzReplanEvent) {
  return JSON.stringify([event.type, event.time, event.entityId, event.job ?? null]);
}
export function nextDueEvent(events: TzReplanEvent[], outcomes: EventOutcomes, time: number) {
  return events.map((event, index) => ({ event, index, time: parseTime(event.time) }))
    .filter(item => Number.isFinite(item.time) && item.time <= time && !outcomes[eventKey(item.event)])
    .sort((a, b) => a.time - b.time || a.index - b.index)[0]?.event ?? null;
}
export function planAtTime(latest: OptimizationResult, history: PlanSnapshot[], time: number) {
  return [...history].sort((a,b) => a.time - b.time).find(snapshot => snapshot.time > time)?.before ?? latest;
}
/** Completed events stay in the past. Future cached results belong to the old plan. */
export function invalidateFutureEvents(outcomes: EventOutcomes, history: PlanSnapshot[], time: number) {
  return {
    outcomes: Object.fromEntries(Object.entries(outcomes).filter(([,value]) => value.time <= time)),
    history: history.filter(snapshot => snapshot.time <= time),
  };
}

/** Build the event against the plan at its appearance, never against a future view. */
export function scheduledEventChange(event: TzReplanEvent, previous: OptimizationResult, engineers: Engineer[], unavailableIds: string[]) {
  const time = parseTime(event.time);
  if (!Number.isFinite(time) || time < 450 || time > 1320) throw new Error("Некорректное время появления события.");
  let jobs = previous.jobs;
  let unavailable = unavailableIds;
  let type: DispatchEvent["type"];
  if (event.type === "отмена заявки") {
    type = "cancel_job";
    const job = jobs.find(item => item.id === event.entityId);
    if (!job) throw new Error("Отменяемая заявка ещё не появилась или отсутствует в наборе.");
    const stop = previous.routes.flatMap(route => route.stops).find(item => item.jobId === job.id);
    if (job.cancelled) throw new Error("Заявка уже отменена.");
    if (time >= job.windowEnd) throw new Error("Окно выполнения заявки уже закончилось: отмена невозможна.");
    if (job.executionStatus === "completed" || (stop && time >= stop.end)) throw new Error("Заявка уже выполнена: отмена невозможна.");
    if (stop && time >= stop.start) throw new Error("Заявка выполняется: отмена невозможна.");
    jobs = jobs.map(item => item.id === job.id ? { ...item, cancelled: true } : item);
  } else if (event.type === "недоступность инженера") {
    type = "engineer_unavailable";
    if (!engineers.some(engineer => engineer.id === event.entityId)) throw new Error("Инженер отсутствует в наборе.");
    if (unavailableIds.includes(event.entityId)) throw new Error("Инженер уже вне смены.");
    unavailable = [...unavailableIds, event.entityId];
  } else if (event.type === "срочная заявка" && !event.job) {
    type = "recalculate";
    const target=jobs.find(item=>item.id===event.entityId);
    if (!target || target.cancelled) throw new Error("Заявка для повышения приоритета отсутствует или отменена.");
    const stop=previous.routes.flatMap(route=>route.stops).find(item=>item.jobId===target.id);
    if (time>=target.windowEnd || (stop && time>=stop.start) || target.executionStatus==="completed") throw new Error("Заявка уже началась или завершилась: повысить приоритет поздно.");
    jobs=jobs.map(item=>item.id===target.id ? {...item,priority:2,urgency:"urgent" as const} : item);
  } else {
    type = "new_job";
    const job = event.job;
    if (!job || job.id !== event.entityId || jobs.some(item => item.id === job.id)) throw new Error("Проверьте номер и параметры новой заявки.");
    if (job.geocodeVerified !== true) throw new Error("Координаты новой заявки не подтверждены.");
    if (Math.max(time,job.windowStart) + job.serviceMinutes > job.windowEnd) throw new Error("Работы не помещаются в окно после появления заявки.");
    const urgent=event.type==="срочная заявка";
    jobs = [...jobs, { ...job, priority: urgent ? 2 : 1, urgency: urgent ? "urgent" as const : "normal" as const, cancelled: false, engineerId: null, baselineEngineerId: null, executionStatus: "not_started" as const }];
  }
  return { dispatch: { type, time, id: event.entityId } as DispatchEvent, jobs, unavailableIds: unavailable };
}
