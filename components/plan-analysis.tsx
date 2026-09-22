"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { buildPlanAnalysis, downloadAnalysis, formatKm } from "@/lib/plan-analysis";
import type { Engineer, OptimizationResult, TravelMatrix } from "@/lib/vrptw";

export function PlanAnalysisView({ result, engineers, travel }: { result: OptimizationResult; engineers: Engineer[]; travel?: TravelMatrix }) {
  const [tab, setTab] = useState<"assignments" | "legs" | "matrix">("assignments");
  const analysis = useMemo(() => buildPlanAnalysis(result, engineers, travel), [result, engineers, travel]);
  const legs = analysis.legs.filter(row => tab === "legs" ? true : row.source === "VRPTW");
  if (!result.metrics.assigned) {
    return <section className="page-view"><p className="list-cap">Сначала постройте маршруты — здесь появятся связи, ноги и матрица расстояний.</p></section>;
  }
  return <section className="page-view">
    <div className="view-summary">
      <article><span>Машины</span><strong>{analysis.vehiclesVrptw}<em> / {analysis.vehiclesBaseline}</em></strong><small>VRPTW / исходный пул</small></article>
      <article><span>Пробег</span><strong>{formatKm(analysis.distanceVrptw)}</strong><small>исходный {formatKm(analysis.distanceBaseline)}</small></article>
      <article><span>Разница</span><strong>{analysis.extraKm >= 0 ? "+" : ""}{formatKm(analysis.extraKm)}</strong><small>{analysis.assigned} назначений</small></article>
    </div>
    <article className="panel analytics-panel wide analysis-note">
      <div className="panel-header"><div><h2>Почему километры растут</h2><p>Целевая функция — не минимум пробега</p></div></div>
      <p>{analysis.packNote}</p>
    </article>
    <div className="export-bar">
      <button className="plain-button" onClick={() => downloadAnalysis(analysis, "assignments")}><Download />Связи CSV</button>
      <button className="plain-button" onClick={() => downloadAnalysis(analysis, "legs")}><Download />Ноги CSV</button>
      <button className="plain-button" onClick={() => downloadAnalysis(analysis, "matrix")}><Download />Матрица CSV</button>
      <button className="plain-button" onClick={() => downloadAnalysis(analysis, "json")}><Download />JSON</button>
    </div>
    <div className="analysis-tabs">
      <button className={tab === "assignments" ? "selected" : ""} onClick={() => setTab("assignments")}>Связи заявок</button>
      <button className={tab === "legs" ? "selected" : ""} onClick={() => setTab("legs")}>Ноги маршрутов</button>
      <button className={tab === "matrix" ? "selected" : ""} onClick={() => setTab("matrix")}>Матрица км</button>
    </div>
    {tab === "assignments" && <div className="job-table analysis-table"><div className="job-row table-head analysis-assign-head"><span>Заявка</span><span>Адрес</span><span>Исходный</span><span>VRPTW</span><span>Сдвиг</span></div>
      {analysis.assignments.map(row => <div className="job-row analysis-assign-row" key={row.jobId}><span><b>№ {row.jobId}</b><small>{row.window}</small></span><span>{row.address}</span><span>{row.baselineEngineer}</span><span>{row.vrptwEngineer}</span><span>{row.changed ? "да" : "нет"}</span></div>)}
    </div>}
    {tab === "legs" && <div className="job-table analysis-table"><div className="job-row table-head analysis-leg-head"><span>Источник</span><span>Инженер</span><span>№</span><span>Откуда → куда</span><span>км</span></div>
      {legs.map((row, index) => <div className="job-row analysis-leg-row" key={`${row.source}-${row.engineer}-${row.sequence}-${index}`}><span>{row.source}</span><span>{row.engineer}</span><span>{row.sequence}</span><span>{row.fromLabel} → {row.toLabel}</span><span>{row.km.toFixed(2).replace(".", ",")}</span></div>)}
    </div>}
    {tab === "matrix" && <div className="matrix-wrap"><table className="matrix-table"><thead><tr><th></th>{analysis.matrix.labels.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{analysis.matrix.labels.map((label, i) => <tr key={label}><th>{label}</th>{analysis.matrix.km[i].map((value, j) => <td key={`${i}-${j}`}>{i === j ? "—" : value.toFixed(1)}</td>)}</tr>)}</tbody></table><p className="list-cap">До 28 точек. Полная таблица — в JSON.</p></div>}
  </section>;
}
