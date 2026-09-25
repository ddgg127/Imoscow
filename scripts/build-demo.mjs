import fs from "node:fs";
import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";

const regions = ["Восток", "Юго-восток", "Югоцентр"];
const local = "Локальные работы";
const connection = "Подключение и модернизация";
const emergency = "Аварийно-восстановительные работы";
const selected = regions.flatMap(region => csvJobs.filter(job => job.region === region).slice(0, 16));
const engineers = regions.flatMap(region => csvEngineers.filter(engineer => engineer.region === region).slice(0, 4)).map(engineer => ({ ...engineer }));
for (const engineer of engineers.filter(item => item.region === "Восток").slice(2)) {
  engineer.skills = engineer.id.endsWith("03") ? [local] : [connection];
  engineer.equipment = engineer.id.endsWith("03") ? ["Диагностический комплект"] : ["ONT", "Комплект GPON"];
}
const office = engineers[0].start;
const special = (id, kind, equipment, windowStart, windowEnd, serviceMinutes, requiredTransport = "") => ({
  id, time: `${String(Math.floor(windowStart / 60)).padStart(2, "0")}:${String(windowStart % 60).padStart(2, "0")}–${String(Math.floor(windowEnd / 60)).padStart(2, "0")}:${String(windowEnd % 60).padStart(2, "0")}`,
  windowStart, windowEnd, area: "Демонстрационный конфликт", address: "Стартовый офис · демонстрационная заявка",
  kind, workType: kind, tone: "amber", region: "Восток", engineerId: null, baselineEngineerId: null,
  coordinates: office, geocodeVerified: true, geocodeQuality: "house", risk: false, equipment, requiredTransport,
  priority: kind === emergency ? 5 : 2, serviceMinutes, source: "Эталонный демонабор", status: "Новая", executionStatus: "not_started",
  urgency: kind === emergency ? "urgent" : "normal", workClass: kind === emergency ? "emergency" : "repair",
  normativeMinutes: kind === emergency ? 100 : undefined, travelReserveMinutes: kind === emergency ? 20 : 0,
  estimatedTravelMinutes: kind === emergency ? 20 : 0, normSource: kind === emergency ? "экспертный норматив" : "демонстрационное допущение",
});
const jobs = [
  special("D-BROAD", local, "Диагностический комплект", 480, 1320, 60),
  special("D-NARROW", emergency, "Рефлектометр", 480, 485, 80),
  ...selected.map(job => ({ ...job, windowStart: 480, windowEnd: 1320, time: "08:00–22:00", source: "Эталонный демонабор · окно расширено явно" })),
  special("D-NO-TRANSPORT", local, "Диагностический комплект", 480, 1320, 30, "Служебный вертолёт"),
];
const output = { format: "fieldflow-dataset-v1", label: "Эталонный демонстрационный сценарий", seed: "первые 16 заявок каждого региона; 4 инженера каждого региона; см. README", speedKmh: 24, jobs, engineers };
fs.writeFileSync("data/demo-scenario.json", JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(`${jobs.length} jobs, ${engineers.length} engineers`);
