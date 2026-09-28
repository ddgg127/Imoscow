import { compatible, fallbackTravel, jobPriorityLevel, simulate, transportAllowed, type Engineer, type Job, type TravelMatrix } from "./vrptw.ts";

/** Choose one kit per engineer before the shift. The resulting equipment must remain fixed during replanning. */
export function issueDailyEquipment(engineers: Engineer[], jobs: Job[], travel: TravelMatrix = fallbackTravel(24), speedKmh = 24, localOnly = false): Engineer[] {
  const options = engineers.map(engineer => [...new Set((engineer.equipmentOptions?.length ? engineer.equipmentOptions : engineer.equipment).map(item => item.trim()).filter(Boolean))]);
  const relevant = jobs.filter(job => !job.cancelled && job.executionStatus !== "completed");
  const assignment = new Map<number, string>();
  const covered = new Set<string>();
  const eligible = (index: number, job: Job) => (!localOnly || engineers[index].region === job.region) && engineers[index].skills.includes(job.kind) && transportAllowed(job, engineers[index].transport) && options[index].includes(job.equipment) && job.windowEnd >= engineers[index].shiftStart && job.windowStart + job.serviceMinutes <= engineers[index].shiftEnd;
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
  const capacityKey = (index: number, equipment: string) => `${localOnly ? engineers[index].region : "all"}|${equipment}`;
  for (const [index, equipment] of assignment) capacity.set(capacityKey(index, equipment), (capacity.get(capacityKey(index, equipment)) ?? 0) + 1);
  for (const [index, engineer] of engineers.entries()) {
    if (assignment.has(index)) continue;
    const choice = options[index].map(equipment => ({ equipment, score: relevant.filter(job => eligible(index, job) && job.equipment === equipment).reduce((sum, job) => sum + job.serviceMinutes * (jobPriorityLevel(job) === 2 ? 5 : 1), 0) / (1 + (capacity.get(capacityKey(index, equipment)) ?? 0)) })).sort((a, b) => b.score - a.score || a.equipment.localeCompare(b.equipment, "ru"))[0]?.equipment;
    if (choice) {
      assignment.set(index, choice);
      capacity.set(capacityKey(index, choice), (capacity.get(capacityKey(index, choice)) ?? 0) + 1);
    }
  }
  // Refine the choice against an actual time-window schedule. Demand alone can
  // overvalue a kit when its jobs overlap or cannot be reached within a shift.
  const evaluate = (kits: Map<number, string>) => {
    const crew = engineers.map((engineer, index) => ({ ...engineer, equipment: kits.has(index) ? [kits.get(index)!] : [] }));
    const routes = crew.map(() => [] as Job[]);
    let elevated = 0;
    let assigned = 0;
    let distance = 0;
    const useful = crew.filter(engineer => relevant.some(job => (!localOnly || engineer.region === job.region) && compatible(engineer, job) && simulate(engineer, [job], true, speedKmh, travel))).length;
    const ordered = [...relevant].sort((a, b) => jobPriorityLevel(b) - jobPriorityLevel(a) || (scarcity.get(a.id) ?? 0) - (scarcity.get(b.id) ?? 0) || a.windowEnd - b.windowEnd || a.id.localeCompare(b.id));
    for (const job of ordered) {
      let best: { index: number; route: Job[]; distance: number } | null = null;
      for (const [index, engineer] of crew.entries()) {
        if ((localOnly && engineer.region !== job.region) || !compatible(engineer, job)) continue;
        const route = routes[index];
        for (let at = 0; at <= route.length; at++) {
          const candidate = [...route.slice(0, at), job, ...route.slice(at)];
          const plan = simulate(engineer, candidate, true, speedKmh, travel);
          if (plan && (!best || plan.distanceKm < best.distance)) best = { index, route: candidate, distance: plan.distanceKm };
        }
      }
      if (!best) continue;
      routes[best.index] = best.route;
      if (jobPriorityLevel(job) === 2) elevated++;
      assigned++;
    }
    for (const [index, route] of routes.entries()) distance += route.length ? simulate(crew[index], route, true, speedKmh, travel)?.distanceKm ?? 0 : 0;
    return { elevated, assigned, useful, distance };
  };
  const better = (a: ReturnType<typeof evaluate>, b: ReturnType<typeof evaluate>) => a.elevated > b.elevated || a.elevated === b.elevated && (a.assigned > b.assigned || a.assigned === b.assigned && (a.useful > b.useful || a.useful === b.useful && a.distance < b.distance - 0.01));
  let score = evaluate(assignment);
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const [index, variants] of options.entries()) {
      for (const equipment of variants) {
        if (equipment === assignment.get(index)) continue;
        const trial = new Map(assignment);
        trial.set(index, equipment);
        const candidate = evaluate(trial);
        if (better(candidate, score)) { assignment.set(index, equipment); score = candidate; changed = true; }
      }
    }
    if (!changed) break;
  }
  // A single change can temporarily leave a whole equipment type uncovered.
  // Exchange two compatible kits as one move so that refinement can escape
  // that local optimum without sacrificing priority or coverage.
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let first = 0; first < engineers.length; first++) {
      for (let second = first + 1; second < engineers.length; second++) {
        if (localOnly && engineers[first].region !== engineers[second].region) continue;
        const firstKit = assignment.get(first);
        const secondKit = assignment.get(second);
        if (!firstKit || !secondKit || firstKit === secondKit) continue;
        if (!options[first].includes(secondKit) || !options[second].includes(firstKit)) continue;
        const trial = new Map(assignment);
        trial.set(first, secondKit);
        trial.set(second, firstKit);
        const candidate = evaluate(trial);
        if (better(candidate, score)) { assignment.set(first, secondKit); assignment.set(second, firstKit); score = candidate; changed = true; }
      }
    }
    if (!changed) break;
  }
  return engineers.map((engineer, index) => ({ ...engineer, equipmentOptions: options[index], equipment: assignment.has(index) ? [assignment.get(index)!] : [] }));
}
