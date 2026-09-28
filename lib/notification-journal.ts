import type { Engineer, Job } from "./vrptw.ts";

export type NotificationKind = "cancelled" | "restored" | "left" | "emergency" | "reassigned" | "unassigned";
export type NotificationDraft = { kind: NotificationKind; time: number; title: string; message: string; engineerIds?: string[] };
export type JournalEntry = NotificationDraft & { id: string; recordedAt: string };
export const JOURNAL_STORAGE_KEY = "fieldflow-notification-journal-v1";

/** Only assignment changes are logged; playback and dismissing a banner do not create events. */
export function reassignmentNotifications(before: Job[], after: Job[], engineers: Engineer[], time: number): NotificationDraft[] {
  const previous = new Map(before.map(job => [job.id, job]));
  const names = new Map(engineers.map(engineer => [engineer.id, engineer.name]));
  const changes = new Map<string, { oldId: string; newId: string | null; jobs: string[] }>();
  for (const job of after) {
    const old = previous.get(job.id);
    if (!old?.engineerId || old.cancelled || job.cancelled || old.executionStatus === "completed" || job.executionStatus === "completed" || old.engineerId === job.engineerId) continue;
    const key = JSON.stringify([old.engineerId, job.engineerId]);
    const group = changes.get(key) ?? { oldId: old.engineerId, newId: job.engineerId, jobs: [] };
    group.jobs.push(job.id);
    changes.set(key, group);
  }
  return [...changes.values()].map(group => ({
    kind: group.newId ? "reassigned" : "unassigned", time,
    title: group.newId ? "Заявки переназначены" : "Заявки остались без исполнителя",
    message: `№${group.jobs.join(", №")} · ${names.get(group.oldId) ?? group.oldId} → ${group.newId ? names.get(group.newId) ?? group.newId : "нет доступного назначения"}.`,
    engineerIds: [group.oldId, ...(group.newId ? [group.newId] : [])],
  }));
}

export function readJournal(raw: string | null): JournalEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    const kinds: NotificationKind[] = ["cancelled", "restored", "left", "emergency", "reassigned", "unassigned"];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is JournalEntry => Boolean(entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.message === "string" && kinds.includes(entry.kind) && Number.isFinite(entry.time) && entry.time >= 0 && entry.time <= 1440 && typeof entry.recordedAt === "string" && Number.isFinite(Date.parse(entry.recordedAt)) && (entry.engineerIds === undefined || (Array.isArray(entry.engineerIds) && entry.engineerIds.every((id: unknown) => typeof id === "string")))));
  } catch { return []; }
}
