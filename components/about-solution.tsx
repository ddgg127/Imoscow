"use client";

import { useEffect, useRef, useState } from "react";
import { Route, Sparkles } from "lucide-react";
import {
  buildStory,
  clock,
  crossings,
  road,
  E1,
  E2,
  PARK,
  PX_PER_MIN,
  SERVICE_MIN,
  SHIFT_KM,
  START_MIN,
  STORY_EVENT,
  STORY_NEW_JOB,
  type Move,
  type Pt,
} from "./about-solution-model";

const S = buildStory();
const RP = S.replan(STORY_NEW_JOB, STORY_EVENT);

const C = {
  e1: "#6d4aff",
  e2: "#0f766e",
  greedy: "#0284c7",
  cut: "#dc2626",
  join: "#059669",
  worse: "#ea580c",
  late: "#dc2626",
  reject: "#94a3b8",
  best: "#10b981",
  done: "#cbd5e1",
  fresh: "#d97706",
};

// ---------- утилиты ----------

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smooth(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function span(t: number, a: number, b: number) {
  return clamp((t - a) / (b - a));
}

function band(t: number, a: number, b: number, edge = 0.012) {
  if (t < a || t > b) return 0;
  const inn = a <= 0 ? 1 : smooth((t - a) / edge);
  const out = b >= 1 ? 1 : smooth((b - t) / edge);
  return Math.min(inn, out);
}

function km(value: number) {
  return value.toFixed(1).replace(".", ",");
}

function label(id: string) {
  if (id === "new") return STORY_NEW_JOB.label;
  return S.byId.get(id)?.label ?? id;
}

function nodePt(id: string): Pt {
  if (id === "e1") return E1;
  if (id === "e2") return E2;
  if (id === "new") return STORY_NEW_JOB;
  return S.byId.get(id)!;
}

type Edge = [string, string];

function edgesOf(baseId: string, order: string[]): Edge[] {
  const out: Edge[] = [];
  let prev = baseId;
  for (const id of order) {
    out.push([prev, id]);
    prev = id;
  }
  return out;
}

const edgeKey = ([a, b]: Edge) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function edgePoly([a, b]: Edge) {
  return road(nodePt(a), nodePt(b));
}

function polyLen(pts: Pt[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

function cutPoly(pts: Pt[], t: number) {
  const target = polyLen(pts) * clamp(t);
  const out: Pt[] = [pts[0]];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (walked + seg >= target) {
      const u = seg === 0 ? 0 : (target - walked) / seg;
      out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u });
      return out;
    }
    walked += seg;
    out.push(pts[i]);
  }
  return pts;
}

function tipOf(pts: Pt[], t: number) {
  const cut = cutPoly(pts, t);
  return cut[cut.length - 1];
}

function midOf(pts: Pt[]) {
  return tipOf(pts, 0.5);
}

function stepper(weights: number[]) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const starts: number[] = [];
  let acc = 0;
  for (const w of weights) {
    starts.push(acc);
    acc += w;
  }
  return (u: number) => {
    const x = clamp(u) * total;
    let k = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      if (x < starts[i] + weights[i]) {
        k = i;
        break;
      }
    }
    return { k, l: clamp((x - starts[k]) / weights[k]) };
  };
}

// ---------- сценарий ----------

const openingIndex = S.insertion.findIndex(step => step.engineer === "e2" && step.e2.length === 1);
const opening = S.insertion[openingIndex];
const openingE1 = (() => {
  const before = S.insertion[openingIndex - 1]?.e1 ?? [];
  let best: { at: number; cost: number } | null = null;
  for (let at = 0; at <= before.length; at++) {
    const next = [...before.slice(0, at), opening.id, ...before.slice(at)];
    if (!S.feasible(E1, next)) continue;
    const cost = S.routeKm(E1, next) - S.routeKm(E1, before);
    if (!best || cost < best.cost) best = { at, cost };
  }
  if (!best) return null;
  const prev = best.at > 0 ? before[best.at - 1] : "e1";
  const next = before[best.at];
  return { prev, next };
})();
const insertWeights = S.insertion.map((_, index) => (index === 0 ? 2.6 : index === openingIndex ? 3.6 : 1));
const insertStep = stepper(insertWeights);
const untangles = S.twoOpt.moves.map(move => crossings(S.routePolyline(E1, move.before)).length - crossings(S.routePolyline(E1, move.after)).length);
const twoOptStep = stepper(untangles.map((value, index) => (value > 0 ? 5.6 : index === 0 ? 2.4 : 1.5)));
const stuckStep = stepper(S.stuck.picks.map(pick => (pick.late && pick.delta < 0 ? 2.4 : 1)));
const firstBeat = S.anneal.log.findIndex(move => move.bestKm + 1e-6 < S.twoOpt.km);
const bestStep = S.anneal.log.reduce((best, move, index) => (move.bestKm + 1e-9 < S.anneal.log[best].bestKm ? index : best), 0);
const annealStep = stepper(
  S.anneal.log.map((_, index) => {
    if (index < 8) return 2.6;
    if (firstBeat >= 0 && index >= firstBeat - 2 && index <= firstBeat + 8) return 3.2;
    if (index >= bestStep - 2 && index <= bestStep + 4) return 2.2;
    if (firstBeat >= 0 && index < firstBeat) return 0.5;
    return 0.18;
  }),
);
const polishStep = stepper(S.anneal.polishMoves.length ? S.anneal.polishMoves.map(() => 1.4) : [1]);

const TL = {
  intro: [0, 0.03],
  greedy: [0.03, 0.09],
  fail: [0.09, 0.125],
  regret: [0.125, 0.16],
  insert: [0.16, 0.255],
  knot: [0.255, 0.3],
  twoopt: [0.3, 0.475],
  stuck: [0.475, 0.545],
  anneal: [0.545, 0.8],
  polish: [0.8, 0.83],
  result: [0.83, 0.875],
  day: [0.875, 0.905],
  fresh: [0.905, 0.935],
  ghost: [0.935, 0.965],
  kept: [0.965, 1],
} as const;

const insertAt = (index: number) => {
  const total = insertWeights.reduce((sum, w) => sum + w, 0);
  const before = insertWeights.slice(0, index).reduce((sum, w) => sum + w, 0);
  return TL.insert[0] + (TL.insert[1] - TL.insert[0]) * (before / total);
};
const OPENING_AT = insertAt(openingIndex);
const OPENING_END = insertAt(openingIndex + 1);

const twooptAt = (index: number) => {
  const total = S.twoOpt.moves.reduce((sum, _, i) => sum + (untangles[i] > 0 ? 5.6 : i === 0 ? 2.4 : 1.5), 0);
  const before = S.twoOpt.moves.slice(0, index).reduce((sum, _, i) => sum + (untangles[i] > 0 ? 5.6 : i === 0 ? 2.4 : 1.5), 0);
  return TL.twoopt[0] + (TL.twoopt[1] - TL.twoopt[0]) * (before / total);
};
const UNCROSS_I = Math.max(0, untangles.findIndex(value => value > 0));
const UNCROSS_AT = twooptAt(UNCROSS_I);
const UNCROSS_END = twooptAt(UNCROSS_I + 1);

const CHAPTERS = [
  { id: "task", at: 0, label: "Задача" },
  { id: "greedy", at: TL.greedy[0], label: "Ближайшая" },
  { id: "regret", at: TL.regret[0], label: "Очередь" },
  { id: "shift", at: OPENING_AT, label: "Порог" },
  { id: "twoopt", at: TL.knot[0], label: "2-opt" },
  { id: "anneal", at: TL.stuck[0], label: "Из тупика" },
  { id: "result", at: TL.result[0], label: "Итог" },
  { id: "event", at: TL.day[0], label: "Новая заявка" },
] as const;

const insertedKm = S.routeKm(E1, S.insertedE1);
const insertedCross = crossings(S.routePolyline(E1, S.insertedE1));
const twoOptCross = crossings(S.routePolyline(E1, S.twoOpt.order));
const greedyUrg = S.schedule(E1, S.greedy).find(item => item.id === "urg")!.arrive;
const finalPlan = S.schedule(E1, S.anneal.best);
const e2Plan = S.schedule(E2, S.e2Final);
const blockedPick = S.stuck.picks.find(pick => pick.late && pick.delta < 0) ?? null;
const log = S.anneal.log;
const kmLo = Math.min(S.anneal.bestKm, ...log.map(m => m.km)) - 3;
const kmHi = Math.max(...log.map(m => m.km)) + 8;
const pendingE1 = RP.crews[0].pending;
const ghostAt = RP.shortest?.crew === "e1" ? RP.shortest.at : -1;
const ghostPrev = ghostAt > 0 ? pendingE1[ghostAt - 1] : RP.crews[0].done[RP.crews[0].done.length - 1];
const ghostNext = ghostAt >= 0 ? pendingE1[ghostAt] : undefined;
const shiftedIds = ghostAt >= 0 ? pendingE1.slice(ghostAt) : [];
const shiftMin = Math.round(RP.shortest?.shift ?? 0);
const keptPrev = RP.kept ? (RP.kept.at > 0 ? pendingE1[RP.kept.at - 1] : RP.crews[0].done[RP.crews[0].done.length - 1]) : undefined;

function reversalEdges(before: string[], i: number, j: number) {
  const nodes = ["e1", ...before];
  const removed: Edge[] = [[nodes[i], nodes[i + 1]]];
  const added: Edge[] = [[nodes[i], nodes[j + 1]]];
  if (j + 2 < nodes.length) {
    removed.push([nodes[j + 1], nodes[j + 2]]);
    added.push([nodes[i + 1], nodes[j + 2]]);
  }
  const segment = nodes.slice(i + 1, j + 2);
  return { removed, added, segment };
}

// ---------- кадр ----------

type RouteView = { base: "e1" | "e2"; from: string[]; to: string[]; l: number; color: string; kind: "insert" | "swap" | "plain"; slow?: boolean };

function viewsAt(t: number): { e1: RouteView | null; e2: RouteView | null } {
  const plain = (base: "e1" | "e2", order: string[]): RouteView => ({ base, from: order, to: order, l: 1, color: base === "e1" ? C.e1 : C.e2, kind: "plain" });
  if (t < TL.regret[1]) return { e1: null, e2: null };
  if (t < TL.insert[1]) {
    const { k, l } = insertStep(span(t, TL.insert[0], TL.insert[1]));
    const step = S.insertion[k];
    const prev = S.insertion[k - 1];
    const morph = smooth((l - 0.38) / 0.5);
    const e1From = prev?.e1 ?? [];
    const e2From = prev?.e2 ?? [];
    return {
      e1: e1From.length || step.e1.length ? { base: "e1", from: e1From, to: step.e1, l: step.engineer === "e1" ? morph : 1, color: C.e1, kind: "insert" } : null,
      e2: e2From.length || (step.engineer === "e2" && morph > 0) ? { base: "e2", from: e2From, to: step.e2, l: step.engineer === "e2" ? morph : 1, color: C.e2, kind: "insert" } : null,
    };
  }
  if (t < TL.twoopt[0]) return { e1: plain("e1", S.insertedE1), e2: plain("e2", S.e2Final) };
  if (t < TL.twoopt[1]) {
    const { k, l } = twoOptStep(span(t, TL.twoopt[0], TL.twoopt[1]));
    const move = S.twoOpt.moves[k];
    return { e1: { base: "e1", from: move.before, to: move.after, l, color: C.e1, kind: "swap", slow: untangles[k] > 0 }, e2: plain("e2", S.e2Final) };
  }
  if (t < TL.anneal[0]) return { e1: plain("e1", S.twoOpt.order), e2: plain("e2", S.e2Final) };
  if (t < TL.anneal[1]) {
    const { k, l } = annealStep(span(t, TL.anneal[0], TL.anneal[1]));
    const move = log[k];
    const accepted = move.kind === "better" || move.kind === "worse";
    return { e1: { base: "e1", from: move.before, to: accepted ? move.after : move.before, l, color: C.e1, kind: "swap", slow: k < 8 || (firstBeat >= 0 && k >= firstBeat && k <= firstBeat + 8) }, e2: plain("e2", S.e2Final) };
  }
  if (t < TL.polish[1] && S.anneal.polishMoves.length) {
    const { k, l } = polishStep(span(t, TL.polish[0], TL.polish[1]));
    const move = S.anneal.polishMoves[k];
    return { e1: { base: "e1", from: move.before, to: move.after, l, color: C.e1, kind: "swap" }, e2: plain("e2", S.e2Final) };
  }
  return { e1: plain("e1", S.anneal.best), e2: plain("e2", S.e2Final) };
}

function currentAnneal(t: number) {
  if (t < TL.anneal[0] || t >= TL.anneal[1]) return null;
  const { k, l } = annealStep(span(t, TL.anneal[0], TL.anneal[1]));
  return { k, l, move: log[k] };
}

function dayClock(t: number) {
  return START_MIN + (STORY_EVENT - START_MIN) * smooth(span(t, TL.day[0], TL.day[1] - 0.008));
}

function positionAt(base: Pt, order: string[], minute: number) {
  const plan = S.schedule(base, order);
  let from: Pt = base;
  let leave = START_MIN;
  for (const item of plan) {
    const to = S.byId.get(item.id)!;
    if (minute < item.arrive) {
      const leg = road(from, to);
      const u = clamp((minute - leave) / Math.max(1, item.arrive - leave));
      return { at: tipOf(leg, u), moving: true };
    }
    if (minute < item.leave) return { at: to as Pt, moving: false };
    from = to;
    leave = item.leave;
  }
  return { at: from, moving: false };
}

// ---------- подписи ----------

type Line = { a: number; b: number; title: string; body: string; aim: (t: number) => Pt | "chart" };

const promisedList = pendingE1.map(id => `${label(id)} — ${clock(finalPlan.find(item => item.id === id)!.start)}`).join(", ");

const LINES: Line[] = [
  {
    a: 0,
    b: TL.intro[1] + 0.004,
    title: "Утро, 08:00",
    body: `На карте двое: Е1 на западе и Е2 на востоке. ${S.stops.length} заявок, у части клиентов есть крайний час — он подписан под точкой. Красная А — авария: клиент ждёт до 09:30, и выехать на неё может только Е1.`,
    aim: () => E1,
  },
  {
    a: TL.greedy[0],
    b: TL.greedy[1] + 0.004,
    title: "Проще всего — ехать к ближайшей",
    body: "Самый простой план: закончил заявку, посмотрел, какая точка ближе, поехал туда. Считается сразу, и первые адреса правда рядом.",
    aim: t => tipOf(S.routePolyline(E1, S.greedy), smooth(span(t, TL.greedy[0], TL.greedy[1]))),
  },
  {
    a: TL.fail[0],
    b: TL.fail[1] + 0.004,
    title: `К аварии — только в ${clock(greedyUrg)}`,
    body: "Ближайшая точка всё время оказывается другой, и до аварии очередь доходит последней. Клиент ждал до 09:30. Правило смотрит только на расстояние: оно не видит срок и не знает, что второй инженер эту заявку взять не может. Так день не собираем.",
    aim: () => nodePt("urg"),
  },
  {
    a: TL.regret[0],
    b: TL.regret[1] + 0.01,
    title: "Сначала то, что больше некому отдать",
    body: `Для каждой заявки смотрим: насколько хуже станет, если отдать её не лучшему инженеру, а запасному. Чем выше столбик, тем дороже откладывать. У аварии запасного нет — её может взять только Е1, поэтому столбик самый высокий, и её ставим первой.`,
    aim: () => nodePt("urg"),
  },
  {
    a: TL.insert[0] + 0.006,
    b: OPENING_AT,
    title: "Ставим по одной, начиная с самой высокой",
    body: "Берём заявку с самым высоким столбиком и вставляем туда, где день удлиняется меньше всего. Кто-то уже получил заявку — столбики у остальных меняются. Западные адреса для Е2 далекие, поэтому они одна за другой уходят к Е1.",
    aim: t => {
      const { k } = insertStep(span(t, TL.insert[0], TL.insert[1]));
      return nodePt(S.insertion[k].id);
    },
  },
  {
    a: OPENING_AT,
    b: OPENING_END + 0.008,
    title: "Выпустить второго — тоже цена",
    body: `Эту заявку можно дописать Е1, но тогда он сделает крюк +${km(opening.e1Cost)} км. Выход ещё одного человека мы считаем как ${SHIFT_KM} км пути — одна шкала, чтобы сравнить «лишняя дорога» и «ещё одна смена». У Е2 выходит ${SHIFT_KM} + ${km(opening.e2Cost - SHIFT_KM)} = ${km(opening.e2Cost)}, это дешевле крюка, поэтому выходит он, и восток дальше едет с ним.`,
    aim: () => nodePt(opening.id),
  },
  {
    a: TL.knot[0],
    b: TL.knot[1] + 0.006,
    title: "Все успевают, но путь петляет",
    body: `Каждую заявку вставили в лучшее место на тот момент. Вместе получился маршрут, который ${insertedCross.length === 1 ? "пересекает сам себя" : `${insertedCross.length} раза пересекает сам себя`}. У Е1 ${km(insertedKm)} км. Вставка не смотрит на форму пути — её чинит следующий шаг.`,
    aim: () => insertedCross[0] ?? E1,
  },
  {
    a: TL.twoopt[0],
    b: UNCROSS_AT + 0.01,
    title: "Меняем два куска местами",
    body: "Выбираем два отрезка маршрута, снимаем их и соединяем концы накрест. Участок между ними инженер теперь едет в обратную сторону — это видно по стрелкам. Если путь стал короче и никто не опоздал, новый порядок оставляем.",
    aim: t => {
      const { k } = twoOptStep(span(t, TL.twoopt[0], TL.twoopt[1]));
      const move = S.twoOpt.moves[k];
      return midOf(edgePoly(reversalEdges(move.before, move.i, move.j).added[0]));
    },
  },
  {
    a: UNCROSS_AT,
    b: UNCROSS_END + 0.006,
    title: "Пересечение уходит",
    body: "Красным горят два куска, которые пересекаются. Их снимаем и ставим зелёные — накрест. Середина разворачивается, линии больше не режут друг друга. Сроки по-прежнему на месте, второй инженер на своей стороне не тронут.",
    aim: () => insertedCross[0] ?? E1,
  },
  {
    a: UNCROSS_END,
    b: TL.twoopt[1] + 0.006,
    title: "Повторяем, пока путь короче",
    body: `Так ${S.twoOpt.moves.length} раза. Было ${km(insertedKm)} км, стало ${km(S.twoOpt.km)}. Если после разворота кто-то из клиентов не дождётся — этот вариант сразу отбрасываем.`,
    aim: () => twoOptCross[0] ?? E1,
  },
  {
    a: TL.stuck[0],
    b: TL.stuck[1] + 0.006,
    title: "Тупик",
    body: blockedPick
      ? `Пробуем все ${S.stuck.total} разворотов. Почти каждый делает путь длиннее. Есть один, который убрал бы последнее пересечение и сэкономил ${km(-blockedPick.delta)} км, но тогда клиент ${label(blockedPick.late!)} не успеет к ${clock(S.byId.get(blockedPick.late!)!.due!)}. Если оставлять только более короткий день, дальше идти некуда.`
      : `Пробуем все ${S.stuck.total} разворотов. Каждый делает путь длиннее или срывает чей-то срок. Если оставлять только более короткий день, дальше идти некуда.`,
    aim: () => twoOptCross[0] ?? E1,
  },
  {
    a: TL.anneal[0],
    b: TL.anneal[0] + (TL.anneal[1] - TL.anneal[0]) * 0.22,
    title: "Температура: готовы ли оставить день длиннее",
    body: "Чтобы выйти из тупика, вводим температуру. Это число: как часто мы ещё оставляем разворот, который сделал путь длиннее. Пока она высокая, такой день часто оставляем нарочно — хороший маршрут может стоять как раз за этим шагом. Оранжевые точки на графике — эти шаги.",
    aim: () => "chart",
  },
  {
    a: TL.anneal[0] + (TL.anneal[1] - TL.anneal[0]) * 0.2,
    b: TL.anneal[0] + (TL.anneal[1] - TL.anneal[0]) * 0.52,
    title: "Температура падает",
    body: `В начале температуру держим высокой: примерно в ${Math.round(log[0].p * 100)}% случаев более длинный день ещё оставляем. Потом она остывает — к концу почти никогда. Если разворот срывает срок клиента, его нет сразу, температура тут ни при чём. Зелёная линия — самый короткий день, который уже видели: его помним, даже пока ходим по более длинным.`,
    aim: () => "chart",
  },
  {
    a: TL.anneal[0] + (TL.anneal[1] - TL.anneal[0]) * 0.5,
    b: TL.polish[0] - 0.002,
    title: "Из тупика: клиент 1 успевает",
    body: `Клиента 1 ждут до 13:30. Чтобы успеть, к клиенту 13 надо заехать раньше. Но разворот, который так ставит точки, сначала добавляет километры — 2-opt его выкидывает. Температура оставила несколько более длинных дней, и за ними нашёлся этот: 13 раньше, 1 к 13:30 успевает, путь ${km(S.anneal.rawBestKm)} км.`,
    aim: () => "chart",
  },
  {
    a: TL.polish[0] - 0.008,
    b: TL.polish[1] + 0.006,
    title: "Остыли — снова только короче",
    body: `Температура почти ноль: более длинный день уже почти не оставляем. Ещё раз проходим развороты и берём только то, что укорачивает путь. ${S.anneal.polishMoves.length} правки — у Е1 ${km(S.anneal.bestKm)} км, пересечений нет, все в срок.`,
    aim: () => "chart",
  },
  {
    a: TL.result[0],
    b: TL.result[1] + 0.004,
    title: "Что дал каждый шаг",
    body: `Сначала раздали заявки так, чтобы все успели: ${km(insertedKm)} км. Потом поменяли куски маршрута местами: ${km(S.twoOpt.km)}. Потом температура вывела из тупика: ${km(S.anneal.bestKm)}. Основной план в приложении считает тот же порядок целей: сначала закрыть заявки в срок, потом меньше инженеров, потом меньше километров.`,
    aim: () => "chart",
  },
  {
    a: TL.day[0],
    b: TL.fresh[0] + 0.006,
    title: `${clock(STORY_EVENT)}. День уже идёт`,
    body: `Утренние заявки закрыты — они серые. Е1 в дороге. Остальным клиентам уже назвали время приезда: ${promisedList}.`,
    aim: t => positionAt(E1, S.anneal.best, dayClock(t)).at,
  },
  {
    a: TL.fresh[0],
    b: TL.ghost[0] + 0.004,
    title: "Приходит новая заявка",
    body: `Точка ${STORY_NEW_JOB.label} появилась на северной улице, рядом с клиентами ${label(ghostPrev)} и ${ghostNext ? label(ghostNext) : ""}. Её нужно вставить в уже идущий день.`,
    aim: () => STORY_NEW_JOB,
  },
  {
    a: TL.ghost[0],
    b: TL.kept[0] - 0.002,
    title: "Самое короткое место сдвинет обещанное",
    body: `Меньше всего пути — вставить ${STORY_NEW_JOB.label} между ${label(ghostPrev)} и ${ghostNext ? label(ghostNext) : ""}: +${km(RP.shortest?.extraKm ?? 0)} км. Но тогда клиенты ${shiftedIds.map(label).join(", ")} получат инженера на ${shiftMin} минуты позже, чем им уже сказали.`,
    aim: () => STORY_NEW_JOB,
  },
  {
    a: TL.kept[0],
    b: 1,
    title: "Ставим туда, где никто не ждёт",
    body: RP.kept
      ? `То, что уже сделано, и часы, которые уже назвали, не трогаем. ${STORY_NEW_JOB.label} встаёт в свободное окно после клиента ${label(keptPrev!)}: приезд в ${clock(RP.kept.arrive)}, путь +${km(RP.kept.extraKm)} км. Обещанное время ни у кого не едет.`
      : "То, что уже сделано, и часы, которые уже назвали, не трогаем. Свободного окна нет — заявка ждёт следующего пересчёта.",
    aim: () => STORY_NEW_JOB,
  },
];

// ---------- геометрия экрана ----------

type Rect = { x: number; y: number; w: number; h: number };

function cardWidth(width: number) {
  return Math.min(width > 1100 ? 360 : 300, Math.max(240, width - 32));
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function boxOf(points: Pt[], pad: number): Box {
  const xs = points.map(pt => pt.x);
  const ys = points.map(pt => pt.y);
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

const CAM_MAP: Box = { x0: 0, y0: 0, x1: 1000, y1: 620 };
const CAM_TWO_OPT = boxOf(
  [
    ...S.twoOpt.moves.flatMap(move => reversalEdges(move.before, move.i, move.j).removed.concat(reversalEdges(move.before, move.i, move.j).added).flat().map(nodePt)),
    ...S.stuck.picks.flatMap(pick => reversalEdges(S.twoOpt.order, pick.i, pick.j).added.flat().map(nodePt)),
    ...insertedCross,
  ],
  60,
);
const CAM_E1 = boxOf([E1, ...S.insertedE1.map(nodePt)], 50);
const CAM_EVENT = boxOf([STORY_NEW_JOB, ...RP.crews[0].pending.map(nodePt), nodePt(RP.crews[0].done[RP.crews[0].done.length - 1])], 90);

function cameraAt(t: number) {
  const w2 = smooth(span(t, TL.knot[0], TL.knot[0] + 0.022)) * (1 - smooth(span(t, TL.stuck[1] - 0.004, TL.stuck[1] + 0.018)));
  const wA = smooth(span(t, TL.stuck[1] - 0.004, TL.stuck[1] + 0.018)) * (1 - smooth(span(t, TL.polish[1], TL.polish[1] + 0.02)));
  const fit = (box: Box) => ({ cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, z: Math.min(2.1, 1000 / (box.x1 - box.x0), 620 / (box.y1 - box.y0)) });
  const wE = smooth(span(t, TL.fresh[0] - 0.012, TL.fresh[0] + 0.016));
  const base = fit(CAM_MAP);
  const two = fit(CAM_TWO_OPT);
  const e1 = fit(CAM_E1);
  const ev = fit(CAM_EVENT);
  const blend = (key: "cx" | "cy" | "z") => base[key] + (two[key] - base[key]) * w2 + (e1[key] - base[key]) * wA + (ev[key] - base[key]) * wE;
  return { cx: blend("cx"), cy: blend("cy"), z: blend("z") };
}

function projector(width: number, height: number, t = 0) {
  const reserve = cardWidth(width) + 40;
  let scale = Math.min((width - 24) / 1000, (height - 110) / 620);
  let ox = (width - 1000 * scale) / 2;
  if (width - 1000 * scale - 24 < reserve && width > 700) {
    scale = Math.min(scale, Math.max(0.35, (width - reserve - 24) / 1000));
    ox = 12 + (width - reserve - 24 - 1000 * scale) / 2;
  }
  const oy = 56 + Math.max(0, (height - 110 - 620 * scale) / 2);
  const cam = cameraAt(t);
  const ax = ox + 500 * scale;
  const ay = oy + 310 * scale;
  const s = scale * cam.z;
  return { scale: s, P: (pt: Pt) => ({ x: ax + (pt.x - cam.cx) * s, y: ay + (pt.y - cam.cy) * s }) };
}

function chartRect(width: number, height: number): Rect {
  const w = Math.min(cardWidth(width), width - 32);
  const h = height > 700 ? 176 : 146;
  return { x: width - w - 16, y: height - h - 54, w, h };
}

function chartAlpha(t: number) {
  return band(t, TL.stuck[1] - 0.012, TL.result[1], 0.014);
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function promisedChips(P: (pt: Pt) => Pt, ghostOn: boolean) {
  const taken: Rect[] = [];
  const avoid = (rect: Rect) => taken.some(item => overlaps(rect, item));
  const dots = [...S.stops.map(stop => P(stop)), P(STORY_NEW_JOB)];
  dots.forEach(at => taken.push({ x: at.x - 14, y: at.y - 14, w: 28, h: 28 }));
  const fresh = P(STORY_NEW_JOB);
  taken.push({ x: fresh.x - 122, y: fresh.y - 13, w: 104, h: 24 });
  return pendingE1.map(id => {
    const at = P(nodePt(id));
    const start = finalPlan.find(item => item.id === id)!.start;
    const shifted = ghostOn && shiftedIds.includes(id);
    const text = shifted ? `${clock(start)} → ${clock(start + (RP.shortest?.shift ?? 0))}` : clock(start);
    const w = text.length * 7 + 14;
    const options: Array<[number, number]> = [
      [14, -30],
      [14, 10],
      [-w - 14, -30],
      [-w - 14, 10],
      [-w / 2, -40],
      [-w / 2, 18],
    ];
    let rect: Rect = { x: at.x + 14, y: at.y - 30, w, h: 22 };
    for (const [dx, dy] of options) {
      const next = { x: at.x + dx, y: at.y + dy, w, h: 22 };
      if (!avoid(next)) {
        rect = next;
        break;
      }
    }
    taken.push(rect);
    return { id, rect, text, shifted };
  });
}

function blockersAt(t: number, width: number, height: number) {
  const { P } = projector(width, height, t);
  const rects: Rect[] = [];
  const dot = (pt: Pt, pad: number) => {
    const at = P(pt);
    rects.push({ x: at.x - pad, y: at.y - pad, w: pad * 2, h: pad * 2 });
  };
  S.stops.forEach(stop => dot(stop, 20));
  dot(E1, 22);
  dot(E2, 22);
  if (t >= TL.fresh[0]) dot(STORY_NEW_JOB, 22);
  const views = viewsAt(t);
  const walk = (view: RouteView | null) => {
    if (!view) return;
    const base = view.base === "e1" ? E1 : E2;
    const pts = S.routePolyline(base, view.to);
    const total = polyLen(pts);
    for (let d = 0; d <= total; d += 16) dot(tipOf(pts, d / Math.max(1, total)), 12);
  };
  if (t >= TL.greedy[0] && t < TL.regret[0]) {
    const pts = S.routePolyline(E1, S.greedy);
    const total = polyLen(pts);
    for (let d = 0; d <= total; d += 16) dot(tipOf(pts, d / total), 12);
  }
  walk(views.e1);
  walk(views.e2);
  if (t >= OPENING_AT && t < OPENING_END) {
    const target = nodePt(opening.id);
    const e2Mid = P(midOf(road(E2, target)));
    rects.push({ x: e2Mid.x + 8, y: e2Mid.y - 12, w: 200, h: 30 });
    if (openingE1) {
      const e1Mid = P(midOf(road(nodePt(openingE1.prev), target)));
      rects.push({ x: e1Mid.x - 24, y: e1Mid.y + 8, w: 170, h: 30 });
    }
  }
  if (t >= TL.day[1] - 0.015) {
    promisedChips(P, t >= TL.ghost[0] && t < TL.kept[0]).forEach(item => rects.push({ x: item.rect.x - 4, y: item.rect.y - 4, w: item.rect.w + 8, h: item.rect.h + 8 }));
    const fresh = P(STORY_NEW_JOB);
    rects.push({ x: fresh.x - 122, y: fresh.y - 16, w: 110, h: 30 });
    if (RP.kept && keptPrev) {
      const mid = P(midOf(road(nodePt(keptPrev), STORY_NEW_JOB)));
      rects.push({ x: mid.x + 8, y: mid.y - 8, w: 180, h: 30 });
    }
  }
  if (chartAlpha(t) > 0.1) {
    const r = chartRect(width, height);
    rects.push({ x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 });
  }
  rects.push({ x: 0, y: 0, w: 280, h: 96 });
  return { rects, P };
}

function placeCard(aim: { x: number; y: number }, cardW: number, cardH: number, bounds: Rect, blocked: Rect[]) {
  const gap = 26;
  const spots: Array<[number, number]> = [
    [aim.x + gap, aim.y - cardH * 0.2],
    [aim.x - cardW - gap, aim.y - cardH * 0.2],
    [aim.x - cardW * 0.5, aim.y - cardH - gap],
    [aim.x - cardW * 0.5, aim.y + gap],
    [aim.x + gap, aim.y - cardH - gap * 0.5],
    [aim.x - cardW - gap, aim.y - cardH - gap * 0.5],
    [aim.x + gap, aim.y + gap * 0.5],
    [aim.x - cardW - gap, aim.y + gap * 0.5],
  ];
  const maxLeft = Math.max(bounds.x, bounds.x + bounds.w - cardW);
  const maxTop = Math.max(bounds.y, bounds.y + bounds.h - cardH);
  for (let x = bounds.x; x <= maxLeft + 1; x += 36) {
    for (let y = bounds.y; y <= maxTop + 1; y += 30) spots.push([x, y]);
    spots.push([x, maxTop]);
  }
  for (let y = bounds.y; y <= maxTop + 1; y += 30) spots.push([maxLeft, y]);
  let best = { left: bounds.x, top: bounds.y, score: Number.POSITIVE_INFINITY };
  for (const [rawLeft, rawTop] of spots) {
    const left = clamp(rawLeft, bounds.x, maxLeft);
    const top = clamp(rawTop, bounds.y, maxTop);
    const card = { x: left, y: top, w: cardW, h: cardH };
    let hits = 0;
    for (const item of blocked) if (overlaps(card, item)) hits++;
    const dist = Math.hypot(left + cardW / 2 - aim.x, top + cardH / 2 - aim.y);
    const score = hits * 900 + dist;
    if (score < best.score) best = { left, top, score };
  }
  return best;
}

// ---------- рисование ----------

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, alpha: number, dash: number[] = [], halo = true) {
  if (pts.length < 2 || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (halo) {
    ctx.setLineDash([]);
    ctx.lineWidth = width + 4;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
  }
  ctx.setLineDash(dash);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function chevron(ctx: CanvasRenderingContext2D, at: Pt, angle: number, color: string, alpha: number, size = 6) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-size * 0.7, -size);
  ctx.lineTo(size * 0.6, 0);
  ctx.lineTo(-size * 0.7, size);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, alpha = 1, bold = true, bg = "rgba(255,255,255,0.95)") {
  if (alpha <= 0.02) return { w: 0, h: 0 };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${bold ? 650 : 500} 12px Segoe UI, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 14;
  const h = 22;
  ctx.fillStyle = bg;
  ctx.strokeStyle = "rgba(20,24,33,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 7, y + h / 2 + 0.5);
  ctx.restore();
  return { w, h };
}

function ring(ctx: CanvasRenderingContext2D, at: Pt, r: number, color: string, alpha: number, width = 2.5) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function stopMarker(ctx: CanvasRenderingContext2D, at: Pt, text: string, ringColor: string, fill: string, textColor: string, alpha: number, radius = 11) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = ringColor;
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.font = `700 ${text.length > 1 ? 10 : 11}px Segoe UI, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at.x, at.y + 0.5);
  ctx.restore();
}

function baseMarker(ctx: CanvasRenderingContext2D, at: Pt, text: string, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(at.x - 15, at.y - 12, 30, 24, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "700 11px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at.x, at.y + 0.5);
  ctx.restore();
}

function rider(ctx: CanvasRenderingContext2D, at: Pt, color: string, alpha = 1) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.restore();
}

function paintScene(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, clockTick: number, bg: string, fg: string, muted: string) {
  const { scale, P } = projector(width, height, t);
  const map = (pts: Pt[]) => pts.map(P);
  const pulse = 0.5 + 0.5 * Math.sin(clockTick * 5);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // сетка улиц
  const tl = P({ x: 0, y: 0 });
  const br = P({ x: 1000, y: 620 });
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.max(0, tl.x), Math.max(48, tl.y), Math.min(width, br.x) - Math.max(0, tl.x), Math.min(height - 44, br.y) - Math.max(48, tl.y));
  ctx.clip();
  ctx.strokeStyle = "rgba(120,128,144,0.13)";
  ctx.lineWidth = 1;
  const stepPx = 40 * scale;
  for (let x = tl.x; x <= br.x + 0.5; x += stepPx) {
    ctx.beginPath();
    ctx.moveTo(x, tl.y);
    ctx.lineTo(x, br.y);
    ctx.stroke();
  }
  for (let y = tl.y; y <= br.y + 0.5; y += stepPx) {
    ctx.beginPath();
    ctx.moveTo(tl.x, y);
    ctx.lineTo(br.x, y);
    ctx.stroke();
  }
  ctx.restore();

  // парк
  const park = map(PARK);
  ctx.save();
  ctx.beginPath();
  park.forEach((pt, index) => (index ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.closePath();
  ctx.fillStyle = "rgba(47,143,92,0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(31,122,74,0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "rgba(31,122,74,0.75)";
  ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const pc = P({ x: (PARK[0].x + PARK[2].x) / 2, y: (PARK[0].y + PARK[2].y) / 2 });
  ctx.fillText("парк", pc.x, pc.y);
  ctx.restore();

  const introU = 0.55 + 0.45 * span(t, 0, Math.max(0.01, TL.intro[1] - 0.004));
  const views = viewsAt(t);
  const anneal = currentAnneal(t);
  const inFreeze = t >= TL.day[0];
  const minute = inFreeze ? dayClock(t) : START_MIN;

  // ---------- жадный обход ----------
  if (t >= TL.greedy[0] && t < TL.regret[1]) {
    const u = smooth(span(t, TL.greedy[0], TL.greedy[1]));
    const fade = 1 - smooth(span(t, TL.regret[0], TL.regret[0] + 0.02));
    const poly = map(S.routePolyline(E1, S.greedy));
    stroke(ctx, cutPoly(poly, u), C.greedy, 3, fade);
    if (fade > 0.05) rider(ctx, tipOf(poly, u), C.greedy, fade);
  }

  // ---------- маршруты ----------
  const drawView = (view: RouteView | null) => {
    if (!view) return;
    const baseId = view.base;
    const fromEdges = edgesOf(baseId, view.from);
    const toEdges = edgesOf(baseId, view.to);
    const fromKeys = new Set(fromEdges.map(edgeKey));
    const toKeys = new Set(toEdges.map(edgeKey));
    const common = toEdges.filter(edge => fromKeys.has(edgeKey(edge)));
    const removed = fromEdges.filter(edge => !toKeys.has(edgeKey(edge)));
    const added = toEdges.filter(edge => !fromKeys.has(edgeKey(edge)));
    const l = view.l;
    const isSwap = view.kind === "swap";
    const slow = Boolean(view.slow);
    const grow = isSwap ? smooth((l - (slow ? 0.22 : 0.34)) / (slow ? 0.5 : 0.44)) : l;
    const settle = isSwap ? smooth((l - (slow ? 0.78 : 0.8)) / (slow ? 0.22 : 0.2)) : 1;
    common.forEach(edge => stroke(ctx, map(edgePoly(edge)), view.color, 3.2, 1));
    removed.forEach(edge => {
      const pts = map(edgePoly(edge));
      if (isSwap) {
        const warn = smooth(l / 0.22) * (1 - grow);
        stroke(ctx, pts, view.color, 3.2, 1 - smooth(l / 0.2));
        stroke(ctx, pts, C.cut, 3.4, warn * (0.7 + 0.3 * pulse), [7, 6], false);
      } else {
        stroke(ctx, pts, view.color, 3.2, 1 - grow);
      }
    });
    added.forEach(edge => {
      const pts = map(edgePoly(edge));
      if (grow <= 0.01) return;
      if (isSwap) {
        stroke(ctx, cutPoly(pts, grow), C.join, 3.6, 1 - settle);
        stroke(ctx, pts, view.color, 3.2, settle);
      } else {
        stroke(ctx, cutPoly(pts, grow), view.color, 3.2, 1);
      }
    });
  };

  // лучший маршрут отжига под текущим
  if (anneal) {
    const bestPoly = map(S.routePolyline(E1, anneal.move.bestOrder));
    stroke(ctx, bestPoly, C.best, 9, 0.2, [], false);
  }

  drawView(views.e2);
  drawView(views.e1);

  // ---------- стрелки и подсветка разворота ----------
  const swapMove = (() => {
    if (t >= TL.twoopt[0] && t < TL.twoopt[1]) {
      const { k, l } = twoOptStep(span(t, TL.twoopt[0], TL.twoopt[1]));
      return { move: S.twoOpt.moves[k], l, accepted: true, kind: "better" as Move["kind"], slow: untangles[k] > 0 || k === 0 };
    }
    if (anneal) return { move: anneal.move, l: anneal.l, accepted: anneal.move.kind === "better" || anneal.move.kind === "worse", kind: anneal.move.kind, slow: anneal.k < 8 || (firstBeat >= 0 && anneal.k >= firstBeat && anneal.k <= firstBeat + 8) };
    if (t >= TL.polish[0] && t < TL.polish[1] && S.anneal.polishMoves.length) {
      const { k, l } = polishStep(span(t, TL.polish[0], TL.polish[1]));
      return { move: S.anneal.polishMoves[k], l, accepted: true, kind: "better" as Move["kind"], slow: false };
    }
    return null;
  })();

  if (swapMove) {
    const { move, l, accepted, kind, slow } = swapMove;
    const { removed, added, segment } = reversalEdges(move.before, move.i, move.j);
    const look = slow ? smooth(l / 0.2) * (1 - smooth((l - 0.18) / 0.16)) : 0;
    const glow = Math.sin(clamp(l) * Math.PI);
    const segEdges: Edge[] = [];
    for (let i = 1; i < segment.length; i++) segEdges.push([segment[i - 1], segment[i]]);
    segEdges.forEach(edge => stroke(ctx, map(edgePoly(edge)), C.e1, 9, 0.16 * glow, [], false));
    const flip = accepted ? smooth((l - (slow ? 0.42 : 0.4)) / (slow ? 0.42 : 0.35)) : 0;
    segEdges.forEach(edge => {
      const pts = map(edgePoly(edge));
      const a = tipOf(pts, 0.46);
      const b = tipOf(pts, 0.54);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const mid = midOf(pts);
      chevron(ctx, mid, angle, C.e1, glow * (1 - flip));
      chevron(ctx, mid, angle + Math.PI, C.join, glow * flip);
    });
    if (look > 0.04) {
      removed.forEach(edge => stroke(ctx, map(edgePoly(edge)), C.cut, 5.2, look * (0.55 + 0.45 * pulse), [8, 6], false));
    }
    if (!accepted) {
      const tryColor = kind === "late" ? C.late : C.reject;
      const show = smooth(l / 0.3) * (1 - smooth((l - 0.7) / 0.3));
      removed.forEach(edge => stroke(ctx, map(edgePoly(edge)), C.cut, 2.4, show * 0.55, [5, 5], false));
      added.forEach(edge => stroke(ctx, map(edgePoly(edge)), tryColor, 3, show, [7, 5]));
      if (kind === "late" && move.late) {
        const at = P(nodePt(move.late));
        ring(ctx, at, 17 + pulse * 3, C.late, show);
        chip(ctx, at.x + 16, at.y - 34, `${label(move.late)} опоздает`, C.late, show);
      }
    } else if (kind === "worse") {
      const tag = smooth((l - 0.3) / 0.2) * (1 - smooth((l - 0.85) / 0.15));
      const at = P(midOf(edgePoly(added[0])));
      chip(ctx, at.x + 10, at.y - 30, `+${km(move.km - routeKmOf(move.before))} км, температура держит`, C.worse, tag);
    } else if (kind === "better") {
      const saved = routeKmOf(move.before) - move.km;
      if (saved > 0.15) {
        const tag = smooth((l - (slow ? 0.55 : 0.45)) / 0.2) * (1 - smooth((l - 0.9) / 0.1));
        const at = P(midOf(edgePoly(added[0])));
        chip(ctx, at.x + 10, at.y - 30, `−${km(saved)} км`, C.join, tag);
      }
    }
  }

  // ---------- пересечения ----------
  if (t >= TL.knot[0] && t < TL.twoopt[0] + 0.01) {
    const a = band(t, TL.knot[0], TL.twoopt[0] + 0.01, 0.01);
    insertedCross.forEach(pt => ring(ctx, P(pt), 13 + pulse * 5, C.cut, a));
  }
  if (t >= TL.twoopt[1] - 0.006 && t < TL.stuck[1]) {
    const a = band(t, TL.twoopt[1] - 0.006, TL.stuck[1], 0.01);
    twoOptCross.forEach(pt => ring(ctx, P(pt), 13 + pulse * 5, C.cut, a));
  }

  // ---------- тупик 2-opt ----------
  if (t >= TL.stuck[0] && t < TL.stuck[1] && S.stuck.picks.length) {
    const { k, l } = stuckStep(span(t, TL.stuck[0], TL.stuck[1]));
    const pick = S.stuck.picks[k];
    const { removed, added } = reversalEdges(S.twoOpt.order, pick.i, pick.j);
    const show = smooth(l / 0.25) * (1 - smooth((l - 0.78) / 0.22));
    removed.forEach(edge => stroke(ctx, map(edgePoly(edge)), C.cut, 2.6, show * 0.6, [5, 5], false));
    const color = pick.late ? C.late : C.reject;
    added.forEach(edge => stroke(ctx, map(edgePoly(edge)), color, 3, show, [7, 5]));
    const at = P(midOf(edgePoly(added[0])));
    const text = pick.late ? `${pick.delta < 0 ? `−${km(-pick.delta)} км, ` : ""}${label(pick.late)} опоздает` : `+${km(pick.delta)} км`;
    chip(ctx, at.x + 10, at.y - 30, text, color, show);
    if (pick.late) ring(ctx, P(nodePt(pick.late)), 17 + pulse * 3, C.late, show);
  }

  // ---------- заявки ----------
  const assignedTo = (id: string): "e1" | "e2" | null => {
    if (t < TL.insert[0]) return null;
    const e1 = views.e1?.to ?? [];
    const e2 = views.e2?.to ?? [];
    if (e1.includes(id)) return "e1";
    if (e2.includes(id)) return "e2";
    return null;
  };
  const doneIds = new Set<string>();
  if (inFreeze) {
    finalPlan.forEach(item => item.leave <= minute && doneIds.add(item.id));
    e2Plan.forEach(item => item.leave <= minute && doneIds.add(item.id));
  }
  const greedyU = smooth(span(t, TL.greedy[0], TL.greedy[1]));
  const greedyVisited = new Set<string>();
  if (t >= TL.greedy[0] && t < TL.regret[0] + 0.02) {
    const poly = S.routePolyline(E1, S.greedy);
    const reached = polyLen(poly) * greedyU;
    let walked = 0;
    let from: Pt = E1;
    for (const id of S.greedy) {
      const to = S.byId.get(id)!;
      walked += polyLen(road(from, to));
      if (walked <= reached + 1) greedyVisited.add(id);
      from = to;
    }
  }

  // столбики сожаления
  if (t >= TL.regret[0] && t < TL.insert[1]) {
    const inInsert = t >= TL.insert[0];
    const { k, l } = inInsert ? insertStep(span(t, TL.insert[0], TL.insert[1])) : { k: 0, l: 0 };
    const step = S.insertion[k];
    const rise = inInsert ? 1 : smooth(span(t, TL.regret[0], TL.regret[0] + 0.02));
    const fadeAll = 1 - smooth(span(t, TL.insert[1] - 0.008, TL.insert[1]));
    Object.entries(step.regrets).forEach(([id, value]) => {
      const chosen = id === step.id;
      const leaving = chosen && inInsert ? 1 - smooth((l - 0.3) / 0.25) : 1;
      const at = P(nodePt(id));
      const h = (8 + Math.min(value, 44) * 1.25) * rise;
      const w = 7;
      ctx.save();
      ctx.globalAlpha = fadeAll * leaving * (chosen ? 1 : 0.8);
      ctx.fillStyle = chosen ? (id === "urg" ? C.cut : C.e1) : "#a5adbb";
      ctx.beginPath();
      ctx.roundRect(at.x - w / 2, at.y - 16 - h, w, h, 3);
      ctx.fill();
      ctx.restore();
      if (chosen) chip(ctx, at.x - 26, at.y - 44 - h, `${km(value)} км`, id === "urg" ? C.cut : C.e1, fadeAll * leaving * rise);
    });
    if (inInsert && k === openingIndex) {
      const cmp = smooth((l - 0.04) / 0.16) * (1 - smooth((l - 0.9) / 0.1));
      const draw = smooth((l - 0.04) / 0.22);
      const target = nodePt(step.id);
      if (openingE1) {
        const a = map(road(nodePt(openingE1.prev), target));
        const b = openingE1.next ? map(road(target, nodePt(openingE1.next))) : [];
        stroke(ctx, cutPoly(a, draw), C.e1, 2.6, cmp * 0.9, [6, 5]);
        if (b.length) stroke(ctx, cutPoly(b, draw), C.e1, 2.6, cmp * 0.9, [6, 5]);
        const mid = midOf(a);
        chip(ctx, mid.x - 20, mid.y + 12, `Е1: крюк +${km(step.e1Cost)} км`, C.e1, cmp);
      }
      const leg = map(road(E2, target));
      stroke(ctx, cutPoly(leg, draw), C.e2, 2.6, cmp * 0.9, [6, 5]);
      const mid = midOf(leg);
      chip(ctx, mid.x + 12, mid.y - 8, `Е2: ${SHIFT_KM} за выход + ${km(step.e2Cost - SHIFT_KM)} км`, C.e2, cmp);
      ring(ctx, P(E2), 20 + pulse * 4, C.e2, cmp);
    }
  }

  S.stops.forEach((stop, index) => {
    const at = P(stop);
    const appear = smooth((introU - index * 0.035) / 0.3);
    if (appear <= 0.01) return;
    const owner = assignedTo(stop.id);
    let ringColor = owner === "e1" ? C.e1 : owner === "e2" ? C.e2 : "#8b93a3";
    let fill = "#fff";
    let text = owner === "e1" ? C.e1 : owner === "e2" ? C.e2 : "#4b5563";
    if (greedyVisited.has(stop.id)) {
      ringColor = C.greedy;
      text = C.greedy;
    }
    if (stop.urgent) {
      fill = C.cut;
      ringColor = C.cut;
      text = "#fff";
    }
    if (doneIds.has(stop.id)) {
      fill = C.done;
      ringColor = "#94a3b8";
      text = "#fff";
    }
    stopMarker(ctx, at, stop.label, ringColor, fill, text, appear, stop.urgent ? 12.5 : 11);
    if (stop.due !== undefined) {
      const lateNow = (anneal?.move.kind === "late" && anneal.move.late === stop.id) || (blockedPick?.late === stop.id && t >= TL.stuck[0] && t < TL.stuck[1]);
      ctx.save();
      ctx.globalAlpha = appear * (doneIds.has(stop.id) ? 0.4 : 0.9);
      ctx.font = `${lateNow ? 700 : 600} 10.5px Segoe UI, system-ui, sans-serif`;
      ctx.fillStyle = lateNow || stop.urgent ? C.cut : muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`до ${clock(stop.due)}`, at.x, at.y + 15);
      ctx.restore();
    }
  });

  // авария в жадном обходе
  if (t >= TL.fail[0] && t < TL.regret[0] + 0.01) {
    const a = band(t, TL.fail[0], TL.regret[0] + 0.01, 0.01);
    const at = P(nodePt("urg"));
    ring(ctx, at, 19 + pulse * 5, C.cut, a);
    chip(ctx, at.x - 24, at.y + 30, `приезд ${clock(greedyUrg)} · ждали до 09:30`, C.cut, a);
  }

  // базы
  const e2Active = (views.e2 && (views.e2.to.length || views.e2.l > 0)) || t >= TL.insert[1];
  baseMarker(ctx, P(E1), "Е1", C.e1, smooth(introU / 0.2));
  baseMarker(ctx, P(E2), "Е2", C.e2, smooth(introU / 0.2) * (e2Active ? 1 : 0.55));

  // ---------- новая заявка и заморозка ----------
  if (inFreeze) {
    const e1Pos = positionAt(E1, S.anneal.best, minute);
    const e2Pos = positionAt(E2, S.e2Final, minute);
    const place = (pos: { at: Pt; moving: boolean }) => {
      const at = P(pos.at);
      return pos.moving ? at : { x: at.x + 13, y: at.y - 13 };
    };
    rider(ctx, place(e2Pos), C.e2);
    rider(ctx, place(e1Pos), C.e1);

    const promised = smooth(span(t, TL.day[1] - 0.015, TL.day[1]));
    const ghost = band(t, TL.ghost[0], TL.kept[0] - 0.002, 0.01);
    const kept = smooth(span(t, TL.kept[0], TL.kept[0] + 0.025));
    promisedChips(P, ghost > 0.05).forEach(item => chip(ctx, item.rect.x, item.rect.y, item.text, item.shifted ? C.cut : C.e1, promised));

    const fresh = smooth(span(t, TL.fresh[0], TL.fresh[0] + 0.02));
    if (fresh > 0.01) {
      const at = P(STORY_NEW_JOB);
      ring(ctx, at, 16 + pulse * 6, C.fresh, fresh * (1 - kept * 0.6));
      stopMarker(ctx, at, STORY_NEW_JOB.label, C.fresh, "#fff", C.fresh, fresh, 12);
      chip(ctx, at.x - 118, at.y - 11, `новая · ${clock(STORY_EVENT)}`, C.fresh, fresh * (1 - kept));
    }
    if (ghost > 0.02 && ghostNext) {
      const a = map(road(nodePt(ghostPrev), STORY_NEW_JOB));
      const b = map(road(STORY_NEW_JOB, nodePt(ghostNext)));
      const cut = map(road(nodePt(ghostPrev), nodePt(ghostNext)));
      const g = smooth(span(t, TL.ghost[0], TL.ghost[0] + 0.02));
      stroke(ctx, cut, C.cut, 2.4, ghost * 0.6, [5, 5], false);
      stroke(ctx, cutPoly(a, g), C.worse, 3, ghost, [7, 5]);
      stroke(ctx, cutPoly(b, g), C.worse, 3, ghost, [7, 5]);
      const mid = midOf(b);
      chip(ctx, mid.x + 10, mid.y - 4, `+${km(RP.shortest?.extraKm ?? 0)} км`, C.worse, ghost);
    }
    if (kept > 0.01 && RP.kept && keptPrev) {
      const leg = map(road(nodePt(keptPrev), STORY_NEW_JOB));
      stroke(ctx, cutPoly(leg, kept), C.e1, 3.2, 1, [8, 6]);
      const mid = midOf(leg);
      chip(ctx, mid.x + 12, mid.y - 4, `Е1 · ${clock(RP.kept.arrive)} · +${km(RP.kept.extraKm)} км`, C.e1, smooth((kept - 0.5) / 0.5));
    }
  }

  // ---------- часы ----------
  let clockText = "08:00";
  if (t >= TL.greedy[0] && t < TL.regret[0]) {
    const u = smooth(span(t, TL.greedy[0], TL.greedy[1]));
    clockText = `${clock(timeAlong(S.greedy, u))} · к ближайшей`;
  } else if (t >= TL.regret[0] && t < TL.knot[0]) clockText = "08:00 · план на день";
  else if (t >= TL.knot[0] && t < TL.day[0]) clockText = `Е1: ${km(views.e1 ? routeKmOf(views.e1.l > 0.8 ? views.e1.to : views.e1.from) : 0)} км`;
  else if (inFreeze) clockText = clock(minute);
  chip(ctx, 16, 58, clockText, fg, smooth(introU / 0.3), true, "rgba(255,255,255,0.94)");

  // ---------- график отжига ----------
  const chartA = chartAlpha(t);
  if (chartA > 0.01) paintChart(ctx, chartRect(width, height), t, chartA, muted, fg);
}

function routeKmOf(order: string[]) {
  return S.routeKm(E1, order);
}

function timeAlong(order: string[], u: number) {
  const poly = S.routePolyline(E1, order);
  const reached = polyLen(poly) * u;
  let walked = 0;
  let now = START_MIN;
  let from: Pt = E1;
  for (const id of order) {
    const to = S.byId.get(id)!;
    const leg = polyLen(road(from, to));
    if (walked + leg >= reached) return now + (reached - walked) / PX_PER_MIN;
    walked += leg;
    now += leg / PX_PER_MIN + SERVICE_MIN;
    from = to;
  }
  return now;
}

function paintChart(ctx: CanvasRenderingContext2D, r: Rect, t: number, alpha: number, muted: string, fg: string) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.strokeStyle = "rgba(20,24,33,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 12);
  ctx.fill();
  ctx.stroke();

  const inResult = t >= TL.polish[1];
  if (inResult) {
    const rows = [
      { name: "вставка", value: insertedKm, color: "#a5adbb" },
      { name: "+ 2-opt", value: S.twoOpt.km, color: C.e1 },
      { name: "из тупика", value: S.anneal.bestKm, color: C.best },
    ];
    const grow = smooth(span(t, TL.result[0], TL.result[0] + 0.03));
    ctx.fillStyle = fg;
    ctx.font = "650 12px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Путь Е1, км", r.x + 14, r.y + 12);
    const maxV = Math.max(...rows.map(row => row.value));
    rows.forEach((row, index) => {
      const y = r.y + 42 + index * 38;
      ctx.fillStyle = muted;
      ctx.font = "500 11.5px Segoe UI, system-ui, sans-serif";
      ctx.fillText(row.name, r.x + 14, y + 4);
      const x0 = r.x + 80;
      const wMax = r.w - 80 - 64;
      const w = (row.value / maxV) * wMax * grow;
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.roundRect(x0, y, Math.max(2, w), 20, 5);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = "700 12px Segoe UI, system-ui, sans-serif";
      ctx.fillText(km(row.value), x0 + w + 8, y + 3);
    });
    ctx.restore();
    return;
  }

  const beforeAnneal = t < TL.anneal[0];
  const cur = currentAnneal(t);
  const k = beforeAnneal ? -1 : cur ? cur.k : log.length - 1;
  const frac = cur ? cur.l : 1;
  const px = r.x + 40;
  const pw = r.w - 54;
  const py = r.y + 34;
  const ph = r.h - 62;
  const X = (i: number) => px + (i / Math.max(1, log.length - 1)) * pw;
  const Y = (v: number) => py + ph - ((v - kmLo) / (kmHi - kmLo)) * ph;

  ctx.fillStyle = fg;
  ctx.font = "650 12px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Как меняется путь Е1, км", r.x + 14, r.y + 11);

  // уровень 2-opt
  ctx.strokeStyle = "rgba(109,74,255,0.45)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(px, Y(S.twoOpt.km));
  ctx.lineTo(px + pw, Y(S.twoOpt.km));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(109,74,255,0.8)";
  ctx.font = "600 10px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(`2-opt ${km(S.twoOpt.km)}`, px + pw, Y(S.twoOpt.km) - 2);

  if (k >= 0) {
    // попытки
    for (let i = 0; i <= k; i++) {
      const m = log[i];
      if (i === k && frac < 0.3) continue;
      const color = m.kind === "better" ? C.best : m.kind === "worse" ? C.worse : m.kind === "late" ? C.late : C.reject;
      const size = m.kind === "worse" ? 2.6 : m.kind === "reject" ? 1.4 : 1.8;
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * (m.kind === "reject" ? 0.55 : 0.9);
      ctx.beginPath();
      ctx.arc(X(i), Y(Math.min(kmHi, m.tryKm)), size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    // текущий путь
    ctx.strokeStyle = C.e1;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= k; i++) {
      const v = i === k && frac < 0.8 ? (i ? log[i - 1].km : S.twoOpt.km) : log[i].km;
      if (i === 0) ctx.moveTo(X(0), Y(v));
      else ctx.lineTo(X(i), Y(v));
    }
    ctx.stroke();
    // лучший
    ctx.strokeStyle = C.best;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= k; i++) {
      const v = log[i].bestKm;
      if (i === 0) ctx.moveTo(X(0), Y(v));
      else ctx.lineTo(X(i), Y(v));
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(k), Y(log[k].bestKm), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = C.best;
    ctx.fill();
  }

  // термометр
  const p = k >= 0 ? log[k].p : log[0].p;
  const p0 = log[0].p;
  const heat = clamp(p / p0);
  const tx = r.x + 16;
  const ty = py;
  const th = ph;
  ctx.fillStyle = "rgba(120,128,144,0.16)";
  ctx.beginPath();
  ctx.roundRect(tx, ty, 10, th, 5);
  ctx.fill();
  const hot = `rgb(${Math.round(234 * heat + 59 * (1 - heat))}, ${Math.round(88 * heat + 130 * (1 - heat))}, ${Math.round(12 * heat + 246 * (1 - heat))})`;
  ctx.fillStyle = hot;
  ctx.beginPath();
  ctx.roundRect(tx, ty + th * (1 - heat), 10, Math.max(4, th * heat), 5);
  ctx.fill();

  ctx.fillStyle = muted;
  ctx.font = "500 11px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const stepText = k >= 0 ? `шаг ${k + 1} из ${log.length}` : "ждём старта";
  ctx.fillText(stepText, r.x + 14, r.y + r.h - 22);
  ctx.textAlign = "right";
  ctx.fillStyle = hot;
  ctx.font = "650 11px Segoe UI, system-ui, sans-serif";
  ctx.fillText(`температура ${Math.max(1, Math.round(p * 100))}%`, r.x + r.w - 12, r.y + r.h - 22);
  ctx.restore();
}

// ---------- компонент ----------

export function AboutSolutionView({
  onOpenPlan,
  onOpenGenerator,
}: {
  onOpenPlan: () => void;
  onOpenGenerator: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef(0);
  const shownRef = useRef(0);

  const chapter = [...CHAPTERS].reverse().find(item => progress >= item.at - 1e-6) ?? CHAPTERS[0];

  const go = (target: number, jump = false) => {
    targetRef.current = clamp(target);
    if (jump) {
      shownRef.current = targetRef.current;
      setProgress(targetRef.current);
    }
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => setStageBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const dir = event.deltaY === 0 ? 0 : event.deltaY > 0 ? 1 : -1;
      if (!dir) return;
      const t = targetRef.current;
      const focus = t >= TL.knot[0] && t < TL.polish[1];
      const amount = Math.min(focus ? 0.0038 : 0.0065, Math.abs(event.deltaY) / (focus ? 17000 : 12500));
      targetRef.current = clamp(targetRef.current + dir * amount);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "PageDown", "PageUp", "ArrowRight", "ArrowLeft"].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      const dir = ["ArrowDown", "PageDown", "ArrowRight"].includes(event.key) ? 1 : -1;
      const focus = targetRef.current >= TL.knot[0] && targetRef.current < TL.polish[1];
      const step = event.key.startsWith("Page") ? (focus ? 0.03 : 0.045) : focus ? 0.006 : 0.01;
      targetRef.current = clamp(targetRef.current + dir * step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let tick = 0;
    let reported = -1;
    const paint = () => {
      tick += 0.016;
      const gap = targetRef.current - shownRef.current;
      if (Math.abs(gap) > 0.00004) shownRef.current += gap * 0.12;
      else shownRef.current = targetRef.current;
      const t = shownRef.current;
      if (Math.abs(t - reported) > 0.0003 || (t === targetRef.current && t !== reported)) {
        reported = t;
        setProgress(t);
      }
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width > 2 && height > 2) {
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
        }
        const styles = getComputedStyle(canvas);
        const bg = styles.getPropertyValue("--background").trim() || "#f6f7f9";
        const fg = styles.getPropertyValue("--foreground").trim() || "#1c1d22";
        const muted = styles.getPropertyValue("--muted-foreground").trim() || "#8b909a";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintScene(ctx, width, height, t, tick, bg, fg, muted);
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);

  const cards = (() => {
    if (stageBox.w < 2) return [];
    const { rects, P } = blockersAt(progress, stageBox.w, stageBox.h);
    const inStage = (pt: { x: number; y: number }) => ({ x: clamp(pt.x, 20, stageBox.w - 20), y: clamp(pt.y, 60, stageBox.h - 60) });
    const cardW = cardWidth(stageBox.w);
    const bounds = { x: 14, y: 92, w: Math.max(0, stageBox.w - 28), h: Math.max(0, stageBox.h - 92 - 50) };
    return LINES.map(line => {
      const opacity = band(progress, line.a, line.b);
      if (opacity <= 0.02) return null;
      const height = cardHeights[line.title] ?? 130;
      const rawAim = line.aim(progress);
      const aim = rawAim === "chart" ? (() => {
        const r = chartRect(stageBox.w, stageBox.h);
        return { x: r.x + r.w / 2, y: r.y + 10 };
      })() : inStage(P(rawAim));
      const placed = placeCard(aim, cardW, height, bounds, rects);
      const pull = (1 - opacity) * 26;
      const vx = aim.x - (placed.left + cardW / 2);
      const vy = aim.y - (placed.top + height / 2);
      const len = Math.hypot(vx, vy) || 1;
      return { line, opacity, aim, left: placed.left, top: placed.top, cardW, height, dx: (vx / len) * pull, dy: (vy / len) * pull };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  })();

  return (
    <div className="story-screen" ref={stageRef}>
      <div className="story-stage">
        <canvas ref={canvasRef} className="story-interactive-canvas" />
        <header className="story-bar">
          <div className="story-steps" role="tablist" aria-label="Этапы разбора">
            {CHAPTERS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={chapter.id === item.id}
                className={chapter.id === item.id ? "active" : ""}
                onClick={() => go(item.at + 0.001)}
              >
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="story-bar-actions">
            <button type="button" className="solution-btn primary" onClick={onOpenPlan}>
              <Route size={14} />
              Планировщик
            </button>
            <button type="button" className="solution-btn" onClick={onOpenGenerator}>
              <Sparkles size={14} />
              Данные
            </button>
          </div>
        </header>
        <div className="story-captions">
          {stageBox.w > 0 && (
            <svg className="story-leaders" viewBox={`0 0 ${stageBox.w} ${stageBox.h}`}>
              {cards.map(card => {
                const left = card.left + card.dx;
                const top = card.top + card.dy;
                const fx = clamp(card.aim.x, left, left + card.cardW);
                const fy = clamp(card.aim.y, top, top + card.height);
                const dx = card.aim.x - fx;
                const dy = card.aim.y - fy;
                const len = Math.hypot(dx, dy);
                if (len < 30) return null;
                return (
                  <line
                    key={card.line.title}
                    x1={fx}
                    y1={fy}
                    x2={card.aim.x - (dx / len) * 16}
                    y2={card.aim.y - (dy / len) * 16}
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                    opacity={card.opacity * 0.5}
                  />
                );
              })}
            </svg>
          )}
          {cards.map(card => (
            <article
              key={card.line.title}
              className="story-overlay"
              style={{
                opacity: card.opacity,
                left: card.left,
                top: card.top,
                width: card.cardW,
                transform: `translate(${card.dx}px, ${card.dy}px)`,
              }}
              ref={node => {
                if (!node) return;
                const next = node.offsetHeight;
                if (Math.abs(next - (cardHeights[card.line.title] ?? 0)) > 4) {
                  setCardHeights(current => ({ ...current, [card.line.title]: next }));
                }
              }}
            >
              <h2>{card.line.title}</h2>
              <p>{card.line.body}</p>
            </article>
          ))}
        </div>
        <div className="story-progress">
          <span>{progress < 0.004 ? "Прокрутите" : `${Math.round(progress * 100)}%`}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={progress}
            aria-label="Ход разбора"
            onChange={event => go(Number(event.target.value), true)}
          />
        </div>
      </div>
    </div>
  );
}
