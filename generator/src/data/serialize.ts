import { CATALOG } from "./catalog";
import type { Dataset, Engineer, Job } from "../engine/types";

const SEP = ";";

function csvCell(value: string | number | undefined): string {
  const s = value === undefined ? "" : String(value);
  if (/["\n;]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function csvRow(cells: Array<string | number | undefined>): string {
  return cells.map(csvCell).join(SEP);
}

function csvFile(header: string[], rows: Array<Array<string | number | undefined>>): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return `sep=${SEP}\n${lines.join("\n")}\n`;
}

/** Windows-1251 — то, что Excel в русской Windows открывает по двойному щелчку. */
export function encodeCsvForExcel(csv: string): Uint8Array {
  const bytes = new Uint8Array(csv.length);
  for (let i = 0; i < csv.length; i++) {
    bytes[i] = unicodeToWin1251(csv.charCodeAt(i));
  }
  return bytes;
}

function unicodeToWin1251(c: number): number {
  if (c < 128) return c;
  if (c === 0x0401) return 0xa8;
  if (c === 0x0451) return 0xb8;
  if (c === 0x2116) return 0xb9;
  if (c === 0x00ab) return 0xab;
  if (c === 0x00bb) return 0xbb;
  if (c === 0x2014) return 0x97;
  if (c === 0x2013) return 0x96;
  if (c === 0x00a0) return 0xa0;
  if (c >= 0x0410 && c <= 0x044f) {
    return c <= 0x042f ? c - 0x0410 + 0xc0 : c - 0x0430 + 0xe0;
  }
  return 0x3f;
}

function skillList(skills: string[]): string {
  return skills.join(", ");
}

export function jobsToCsv(jobs: Job[]): string {
  return csvFile(
    [
      "ID заявки",
      "Название задачи",
      "Адрес",
      "Широта",
      "Долгота",
      "Длительность, мин",
      "Начало окна",
      "Конец окна",
      "Приоритет",
      "Число навыков",
      "Навыки",
      "Требуемый транспорт",
    ],
    jobs.map((j) => [
      j.id,
      j.title,
      j.address,
      j.lat,
      j.lon,
      j.durationMin,
      j.windowStart,
      j.windowEnd,
      j.priority,
      j.skillCount,
      skillList(j.skills),
      j.vehicle ?? "",
    ]),
  );
}

export function engineersToCsv(engineers: Engineer[]): string {
  return csvFile(
    [
      "ID инженера",
      "Имя",
      "Адрес старта",
      "Широта",
      "Долгота",
      "Начало смены",
      "Конец смены",
      "Число навыков",
      "Навыки",
      "Транспорт",
      "Уровень",
    ],
    engineers.map((e) => [
      e.id,
      e.name,
      e.address,
      e.lat,
      e.lon,
      e.shiftStart,
      e.shiftEnd,
      e.skills.length,
      skillList(e.skills),
      e.vehicle,
      e.level,
    ]),
  );
}

export function catalogSkillsToCsv(): string {
  return csvFile(
    ["ID навыка", "Навык", "Область"],
    CATALOG.skills.map((s) => [s.id, s.name, s.domain]),
  );
}

export function catalogTasksToCsv(): string {
  return csvFile(
    ["ID задачи", "Название", "Область", "Число навыков", "Навыки", "Длительность от, мин", "Длительность до, мин"],
    CATALOG.tasks.map((t) => [
      t.id,
      t.title,
      t.domain,
      t.skills.length,
      skillList(t.skills),
      t.durationMin[0],
      t.durationMin[1],
    ]),
  );
}

export function datasetToJson(data: Dataset): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function catalogToJson(): string {
  return `${JSON.stringify(CATALOG, null, 2)}\n`;
}
