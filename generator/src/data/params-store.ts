import { DEFAULT_GENERATE_PARAMS, type GenerateParams } from "../engine/types";

const KEYS: Array<keyof GenerateParams> = [
  "engineerCount",
  "jobCount",
  "jobEasy",
  "jobMedium",
  "jobHard",
  "novice",
  "specialist",
  "pro",
  "urgentShare",
  "vehicleConstraintShare",
  "seed",
];

export const UI_PARAMS_KEY = "fieldflow.generateParams";

export function parseGenerateParams(raw: unknown): GenerateParams {
  const out: GenerateParams = { ...DEFAULT_GENERATE_PARAMS };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of KEYS) {
    const v = src[key];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}
