export const TZ_SKILLS = [
  "Локальные работы",
  "Работы на подключение и дозаказы",
  "Аварийные работы",
] as const;

export const VEHICLES = [
  "Автомобиль",
  "Пешеход",
  "Велосипед",
  "Общественный транспорт",
] as const;

export const PRIORITIES = ["Обычная", "Срочная"] as const;

export const PRIORITY_NORMAL = 1;
export const PRIORITY_URGENT = 10;

export type TzSkill = (typeof TZ_SKILLS)[number];
export type Vehicle = (typeof VEHICLES)[number];
export type PriorityLabel = (typeof PRIORITIES)[number];

const SKILL_ALIASES: Record<string, TzSkill> = {
  "локальные работы": "Локальные работы",
  "подключение и модернизация": "Работы на подключение и дозаказы",
  "работы на подключение и дозаказы": "Работы на подключение и дозаказы",
  "аварийно-восстановительные работы": "Аварийные работы",
  "аварийные работы": "Аварийные работы",
};

export function canonicalSkill(raw: string): TzSkill {
  const exact = SKILL_ALIASES[raw.trim().toLocaleLowerCase("ru")];
  if (exact) return exact;
  if (/авар|повреж|обрыв|нет\s*(?:линк|связ)|восстанов|недоступ/i.test(raw)) return TZ_SKILLS[2];
  if (/подключ|монтаж|дозаказ|gpon|гигабит|конверг|миграц|замен/i.test(raw)) return TZ_SKILLS[1];
  return TZ_SKILLS[0];
}

export function canonicalTransport(raw: string): Vehicle {
  if (/пеш/i.test(raw)) return "Пешеход";
  if (/вело/i.test(raw)) return "Велосипед";
  if (/обществен|метро|автобус/i.test(raw)) return "Общественный транспорт";
  if (/авто/i.test(raw)) return "Автомобиль";
  return VEHICLES.includes(raw as Vehicle) ? raw as Vehicle : "Автомобиль";
}

export function priorityFromRaw(raw: string): number {
  if (/срочн/i.test(raw)) return PRIORITY_URGENT;
  const parsed = Number(String(raw).replace(",", "."));
  if (Number.isFinite(parsed) && parsed >= PRIORITY_URGENT) return PRIORITY_URGENT;
  return PRIORITY_NORMAL;
}

export function priorityLabel(priority: number): PriorityLabel {
  return priority >= PRIORITY_URGENT ? "Срочная" : "Обычная";
}

export function plannerSkills(raw: string, level = ""): TzSkill[] {
  const parts = raw.split(/[,;]/).map(part => part.trim()).filter(Boolean);
  const mapped = [...new Set(parts.map(canonicalSkill))];
  if (/профи/i.test(level) || parts.length >= 3) return [...TZ_SKILLS];
  if (/специал/i.test(level) || parts.length === 2) return mapped.length >= 2 ? mapped : [TZ_SKILLS[0], TZ_SKILLS[1]];
  return mapped.length ? mapped : [TZ_SKILLS[0]];
}

export function equipmentFor(raw: string, skill: string) {
  if (raw) return raw;
  if (skill === TZ_SKILLS[2]) return "Рефлектометр";
  if (skill === TZ_SKILLS[1]) return "ONT";
  return "Диагностический комплект";
}

export function serviceMinutesFor(raw: string, skill: string) {
  const explicit = Number(raw);
  if (Number.isFinite(explicit) && explicit >= 5 && explicit <= 480) return Math.round(explicit);
  if (skill === TZ_SKILLS[2]) return 60;
  if (skill === TZ_SKILLS[1]) return 45;
  return 30;
}

export function allowedTransportsFor(skill: string, required: string, equipment = ""): Vehicle[] {
  const vehicle = canonicalTransport(required);
  if (skill === TZ_SKILLS[2]) return [...new Set([vehicle, "Автомобиль" as const])];
  if (equipment === "Комплект GPON") return [...new Set([vehicle, "Автомобиль" as const, "Общественный транспорт" as const])];
  return [...VEHICLES];
}

export function serviceMinutesForKind(kind: string) {
  if (kind === TZ_SKILLS[2]) return 90;
  if (kind === TZ_SKILLS[1]) return 60;
  return 30;
}

/** Keep extras at the end of a limited table slice so a new job is not clipped off. */
export function queueWithExtras<T extends { id: string }>(jobs: T[], extras: T[], limit: number): T[] {
  if (jobs.length <= limit) return jobs;
  const extraIds = new Set(extras.map(item => item.id));
  const tail = jobs.filter(job => extraIds.has(job.id));
  const head = jobs.filter(job => !extraIds.has(job.id));
  return [...head.slice(0, Math.max(0, limit - tail.length)), ...tail];
}
