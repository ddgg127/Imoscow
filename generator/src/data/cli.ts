import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CATALOG } from "./catalog";
import { DEFAULT_GENERATE_PARAMS, type GenerateParams } from "../engine/types";
import { parseGenerateParams } from "./params-store";
import { datasetSummary, generateDataset } from "./generate";
import {
  catalogSkillsToCsv,
  catalogTasksToCsv,
  catalogToJson,
  datasetToJson,
  encodeCsvForExcel,
  engineersToCsv,
  jobsToCsv,
} from "./serialize";

function arg(name: string): string | undefined {
  const key = `--${name}`;
  const i = process.argv.indexOf(key);
  if (i >= 0) return process.argv[i + 1];
  const pref = `${key}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit?.slice(pref.length);
}

function num(name: string, fallback: number): number {
  const v = arg(name);
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} ожидало число, получено ${v}`);
  return n;
}

async function promptParams(base: GenerateParams): Promise<GenerateParams> {
  const rl = createInterface({ input, output });
  const ask = async (label: string, current: number) => {
    const a = (await rl.question(`${label} [${current}]: `)).trim();
    if (!a) return current;
    const n = Number(a);
    if (!Number.isFinite(n)) throw new Error(`Нужно число: ${label}`);
    return n;
  };
  const params: GenerateParams = {
    engineerCount: await ask("Инженеров", base.engineerCount),
    jobCount: await ask("Заявок", base.jobCount),
    jobEasy: await ask("Доля заявок с 1 навыком", base.jobEasy),
    jobMedium: await ask("Доля заявок с 2 навыками", base.jobMedium),
    jobHard: await ask("Доля заявок с 3 навыками", base.jobHard),
    novice: await ask("Доля новичков", base.novice),
    specialist: await ask("Доля специалистов", base.specialist),
    pro: await ask("Доля профи", base.pro),
    urgentShare: await ask("% срочных заявок", base.urgentShare),
    vehicleConstraintShare: await ask("% заявок с требованием ТС", base.vehicleConstraintShare),
    seed: await ask("Seed", base.seed),
  };
  await rl.close();
  return params;
}

const LAST_PARAMS_FILE = path.resolve("datasets/last-params.json");

function loadLastParams(): GenerateParams {
  try {
    return parseGenerateParams(JSON.parse(readFileSync(LAST_PARAMS_FILE, "utf8")));
  } catch {
    return { ...DEFAULT_GENERATE_PARAMS };
  }
}

function saveLastParams(params: GenerateParams): void {
  mkdirSync(path.dirname(LAST_PARAMS_FILE), { recursive: true });
  writeFileSync(LAST_PARAMS_FILE, `${JSON.stringify(params, null, 2)}\n`, "utf8");
}

function fromArgs(base: GenerateParams): GenerateParams {
  const d = base;
  return {
    engineerCount: num("engineers", d.engineerCount),
    jobCount: num("jobs", d.jobCount),
    jobEasy: num("easy", d.jobEasy),
    jobMedium: num("medium", d.jobMedium),
    jobHard: num("hard", d.jobHard),
    novice: num("novice", d.novice),
    specialist: num("specialist", d.specialist),
    pro: num("pro", d.pro),
    urgentShare: num("urgent", d.urgentShare),
    vehicleConstraintShare: num("vehicle", d.vehicleConstraintShare),
    seed: num("seed", d.seed),
  };
}

function hasFlags(): boolean {
  return process.argv.slice(2).some((a) => a.startsWith("--"));
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Генератор наборов заявок и инженеров.

Без флагов — вопросы в консоли. С флагами — сразу файл.

  npm run generate
  npm run generate -- --catalog-only --out datasets/catalog

Флаги: --engineers --jobs --easy --medium --hard --novice --specialist --pro
       --urgent --vehicle --seed --format json|csv|both --out <папка>
       --catalog-only  только справочник задач и навыков

Значения в [скобках] — последний успешный запуск (datasets/last-params.json).
`);
    return;
  }

  if (process.argv.includes("--catalog-only")) {
    const outDir = path.resolve(arg("out") ?? "datasets/catalog");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "catalog.json"), catalogToJson(), "utf8");
    writeFileSync(path.join(outDir, "skills.csv"), encodeCsvForExcel(catalogSkillsToCsv()));
    writeFileSync(path.join(outDir, "tasks.csv"), encodeCsvForExcel(catalogTasksToCsv()));
    console.log(`справочник: ${CATALOG.tasks.length} задач, ${CATALOG.skills.length} навыков`);
    console.log(`записано: ${outDir}`);
    return;
  }

  const last = loadLastParams();
  const params = hasFlags() ? fromArgs(last) : await promptParams(last);
  const format = (arg("format") ?? "both") as "json" | "csv" | "both";
  const outDir = path.resolve(arg("out") ?? "datasets/latest");

  const data = generateDataset(params);
  saveLastParams(params);
  mkdirSync(outDir, { recursive: true });

  if (format === "json" || format === "both") {
    writeFileSync(path.join(outDir, "dataset.json"), datasetToJson(data), "utf8");
  }
  if (format === "csv" || format === "both") {
    writeFileSync(path.join(outDir, "jobs.csv"), encodeCsvForExcel(jobsToCsv(data.jobs)));
    writeFileSync(path.join(outDir, "engineers.csv"), encodeCsvForExcel(engineersToCsv(data.engineers)));
  }

  console.log(datasetSummary(data));
  console.log(`записано: ${outDir}`);
  console.log(`следующие значения в скобках: ${LAST_PARAMS_FILE}`);
}

await main();
