"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Pause, Play, RotateCcw } from "lucide-react";
import { SearchTrace, makeDemoProblem, optimizeVrptw, type SearchObjective, type TraceFrame } from "@/lib/vrptw";

function pathD(points: Array<[number, number]>) {
  if (points.length < 2) return "";
  return points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join(" ");
}

function saveCsv(filename: string, rows: Array<Array<string | number>>) {
  const body = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, "\"\"")}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function tourLegs(frame: TraceFrame) {
  return frame.routes.flatMap(route => {
    const points = route.points;
    const labels = ["База", ...route.jobIds];
    const rows: Array<{ from: string; to: string; km: number; color: string }> = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      rows.push({ from: labels[i] ?? `p${i}`, to: labels[i + 1] ?? `p${i + 1}`, km: Math.hypot(a[0] - b[0], a[1] - b[1]), color: route.color });
    }
    return rows;
  });
}

function demoMatrix(jobs: Array<{ id: string; coordinates: [number, number] }>, depot: [number, number]) {
  const nodes = [{ id: "База", coordinates: depot }, ...jobs.map(job => ({ id: job.id, coordinates: job.coordinates }))];
  const km = nodes.map(a => nodes.map(b => Math.hypot(a.coordinates[0] - b.coordinates[0], a.coordinates[1] - b.coordinates[1])));
  return { labels: nodes.map(node => node.id), km };
}

function exportTour(legs: Array<{ from: string; to: string; km: number }>) {
  saveCsv("demo-tour.csv", [["Откуда", "Куда", "длина"], ...legs.map(row => [row.from, row.to, row.km.toFixed(3)])]);
}

function exportMatrix(matrix: { labels: string[]; km: number[][] }) {
  const rows: Array<Array<string | number>> = [["", ...matrix.labels]];
  matrix.labels.forEach((label, i) => rows.push([label, ...matrix.km[i].map(value => value.toFixed(3))]));
  saveCsv("demo-matrix.csv", rows);
}

function exportSteps(frames: TraceFrame[]) {
  saveCsv("demo-steps.csv", [["Шаг", "Фаза", "Подпись", "Длина", "Машин"], ...frames.map(item => [item.step + 1, item.phase, item.label, item.distanceKm.toFixed(3), item.vehicles])]);
}

export function AlgorithmDemoView() {
  const [mode, setMode] = useState<SearchObjective>("distance");
  const [points, setPoints] = useState(12);
  const [vehicles, setVehicles] = useState(1);
  const [seed, setSeed] = useState(7);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [table, setTable] = useState<"legs" | "matrix" | "steps">("legs");
  const run = useMemo(() => {
    const problem = makeDemoProblem(points, mode === "distance" ? 1 : vehicles, seed);
    const trace = new SearchTrace();
    const result = optimizeVrptw(problem.engineers, problem.jobs, {
      travel: problem.travel,
      seed,
      objective: mode,
      innerBudget: mode === "distance" ? 240 : 80,
      zoneBudget: mode === "distance" ? 120 : 180,
      skipInsertPolish: mode === "distance",
      trace,
    });
    const frames = trace.frames.length ? trace.frames : [{
      step: 0,
      phase: "done" as const,
      label: "Нет кадров",
      accepted: true,
      distanceKm: result.metrics.distanceKm,
      score: result.metrics.distanceKm,
      vehicles: result.routes.length,
      routes: [],
    }];
    return { problem, result, frames };
  }, [mode, points, vehicles, seed]);
  /* eslint-disable react-hooks/set-state-in-effect -- playback cursor follows the latest search trace */
  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [run]);
  useEffect(() => {
    if (!playing) return;
    if (cursor >= run.frames.length - 1) return;
    const timer = window.setTimeout(() => {
      setCursor(value => {
        const next = Math.min(run.frames.length - 1, value + 1);
        if (next >= run.frames.length - 1) setPlaying(false);
        return next;
      });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, run.frames.length]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const frame: TraceFrame = run.frames[Math.min(cursor, run.frames.length - 1)] ?? run.frames[0];
  const chart = run.frames.map(item => item.distanceKm);
  const maxKm = Math.max(1, ...chart);
  const afterInsert = [...run.frames].reverse().find(item => item.phase === "insert" && item.vehicles > 0);
  const finalFrame = run.frames[run.frames.length - 1];
  const greedyKm = afterInsert?.distanceKm ?? finalFrame.distanceKm;
  const finalKm = finalFrame.distanceKm;
  const legs = tourLegs(frame);
  const matrix = useMemo(() => demoMatrix(run.problem.jobs, [50, 50]), [run.problem.jobs]);
  const shortened = finalKm + 1e-6 < greedyKm;
  return <section className="page-view demo-view">
    <div className="view-summary">
      <article><span>Режим</span><strong>{mode === "distance" ? "Мин. путь" : "FieldFlow"}</strong><small>{mode === "distance" ? "только длина тура" : "штраф за машину"}</small></article>
      <article><span>Длина сейчас</span><strong>{frame.distanceKm.toFixed(1).replace(".", ",")}</strong><small>шаг {frame.step + 1} из {run.frames.length}</small></article>
      <article><span>Жадина → финиш</span><strong>{greedyKm.toFixed(1).replace(".", ",")} → {finalKm.toFixed(1).replace(".", ",")}</strong><small>{shortened ? "2-opt укоротил тур" : finalKm > greedyKm + 1e-6 ? "длина выросла из-за уплотнения" : "длина после жадины не изменилась"}</small></article>
    </div>
    <div className="demo-toolbar">
      <label>Точки<input type="number" min={4} max={18} value={points} onChange={event => setPoints(Math.min(18, Math.max(4, Number(event.target.value) || 4)))} /></label>
      <label>Курьеры<input type="number" min={1} max={6} value={vehicles} disabled={mode === "distance"} onChange={event => setVehicles(Math.min(6, Math.max(1, Number(event.target.value) || 1)))} /></label>
      <label>Seed<input type="number" min={1} max={999} value={seed} onChange={event => setSeed(Math.max(1, Number(event.target.value) || 1))} /></label>
      <button className={mode === "distance" ? "selected" : ""} onClick={() => { setMode("distance"); setVehicles(1); }}>Кратчайший путь</button>
      <button className={mode === "fieldflow" ? "selected" : ""} onClick={() => { setMode("fieldflow"); setVehicles(current => Math.max(2, current)); }}>Как в FieldFlow</button>
      <button className="plain-button" onClick={() => setSeed(value => value + 1)}><RotateCcw />Новые точки</button>
    </div>
    <div className="demo-stage">
      <svg viewBox="-4 -4 108 108" className="demo-plane" aria-label="Демонстрация поиска маршрута">
        {frame.routes.map(route => <path key={route.engineerId} d={pathD(route.points)} fill="none" stroke={route.color} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" />)}
        <circle cx="50" cy="50" r="2.2" fill="#151827" />
        {run.problem.jobs.map(job => {
          const active = frame.routes.some(route => route.jobIds.includes(job.id));
          return <g key={job.id}>
            <circle cx={job.coordinates[0]} cy={job.coordinates[1]} r={active ? 1.7 : 1.3} fill={active ? "#6547e7" : "#9aa0ae"} />
            <text x={job.coordinates[0] + 1.6} y={job.coordinates[1] - 1.4} fontSize="3">{job.id}</text>
          </g>;
        })}
      </svg>
      <div className="demo-side">
        <p className="demo-step"><b>{frame.label}</b><small>{frame.phase} · машин {frame.vehicles} · оценка {frame.score.toFixed(1)}</small></p>
        <div className="demo-chart" aria-hidden>{chart.map((value, index) => <i key={index} className={index === frame.step ? "current" : ""} style={{ height: `${value / maxKm * 100}%` }} />)}</div>
        <div className="demo-play">
          <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? <Pause /> : <Play />}{playing ? "Пауза" : "Играть"}</button>
          <input type="range" min={0} max={Math.max(0, run.frames.length - 1)} value={Math.min(cursor, run.frames.length - 1)} onChange={event => { setPlaying(false); setCursor(Number(event.target.value)); }} />
        </div>
        <p className="list-cap">{mode === "distance"
          ? "Один курьер, евклидово расстояние, широкие окна. Сначала жадина вставляет точки, затем 2-opt разворачивает пересечения. Если финиш короче жадины — поиск минимума работает."
          : "Тот же алгоритм, что в плане: штраф за новую машину ≈ 14 единиц пути. Переносы могут временно удлинить путь, но финал возвращает лучший найденный план. Уплотнение всё ещё может удлинить пробег, если машин становится меньше."}</p>
      </div>
    </div>
    <div className="export-bar">
      <button className="plain-button" onClick={() => exportTour(legs)}><Download />Тур CSV</button>
      <button className="plain-button" onClick={() => exportMatrix(matrix)}><Download />Матрица CSV</button>
      <button className="plain-button" onClick={() => exportSteps(run.frames)}><Download />Шаги CSV</button>
    </div>
    <div className="analysis-tabs">
      <button className={table === "legs" ? "selected" : ""} onClick={() => setTable("legs")}>Ноги тура</button>
      <button className={table === "matrix" ? "selected" : ""} onClick={() => setTable("matrix")}>Матрица</button>
      <button className={table === "steps" ? "selected" : ""} onClick={() => setTable("steps")}>Шаги поиска</button>
    </div>
    {table === "legs" && <div className="job-table analysis-table"><div className="job-row table-head demo-leg-row"><span>Откуда</span><span>Куда</span><span>длина</span></div>
      {legs.map((row, index) => <div className="job-row demo-leg-row" key={`${row.from}-${row.to}-${index}`}><span>{row.from}</span><span>{row.to}</span><span>{row.km.toFixed(2).replace(".", ",")}</span></div>)}
    </div>}
    {table === "matrix" && <div className="matrix-wrap"><table className="matrix-table"><thead><tr><th></th>{matrix.labels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{matrix.labels.map((label, i) => <tr key={label}><th>{label}</th>{matrix.km[i].map((value, j) => <td key={`${i}-${j}`}>{i === j ? "—" : value.toFixed(1)}</td>)}</tr>)}</tbody></table></div>}
    {table === "steps" && <div className="job-table analysis-table"><div className="job-row table-head analysis-step-head"><span>Шаг</span><span>Фаза</span><span>Что произошло</span><span>длина</span></div>
      {run.frames.map(item => <button type="button" className={`job-row analysis-step-row${item.step === frame.step ? " current-step" : ""}`} key={item.step} onClick={() => { setPlaying(false); setCursor(item.step); }}><span>{item.step + 1}</span><span>{item.phase}</span><span>{item.label}</span><span>{item.distanceKm.toFixed(1).replace(".", ",")}</span></button>)}
    </div>}
  </section>;
}
