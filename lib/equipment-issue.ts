import { jobPriorityLevel, transportAllowed, type Engineer, type Job } from "./vrptw.ts";

/** Choose one kit per engineer before the shift. The resulting equipment must remain fixed during replanning. */
export function issueDailyEquipment(engineers: Engineer[], jobs: Job[]): Engineer[] {
  const options = engineers.map(engineer => [...new Set((engineer.equipmentOptions?.length ? engineer.equipmentOptions : engineer.equipment).map(item => item.trim()).filter(Boolean))]);
  const relevant = jobs.filter(job => !job.cancelled && job.executionStatus !== "completed");
  const assignment = new Map<number, string>();
  const covered = new Set<string>();
  const eligible = (index: number, job: Job) => engineers[index].region === job.region && engineers[index].skills.includes(job.kind) && transportAllowed(job, engineers[index].transport) && options[index].includes(job.equipment) && job.windowEnd >= engineers[index].shiftStart && job.windowStart + job.serviceMinutes <= engineers[index].shiftEnd;
  const scarcity = new Map(relevant.map(job => [job.id, engineers.reduce((count, _, index) => count + Number(eligible(index, job)), 0)]));

  // First reserve a kit for the least replaceable work. An engineer who is the
  // sole carrier of a type cannot be reassigned to a common type later.
  for (const job of [...relevant].sort((a, b) => (scarcity.get(a.id) ?? 0) - (scarcity.get(b.id) ?? 0) || jobPriorityLevel(b) - jobPriorityLevel(a) || a.windowEnd - b.windowEnd)) {
    if (covered.has(job.id) || !scarcity.get(job.id)) continue;
    const candidates = engineers.map((_, index) => index).filter(index => !assignment.has(index) && eligible(index, job));
    const best = candidates.sort((a, b) => options[a].length - options[b].length || a - b)[0];
    if (best == null) continue;
    assignment.set(best, job.equipment);
    for (const other of relevant) if (eligible(best, other) && other.equipment === job.equipment) covered.add(other.id);
  }

  // Extra engineers go where the remaining compatible workload is greatest.
  const capacity = new Map<string, number>();
  for (const [index, equipment] of assignment) capacity.set(`${engineers[index].region}|${equipment}`, (capacity.get(`${engineers[index].region}|${equipment}`) ?? 0) + 1);
  for (const [index, engineer] of engineers.entries()) {
    if (assignment.has(index)) continue;
    const choice = options[index].map(equipment => ({ equipment, score: relevant.filter(job => eligible(index, job) && job.equipment === equipment).reduce((sum, job) => sum + job.serviceMinutes * (jobPriorityLevel(job) === 2 ? 5 : 1), 0) / (1 + (capacity.get(`${engineer.region}|${equipment}`) ?? 0)) })).sort((a, b) => b.score - a.score || a.equipment.localeCompare(b.equipment, "ru"))[0]?.equipment;
    if (choice) {
      assignment.set(index, choice);
      capacity.set(`${engineer.region}|${choice}`, (capacity.get(`${engineer.region}|${choice}`) ?? 0) + 1);
    }
  }
  return engineers.map((engineer, index) => ({ ...engineer, equipmentOptions: options[index], equipment: assignment.has(index) ? [assignment.get(index)!] : [] }));
}
