"use client";

import { useEffect, useRef, useState } from "react";
import { Route, Sparkles } from "lucide-react";

type Pt = { x: number; y: number; name?: string; urgent?: boolean };

const E1: Pt = { x: 200, y: 318, name: "1" };
const E2: Pt = { x: 790, y: 188, name: "2" };
const A: Pt = { x: 352, y: 214, name: "1" };
const D: Pt = { x: 528, y: 168, name: "2" };
const FAR: Pt = { x: 688, y: 156, name: "3" };
const URG: Pt = { x: 128, y: 508, name: "А", urgent: true };
const B: Pt = { x: 572, y: 438, name: "4" };
const C: Pt = { x: 286, y: 468, name: "5" };
const HOOK: Pt = { x: 648, y: 528, name: "+" };
const E2B: Pt = { x: 860, y: 318 };
const E2C: Pt = { x: 742, y: 412 };
const S0: Pt = { x: 250, y: 455 };
const S1: Pt = { x: 700, y: 520 };
const S2: Pt = { x: 250, y: 545 };
const S3: Pt = { x: 700, y: 420 };
const EN: Pt = { x: 710, y: 175 };
const GAP: Pt = { x: 188, y: 390 };

const PARK = [
  { x: 392, y: 248 },
  { x: 508, y: 262 },
  { x: 522, y: 368 },
  { x: 404, y: 382 },
];

const GREEDY = [E1, A, D, FAR];
const REGRET = [E1, URG, A, D];
const CROSSED = [E1, URG, C, S2, S3, B, EN, D, A, S0, S1];
const CLEAR = [E1, URG, A, C, B, EN, D];
const CREW2 = [E2, FAR, E2B, E2C];

const CHAPTERS = [
  { id: "greedy", at: 0, label: "Ближайшая" },
  { id: "regret", at: 0.24, label: "Сожаление" },
  { id: "twoopt", at: 0.46, label: "2-opt" },
  { id: "threshold", at: 0.66, label: "Порог" },
  { id: "freeze", at: 0.82, label: "Часы" },
] as const;

const CROSS: Pt = { x: 463, y: 486 };

const LINES: Array<{
  start: number;
  end: number;
  title: string;
  body: string;
  aim: Pt;
  paths: Pt[][];
}> = [
  {
    start: 0,
    end: 0.2,
    title: "Ближайшая заявка уводит от аварии",
    body: "Каждый следующий заказ — тот, что ближе всех. Инженер уходит на восток, а авария на юго-западе открывается слишком поздно: он уже не успевает.",
    aim: URG,
    paths: [GREEDY, [URG]],
  },
  {
    start: 0.17,
    end: 0.32,
    title: "От расстояния отказываемся",
    body: "К концу жадного пути окно аварии уже закрыто. Близость не видит, что у этой заявки больше нет другого инженера.",
    aim: FAR,
    paths: [GREEDY, [URG, E1]],
  },
  {
    start: 0.28,
    end: 0.48,
    title: "Сначала берём то, что больше некому взять",
    body: "Сожаление — насколько хуже второе место в маршруте. У аварии второго места нет, поэтому её ставим раньше, пока окно открыто. Дальний заказ на востоке забирает второй инженер.",
    aim: URG,
    paths: [REGRET, CREW2],
  },
  {
    start: 0.44,
    end: 0.62,
    title: "Окна соблюдены, но путь завязан",
    body: "Вставка по выгоде собирает остановки, но не смотрит на форму пути. Дороги и так идут в обход, а маршрут всё равно пересекает сам себя и набирает лишние километры.",
    aim: CROSS,
    paths: [CROSSED, CREW2],
  },
  {
    start: 0.58,
    end: 0.76,
    title: "Два ребра меняем местами",
    body: "Берём пересечённые участки и разворачиваем кусок между ними. Пересечение пропадает, путь короче. Второй инженер остаётся на своей стороне.",
    aim: { x: 460, y: 530 },
    paths: [CLEAR, CROSSED, CREW2, [S0, S1], [S2, S3]],
  },
  {
    start: 0.72,
    end: 0.88,
    title: "Крюк сравниваем с новой сменой",
    body: "Появляется дальний заказ. Лишний путь и выход ещё одного инженера лежат на одной шкале: новая смена равна 14 км крюка. Это общая мера, чтобы сравнить два решения. Короче 14 — догружаем того, кто уже едет. Длиннее — выходит второй.",
    aim: HOOK,
    paths: [CLEAR, [D, HOOK], CREW2, [E2C, HOOK]],
  },
  {
    start: 0.84,
    end: 1,
    title: "Авария в 13:10 не двигает названные часы",
    body: "Утро уже прошло. Визиты, которым уже сказали 15:40 и 17:10, остаются на своих местах. Новая заявка встаёт в свободный промежуток раньше них.",
    aim: GAP,
    paths: [CLEAR, CREW2, [GAP], [B], [D]],
  },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smooth(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function band(t: number, start: number, end: number) {
  const edge = Math.min(0.045, (end - start) * 0.45);
  if (t < start || t > end) return 0;
  if (t < start + edge && start > 0) return (t - start) / edge;
  if (t > end - edge) return (end - t) / edge;
  return 1;
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) };
}

function lengthOf(pts: Pt[]) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

function cutPath(pts: Pt[], t: number) {
  const target = lengthOf(pts) * clamp(t);
  const out: Pt[] = [pts[0]];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (walked + seg >= target) {
      out.push(lerp(pts[i - 1], pts[i], seg === 0 ? 0 : (target - walked) / seg));
      return out;
    }
    walked += seg;
    out.push(pts[i]);
  }
  return pts;
}

function pointAlong(pts: Pt[], t: number) {
  const cut = cutPath(pts, t);
  return cut[cut.length - 1];
}

type Rect = { x: number; y: number; w: number; h: number };

function blockPath(path: Pt[], project: (pt: Pt) => { x: number; y: number }, blocked: Rect[], pad = 22) {
  for (let index = 1; index < path.length; index++) {
    const from = project(path[index - 1]);
    const to = project(path[index]);
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(len / 14));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      blocked.push({ x: x - pad, y: y - pad, w: pad * 2, h: pad * 2 });
    }
  }
  path.forEach(pt => {
    const at = project(pt);
    blocked.push({ x: at.x - pad - 6, y: at.y - pad - 6, w: (pad + 6) * 2, h: (pad + 6) * 2 });
  });
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function projector(width: number, height: number) {
  const scale = Math.min(width / 1000, (height - 8) / 620);
  const ox = (width - 1000 * scale) / 2;
  const oy = Math.max(54, (height - 620 * scale) / 2);
  return (pt: Pt) => ({ x: ox + pt.x * scale, y: oy + pt.y * scale });
}

function placeCallout(aim: { x: number; y: number }, cardW: number, cardH: number, bounds: Rect, blocked: Rect[]) {
  const gap = 28;
  const spots: Array<[number, number]> = [
    [aim.x + gap, aim.y - cardH * 0.15],
    [aim.x - cardW - gap, aim.y - cardH * 0.15],
    [aim.x - cardW * 0.2, aim.y - cardH - gap],
    [aim.x - cardW * 0.55, aim.y + gap],
    [aim.x + gap, aim.y - cardH - gap * 0.4],
    [aim.x - cardW - gap, aim.y - cardH - gap * 0.4],
    [aim.x + gap, aim.y + gap],
    [aim.x - cardW - gap, aim.y + gap],
  ];
  const maxLeft = Math.max(bounds.x, bounds.x + bounds.w - cardW);
  const maxTop = Math.max(bounds.y, bounds.y + bounds.h - cardH);
  for (let x = bounds.x; x <= maxLeft; x += 64) spots.push([x, bounds.y]);
  for (let y = bounds.y; y <= maxTop; y += 56) {
    spots.push([bounds.x, y]);
    spots.push([maxLeft, y]);
  }
  let best = { left: bounds.x, top: bounds.y, score: Number.POSITIVE_INFINITY };
  for (const [rawLeft, rawTop] of spots) {
    const left = clamp(rawLeft, bounds.x, maxLeft);
    const top = clamp(rawTop, bounds.y, maxTop);
    const card = { x: left, y: top, w: cardW, h: cardH };
    const hits = blocked.reduce((sum, item) => sum + (overlaps(card, item) ? 1 : 0), 0);
    const dist = Math.hypot(left + cardW / 2 - aim.x, top + cardH / 2 - aim.y);
    const score = hits * 8000 + dist;
    if (score < best.score) best = { left, top, score };
  }
  return best;
}

function emerge(left: number, top: number, cardW: number, cardH: number, aim: { x: number; y: number }, opacity: number) {
  const pull = (1 - opacity) * 32;
  const vx = aim.x - (left + cardW / 2);
  const vy = aim.y - (top + cardH / 2);
  const len = Math.hypot(vx, vy) || 1;
  return { x: (vx / len) * pull, y: (vy / len) * pull };
}

function closestEdge(left: number, top: number, cardW: number, cardH: number, aim: { x: number; y: number }) {
  return {
    x: clamp(aim.x, left, left + cardW),
    y: clamp(aim.y, top, top + cardH),
  };
}

function calloutSpot(
  line: (typeof LINES)[number],
  progress: number,
  stage: { w: number; h: number },
  cardHeight: number,
) {
  const opacity = band(progress, line.start, line.end);
  if (opacity <= 0.02 || stage.w < 2) return null;
  const project = projector(stage.w, stage.h);
  const aim = project(line.aim);
  const cardW = Math.min(336, Math.max(220, stage.w - 28));
  const bounds = { x: 14, y: 56, w: Math.max(0, stage.w - 28), h: Math.max(0, stage.h - 56 - 50) };
  const park = PARK.map(project);
  const blocked: Rect[] = [
    { x: 12, y: 50, w: 240, h: 36 },
    {
      x: Math.min(...park.map(pt => pt.x)) - 8,
      y: Math.min(...park.map(pt => pt.y)) - 8,
      w: Math.max(...park.map(pt => pt.x)) - Math.min(...park.map(pt => pt.x)) + 16,
      h: Math.max(...park.map(pt => pt.y)) - Math.min(...park.map(pt => pt.y)) + 16,
    },
  ];
  line.paths.forEach(path => blockPath(path, project, blocked));
  const placed = placeCallout(aim, cardW, cardHeight, bounds, blocked);
  return { ...placed, opacity, aim, cardW };
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

function drawPath(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, alpha: number, dash: number[] = []) {
  if (pts.length < 2 || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.lineWidth = width + 5;
  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
  ctx.stroke();
  ctx.setLineDash(dash);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function marker(ctx: CanvasRenderingContext2D, pt: Pt, fill: string, text: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.fillStyle = "#fff";
  ctx.arc(pt.x, pt.y, pt.urgent ? 13 : 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = fill;
  ctx.stroke();
  if (pt.urgent) {
    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = pt.urgent ? "#fff" : fill;
  ctx.font = "700 11px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pt.x, pt.y + 0.5);
  ctx.restore();
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, bg: string) {
  ctx.save();
  ctx.font = "600 12px Segoe UI, sans-serif";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w + 16, 22, 7);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 8, y + 11);
  ctx.restore();
}

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
  const progressRef = useRef(0);
  const animRef = useRef(0);

  const chapter = [...CHAPTERS].reverse().find(item => progress >= item.at) ?? CHAPTERS[0];

  const go = (target: number, animate: boolean) => {
    cancelAnimationFrame(animRef.current);
    const next = clamp(target);
    if (!animate) {
      progressRef.current = next;
      setProgress(next);
      return;
    }
    const from = progressRef.current;
    // eslint-disable-next-line react-hooks/purity
    const started = performance.now();
    const duration = 650 + Math.abs(next - from) * 1400;
    const frame = (now: number) => {
      const u = clamp((now - started) / duration);
      const eased = 1 - (1 - u) ** 3;
      const value = from + (next - from) * eased;
      progressRef.current = value;
      setProgress(value);
      if (u < 1) animRef.current = requestAnimationFrame(frame);
    };
    animRef.current = requestAnimationFrame(frame);
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
      cancelAnimationFrame(animRef.current);
      const dir = event.deltaY === 0 ? 0 : event.deltaY > 0 ? 1 : -1;
      if (!dir) return;
      const amount = Math.min(0.035, Math.abs(event.deltaY) / 2800);
      const value = clamp(progressRef.current + dir * amount);
      progressRef.current = value;
      setProgress(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      const dir = event.key === "ArrowDown" || event.key === "PageDown" ? 1 : -1;
      const step = event.key.startsWith("Page") ? 0.12 : 0.035;
      cancelAnimationFrame(animRef.current);
      const value = clamp(progressRef.current + dir * step);
      progressRef.current = value;
      setProgress(value);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let clock = 0;

    const paint = () => {
      clock += 0.016;
      const t = progressRef.current;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) {
        frame = requestAnimationFrame(paint);
        return;
      }
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const styles = getComputedStyle(canvas);
      const bg = cssVar(styles, "--background", "#f6f7f9");
      const fg = cssVar(styles, "--foreground", "#1c1d22");
      const muted = cssVar(styles, "--muted-foreground", "#8b909a");
      const primary = cssVar(styles, "--primary", "#6d4aff");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const sx = width / 1000;
      const sy = (height - 8) / 620;
      const scale = Math.min(sx, sy);
      const ox = (width - 1000 * scale) / 2;
      const oy = Math.max(54, (height - 620 * scale) / 2);
      const X = (x: number) => ox + x * scale;
      const Y = (y: number) => oy + y * scale;
      const P = (pt: Pt): Pt => ({ ...pt, x: X(pt.x), y: Y(pt.y) });
      const map = (pts: Pt[]) => pts.map(P);

      ctx.strokeStyle = "rgba(120, 128, 144, 0.14)";
      ctx.lineWidth = 1;
      for (let x = ox; x < ox + 1000 * scale; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, oy);
        ctx.lineTo(x, oy + 620 * scale);
        ctx.stroke();
      }
      for (let y = oy; y < oy + 620 * scale; y += 36) {
        ctx.beginPath();
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + 1000 * scale, y);
        ctx.stroke();
      }

      const park = map(PARK);
      ctx.beginPath();
      ctx.moveTo(park[0].x, park[0].y);
      park.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.closePath();
      ctx.fillStyle = "rgba(47, 143, 92, 0.16)";
      ctx.fill();
      ctx.strokeStyle = "rgba(31, 122, 74, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      park.forEach((pt, index) => {
        ctx.fillStyle = index % 2 ? "rgba(31,122,74,0.35)" : "rgba(47,143,92,0.55)";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = "rgba(31, 122, 74, 0.9)";
      ctx.font = "600 12px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("парк", X(456), Y(318));

      const greedyU = smooth(clamp((t - 0.02) / 0.16));
      const greedyFade = 1 - smooth(clamp((t - 0.18) / 0.12));
      const regretU = smooth(clamp((t - 0.26) / 0.16));
      const regretFade = 1 - smooth(clamp((t - 0.44) / 0.08));
      const knotU = smooth(clamp((t - 0.42) / 0.12));
      const swapU = smooth(clamp((t - 0.56) / 0.16));
      const clearFade = smooth(clamp((t - 0.5) / 0.08));
      const hookU = smooth(clamp((t - 0.7) / 0.14));
      const freezeU = smooth(clamp((t - 0.82) / 0.12));
      const crew2U = smooth(clamp((t - 0.3) / 0.12));

      if (greedyFade > 0.02) drawPath(ctx, map(cutPath(GREEDY, greedyU)), "#0284c7", 3.2, greedyFade * (1 - clearFade));
      if (regretU > 0 && regretFade > 0.02 && swapU < 0.98) {
        drawPath(ctx, map(cutPath(REGRET, regretU)), primary, 3.4, regretFade * (1 - knotU * 0.85));
      }

      const crossedPts = map(CROSSED);
      const clearPts = map(CLEAR);
      const oldRoute = knotU * (1 - smooth(clamp((swapU - 0.18) / 0.28)));
      const newRoute = smooth(clamp((swapU - 0.28) / 0.34));
      if (oldRoute > 0.02) drawPath(ctx, crossedPts, "#c2410c", 3.4, oldRoute);
      if (newRoute > 0.02) drawPath(ctx, clearPts, "#0f9f6e", 3.5, newRoute);
      const pair = Math.sin(clamp(swapU) * Math.PI);
      if (pair > 0.04) {
        ctx.save();
        ctx.lineWidth = 4;
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = `rgba(220, 38, 38, ${pair * (1 - newRoute)})`;
        ctx.beginPath();
        ctx.moveTo(X(S2.x), Y(S2.y));
        ctx.lineTo(X(S3.x), Y(S3.y));
        ctx.moveTo(X(S0.x), Y(S0.y));
        ctx.lineTo(X(S1.x), Y(S1.y));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(15, 159, 110, ${pair * newRoute})`;
        ctx.beginPath();
        ctx.moveTo(X(S2.x), Y(S2.y));
        ctx.lineTo(X(S0.x), Y(S0.y));
        ctx.moveTo(X(S3.x), Y(S3.y));
        ctx.lineTo(X(S1.x), Y(S1.y));
        ctx.stroke();
        ctx.restore();
      }

      const crewAlpha = Math.max(crew2U, freezeU);
      if (crewAlpha > 0.02) drawPath(ctx, map(cutPath(CREW2, crew2U)), "#0f766e", 3, crewAlpha);

      const km = 4 + hookU * 24;
      const secondCrew = km > 14;
      const handoff = smooth(clamp((km - 14) / 6));
      const hookFade = 1 - freezeU;
      if (hookU > 0.02 && hookFade > 0.02) {
        const from = P(D);
        const to = P(HOOK);
        const mid = lerp(from, to, hookU);
        drawPath(ctx, [from, mid], secondCrew ? "#0f766e" : "#c2410c", 3, 0.95 * hookFade, [6, 5]);
        if (secondCrew) drawPath(ctx, map(cutPath([E2C, HOOK], handoff)), "#0f766e", 3, handoff * hookFade);
        ctx.save();
        ctx.globalAlpha = hookFade;
        chip(ctx, to.x + 12, to.y - 28, `крюк ${km.toFixed(0)}`, secondCrew ? "#0f766e" : "#c2410c", "rgba(255,255,255,0.94)");
        ctx.restore();
      }

      const jobs: Array<{ pt: Pt; show: number }> = [
        { pt: A, show: 1 },
        { pt: D, show: greedyU > 0.25 || regretU > 0 ? 1 : 0.45 },
        { pt: FAR, show: 1 },
        { pt: URG, show: greedyU > 0.45 || regretU > 0 ? 1 : 0.35 },
        { pt: B, show: knotU },
        { pt: C, show: knotU },
        { pt: HOOK, show: hookU * (1 - freezeU) },
      ];
      jobs.forEach(({ pt, show }) => {
        if (show <= 0.02) return;
        marker(ctx, P(pt), pt.urgent ? "#dc2626" : primary, pt.name ?? "", show);
      });

      const riderRoute = swapU > 0.5 ? CLEAR : knotU > 0.4 ? CROSSED : regretU > 0.2 ? REGRET : GREEDY;
      const riderT = swapU > 0.5 ? swapU : knotU > 0.4 ? knotU : regretU > 0.2 ? regretU : greedyU;
      const rider = P(pointAlong(riderRoute, Math.max(0.04, riderT)));
      ctx.beginPath();
      ctx.fillStyle = primary;
      ctx.arc(rider.x, rider.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();

      const base = (pt: Pt, color: string, title: string, alpha: number) => {
        const at = P(pt);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(at.x - 14, at.y - 12, 28, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "700 11px Segoe UI, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(title, at.x, at.y);
        ctx.restore();
      };
      base(E1, primary, "Е1", 1);
      base(E2, "#0f766e", "Е2", Math.max(0.45, crewAlpha));

      const minutes = regretU > 0.15 ? Math.round(mix(8 * 60, 13 * 60 + 15, regretU)) : Math.round(mix(8 * 60, 14 * 60 + 45, greedyU));
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      chip(ctx, 16, 58, regretU > 0.15 ? `${hh}:${mm}  авария в окне` : `${hh}:${mm}  жадный обход`, fg, "rgba(255,255,255,0.92)");

      if (freezeU > 0.02) {
        const settle = smooth(clamp((t - 0.87) / 0.08));
        const slide = (1 - settle) * 48;
        ctx.save();
        ctx.globalAlpha = freezeU;
        const timed = [
          { pt: B, label: "15:40", shift: slide },
          { pt: D, label: "17:10", shift: slide * 0.6 },
        ];
        timed.forEach(item => {
          const at = P(item.pt);
          chip(ctx, at.x + 14 + item.shift, at.y - 18, item.label, primary, "rgba(255,255,255,0.94)");
        });
        const gap = P(GAP);
        ctx.fillStyle = "#dc2626";
        ctx.beginPath();
        ctx.arc(gap.x, gap.y, 8, 0, Math.PI * 2);
        ctx.fill();
        chip(ctx, gap.x + 12, gap.y - 16, "13:10", "#dc2626", "rgba(255,255,255,0.94)");
        ctx.restore();
      }

      const flow = (pts: Pt[], alpha: number, color: string) => {
        if (alpha < 0.05) return;
        const spot = pointAlong(pts, (clock * 0.12) % 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X(spot.x), Y(spot.y), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      flow(swapU > 0.6 ? CLEAR : GREEDY, greedyFade * 0.8, "#0284c7");
      flow(CREW2, crewAlpha, "#0f766e");

      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, []);

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
                onClick={() => go(item.at, true)}
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
              {LINES.map(line => {
                const spot = calloutSpot(line, progress, stageBox, cardHeights[line.title] ?? 118);
                if (!spot) return null;
                const height = cardHeights[line.title] ?? 118;
                const shift = emerge(spot.left, spot.top, spot.cardW, height, spot.aim, spot.opacity);
                const from = closestEdge(spot.left + shift.x, spot.top + shift.y, spot.cardW, height, spot.aim);
                const dx = spot.aim.x - from.x;
                const dy = spot.aim.y - from.y;
                const len = Math.hypot(dx, dy);
                if (len < 36) return null;
                const endX = spot.aim.x - (dx / len) * 18;
                const endY = spot.aim.y - (dy / len) * 18;
                return (
                  <line
                    key={line.title}
                    x1={from.x}
                    y1={from.y}
                    x2={endX}
                    y2={endY}
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeDasharray="4 4"
                    opacity={spot.opacity * 0.55}
                  />
                );
              })}
            </svg>
          )}
          {LINES.map(line => {
            const height = cardHeights[line.title] ?? 118;
            const spot = stageBox.w > 0 ? calloutSpot(line, progress, stageBox, height) : null;
            const opacity = spot?.opacity ?? band(progress, line.start, line.end);
            if (opacity <= 0.02 || !spot) return null;
            const shift = emerge(spot.left, spot.top, spot.cardW, height, spot.aim, opacity);
            return (
              <article
                key={line.title}
                className="story-overlay"
                style={{
                  opacity,
                  left: spot.left,
                  top: spot.top,
                  width: spot.cardW,
                  transform: `translate(${shift.x}px, ${shift.y}px)`,
                }}
                ref={node => {
                  if (!node) return;
                  const next = node.offsetHeight;
                  if (Math.abs(next - (cardHeights[line.title] ?? 0)) > 4) {
                    setCardHeights(current => ({ ...current, [line.title]: next }));
                  }
                }}
              >
                <h2>{line.title}</h2>
                <p>{line.body}</p>
              </article>
            );
          })}
        </div>
        <div className="story-progress">
          <span>{progress < 0.02 ? "Прокрутите" : `${Math.round(progress * 100)}%`}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={progress}
            aria-label="Ход разбора"
            onChange={event => go(Number(event.target.value), false)}
          />
        </div>
      </div>
    </div>
  );
}
