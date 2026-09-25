import type { Coordinate } from "./map-providers";
import type {
  AssignmentAlternative,
  AssignmentExplanation,
  Engineer,
  Job,
  PlanMetrics,
  RoutePlan,
  SearchObjective,
} from "./vrptw";

/**
 * Политика назначения: какую заявку какому инженеру можно отдать.
 *
 * Откуда правила и почему веса именно такие — в `assignment-policy.md`.
 * Здесь только исполнимый код. Порядок остановок (2-opt, отжиг) живёт в `vrptw.ts`.
 *
 * Порядок решения:
 * 1. Жёсткий фильтр ресурсов: регион, навык, оборудование, транспорт, отмена.
 * 2. Очередь заявок: сначала срочные и с более ранним концом окна.
 * 3. Выбор инженера: дельта целевой функции вставки, штраф за нового человека.
 * 4. Baseline ТЗ: входной порядок заявок, первый допустимый инженер, только в конец.
 * 5. Добор неназначенных: сначала заявки с меньшим числом подходящих инженеров.
 */

/** Штраф за нового инженера в запасном поиске. Вместе с DISTANCE_WEIGHT это 14 км. */
export const VEHICLE_COST = 350;
/** Множитель километров в общей шкале. Смысл — отношение к весам минут, не сама двадцатипятка. */
export const DISTANCE_WEIGHT = 25;
/** Доля смены без штрафа. Дальше запасной поиск доплачивает за слишком плотный маршрут. */
export const SLACK = 0.12;
/** Стартовая вероятность попробовать не лучшего инженера при вставке. */
export const P0 = 0.8;
/** Ниже этой вероятности поиск перестаёт пробовать худших кандидатов. */
export const P_STOP = 0.01;
const WAIT_WEIGHT = 0.35;
const DURATION_WEIGHT = 0.01;
const SLACK_GAP_WEIGHT = 0.45;

export type SimulateRoute = (engineer: Engineer, route: Job[], hardWindows?: boolean) => RoutePlan | null;

export type AssignmentEval = {
  simulate: SimulateRoute;
  travelKm: (from: Coordinate, to: Coordinate) => number;
  travelMinutes: (from: Coordinate, to: Coordinate) => number;
  objective?: SearchObjective;
};

const BASELINE_NO_RESOURCE = "Нет инженера с нужными навыком, оборудованием и транспортом в регионе.";
const BASELINE_NO_TAIL = "Последовательный baseline не нашёл инженера, которому заявку можно добавить в конец маршрута без нарушения окна или смены.";

export function compatible(engineer: Engineer, job: Job) {
  return compatibilityFailure(engineer, job) == null;
}

/** Почему инженер не проходит жёсткий фильтр ТЗ; `null` — ресурсы сходятся. */
export function compatibilityFailure(engineer: Engineer, job: Job): string | null {
  if (job.cancelled) return "заявка отменена";
  if (engineer.region !== job.region) return `другой регион: ${engineer.region}`;
  if (!engineer.skills.includes(job.kind)) return `нет навыка «${job.kind}»`;
  if (!engineer.equipment.includes(job.equipment)) return `нет оборудования «${job.equipment}»`;
  const transports = job.allowedTransports ?? [job.requiredTransport];
  if (!transports.includes(engineer.transport)) return `транспорт «${engineer.transport}» не подходит`;
  return null;
}

export function eligibleEngineers(engineers: Engineer[], job: Job) {
  return engineers.filter(engineer => compatible(engineer, job));
}

/** Строительство плана: сначала высокий приоритет, затем более ранний конец окна. */
export function compareJobsForInsertion(a: Job, b: Job) {
  return b.priority - a.priority || a.windowEnd - b.windowEnd || a.windowStart - b.windowStart;
}

/** Добор: сначала заявки, которые могут взять меньше инженеров. */
export function compareJobsForRecovery(a: Job, b: Job, engineers: Engineer[]) {
  const aChoices = eligibleEngineers(engineers, a).length;
  const bChoices = eligibleEngineers(engineers, b).length;
  return aChoices - bChoices || a.windowEnd - b.windowEnd || b.priority - a.priority;
}

export function vehicleActivationPenalty(objective: SearchObjective = "fieldflow") {
  return objective === "distance" ? 0 : VEHICLE_COST;
}

export function scoreAssignedRoute(plan: RoutePlan, engineer: Engineer, objective: SearchObjective = "fieldflow") {
  if (objective === "distance") return plan.distanceKm;
  const capacity = Math.max(1, engineer.shiftEnd - engineer.shiftStart);
  const slackGap = Math.max(0, plan.durationMinutes - capacity * (1 - SLACK));
  const wait = plan.stops.reduce((sum, stop) => sum + Math.max(0, stop.start - stop.arrival), 0);
  return plan.distanceKm * DISTANCE_WEIGHT + wait * WAIT_WEIGHT + slackGap * SLACK_GAP_WEIGHT + plan.durationMinutes * DURATION_WEIGHT;
}

export function insertionScore(engineer: Engineer, currentLength: number, currentScore: number, plan: RoutePlan, objective: SearchObjective = "fieldflow") {
  return scoreAssignedRoute(plan, engineer, objective) - currentScore + (currentLength ? 0 : vehicleActivationPenalty(objective));
}

export function fleetScore(from: Engineer, fromPlan: RoutePlan, to: Engineer, toPlan: RoutePlan, fromJobs: number, toJobs: number, objective: SearchObjective = "fieldflow") {
  const vehicles = (fromJobs > 0 ? 1 : 0) + (toJobs > 0 ? 1 : 0);
  return scoreAssignedRoute(fromPlan, from, objective) + scoreAssignedRoute(toPlan, to, objective) + vehicleActivationPenalty(objective) * vehicles;
}

export function temperature(mu: number, p: number) {
  const probability = Math.min(0.999, Math.max(1e-6, p));
  return Math.max(1e-6, -Math.max(mu, 1e-3) / Math.log(probability));
}

/** Среди допустимых вставок берём лучшую, изредка — соседнюю, чтобы не залипать в первом инженере. */
export function pickInsertion(candidates: Array<{ engineer: Engineer; route: Job[]; plan: RoutePlan; score: number }>, random: () => number, p: number) {
  const ranked = [...candidates].sort((a, b) => a.score - b.score);
  const best = ranked[0];
  if (ranked.length === 1 || p < 0.02) return best;
  const mu = ranked.slice(1, 8).reduce((sum, item) => sum + Math.max(0, item.score - best.score), 0) / Math.max(1, Math.min(7, ranked.length - 1)) || 1;
  const T = temperature(mu, p);
  const alt = ranked[1 + Math.floor(random() * (ranked.length - 1))];
  if (random() < Math.exp(-(alt.score - best.score) / T)) return alt;
  return best;
}

export function bestInsert(engineer: Engineer, route: Job[], job: Job, simulate: SimulateRoute, objective: SearchObjective = "fieldflow") {
  let best: { route: Job[]; plan: RoutePlan; score: number } | null = null;
  for (let position = 0; position <= route.length; position++) {
    const candidate = [...route.slice(0, position), job, ...route.slice(position)];
    const plan = simulate(engineer, candidate, true);
    if (!plan) continue;
    const score = scoreAssignedRoute(plan, engineer, objective);
    if (!best || score < best.score) best = { route: candidate, plan, score };
  }
  return best;
}

/**
 * Официальный baseline ТЗ: заявки во входном порядке, первый допустимый
 * инженер во входном порядке, добавление только в конец его маршрута.
 */
export function assignBaselineFirstFit(engineers: Engineer[], jobs: Job[], simulate: SimulateRoute) {
  const assigned = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const plans = new Map<string, RoutePlan>();
  const assignmentById = new Map<string, string>();
  const unassignedReasons = new Map<string, string>();
  for (const job of jobs) {
    if (!eligibleEngineers(engineers, job).length) {
      unassignedReasons.set(job.id, BASELINE_NO_RESOURCE);
      continue;
    }
    let selected: { engineer: Engineer; route: Job[]; plan: RoutePlan } | null = null;
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const route = [...assigned.get(engineer.id)!, job];
      const plan = simulate(engineer, route, true);
      if (!plan) continue;
      selected = { engineer, route, plan };
      break;
    }
    if (selected) {
      assigned.set(selected.engineer.id, selected.route);
      plans.set(selected.engineer.id, selected.plan);
      assignmentById.set(job.id, selected.engineer.id);
    } else unassignedReasons.set(job.id, BASELINE_NO_TAIL);
  }
  return { assigned, plans, assignmentById, unassignedReasons };
}

export function finishBaselinePlan(
  engineers: Engineer[],
  jobs: Job[],
  simulate: SimulateRoute,
  metricsFrom: (engineers: Engineer[], jobs: Job[], routes: RoutePlan[]) => PlanMetrics,
) {
  const { plans, assignmentById, unassignedReasons } = assignBaselineFirstFit(engineers, jobs, simulate);
  const routes = engineers.map(engineer => plans.get(engineer.id)).filter((route): route is RoutePlan => Boolean(route));
  return { routes, metrics: metricsFrom(engineers, jobs, routes), assignmentById, unassignedReasons };
}

/** Сначала прямая вставка, затем вытеснение одной заявки, затем эвакуация короткого маршрута. */
export function recoverUnassigned(engineers: Engineer[], jobs: Job[], assignments: Map<string, Job[]>, simulate: SimulateRoute, objective: SearchObjective = "fieldflow") {
  const assigned = new Set([...assignments.values()].flatMap(route => route.map(job => job.id)));
  const pending = jobs.filter(job => !assigned.has(job.id)).sort((a, b) => compareJobsForRecovery(a, b, engineers));
  for (const job of pending) {
    let direct: { engineer: Engineer; route: Job[]; score: number } | null = null;
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const current = assignments.get(engineer.id) ?? [];
      const placed = bestInsert(engineer, current, job, simulate, objective);
      if (!placed) continue;
      const currentPlan = simulate(engineer, current, true);
      const score = insertionScore(engineer, current.length, currentPlan ? scoreAssignedRoute(currentPlan, engineer, objective) : 0, placed.plan, objective);
      if (!direct || score < direct.score) direct = { engineer, route: placed.route, score };
    }
    if (direct) {
      assignments.set(direct.engineer.id, direct.route);
      continue;
    }
    let repaired: { from: Engineer; to: Engineer; fromRoute: Job[]; toRoute: Job[]; score: number } | null = null;
    for (const from of engineers) {
      if (!compatible(from, job)) continue;
      const current = assignments.get(from.id) ?? [];
      for (let index = 0; index < current.length; index++) {
        const displaced = current[index];
        const without = current.filter((_, i) => i !== index);
        const withNew = bestInsert(from, without, job, simulate, objective);
        if (!withNew) continue;
        for (const to of engineers) {
          if (!compatible(to, displaced)) continue;
          const destination = to.id === from.id ? withNew.route : assignments.get(to.id) ?? [];
          const reinserted = bestInsert(to, destination, displaced, simulate, objective);
          if (!reinserted) continue;
          const score = scoreAssignedRoute(to.id === from.id ? reinserted.plan : withNew.plan, from, objective)
            + (to.id === from.id ? 0 : scoreAssignedRoute(reinserted.plan, to, objective))
            + (to.id !== from.id && !destination.length ? VEHICLE_COST : 0);
          if (!repaired || score < repaired.score) repaired = {
            from, to,
            fromRoute: to.id === from.id ? reinserted.route : withNew.route,
            toRoute: reinserted.route,
            score,
          };
        }
      }
    }
    if (repaired) {
      assignments.set(repaired.from.id, repaired.fromRoute);
      if (repaired.to.id !== repaired.from.id) assignments.set(repaired.to.id, repaired.toRoute);
      continue;
    }
    // Короткий маршрут подходящего инженера может быть заперт порядком остановок.
    // Сначала выселяем эти заявки, и только потом считаем новую потерянной.
    const evacuationTargets = eligibleEngineers(engineers, job)
      .sort((a, b) => (assignments.get(a.id)?.length ?? 0) - (assignments.get(b.id)?.length ?? 0));
    for (const from of evacuationTargets) {
      const current = assignments.get(from.id) ?? [];
      if (!current.length || current.length > 8 || !simulate(from, [job], true)) continue;
      const draft = new Map([...assignments].map(([id, route]) => [id, [...route]]));
      draft.set(from.id, [job]);
      const displacedJobs = [...current].sort((a, b) => {
        const aChoices = eligibleEngineers(engineers, a).length;
        const bChoices = eligibleEngineers(engineers, b).length;
        return aChoices - bChoices || a.windowEnd - b.windowEnd;
      });
      let feasible = true;
      for (const displaced of displacedJobs) {
        let placement: { engineer: Engineer; route: Job[]; score: number } | null = null;
        for (const to of engineers) {
          if (!compatible(to, displaced)) continue;
          const route = draft.get(to.id) ?? [];
          const inserted = bestInsert(to, route, displaced, simulate, objective);
          if (!inserted) continue;
          const score = scoreAssignedRoute(inserted.plan, to, objective) + (!route.length ? VEHICLE_COST : 0);
          if (!placement || score < placement.score) placement = { engineer: to, route: inserted.route, score };
        }
        if (!placement) { feasible = false; break; }
        draft.set(placement.engineer.id, placement.route);
      }
      if (!feasible) continue;
      for (const [id, route] of draft) assignments.set(id, route);
      break;
    }
  }
}

export function reasonJobUnassigned(job: Job, engineers: Engineer[], assignments: Map<string, Job[]>, evalRoute: AssignmentEval): string | undefined {
  const eligible = eligibleEngineers(engineers, job);
  if (job.cancelled) return "Заявка отменена диспетчером и исключена из расчёта.";
  if (!eligible.length) return "В регионе нет инженера с нужным навыком, оборудованием и транспортом.";
  if (!eligible.some(engineer => evalRoute.simulate(engineer, [job], true))) {
    const earliest = Math.min(...eligible.map(engineer => engineer.shiftStart + evalRoute.travelMinutes(engineer.start, job.coordinates)));
    return earliest > job.windowEnd
      ? `Даже свободный подходящий инженер приедет не раньше ${clock(earliest)}, а окно заканчивается в ${clock(job.windowEnd)}.`
      : "Даже свободный подходящий инженер не успевает выполнить заявку до конца своей смены.";
  }
  if (eligible.length === 1) {
    const only = eligible[0];
    const count = assignments.get(only.id)?.length ?? 0;
    return `Единственный подходящий инженер — ${only.name}; у него уже ${count} заявки. Не найдено перестановки, сохраняющей все окна SLA и смену.`;
  }
  return `${eligible.length} инженеров подходят по навыку и ресурсам, но после распределения работ не найден допустимый маршрут в пределах SLA и смены.`;
}

export function explainAssignment(
  job: Job,
  engineer: Engineer,
  plan: RoutePlan,
  engineers: Engineer[],
  routes: RoutePlan[],
  jobs: Job[],
  evalRoute: AssignmentEval,
): AssignmentExplanation {
  const objective = evalRoute.objective ?? "fieldflow";
  const byId = new Map(jobs.map(item => [item.id, item]));
  const routeByEngineer = new Map(routes.map(route => [route.engineerId, route]));
  const stop = plan.stops.find(item => item.jobId === job.id);
  const routeJobs = plan.stops.map(item => byId.get(item.jobId)).filter((item): item is Job => Boolean(item));
  const without = routeJobs.filter(item => item.id !== job.id);
  const withoutPlan = without.length ? evalRoute.simulate(engineer, without, true) : null;
  const distanceImpactKm = Math.max(0, plan.distanceKm - (withoutPlan?.distanceKm ?? 0));
  const start = stop?.start ?? job.windowStart;
  const checks = [
    `Навык «${job.kind}» подтверждён у инженера.`,
    `Оборудование «${job.equipment}» и транспорт «${engineer.transport}» доступны.`,
    `Регион ${job.region}; прибытие ${clock(stop?.arrival ?? start)}, начало ${clock(start)}, окончание ${clock(stop?.end ?? start + job.serviceMinutes)} — внутри SLA ${job.time} и смены ${clock(engineer.shiftStart)}–${clock(engineer.shiftEnd)}.`,
    plan.stops.length > 1 ? `Заявка встроена в уже используемый маршрут; дополнительный инженер не потребовался.` : `Для выполнения заявки задействован этот инженер.`,
    `Вклад заявки в маршрут — около ${distanceImpactKm.toFixed(1)} км.`,
  ];

  const alternatives: AssignmentAlternative[] = engineers.filter(item => item.id !== engineer.id).map(candidate => {
    const prefix = { engineerId: candidate.id, engineerName: candidate.name || candidate.id, proximityKm: evalRoute.travelKm(candidate.start, job.coordinates) };
    const failure = compatibilityFailure(candidate, job);
    if (failure) return { ...prefix, feasible: false, reason: failure };
    const existingPlan = routeByEngineer.get(candidate.id);
    const existingJobs = existingPlan?.stops.map(item => byId.get(item.jobId)).filter((item): item is Job => Boolean(item)) ?? [];
    const insertion = bestInsert(candidate, existingJobs, job, evalRoute.simulate, objective);
    if (!insertion) return { ...prefix, feasible: false, reason: `нет допустимой вставки в окно и смену` };
    const added = Math.max(0, insertion.plan.distanceKm - (existingPlan?.distanceKm ?? 0));
    const activation = existingJobs.length ? "маршрут уже активен" : "потребовалось бы задействовать дополнительного инженера";
    const reason = added + 0.05 >= distanceImpactKm
      ? `${activation}; локальный прирост ${added.toFixed(1)} км против ${distanceImpactKm.toFixed(1)} км у выбранного`
      : `${activation}; локально +${added.toFixed(1)} км, но глобально ухудшается порядок, окна или целевая функция плана`;
    return { ...prefix, feasible: true, reason };
  }).sort((a, b) => a.proximityKm - b.proximityKm || Number(b.feasible) - Number(a.feasible)).slice(0, 3).map(item => ({ engineerId: item.engineerId, engineerName: item.engineerName, reason: item.reason, feasible: item.feasible }));

  return {
    summary: `${engineer.name || engineer.id} выбран: обязательные ресурсы подтверждены, работа начинается в ${clock(start)}, а назначение ${plan.stops.length > 1 ? "не увеличивает активный штат" : "обеспечивает выполнение заявки"}.`,
    checks,
    alternatives,
    distanceImpactKm,
  };
}

function clock(value: number) {
  const normalized = Math.max(0, Math.round(value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
