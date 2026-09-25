import { readFileSync, writeFileSync } from "node:fs";

const sources = [
  ["generator/datasets/bench-tight/dataset.json", "tight", "Плотный день, seed 11"],
  ["generator/datasets/bench-mixed/dataset.json", "mixed", "Смешанный день, seed 42"],
  ["generator/datasets/bench-transport/dataset.json", "transport", "Много ограничений транспорта, seed 77"],
  ["generator/datasets/bench-wide/dataset.json", "wide", "Много новичков, seed 99"],
];

function clock(text) {
  const [h, m] = String(text).split(":").map(Number);
  return h * 60 + m;
}

function job(raw) {
  return {
    id: raw.id,
    address: raw.address,
    service: raw.durationMin,
    windowStart: clock(raw.windowStart),
    windowEnd: clock(raw.windowEnd),
    priority: raw.priority,
    skill: raw.skills[0],
    transport: raw.vehicle ?? null,
    point: [raw.lat, raw.lon],
    cancelled: false,
  };
}

function engineer(raw) {
  return {
    id: raw.id,
    name: raw.name,
    start: [raw.lat, raw.lon],
    shiftStart: clock(raw.shiftStart),
    shiftEnd: clock(raw.shiftEnd),
    skills: raw.skills,
    transport: raw.vehicle,
  };
}

const datasets = sources.map(([file, id, title]) => {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return {
    id,
    title,
    seed: raw.meta.seed,
    engineers: raw.engineers.map(engineer),
    jobs: raw.jobs.map(job),
    events: raw.events.map((event) => ({
      type: event.type,
      time: event.time,
      jobId: event.jobId,
      engineerId: event.engineerId,
      job: event.job ? job(event.job) : undefined,
    })),
  };
});

writeFileSync(
  "public/algorithm-datasets.js",
  `globalThis.AlgorithmDatasets = ${JSON.stringify(datasets)};\n`,
  "utf8",
);
console.log(datasets.map((item) => `${item.id}: ${item.engineers.length} инженеров, ${item.jobs.length} заявок`).join("\n"));
