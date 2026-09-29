"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { buildPlanAnalysis, downloadAnalysis, formatKm } from "@/lib/plan-analysis";
import { optimizationExplanation } from "@/lib/optimization-explanation";
import type { Engineer, OptimizationResult, TravelMatrix } from "@/lib/vrptw";

export function PlanAnalysisView({ result, engineers, travel }: { result: OptimizationResult; engineers: Engineer[]; travel?: TravelMatrix }) {
  const [tab, setTab] = useState<"assignments" | "legs" | "matrix">("assignments");
  const analysis = useMemo(() => buildPlanAnalysis(result, engineers, travel), [result, engineers, travel]);
  const legs = analysis.legs.filter(row => tab === "legs" ? true : row.source === "VRPTW");
  if (!result.metrics.assigned) {
    return <section className="page-view"><p className="list-cap">Сначала постройте маршруты — здесь появятся назначения, участки маршрутов и расстояния между точками.</p></section>;
  }
  return <section className="page-view">
    <details className="panel distance-details"><summary><strong>Изменение пробега</strong><span className="details-action">Показать расчёт</span></summary><div className="view-summary">
      <article><span>Инженеры</span><strong>{analysis.vehiclesVrptw}<em> / {analysis.vehiclesBaseline}</em></strong><small>Оптимизация / базовый план</small></article>
      <article><span>Пробег</span><strong>{formatKm(analysis.distanceVrptw)}</strong><small>базовый {formatKm(analysis.distanceBaseline)}</small></article>
      <article><span>Разница</span><strong>{analysis.extraKm >= 0 ? "+" : ""}{formatKm(analysis.extraKm)}</strong><small>{analysis.assigned} назначений</small></article>
    </div>
    <article className="analytics-panel wide analysis-note">
      <div className="panel-header"><div><h2>Анализ пробега</h2><p>Оптимизация учитывает приоритет выполнения заявок перед минимизацией километража</p></div></div>
      <p>{analysis.packNote}</p>
      <p>{optimizationExplanation}</p>
    </article></details>
    <div className="export-bar">
      <button className="plain-button" title="Скачать таблицу заявок и назначенных инженеров" onClick={() => downloadAnalysis(analysis, "assignments")}><Download />Скачать назначения CSV</button>
      <button className="plain-button" title="Скачать расстояние и время каждого участка маршрута" onClick={() => downloadAnalysis(analysis, "legs")}><Download />Скачать участки маршрутов CSV</button>
      <button className="plain-button" title="Скачать расстояния между парами точек" onClick={() => downloadAnalysis(analysis, "matrix")}><Download />Скачать расстояния CSV</button>
      <button className="plain-button" title="Скачать все данные анализа в одном файле" onClick={() => downloadAnalysis(analysis, "json")}><Download />Скачать весь анализ JSON</button>
    </div>
    <div className="analysis-tabs">
      <button className={tab === "assignments" ? "selected" : ""} onClick={() => setTab("assignments")}>Назначения заявок</button>
      <button className={tab === "legs" ? "selected" : ""} onClick={() => setTab("legs")}>Участки маршрутов</button>
      <button className={tab === "matrix" ? "selected" : ""} onClick={() => setTab("matrix")}>Расстояния между точками</button>
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
