export const TZ_SKILLS = [
  "Локальные работы",
  "Работы на подключение и дозаказы",
  "Аварийные работы",
] as const;

export const EXTRA_SKILLS = [
  "Монтаж СКС",
  "Видеонаблюдение",
  "Электропитание",
] as const;

export const ALL_SKILLS = [...TZ_SKILLS, ...EXTRA_SKILLS] as const;

export const SKILL_EQUIPMENT_POOLS: Record<string, readonly string[]> = {
  "Локальные работы": ["Диагностический комплект", "Кабельный тестер", "Wi-Fi анализатор", "Мультиметр"],
  "Работы на подключение и дозаказы": ["ONT", "Сварочный аппарат", "Оптический кросс", "Монтажный набор GPON"],
  "Аварийные работы": ["Рефлектометр", "Трассоискатель", "Аварийный комплект", "Тепловизор"],
  "Монтаж СКС": ["Обжимной инструмент", "Тестер витой пары", "Кабельный органайзер"],
  "Видеонаблюдение": ["Комплект IP-камеры", "PoE-инжектор", "Видеорегистратор"],
  "Электропитание": ["ИБП-тестер", "Клещи токовые", "Набор для шкафа питания"],
};

export const SKILL_EQUIPMENT: Record<string, string> = Object.fromEntries(
  Object.entries(SKILL_EQUIPMENT_POOLS).map(([skill, pool]) => [skill, pool[0] ?? skill]),
);

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
export type ExtraSkill = (typeof EXTRA_SKILLS)[number];
export type Vehicle = (typeof VEHICLES)[number];
export type PriorityLabel = (typeof PRIORITIES)[number];

export const LEGACY_SKILLS = [
  "Подключение и модернизация",
  "Аварийно-восстановительные работы",
] as const;

const SKILL_ALIASES: Record<string, string> = {
  "локальные работы": "Локальные работы",
  "работы на подключение и дозаказы": "Работы на подключение и дозаказы",
  "аварийные работы": "Аварийные работы",
  "монтаж скс": "Монтаж СКС",
  "скс": "Монтаж СКС",
  "видеонаблюдение": "Видеонаблюдение",
  "электропитание": "Электропитание",
};

export function canonicalSkill(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return TZ_SKILLS[0];
  const lower = trimmed.toLocaleLowerCase("ru");
  const preserved = [...ALL_SKILLS, ...LEGACY_SKILLS].find(skill => skill.toLocaleLowerCase("ru") === lower);
  if (preserved) return preserved;
  const aliased = SKILL_ALIASES[lower];
  if (aliased) return aliased;
  if (/видеонаблюд|ip.?камер|видеорегистр/i.test(trimmed)) return "Видеонаблюдение";
  if (/скс|витой пар|патч.?панел/i.test(trimmed)) return "Монтаж СКС";
  if (/электропитан|ибп|щитов/i.test(trimmed)) return "Электропитание";
  if (/авар|повреж|обрыв|нет\s*(?:линк|связ)|восстанов|недоступ/i.test(trimmed)) return TZ_SKILLS[2];
  if (/подключ|дозаказ|gpon|гигабит|конверг|миграц/i.test(trimmed)) return TZ_SKILLS[1];
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

export function plannerSkills(raw: string, level = ""): string[] {
  const parts = raw.split(/[,;]/).map(part => part.trim()).filter(Boolean);
  const mapped = [...new Set(parts.map(canonicalSkill))];
  if (mapped.length) return mapped;
  if (/профи/i.test(level)) return [...TZ_SKILLS];
  if (/специал/i.test(level)) return [TZ_SKILLS[0], TZ_SKILLS[1]];
  return [TZ_SKILLS[0]];
}

export function equipmentFor(raw: string, skill: string) {
  if (raw) return raw;
  return SKILL_EQUIPMENT[skill] ?? SKILL_EQUIPMENT[TZ_SKILLS[0]] ?? "Диагностический комплект";
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
