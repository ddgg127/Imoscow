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

export type Vehicle = (typeof VEHICLES)[number];

export const PRIORITIES = ["Обычная", "Повышенная"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ENGINEER_LEVELS = ["новичок", "специалист", "профи"] as const;
export type EngineerLevel = (typeof ENGINEER_LEVELS)[number];

export type SkillCount = 1 | 2 | 3 | 4;

export type Place = {
  address: string;
  lat: number;
  lon: number;
};

export type Job = Place & {
  id: string;
  title: string;
  durationMin: number;
  windowStart: string;
  windowEnd: string;
  priority: Priority;
  skills: string[];
  skillCount: SkillCount;
  equipment?: string;
  vehicle?: Vehicle;
};

export type Engineer = Place & {
  id: string;
  name: string;
  shiftStart: string;
  shiftEnd: string;
  skills: string[];
  equipment?: string[];
  vehicle: Vehicle;
  level: EngineerLevel;
};

export type ReplanEventType =
  | "срочная заявка"
  | "отмена заявки"
  | "недоступность инженера";

export type ReplanEvent = {
  type: ReplanEventType;
  time: string;
  jobId?: string;
  engineerId?: string;
  job?: Job;
};

export type Dataset = {
  meta: {
    seed: number;
    generatedAt: string;
    notes: string[];
    params: GenerateParams;
    catalog: { skills: number; tasks: number };
  };
  jobs: Job[];
  engineers: Engineer[];
  events: ReplanEvent[];
};

export type GenerateParams = {
  engineerCount: number;
  jobCount: number;
  jobEasy: number;
  jobMedium: number;
  jobHard: number;
  novice: number;
  specialist: number;
  pro: number;
  urgentShare: number;
  vehicleConstraintShare: number;
  cancelEvents: number;
  unavailableEvents: number;
  urgentEvents: number;
  seed: number;
};

export const DEFAULT_GENERATE_PARAMS: GenerateParams = {
  engineerCount: 12,
  jobCount: 40,
  jobEasy: 50,
  jobMedium: 30,
  jobHard: 20,
  novice: 40,
  specialist: 40,
  pro: 20,
  urgentShare: 15,
  vehicleConstraintShare: 25,
  cancelEvents: 1,
  unavailableEvents: 1,
  urgentEvents: 1,
  seed: 42,
};
