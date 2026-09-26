import {
  DEFAULT_GENERATE_PARAMS,
  type Dataset,
  type Engineer,
  type EngineerLevel,
  type GenerateParams,
  type Job,
  type Priority,
  type SkillCount,
  VEHICLES,
  type Vehicle,
} from "../engine/types";
import type { Building, BuildingKind } from "./building-types";
import { CATALOG, type CatalogTask } from "./catalog";
import { MOSCOW_BUILDINGS } from "./moscow-addresses";
import { createRng, intBetween, pick, splitByShare, type Rng } from "./rng";

const MALE_FIRST = [
  "Алексей", "Дмитрий", "Иван", "Сергей", "Андрей", "Никита", "Павел", "Роман",
  "Максим", "Артём", "Кирилл", "Егор", "Олег", "Виктор", "Игорь", "Антон",
];
const FEMALE_FIRST = [
  "Мария", "Анна", "Елена", "Ольга", "Наталья", "Екатерина", "Дарья", "Юлия",
];
const MALE_LAST = [
  "Соколов", "Мельников", "Паршин", "Волков", "Новиков", "Морозов", "Фёдоров",
  "Михайлов", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Павлов", "Козлов",
  "Степанов", "Николаев", "Орлов",
];
const FEMALE_LAST = [
  "Андреева", "Кузнецова", "Попова", "Васильева", "Петрова", "Соколова", "Новикова",
  "Орлова", "Волкова", "Морозова", "Лебедева", "Козлова",
];

const SHIFTS: Array<[string, string]> = [
  ["08:00", "17:00"],
  ["08:00", "18:00"],
  ["09:00", "18:00"],
  ["09:00", "19:00"],
  ["07:30", "16:30"],
  ["10:00", "19:00"],
];

const TASKS_BY_COUNT: Record<SkillCount, CatalogTask[]> = {
  1: CATALOG.tasks.filter((t) => t.skills.length === 1),
  2: CATALOG.tasks.filter((t) => t.skills.length === 2),
  3: CATALOG.tasks.filter((t) => t.skills.length === 3),
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToHm(total: number): string {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

function uniqueName(rng: Rng, used: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const female = rng() < 0.35;
    const name = female
      ? `${pick(rng, FEMALE_FIRST)} ${pick(rng, FEMALE_LAST)}`
      : `${pick(rng, MALE_FIRST)} ${pick(rng, MALE_LAST)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const name = `${pick(rng, MALE_FIRST)} ${pick(rng, MALE_LAST)} ${intBetween(rng, 2, 99)}`;
  used.add(name);
  return name;
}

function windowForDuration(rng: Rng, durationMin: number): { start: string; end: string } {
  const span = Math.max(durationMin + 30, intBetween(rng, durationMin + 60, durationMin + 180));
  const earliest = 8 * 60;
  const latestStart = 19 * 60 - span;
  const start = intBetween(rng, earliest, Math.max(earliest, latestStart));
  return { start: minutesToHm(start), end: minutesToHm(start + span) };
}

function unusedBuildings(pool: Building[], used: Set<string>): Building[] {
  return pool.filter((b) => !used.has(b.address));
}

/**
 * Реальное здание: сначала нужный тип (жильё / рабочее), затем район без занятых точек.
 * Так заявки не склеиваются на одних вестибюлях, а инженеры стартуют из жилых домов.
 */
function takePlace(rng: Rng, used: Set<string>, prefer: BuildingKind) {
  if (MOSCOW_BUILDINGS.length === 0) {
    throw new Error("Справочник зданий пуст. Запустите npm run fetch-buildings");
  }
  const preferred = unusedBuildings(
    MOSCOW_BUILDINGS.filter((b) => b.kind === prefer),
    used,
  );
  const any = unusedBuildings(MOSCOW_BUILDINGS, used);
  const pool = preferred.length > 0 ? preferred : any.length > 0 ? any : MOSCOW_BUILDINGS;

  const usedAreas = new Set(
    MOSCOW_BUILDINGS.filter((b) => used.has(b.address)).map((b) => b.area),
  );
  const fresh = pool.filter((b) => !usedAreas.has(b.area));
  const spread = fresh.length > 0 ? fresh : pool;
  const areas = [...new Set(spread.map((b) => b.area))];
  const area = pick(rng, areas);
  const inArea = spread.filter((b) => b.area === area);
  const building = pick(rng, inArea);
  used.add(building.address);
  return { address: building.address, lat: building.lat, lon: building.lon };
}

function pickTask(rng: Rng, count: SkillCount): CatalogTask {
  const pool = TASKS_BY_COUNT[count];
  if (pool.length === 0) throw new Error(`В справочнике нет задач на ${count} навыка`);
  return pick(rng, pool);
}

function skillsForEngineer(rng: Rng, level: EngineerLevel, jobs: Job[]): string[] {
  const n: SkillCount = level === "новичок" ? 1 : level === "специалист" ? 2 : 3;
  const fromJobs = jobs.filter((j) => j.skillCount === n);
  if (fromJobs.length > 0) return [...pick(rng, fromJobs).skills];
  return [...pickTask(rng, n).skills];
}

function vehicleForJob(rng: Rng, engineers: Engineer[], jobSkills: string[]): Vehicle {
  const capable = engineers.filter((e) =>
    jobSkills.every((s) => e.skills.includes(s)),
  );
  if (capable.length > 0 && rng() < 0.75) return pick(rng, capable).vehicle;
  return pick(rng, VEHICLES);
}

export function generateDataset(raw: Partial<GenerateParams> = {}): Dataset {
  const params: GenerateParams = { ...DEFAULT_GENERATE_PARAMS, ...raw };
  const rng = createRng(params.seed);
  const usedPlaces = new Set<string>();
  const usedNames = new Set<string>();

  const [easyN, midN, hardN] = splitByShare(params.jobCount, [
    params.jobEasy,
    params.jobMedium,
    params.jobHard,
  ]);
  const counts: SkillCount[] = [
    ...Array.from({ length: easyN }, () => 1 as const),
    ...Array.from({ length: midN }, () => 2 as const),
    ...Array.from({ length: hardN }, () => 3 as const),
  ];

  const jobs: Job[] = counts.map((skillCount, i) => {
    const template = pickTask(rng, skillCount);
    const durationMin = intBetween(rng, template.durationMin[0], template.durationMin[1]);
    const window = windowForDuration(rng, durationMin);
    const place = takePlace(rng, usedPlaces, "workplace");
    const urgent = rng() * 100 < params.urgentShare;
    return {
      id: `J${String(i + 1).padStart(3, "0")}`,
      title: template.title,
      ...place,
      durationMin,
      windowStart: window.start,
      windowEnd: window.end,
      priority: (urgent ? "Повышенная" : "Обычная") satisfies Priority,
      skills: [...template.skills],
      skillCount,
    };
  });

  const [noviceN, specN, proN] = splitByShare(params.engineerCount, [
    params.novice,
    params.specialist,
    params.pro,
  ]);
  const levels: EngineerLevel[] = [
    ...Array.from({ length: noviceN }, () => "новичок" as const),
    ...Array.from({ length: specN }, () => "специалист" as const),
    ...Array.from({ length: proN }, () => "профи" as const),
  ];

  const engineers: Engineer[] = levels.map((level, i) => {
    const place = takePlace(rng, usedPlaces, "residential");
    const shift = pick(rng, SHIFTS);
    return {
      id: `E${String(i + 1).padStart(3, "0")}`,
      name: uniqueName(rng, usedNames),
      ...place,
      shiftStart: shift[0],
      shiftEnd: shift[1],
      skills: skillsForEngineer(rng, level, jobs),
      vehicle: pick(rng, VEHICLES),
      level,
    };
  });

  for (const job of jobs) {
    if (rng() * 100 < params.vehicleConstraintShare) {
      job.vehicle = vehicleForJob(rng, engineers, job.skills);
    }
  }

  return {
    meta: {
      seed: params.seed,
      generatedAt: new Date().toISOString(),
      params,
      catalog: { skills: CATALOG.skills.length, tasks: CATALOG.tasks.length },
      notes: [
        "Число навыков заявки: 1, 2 или 3. Навыки — общие компетенции; название задачи может быть узким случаем.",
        "Инженер должен иметь все навыки заявки. Новичок/специалист/профи = 1/2/3 навыка, взятые с задач этого набора.",
        "Адреса — реальные здания OSM (улица и номер дома), не вестибюли метро. Заявки — рабочие здания, старт инженера — жилой дом; при нехватке берётся любой свободный дом в другом районе.",
        "CSV: разделитель точка с запятой.",
      ],
    },
    jobs,
    engineers,
    events: [],
  };
}

export function datasetSummary(data: Dataset): string {
  const { jobs, engineers } = data;
  const byCount = { 1: 0, 2: 0, 3: 0 };
  for (const j of jobs) byCount[j.skillCount] += 1;
  const engC = countBy(engineers.map((e) => e.level));
  return [
    `справочник: ${data.meta.catalog.tasks} задач, ${data.meta.catalog.skills} навыков`,
    `инженеры ${engineers.length}: новички ${engC.новичок ?? 0}, специалисты ${engC.специалист ?? 0}, профи ${engC.профи ?? 0}`,
    `заявки ${jobs.length}: 1 навык ${byCount[1]}, 2 навыка ${byCount[2]}, 3 навыка ${byCount[3]}`,
    `повышенных ${jobs.filter((j) => j.priority === "Повышенная").length}, с требованием ТС ${jobs.filter((j) => j.vehicle).length}`,
    `адреса OSM: заявка «${jobs[0]?.address ?? "—"}», старт «${engineers[0]?.address ?? "—"}»`,
    `seed ${data.meta.seed}`,
  ].join("\n");
}

function countBy(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}
