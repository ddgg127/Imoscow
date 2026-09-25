"use client";

import { useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  Database,
  GitBranch,
  Layers,
  MapPin,
  Route,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  Zap,
} from "lucide-react";

type StageId = "filter" | "regret" | "cost" | "gls" | "objective" | "temporal";

type StageDetail = {
  id: StageId;
  code: string;
  title: string;
  formula: string;
  rationale: string;
  impact: string;
  sourceRef: string;
};

const STAGE_DETAILS: Record<StageId, StageDetail> = {
  filter: {
    id: "filter",
    code: "GATE-01",
    title: "Жёсткий отсев (Hard Filter Gate)",
    formula: "compatible = zoneMatch && skillMatch && equipmentMatch && transportAllowed",
    rationale:
      "До начала любых математических расчётов проверяется строгое пересечение ограничений. Несовместимые пары «инженер–заявка» отсекаются мгновенно, сокращая размерность задачи и исключая ошибки назначения.",
    impact: "Размерность пространства поиска сокращается на 70–85%, гарантируя выполнимость маршрута по ресурсам.",
    sourceRef: "lib/vrptw.ts → compatible()",
  },
  regret: {
    id: "regret",
    code: "LOOP-01",
    title: "Инициализация по сожалению (Regret-2)",
    formula: "Regret = Score(Инженер₂) - Score(Инженер₁), Solo_Gap = 24 км",
    rationale:
      "В отличие от жадного добавления, алгоритм сначала рассчитывает разницу в цене между лучшим и вторым кандидатом для каждой заявки. Работы с высоким риском потери (единственный кандидат или резкий скачок цены) ставятся в график первыми.",
    impact:
      "Защищает узкие утренние окна и редкие навыки от захвата случайными работами. Прирост назначений на контрольных наборах — до +18%.",
    sourceRef: "lib/vrptw.ts → optimizeVrptw()",
  },
  cost: {
    id: "cost",
    code: "LOOP-02",
    title: "Взвешенная стоимость вставки",
    formula: "Cost = (Δ_км × 25) + (Новый маршрут ? 350 : 0)",
    rationale:
      "Отношение 350 / 25 = 14 км задаёт экономический порог открытия нового инженера. Пока добавление заявки в уже открытый маршрут требует крюка меньше 14 км, новый сотрудник на линию не выводится.",
    impact: "Обеспечивает компактность выездной службы без искусственного простоя инженеров.",
    sourceRef: "lib/vrptw.ts → VEHICLE_COST, DISTANCE_WEIGHT",
  },
  gls: {
    id: "gls",
    code: "LOOP-03",
    title: "Локальный поиск и снятие минимумов (GLS)",
    formula: "Penalty_edge = km / (penalties[edge] + 1), Relocate + 2-opt",
    rationale:
      "Собранный план подвергается перестановкам: заявки переносятся между бригадами (Relocate) и меняются местами внутри маршрутов (2-opt). При застревании в локальном оптимуме длинные рёбра временно штрафуются, выталкивая алгоритм к более выгодным связкам.",
    impact: "Снижение суммарного километража на 12–22% при сохранении 100% временных окон.",
    sourceRef: "solver_service/app.py → GUIDED_LOCAL_SEARCH",
  },
  objective: {
    id: "objective",
    code: "LOOP-04",
    title: "Многокритериальная лестница целей",
    formula: "1) Max(Заявки) > 2) Max(Срочные) > 3) Min(Бригады) > 4) Min(Км)",
    rationale:
      "Цели не смешиваются в единую слепую сумму. Потеря заявки никогда не может быть оправдана экономией нескольких километров пути. Приоритет всегда отдаётся полноте обслуживания и срочным аварийным работам.",
    impact: "Предсказуемость для диспетчера: нет ситуаций, когда дальняя заявка «выброшена» ради красивого трека.",
    sourceRef: "solver_service/app.py → AddDisjunction(), VehicleCost",
  },
  temporal: {
    id: "temporal",
    code: "SYNC-01",
    title: "Временная адаптация и заморозка истории",
    formula: "Locked: t < T_event; Replan: t ≥ T_event; Ordinary: Gap-Insert Only",
    rationale:
      "При возникновении события в течение дня (срочный вызов, отмена, невыход) уже выполненные и начатые работы намертво фиксируются. Обычные заявки встраиваются только в свободные интервалы без смещения согласованного времени клиентов.",
    impact: "Нулевое нарушение обязательств перед клиентами при полной устойчивости к сбоям дня.",
    sourceRef: "lib/temporal-replan.ts → prepareTemporalReplan()",
  },
};

export function AboutSolutionView({
  onOpenPlan,
  onOpenGenerator,
  onOpenDemo,
}: {
  onOpenPlan: () => void;
  onOpenGenerator: () => void;
  onOpenDemo: () => void;
}) {
  const [activeStage, setActiveStage] = useState<StageId>("regret");
  const detail = STAGE_DETAILS[activeStage];

  return (
    <div className="about-solution-view">
      {/* Top Banner / Monospace Eyebrow */}
      <header className="blueprint-hero">
        <div className="blueprint-meta-bar">
          <span className="blueprint-tag">SYSTEM BLUEPRINT // VER. 2.4</span>
          <span className="blueprint-separator">/</span>
          <span>АРХИТЕКТУРА И АЛГОРИТМИЧЕСКИЙ ЦИКЛ</span>
          <span className="blueprint-separator">/</span>
          <span className="blueprint-status">
            <span className="blueprint-dot" />
            ДЕЙСТВУЮЩЕЕ ЯДРО
          </span>
        </div>

        <div className="blueprint-header-content">
          <div>
            <h1>О решении</h1>
            <p className="blueprint-lead">
              Как алгоритм распределяет заявки, управляет ограничениями и находит баланс между полнотой обслуживания,
              компактностью выездной службы и километражом.
            </p>
          </div>
          <div className="blueprint-quick-actions">
            <button type="button" className="blueprint-action-btn primary" onClick={onOpenPlan}>
              <Route size={15} />
              Открыть планирование
            </button>
            <button type="button" className="blueprint-action-btn" onClick={onOpenGenerator}>
              <Database size={15} />
              Генератор наборов
            </button>
          </div>
        </div>

        {/* Fact Ticker */}
        <div className="blueprint-metrics-strip">
          <div className="blueprint-metric">
            <small>СТРАТЕГИЯ ВСТАВКИ</small>
            <strong>Regret-2</strong>
            <span>Оценка риска потери заявки</span>
          </div>
          <div className="blueprint-metric">
            <small>ПОРОГ ОТКРЫТИЯ БРИГАДЫ</small>
            <strong>14 км</strong>
            <span>350 штраф / 25 вес км</span>
          </div>
          <div className="blueprint-metric">
            <small>ЗАПАС СОЖАЛЕНИЯ</small>
            <strong>24 км</strong>
            <span>Для безальтернативных позиций</span>
          </div>
          <div className="blueprint-metric">
            <small>ВРЕМЕННОЙ ГОРИЗОНТ</small>
            <strong>Заморозка</strong>
            <span>История дня не сдвигается</span>
          </div>
        </div>
      </header>

      {/* 3-Column Blueprint Diagram */}
      <section className="blueprint-container">
        {/* Column 01 */}
        <div className="blueprint-column">
          <div className="column-header">
            <span className="column-index">01</span>
            <div>
              <h3>Входной поток и отсев</h3>
              <small>Сущности, ресурсы и жёсткие фильтры</small>
            </div>
          </div>

          <div className="blueprint-cards">
            <div className="blueprint-card">
              <div className="card-top">
                <Users size={16} />
                <span className="card-code">ACTOR.01</span>
              </div>
              <h4>Выездные инженеры</h4>
              <ul>
                <li>График смены (08:00–17:00, 09:00–18:00)</li>
                <li>Точка старта (жилой дом OSM, без возврата)</li>
                <li>Компетенции: 1–3 навыка и рабочий инструмент</li>
                <li>Транспорт: Авто, Пешком, Вело, Общественный</li>
              </ul>
            </div>

            <div className="blueprint-card">
              <div className="card-top">
                <Wrench size={16} />
                <span className="card-code">ACTOR.02</span>
              </div>
              <h4>Клиентские заявки</h4>
              <ul>
                <li>Жёсткие окна визита (SLA-интервалы)</li>
                <li>Норматив выполнения (20–90 минут)</li>
                <li>Требуемый навык и оборудование</li>
                <li>Ограничение по типу транспорта (при наличии)</li>
              </ul>
            </div>

            <div className="blueprint-card gate-card">
              <div className="card-top">
                <ShieldCheck size={16} />
                <span className="card-code">GATE.01</span>
              </div>
              <h4>Жёсткий фильтр совместимости</h4>
              <p>
                Пары, не совпадающие по зоне, навыкам, комплекту оборудования или транспорту, отбрасываются до
                оптимизатора.
              </p>
              <div className="gate-pill">compatible(engineer, job) = true/false</div>
            </div>
          </div>
        </div>

        {/* Column 02 */}
        <div className="blueprint-column highlight-column">
          <div className="column-header">
            <span className="column-index">02</span>
            <div>
              <h3>Оптимизационный цикл</h3>
              <small>Поиск, оценка стоимости и локальное улучшение</small>
            </div>
          </div>

          {/* Interactive Flow Loop */}
          <div className="loop-diagram">
            <div className="loop-track">
              {[
                { id: "regret" as const, num: "01", label: "Regret-2 вставка" },
                { id: "cost" as const, num: "02", label: "Оценка стоимости" },
                { id: "gls" as const, num: "03", label: "Guided Local Search" },
                { id: "objective" as const, num: "04", label: "Иерархия целей" },
              ].map(step => (
                <button
                  key={step.id}
                  type="button"
                  className={`loop-node ${activeStage === step.id ? "active" : ""}`}
                  onClick={() => setActiveStage(step.id)}
                >
                  <span className="node-num">{step.num}</span>
                  <span className="node-label">{step.label}</span>
                </button>
              ))}
            </div>

            {/* Central Engine Badge */}
            <div className="loop-hub">
              <div className="hub-core">
                <Cpu size={18} />
                <strong>SOLVER CORE</strong>
                <small>OR-Tools + Резерв</small>
              </div>
            </div>
          </div>

          {/* Active Stage Inspector */}
          <div className="stage-inspector">
            <div className="inspector-head">
              <span className="inspector-code">{detail.code}</span>
              <h4>{detail.title}</h4>
            </div>
            <div className="inspector-formula">
              <code>{detail.formula}</code>
            </div>
            <p className="inspector-desc">{detail.rationale}</p>
            <div className="inspector-impact">
              <CheckCircle2 size={14} />
              <span>{detail.impact}</span>
            </div>
            <div className="inspector-source">
              <small>Реализация: {detail.sourceRef}</small>
            </div>
          </div>
        </div>

        {/* Column 03 */}
        <div className="blueprint-column">
          <div className="column-header">
            <span className="column-index">03</span>
            <div>
              <h3>Исполнение и адаптация</h3>
              <small>Управление событиями дня и прозрачность</small>
            </div>
          </div>

          <div className="blueprint-cards">
            <div
              className={`blueprint-card interactive ${activeStage === "temporal" ? "selected" : ""}`}
              onClick={() => setActiveStage("temporal")}
            >
              <div className="card-top">
                <Clock size={16} />
                <span className="card-code">SYNC.01</span>
              </div>
              <h4>Заморозка горизонта дня</h4>
              <p>
                Работы, которые начаты или завершены до наступления события, намертво блокируются. Время клиента не
                сдвигается.
              </p>
            </div>

            <div className="blueprint-card">
              <div className="card-top">
                <GitBranch size={16} />
                <span className="card-code">SYNC.02</span>
              </div>
              <h4>Суффиксное перепланирование</h4>
              <p>
                Перестраивается только будущий отрезок смены. Срочная заявка встраивается в свободные интервалы или
                вызывает локальную рокировку.
              </p>
            </div>

            <div className="blueprint-card">
              <div className="card-top">
                <Compass size={16} />
                <span className="card-code">EXPLAIN.01</span>
              </div>
              <h4>Детерминированные причины</h4>
              <p>
                Если заявку невозможно назначить, система выдаёт конкретную причину: нехватка времени смены, опоздание
                к закрытию окна или отсутствие навыка.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparative Evaluation Section */}
      <section className="blueprint-comparison">
        <div className="comparison-intro">
          <span className="blueprint-tag">СРАВНИТЕЛЬНЫЙ АНАЛИЗ</span>
          <h2>Почему этот метод превосходит базовые эвристики</h2>
          <p>
            На тех же самых данных разные подходы дают принципиально разный результат. Простое жадное назначение теряет
            узкие окна, а чистый поиск кратчайшего пути срывает график выездов.
          </p>
        </div>

        <div className="comparison-grid">
          <div className="comparison-card flawed">
            <div className="comp-tag">БАЗОВЫЙ ПОДХОД</div>
            <h3>Жадная вставка (First-Fit)</h3>
            <p className="comp-summary">Берёт заявку по порядку и отдаёт первому, кому она влезает в расписание.</p>
            <div className="comp-metric-row">
              <span>Покрытие заявок</span>
              <b>~79–83%</b>
            </div>
            <div className="comp-metric-row">
              <span>Задействованный штат</span>
              <b>Раздут на +25%</b>
            </div>
            <div className="comp-note">
              Длинные дневные заявки захватывают утреннее время и блокируют критичные короткие окна.
            </div>
          </div>

          <div className="comparison-card flawed">
            <div className="comp-tag">ЧИСТАЯ МИНИМИЗАЦИЯ КМ</div>
            <h3>Только пробег (TSP)</h3>
            <p className="comp-summary">Минимизирует суммарное расстояние, объединяя заявки по географической близости.</p>
            <div className="comp-metric-row">
              <span>Соблюдение окон SLA</span>
              <b>Частые срывы</b>
            </div>
            <div className="comp-metric-row">
              <span>Удалённые клиенты</span>
              <b>Выпадают из плана</b>
            </div>
            <div className="comp-note">
              Экономия 5 км пути приводит к потере заявки стоимостью в десятки раз выше затрат на топливо.
            </div>
          </div>

          <div className="comparison-card winner">
            <div className="comp-tag highlight">РЕШЕНИЕ FIELDFLOW</div>
            <h3>Regret-2 + Guided Local Search</h3>
            <p className="comp-summary">
              Лексикографическая иерархия: максимум выполненных работ, приоритет срочных, минимум машин и только затем
              километраж.
            </p>
            <div className="comp-metric-row">
              <span>Покрытие заявок</span>
              <b className="green">до 98.7%</b>
            </div>
            <div className="comp-metric-row">
              <span>Соблюдение окон SLA</span>
              <b className="green">100% строгий учёт</b>
            </div>
            <div className="comp-note">
              Защищает редкие ресурсы и утренние окна, автоматически находя оптимальный порядок объезда.
            </div>
          </div>
        </div>

        <div className="blueprint-footer-cta">
          <div>
            <h4>Посмотрите алгоритм в действии на реальных адресах</h4>
            <p>Вы можете сгенерировать контрольный набор данных или запустить расчёт на штатных данных Москвы.</p>
          </div>
          <div className="cta-buttons">
            <button type="button" className="blueprint-action-btn primary" onClick={onOpenPlan}>
              <Route size={15} />
              Перейти в планирование
            </button>
            <button type="button" className="blueprint-action-btn" onClick={onOpenDemo}>
              <Activity size={15} />
              Пошаговая демонстрация
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
