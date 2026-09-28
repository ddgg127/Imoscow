import { minutesLabel } from "./vrptw.ts";

export const FIRST_EVENT_MINUTE = 450;

export type AvailabilityChange = { engineerId: string; time: number; unavailable: boolean };

/** Replay availability backwards from the latest state for historical views. */
export function unavailableAtTime(currentIds: string[], changes: AvailabilityChange[], time: number): string[] {
  const unavailable = new Set(currentIds);
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index];
    if (change.time <= time) continue;
    if (change.unavailable) unavailable.delete(change.engineerId);
    else unavailable.add(change.engineerId);
  }
  return [...unavailable];
}

/** Validate a new event independently from moving the playback cursor. */
export function eventTimeError(time: number, previous: number | null, dayEnd = 1320): string | null {
  if (!Number.isFinite(time) || time < FIRST_EVENT_MINUTE || time > dayEnd)
    return `Укажите время события с 07:30 до ${minutesLabel(dayEnd)}.`;
  if (previous !== null && time < previous)
    return `Следующее событие не может быть раньше ${minutesLabel(previous)}.`;
  return null;
}
