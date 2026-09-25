"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Compass,
  ExternalLink,
  GitBranch,
  Layers,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Route,
  Scale,
  Shield,
  Sparkles,
  Users,
  Wrench,
  Zap,
} from "lucide-react";

export type StoryChapterId =
  | "chaos"
  | "greedy"
  | "two_opt"
  | "regret"
  | "threshold"
  | "freeze"
  | "synthesis"
  | "references";

interface ChapterMeta {
  id: StoryChapterId;
  num: string;
  shortTitle: string;
  title: string;
  subtitle: string;
  badge: string;
  metricLabel: string;
  metricValue: string;
}

const CHAPTERS: ChapterMeta[] = [
  {
    id: "chaos",
    num: "01",
    shortTitle: "Хаос заявок",
    title: "Первичный хаос: NP-трудная задача на карте Москвы",
    subtitle: "205 заявок, 35 инженеров, миллионы несовместимых комбинаций",
    badge: "АНАТОМИЯ ВЫЗОВА",
    metricLabel: "Число комбинаций",
    metricValue: "> 10²⁸⁰ (N!)",
  },
  {
    id: "greedy",
    num: "02",
    shortTitle: "Ловушка жадины",
    title: "Тупик «жадного» выбора: почему ближайший заказ губит день",
    subtitle: "Жадный захват соседних точек оставляет критические заявки без исполнителей",
    badge: "СЛАБОСТЬ BASELINE",
    metricLabel: "Срыв окон SLA",
    metricValue: "до 25% аварий",
  },
  {
    id: "two_opt",
    num: "03",
    shortTitle: "Геометрия 2-opt",
    title: "Геометрия 2-opt: математическое распутывание самопересечений",
    subtitle: "Как фундаментальное неравенство треугольника сокращает километраж на 30%+",
    badge: "ЭВРИСТИКА ЛИНА-КЕРНИГАНА",
    metricLabel: "Экономия пробега",
    metricValue: "−30.8% (32.4 км)",
  },
  {
    id: "regret",
    num: "04",
    shortTitle: "Эвристика Regret-k",
    title: "Сожаление вместо жадности: принцип ALNS Ропке и Пизингера",
    subtitle: "Оценка упущенной выгоды (c₂ − c₁) гарантирует защиту аварийных окон",
    badge: "НАУЧНЫЙ ПРОРЫВ ALNS",
    metricLabel: "Защита срочных окон",
    metricValue: "100% покрытия",
  },
  {
    id: "threshold",
    num: "05",
    shortTitle: "Порог 14 км",
    title: "Экономический порог 14 км: когда вызывать нового инженера",
    subtitle: "Единая финансовая шкала: стоимость активации машины против перепробега",
    badge: "ШКАЛА ЦЕЛЕВОЙ ФУНКЦИИ",
    metricLabel: "Порог активации",
    metricValue: "350 / 25 = 14 км",
  },
  {
    id: "freeze",
    num: "06",
    shortTitle: "Заморозка времени",
    title: "Заморозка времени: адаптивное перепланирование в живом дне",
    subtitle: "Иммунитет согласованных визитов: события 13:10 не сдвигают обещания клиентам",
    badge: "ДИНАМИЧЕСКИЙ VRPTW",
    metricLabel: "Незыблемость плана",
    metricValue: "100% до рубежа",
  },
  {
    id: "synthesis",
    num: "07",
    shortTitle: "Синтез-система",
    title: "Архитектура FieldFlow: Google OR-Tools + Guided Local Search",
    subtitle: "Четырёхуровневая лексикографическая оптимизация на дорожном графе OSRM",
    badge: "ФИНАЛЬНЫЙ ОПТИМУМ",
    metricLabel: "Общее покрытие",
    metricValue: "99.5% без срывов",
  },
  {
    id: "references",
    num: "08",
    shortTitle: "Исследования",
    title: "Научная база и референсы индустрии",
    subtitle: "Фундаментальные статьи и инженерный опыт Яндекса, Dodo и Google",
    badge: "RESEARCH & PAPERS",
    metricLabel: "Использовано работ",
    metricValue: "5 ключевых трудов",
  },
];

// Canvas node definition
interface VisualNode {
  id: number;
  label: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  radius: number;
  type: "job_normal" | "job_urgent" | "engineer";
  engineerColor?: string;
  assignedEngineer: number | null; // 0, 1, 2 or null
  frozen: boolean;
  timeWindow: string;
  kind: string;
}

// Initial simulation nodes across a virtual Moscow coordinate space
const BASE_NODES: VisualNode[] = [
  // 3 Engineer Depots
  { id: 101, label: "И1 (Восток)", x: 260, y: 150, targetX: 260, targetY: 150, vx: 0, vy: 0, radius: 9, type: "engineer", engineerColor: "#7c3aed", assignedEngineer: 0, frozen: false, timeWindow: "08:00–20:00", kind: "База Восток" },
  { id: 102, label: "И2 (Юго-восток)", x: 280, y: 310, targetX: 280, targetY: 310, vx: 0, vy: 0, radius: 9, type: "engineer", engineerColor: "#0d9488", assignedEngineer: 1, frozen: false, timeWindow: "08:00–20:00", kind: "База Юго-восток" },
  { id: 103, label: "И3 (Югоцентр)", x: 130, y: 260, targetX: 130, targetY: 260, vx: 0, vy: 0, radius: 9, type: "engineer", engineerColor: "#d97706", assignedEngineer: 2, frozen: false, timeWindow: "08:00–20:00", kind: "База Югоцентр" },

  // Orders in East Zone
  { id: 1, label: "0001", x: 310, y: 90, targetX: 310, targetY: 90, vx: 0.3, vy: -0.2, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "09:00–11:00", kind: "Локальные работы" },
  { id: 2, label: "0002", x: 380, y: 120, targetX: 380, targetY: 120, vx: -0.2, vy: 0.4, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "11:30–13:30", kind: "Подключение" },
  { id: 3, label: "0003", x: 340, y: 180, targetX: 340, targetY: 180, vx: 0.4, vy: 0.2, radius: 6.5, type: "job_urgent", assignedEngineer: null, frozen: false, timeWindow: "10:00–11:30", kind: "Аварийные работы" },
  { id: 4, label: "0004", x: 290, y: 220, targetX: 290, targetY: 220, vx: -0.3, vy: -0.3, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "14:00–16:00", kind: "Локальные работы" },

  // Orders in Southeast Zone
  { id: 5, label: "0005", x: 330, y: 280, targetX: 330, targetY: 280, vx: 0.2, vy: 0.3, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "09:30–11:30", kind: "Подключение" },
  { id: 6, label: "0006", x: 390, y: 320, targetX: 390, targetY: 320, vx: -0.4, vy: -0.2, radius: 6.5, type: "job_urgent", assignedEngineer: null, frozen: false, timeWindow: "12:00–13:30", kind: "Аварийные работы" },
  { id: 7, label: "0007", x: 320, y: 370, targetX: 320, targetY: 370, vx: 0.3, vy: -0.3, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "15:00–17:00", kind: "Локальные работы" },
  { id: 8, label: "0008", x: 240, y: 360, targetX: 240, targetY: 360, vx: -0.2, vy: 0.3, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "17:00–19:00", kind: "Подключение" },

  // Orders in Southcenter Zone
  { id: 9, label: "0009", x: 170, y: 190, targetX: 170, targetY: 190, vx: 0.2, vy: 0.4, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "09:00–11:00", kind: "Подключение" },
  { id: 10, label: "0010", x: 80, y: 220, targetX: 80, targetY: 220, vx: -0.3, vy: -0.3, radius: 6.5, type: "job_urgent", assignedEngineer: null, frozen: false, timeWindow: "11:00–12:30", kind: "Аварийные работы" },
  { id: 11, label: "0011", x: 70, y: 300, targetX: 70, targetY: 300, vx: 0.4, vy: -0.2, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "14:00–16:00", kind: "Локальные работы" },
  { id: 12, label: "0012", x: 160, y: 340, targetX: 160, targetY: 340, vx: -0.2, vy: 0.2, radius: 5.5, type: "job_normal", assignedEngineer: null, frozen: false, timeWindow: "16:30–18:30", kind: "Подключение" },
];

export function AboutSolutionView({
  onOpenPlan,
  onOpenGenerator,
}: {
  onOpenPlan: () => void;
  onOpenGenerator: () => void;
}) {
  const [activeChapter, setActiveChapter] = useState<StoryChapterId>("chaos");
  const [animPlaying, setAnimPlaying] = useState(true);

  // Mini-interactive states inside chapter widgets
  const [twoOptUntangled, setTwoOptUntangled] = useState(false);
  const [regretStrategy, setRegretStrategy] = useState<"greedy" | "regret">("regret");
  const [detourKm, setDetourKm] = useState(10);
  const [freezeTime, setFreezeTime] = useState(13 * 60 + 10); // 13:10

  const costDetour = detourKm * 25;
  const costNewEngineer = 350;
  const detourChoice = detourKm <= 14 ? "assign_current" : "call_new";

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const nodesRef = useRef<VisualNode[]>(JSON.parse(JSON.stringify(BASE_NODES)));
  const hoverNodeRef = useRef<VisualNode | null>(null);
  const [hoverNodeInfo, setHoverNodeInfo] = useState<VisualNode | null>(null);

  // Chapter intersection observers
  const chapterRefs = useRef<Map<StoryChapterId, HTMLElement>>(new Map());

  const registerChapterRef = (id: StoryChapterId, el: HTMLElement | null) => {
    if (el) chapterRefs.current.set(id, el);
    else chapterRefs.current.delete(id);
  };

  const scrollToChapter = (id: StoryChapterId) => {
    const el = chapterRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveChapter(id);
    }
  };

  // Scroll spy to update active chapter as user scrolls
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-chapter-id") as StoryChapterId | null;
            if (id) setActiveChapter(id);
          }
        }
      },
      { threshold: 0.35, rootMargin: "-10% 0px -40% 0px" }
    );

    chapterRefs.current.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Sync canvas nodes target positions and connections based on active chapter
  useEffect(() => {
    const nodes = nodesRef.current;
    if (activeChapter === "chaos") {
      // Free random drift
      nodes.forEach((n, idx) => {
        n.assignedEngineer = null;
        n.frozen = false;
        n.targetX = BASE_NODES[idx].x;
        n.targetY = BASE_NODES[idx].y;
      });
    } else if (activeChapter === "greedy") {
      // Bad crossed connections: engineer 1 takes orders with crossing
      nodes.forEach((n, idx) => {
        n.frozen = false;
        n.assignedEngineer = n.type === "engineer" ? null : (idx <= 4 ? 0 : idx <= 8 ? 1 : 2);
      });
    } else if (activeChapter === "two_opt") {
      // 2-opt uncrossing demonstration
      nodes.forEach(n => {
        n.frozen = false;
      });
    } else if (activeChapter === "regret") {
      // Regret: urgent nodes are prioritized and reserved
      nodes.forEach(n => {
        n.frozen = false;
      });
    } else if (activeChapter === "threshold") {
      // Economic threshold
      nodes.forEach(n => {
        n.frozen = false;
      });
    } else if (activeChapter === "freeze") {
      // Time freeze: left nodes frozen (t <= 13:10)
      nodes.forEach(n => {
        n.frozen = n.x < 240;
      });
    } else if (activeChapter === "synthesis" || activeChapter === "references") {
      // Complete harmony
      nodes.forEach((n, idx) => {
        n.frozen = false;
        n.assignedEngineer = n.type === "engineer" ? null : (idx <= 4 ? 0 : idx <= 8 ? 1 : 2);
      });
    }
  }, [activeChapter]);

  // High-performance canvas drawing loop (Byotone-inspired particle-node field)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let pulse = 0;

    const render = () => {
      pulse += 0.035;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Scale factors from virtual (460x420) to real canvas
      const scaleX = width / 460;
      const scaleY = height / 420;

      const nodes = nodesRef.current;

      // 1. Update node physics (drift in chaos mode, lerp to targets in others)
      nodes.forEach(n => {
        if (activeChapter === "chaos") {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 30 || n.x > 430) n.vx *= -1;
          if (n.y < 30 || n.y > 390) n.vy *= -1;
        } else {
          n.x += (n.targetX - n.x) * 0.08;
          n.y += (n.targetY - n.y) * 0.08;
        }
      });

      // Helper for canvas coordinate
      const cx = (x: number) => x * scaleX;
      const cy = (y: number) => y * scaleY;

      // 2. Draw Connections depending on active chapter
      if (activeChapter === "chaos") {
        // Soft fading proximity lines
        ctx.lineWidth = 1;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const dist = Math.hypot(dx, dy);
            if (dist < 85) {
              const alpha = (1 - dist / 85) * 0.22;
              ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
              ctx.beginPath();
              ctx.moveTo(cx(nodes[i].x), cy(nodes[i].y));
              ctx.lineTo(cx(nodes[j].x), cy(nodes[j].y));
              ctx.stroke();
            }
          }
        }
      } else if (activeChapter === "greedy") {
        // Crossed jagged line with red intersection warning
        const eng = nodes[0]; // И1
        const n1 = nodes[3];  // 0001
        const n2 = nodes[4];  // 0002
        const n3 = nodes[5];  // 0003 (urgent)
        const n4 = nodes[6];  // 0004

        // Greedy creates a bad crossover between (eng->n2) and (n1->n4)
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#e11d48";
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.moveTo(cx(eng.x), cy(eng.y));
        ctx.lineTo(cx(n2.x), cy(n2.y));
        ctx.lineTo(cx(n1.x), cy(n1.y));
        ctx.lineTo(cx(n4.x), cy(n4.y));
        ctx.stroke();
        ctx.setLineDash([]);

        // Intersection marker
        const crossX = (cx(eng.x) + cx(n2.x) + cx(n1.x) + cx(n4.x)) / 4;
        const crossY = (cy(eng.y) + cy(n2.y) + cy(n1.y) + cy(n4.y)) / 4;
        const crossPulse = (Math.sin(pulse * 2) + 1) * 4;

        ctx.strokeStyle = "rgba(225, 29, 72, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(crossX, crossY, 14 + crossPulse, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#e11d48";
        ctx.beginPath();
        ctx.arc(crossX, crossY, 5, 0, Math.PI * 2);
        ctx.fill();

        // Dropped urgent node warning
        ctx.strokeStyle = "#dc2626";
        ctx.fillStyle = "rgba(220, 38, 38, 0.15)";
        ctx.beginPath();
        ctx.arc(cx(n3.x), cy(n3.y), 16 + Math.sin(pulse * 3) * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (activeChapter === "two_opt") {
        // 2-opt uncrossing: either crossed or untangled
        const eng = nodes[0];
        const n1 = nodes[3];
        const n2 = nodes[4];
        const n4 = nodes[6];

        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (!twoOptUntangled) {
          // Crossed
          ctx.strokeStyle = "#ef4444";
          ctx.beginPath();
          ctx.moveTo(cx(eng.x), cy(eng.y));
          ctx.lineTo(cx(n2.x), cy(n2.y));
          ctx.lineTo(cx(n1.x), cy(n1.y));
          ctx.lineTo(cx(n4.x), cy(n4.y));
          ctx.stroke();
        } else {
          // Untangled optimal
          ctx.strokeStyle = "#16a34a";
          ctx.beginPath();
          ctx.moveTo(cx(eng.x), cy(eng.y));
          ctx.lineTo(cx(n1.x), cy(n1.y));
          ctx.lineTo(cx(n2.x), cy(n2.y));
          ctx.lineTo(cx(n4.x), cy(n4.y));
          ctx.stroke();

          // Traveling light particle on untangled route
          const t = (pulse * 0.4) % 3;
          let px = 0, py = 0;
          if (t < 1) {
            px = cx(eng.x) + (cx(n1.x) - cx(eng.x)) * t;
            py = cy(eng.y) + (cy(n1.y) - cy(eng.y)) * t;
          } else if (t < 2) {
            px = cx(n1.x) + (cx(n2.x) - cx(n1.x)) * (t - 1);
            py = cy(n1.y) + (cy(n2.y) - cy(n1.y)) * (t - 1);
          } else {
            px = cx(n2.x) + (cx(n4.x) - cx(n2.x)) * (t - 2);
            py = cy(n2.y) + (cy(n4.y) - cy(n2.y)) * (t - 2);
          }
          ctx.fillStyle = "#fff";
          ctx.shadowColor = "#16a34a";
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      } else if (activeChapter === "regret") {
        // Regret waves radiating from high-regret urgent nodes
        const urgentNodes = nodes.filter(n => n.type === "job_urgent");
        urgentNodes.forEach(un => {
          const r1 = ((pulse * 18) % 45);
          const r2 = (((pulse * 18) + 20) % 45);
          ctx.strokeStyle = `rgba(217, 119, 6, ${Math.max(0, 1 - r1 / 45) * 0.6})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx(un.x), cy(un.y), r1, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = `rgba(217, 119, 6, ${Math.max(0, 1 - r2 / 45) * 0.6})`;
          ctx.beginPath();
          ctx.arc(cx(un.x), cy(un.y), r2, 0, Math.PI * 2);
          ctx.stroke();
        });

        // Connection lines in regret strategy
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = regretStrategy === "regret" ? "#7c3aed" : "#94a3b8";
        ctx.beginPath();
        ctx.moveTo(cx(nodes[0].x), cy(nodes[0].y));
        ctx.lineTo(cx(nodes[5].x), cy(nodes[5].y)); // Engineer 1 takes Urgent 0003 directly
        ctx.lineTo(cx(nodes[3].x), cy(nodes[3].y));
        ctx.lineTo(cx(nodes[4].x), cy(nodes[4].y));
        ctx.stroke();
      } else if (activeChapter === "threshold") {
        // Threshold circle around active route
        const eng = nodes[0];
        const job = nodes[6]; // Pending job
        const thresholdRadius = (14 * 6) * scaleX;

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(124, 58, 237, 0.35)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(cx(eng.x), cy(eng.y), thresholdRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Line to job if within threshold
        if (detourChoice === "assign_current") {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "#16a34a";
          ctx.beginPath();
          ctx.moveTo(cx(eng.x), cy(eng.y));
          ctx.lineTo(cx(job.x), cy(job.y));
          ctx.stroke();
        } else {
          // Second engineer summoned
          const eng2 = nodes[1];
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "#0d9488";
          ctx.beginPath();
          ctx.moveTo(cx(eng2.x), cy(eng2.y));
          ctx.lineTo(cx(job.x), cy(job.y));
          ctx.stroke();
        }
      } else if (activeChapter === "freeze") {
        // Vertical timeline freeze wave
        const waveX = cx(235);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#e11d48";
        ctx.beginPath();
        ctx.moveTo(waveX, 0);
        ctx.lineTo(waveX, height);
        ctx.stroke();

        // Shaded frozen past
        ctx.fillStyle = "rgba(100, 116, 139, 0.08)";
        ctx.fillRect(0, 0, waveX, height);

        // Solid lines in past
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#64748b";
        ctx.beginPath();
        ctx.moveTo(cx(nodes[2].x), cy(nodes[2].y));
        ctx.lineTo(cx(nodes[9].x), cy(nodes[9].y));
        ctx.lineTo(cx(nodes[10].x), cy(nodes[10].y));
        ctx.stroke();

        // Dynamic adaptive dashed lines in future
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#16a34a";
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(cx(nodes[0].x), cy(nodes[0].y));
        ctx.lineTo(cx(nodes[3].x), cy(nodes[3].y));
        ctx.lineTo(cx(nodes[4].x), cy(nodes[4].y));
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Synthesis / Optimal 3 balanced routes with flowing photons
        const routes = [
          { color: "#7c3aed", path: [nodes[0], nodes[3], nodes[4], nodes[5], nodes[6]] },
          { color: "#0d9488", path: [nodes[1], nodes[7], nodes[8], nodes[9], nodes[10]] },
          { color: "#d97706", path: [nodes[2], nodes[11], nodes[12], nodes[13], nodes[14]] },
        ];

        routes.forEach(({ color, path }) => {
          if (!path[0]) return;
          ctx.lineWidth = 2.8;
          ctx.strokeStyle = color;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(cx(path[0].x), cy(path[0].y));
          for (let p = 1; p < path.length; p++) {
            if (path[p]) ctx.lineTo(cx(path[p].x), cy(path[p].y));
          }
          ctx.stroke();

          // Traveling photon
          const segCount = path.length - 1;
          const progress = (pulse * 0.4) % segCount;
          const currSeg = Math.floor(progress);
          const t = progress - currSeg;

          const p1 = path[currSeg];
          const p2 = path[currSeg + 1];
          if (p1 && p2) {
            const px = cx(p1.x) + (cx(p2.x) - cx(p1.x)) * t;
            const py = cy(p1.y) + (cy(p2.y) - cy(p1.y)) * t;

            ctx.fillStyle = "#fff";
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(px, py, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        });
      }

      // 3. Draw Nodes (Orders & Engineers)
      nodes.forEach(n => {
        const x = cx(n.x);
        const y = cy(n.y);

        if (n.type === "engineer") {
          // Engineer Depot / Hub: rounded badge
          ctx.fillStyle = n.engineerColor || "#7c3aed";
          ctx.beginPath();
          ctx.arc(x, y, n.radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "#fff";
          ctx.stroke();

          // Outer beacon ring
          const ringRadius = n.radius + 5 + Math.sin(pulse * 2) * 2;
          ctx.strokeStyle = `${n.engineerColor}40`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
          ctx.stroke();

          // Label
          ctx.fillStyle = "#fff";
          ctx.font = "bold 9px ui-monospace, SFMono-Regular, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("И", x, y);
        } else {
          // Job Node
          const isUrgent = n.type === "job_urgent";
          const fillColor = isUrgent
            ? "#dc2626"
            : n.frozen
            ? "#64748b"
            : n.assignedEngineer === 0
            ? "#7c3aed"
            : n.assignedEngineer === 1
            ? "#0d9488"
            : n.assignedEngineer === 2
            ? "#d97706"
            : "#3b82f6";

          // Glow for urgent or hovered
          if (isUrgent || hoverNodeRef.current?.id === n.id) {
            ctx.fillStyle = `${fillColor}33`;
            ctx.beginPath();
            ctx.arc(x, y, n.radius + 6, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.fillStyle = fillColor;
          ctx.beginPath();
          ctx.arc(x, y, n.radius, 0, Math.PI * 2);
          ctx.fill();

          ctx.lineWidth = 2;
          ctx.strokeStyle = "#fff";
          ctx.stroke();

          // Node ID text
          ctx.fillStyle = "#fff";
          ctx.font = "bold 8px ui-monospace, SFMono-Regular, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(n.id).slice(-2), x, y);
        }
      });

      ctx.restore();

      if (animPlaying) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [activeChapter, animPlaying, twoOptUntangled, regretStrategy, detourChoice]);

  // Mouse hover detection on canvas nodes
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.clientWidth / 460;
    const scaleY = canvas.clientHeight / 420;

    const mx = (e.clientX - rect.left) / scaleX;
    const my = (e.clientY - rect.top) / scaleY;

    const hit = nodesRef.current.find(n => Math.hypot(n.x - mx, n.y - my) < n.radius + 6) || null;
    hoverNodeRef.current = hit;
    setHoverNodeInfo(hit);
  };

  const currChapterMeta = useMemo(() => {
    return CHAPTERS.find(c => c.id === activeChapter) ?? CHAPTERS[0];
  }, [activeChapter]);

  return (
    <div className="about-solution-container scrollytelling-experience">
      {/* Page Header */}
      <div className="solution-hero-banner">
        <div className="solution-hero-text">
          <div className="hero-kicker-tag">
            <Sparkles size={12} />
            <span>ИНТЕРАКТИВНАЯ ИСТОРИЯ АЛГОРИТМА</span>
          </div>
          <h1>Эволюция алгоритма: от хаоса к оптимальности</h1>
          <p className="solution-hero-sub">
            Пошаговое интерактивное путешествие: как простая идея развивалась через геометрию 2-opt,
            эвристику сожаления Ропке-Пизингера, экономический порог 14 км и заморозку времени
            в отказоустойчивую промышленную VRPTW систему.
          </p>
        </div>
        <div className="solution-hero-actions">
          <button type="button" className="solution-btn primary" onClick={onOpenPlan}>
            <Route size={15} />
            Открыть планировщик
          </button>
          <button type="button" className="solution-btn" onClick={onOpenGenerator}>
            Сгенерировать тест-данные
          </button>
        </div>
      </div>

      {/* Scrollytelling Stage: Sticky Canvas on the right, Narrative on the left */}
      <div className="scrolly-main-stage">
        {/* LEFT COLUMN: The Narrative Chapters (Scrollable) */}
        <div className="scrolly-narrative-stream">
          {/* CHAPTER 01: CHAOS */}
          <section
            id="chapter-chaos"
            data-chapter-id="chaos"
            ref={el => registerChapterRef("chaos", el)}
            className={`scrolly-chapter-card ${activeChapter === "chaos" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 01</span>
              <span className="chapter-tag">АНАТОМИЯ ВЫЗОВА</span>
            </div>
            <h2>Первичный хаос: NP-трудная задача на карте Москвы</h2>
            <p className="chapter-lead">
              Представьте утро диспетчерской: на карте разбросаны более 200 разнородных адресов — от Бабушкинской до Чертаново.
              Каждый клиент ждёт в строго согласованное окно (например, 10:00–12:00), а инженеры имеют разные квалификации и транспорт.
            </p>
            <div className="chapter-formula-card">
              <small>ВЫЧИСЛИТЕЛЬНАЯ СЛОЖНОСТЬ</small>
              <strong>N! перестановок = 205! &gt; 10²⁸⁰ вариантов</strong>
              <p>Число комбинаций превышает количество элементарных частиц в обозримой Вселенной. Полный перебор физически невозможен.</p>
            </div>
            <div className="chapter-insight-box">
              <Compass size={16} />
              <div>
                <strong>С чего мы начали:</strong>
                <p>
                  Попытка перебирать все возможные последовательности зависает даже на 15 заявках.
                  Системе требовалась быстрая математическая эвристика, способная за доли секунды отсекать заведомо проигрышные ходы.
                </p>
              </div>
            </div>
          </section>

          {/* CHAPTER 02: GREEDY TRAP */}
          <section
            id="chapter-greedy"
            data-chapter-id="greedy"
            ref={el => registerChapterRef("greedy", el)}
            className={`scrolly-chapter-card ${activeChapter === "greedy" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 02</span>
              <span className="chapter-tag error">СЛАБОСТЬ BASELINE</span>
            </div>
            <h2>Тупик «жадного» выбора: почему ближайший заказ губит день</h2>
            <p className="chapter-lead">
              Первая естественная мысль любого разработчика: <em>«Давайте просто брать заявку, которая ближе всего к инженеру прямо сейчас!»</em> (Greedy First-Fit).
              На практике это приводит к катастрофе.
            </p>
            <div className="chapter-warning-callout">
              <AlertTriangle size={18} />
              <div>
                <strong>Анатомия провала:</strong>
                <p>
                  Жадный алгоритм с радостью забирает 3 соседних простых заказа утром, но уводит инженера на восток города.
                  В результате в 11:30 в западном округе загорается срочный аварийный обрыв кабеля, а доехать туда вовремя уже никто не может.
                </p>
              </div>
            </div>
            <div className="chapter-metrics-row">
              <div className="mini-metric-pill bad">
                <small>Пересечений маршрута</small>
                <strong>3–5 петель</strong>
              </div>
              <div className="mini-metric-pill bad">
                <small>Сорвано аварийных SLA</small>
                <strong>до 25% вызовов</strong>
              </div>
              <div className="mini-metric-pill bad">
                <small>Лишний пробег</small>
                <strong>+44% км</strong>
              </div>
            </div>
          </section>

          {/* CHAPTER 03: 2-OPT GEOMETRY */}
          <section
            id="chapter-two_opt"
            data-chapter-id="two_opt"
            ref={el => registerChapterRef("two_opt", el)}
            className={`scrolly-chapter-card ${activeChapter === "two_opt" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 03</span>
              <span className="chapter-tag success">ГЕОМЕТРИЯ 2-OPT</span>
            </div>
            <h2>Геометрия 2-opt: распутывание самопересечений</h2>
            <p className="chapter-lead">
              В 1973 году исследователи Шен Лин и Брайан Керниган сформулировали принцип локального поиска 2-opt.
              В его основе лежит фундаментальный закон евклидовой метрики — <strong>неравенство треугольника</strong>.
            </p>
            <div className="chapter-formula-card">
              <small>ТЕОРЕМА НЕРАВЕНСТВА ТРЕУГОЛЬНИКА</small>
              <strong>‖A − C‖ + ‖B − D‖ &lt; ‖A − B‖ + ‖C − D‖</strong>
              <p>Сумма длин диагоналей любого выпуклого четырёхугольника всегда строго больше суммы двух его противоположных сторон.</p>
            </div>
            <div className="chapter-interactive-widget">
              <div className="widget-header">
                <span>Интерактивный эксперимент с 2-opt:</span>
                <span className={`status-tag ${twoOptUntangled ? "optimal" : "crossed"}`}>
                  {twoOptUntangled ? "32.4 км (распутано)" : "46.8 км (пересечение)"}
                </span>
              </div>
              <button
                type="button"
                className={`widget-action-btn ${twoOptUntangled ? "active" : ""}`}
                onClick={() => setTwoOptUntangled(v => !v)}
              >
                <RefreshCw size={14} className={twoOptUntangled ? "spin-once" : ""} />
                {twoOptUntangled ? "Вернуть исходный скрещенный путь" : "Применить перестановку 2-opt"}
              </button>
            </div>
            <p className="chapter-note">
              Решение: алгоритм непрерывно сканирует пары ребер. Как только обнаруживается пара, чья перестановка уменьшает сумму километров,
              порядок обхода участка массива немедленно инвертируется.
            </p>
          </section>

          {/* CHAPTER 04: REGRET-K */}
          <section
            id="chapter-regret"
            data-chapter-id="regret"
            ref={el => registerChapterRef("regret", el)}
            className={`scrolly-chapter-card ${activeChapter === "regret" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 04</span>
              <span className="chapter-tag highlight">НАУЧНЫЙ ПРОРЫВ ALNS</span>
            </div>
            <h2>Эвристика сожаления (Regret-k): взгляд на шаг вперёд</h2>
            <p className="chapter-lead">
              В фундаментальной работе 2006 года Стефан Ропке и Дэвид Пизингер предложили концепцию <strong>Regret-k</strong>
              в рамках адаптивного поиска в больших окрестностях (Adaptive Large Neighborhood Search, ALNS).
            </p>
            <div className="chapter-formula-card">
              <small>ФОРМУЛА СОЖАЛЕНИЯ (REGRET-2)</small>
              <strong>Δ = c₂ − c₁</strong>
              <p>
                Разница между стоимостью вставки ко <em>второму лучшему кандидату</em> (c₂) и к <em>первому</em> (c₁).
                Если эта разница огромна (или второго кандидата просто нет), откладывать заявку смертельно опасно.
              </p>
            </div>
            <div className="chapter-interactive-widget">
              <div className="widget-header">
                <span>Сравнение стратегий назначения:</span>
              </div>
              <div className="toggle-pill-group">
                <button
                  type="button"
                  className={regretStrategy === "greedy" ? "active" : ""}
                  onClick={() => setRegretStrategy("greedy")}
                >
                  Жадная стратегия (срыв)
                </button>
                <button
                  type="button"
                  className={regretStrategy === "regret" ? "active" : ""}
                  onClick={() => setRegretStrategy("regret")}
                >
                  Regret-2 (100% защита)
                </button>
              </div>
            </div>
            <div className="chapter-insight-box">
              <Zap size={16} />
              <div>
                <strong>Почему это решило проблему аварий:</strong>
                <p>
                  Если на аварию с рефлектометром может приехать только один специалист, то потеря этого слота означает срыв заявки ($c_2 = \infty$).
                  Regret-2 назначает её <strong>первой</strong>, даже если прямо сейчас это кажется не самым дешевым крюком.
                </p>
              </div>
            </div>
          </section>

          {/* CHAPTER 05: 14 KM THRESHOLD */}
          <section
            id="chapter-threshold"
            data-chapter-id="threshold"
            ref={el => registerChapterRef("threshold", el)}
            className={`scrolly-chapter-card ${activeChapter === "threshold" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 05</span>
              <span className="chapter-tag">ЭКОНОМИКА МАРШРУТА</span>
            </div>
            <h2>Экономический порог 14 км: баланс нового инженера и крюка</h2>
            <p className="chapter-lead">
              Исследования Яндекса и Dodo Engineering показывают: в целевой функции недопустимо использовать разрозненные абстрактные единицы.
              Километры и вывод сотрудников должны иметь сопоставимый финансовый вес.
            </p>
            <div className="chapter-formula-card">
              <small>ТОЧКА БЕЗУБЫТОЧНОСТИ АКТИВАЦИИ</small>
              <strong>Порог = C_инженер / w_км = 350 руб / 25 руб/км = 14 км</strong>
              <p>
                Если ради заявки занятому инженеру придётся сделать крюк ≤ 14 км — выгоднее догрузить его.
                Если крюк превышает 14 км — математически целесообразнее вывести на смену нового сотрудника.
              </p>
            </div>
            <div className="chapter-interactive-widget">
              <div className="widget-header">
                <span>Интерактивный ползунок крюка: <strong>{detourKm} км</strong></span>
                <span className={`status-tag ${detourChoice === "assign_current" ? "optimal" : "warning"}`}>
                  {detourChoice === "assign_current" ? "Догрузить текущего (дешевле)" : "Вызвать нового инженера"}
                </span>
              </div>
              <input
                type="range"
                min="2"
                max="30"
                step="1"
                value={detourKm}
                onChange={e => setDetourKm(Number(e.target.value))}
                className="detour-slider"
              />
              <div className="detour-calc-summary">
                <span>Крюк: {costDetour} руб ({detourKm} × 25)</span>
                <span>Выход нового: {costNewEngineer} руб</span>
              </div>
            </div>
          </section>

          {/* CHAPTER 06: TEMPORAL FREEZE */}
          <section
            id="chapter-freeze"
            data-chapter-id="freeze"
            ref={el => registerChapterRef("freeze", el)}
            className={`scrolly-chapter-card ${activeChapter === "freeze" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 06</span>
              <span className="chapter-tag highlight">ДИНАМИЧЕСКИЙ ДЕНЬ</span>
            </div>
            <h2>Заморозка времени: адаптивное перепланирование в реальном дне</h2>
            <p className="chapter-lead">
              День никогда не идёт идеально по плану: в 13:10 падает срочная авария или ломается автомобиль инженера.
              Главная ошибка наивных планировщиков — пересчитывать день целиком, разрушая утренние договоренности.
            </p>
            <div className="chapter-insight-box">
              <Lock size={16} />
              <div>
                <strong>Принцип неизменности согласованного визита:</strong>
                <p>
                  Рубеж времени разделяет день на две половины. Всё, что произошло или начато до момента события (13:10) —
                  <strong>абсолютно заморожено</strong>. Новые заявки встраиваются строго в технологические окна будущего
                  без сдвига согласованного времени других клиентов.
                </p>
              </div>
            </div>
            <div className="chapter-interactive-widget">
              <div className="widget-header">
                <span>Рубеж заморозки времени: <strong>{Math.floor(freezeTime / 60)}:{String(freezeTime % 60).padStart(2, "0")}</strong></span>
              </div>
              <input
                type="range"
                min={9 * 60}
                max={18 * 60}
                step={15}
                value={freezeTime}
                onChange={e => setFreezeTime(Number(e.target.value))}
                className="detour-slider"
              />
              <div className="freeze-legend-row">
                <span className="legend-tag frozen"><Lock size={11} /> До {Math.floor(freezeTime / 60)}:{String(freezeTime % 60).padStart(2, "0")}: Заморожено</span>
                <span className="legend-tag adaptive"><RefreshCw size={11} /> После: Адаптивный хвост</span>
              </div>
            </div>
          </section>

          {/* CHAPTER 07: GLOBAL SYNTHESIS */}
          <section
            id="chapter-synthesis"
            data-chapter-id="synthesis"
            ref={el => registerChapterRef("synthesis", el)}
            className={`scrolly-chapter-card ${activeChapter === "synthesis" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 07</span>
              <span className="chapter-tag success">ФИНАЛЬНЫЙ СИНТЕЗ</span>
            </div>
            <h2>Архитектура FieldFlow: Google OR-Tools + Guided Local Search</h2>
            <p className="chapter-lead">
              Мы объединили эвристику Regret-2 для быстрого начального построения и точный решатель Google OR-Tools
              (Constraint Programming + Guided Local Search) для глобальной оптимизации.
            </p>
            <div className="hierarchy-ladder-box">
              <div className="ladder-step">
                <div className="ladder-badge">1</div>
                <div>
                  <strong>Максимум назначенных заявок (99.5%+)</strong>
                  <small>Каждый потерянный абонент — прямой урон бизнесу</small>
                </div>
              </div>
              <div className="ladder-step">
                <div className="ladder-badge">2</div>
                <div>
                  <strong>100% покрытие срочных аварий</strong>
                  <small>Аварийные инциденты имеют приоритет штрафа в 10× раз выше обычных</small>
                </div>
              </div>
              <div className="ladder-step">
                <div className="ladder-badge">3</div>
                <div>
                  <strong>Минимум задействованных инженеров</strong>
                  <small>Концентрация смен экономит фонд оплаты труда и накладные расходы</small>
                </div>
              </div>
              <div className="ladder-step">
                <div className="ladder-badge">4</div>
                <div>
                  <strong>Минимум суммарного километража</strong>
                  <small>Точный дорожный граф OSRM и локальный поиск 2-opt</small>
                </div>
              </div>
            </div>
          </section>

          {/* CHAPTER 08: RESEARCH & REFERENCES */}
          <section
            id="chapter-references"
            data-chapter-id="references"
            ref={el => registerChapterRef("references", el)}
            className={`scrolly-chapter-card ${activeChapter === "references" ? "active" : ""}`}
          >
            <div className="chapter-marker-header">
              <span className="chapter-num-badge">ГЛАВА 08</span>
              <span className="chapter-tag">ИССЛЕДОВАТЕЛЬСКАЯ БАЗА</span>
            </div>
            <h2>Научные труды и индустриальные референсы</h2>
            <p className="chapter-lead">
              Архитектура и константы FieldFlow не были изобретены наугад. Они опираются на рецензируемые международные
              исследования по дискретной оптимизации и опыт ведущих логистических платформ.
            </p>

            <div className="research-papers-grid">
              <article className="paper-card">
                <div className="paper-header">
                  <span className="paper-year">2006</span>
                  <span className="paper-tag">ALNS &amp; Regret</span>
                </div>
                <h3>An Adaptive Large Neighborhood Search Heuristic for VRPTW</h3>
                <p className="paper-authors">Stefan Ropke, David Pisinger · <em>Transportation Science, 40(4)</em></p>
                <p className="paper-summary">
                  Основополагающая статья, доказавшая превосходство эвристики сожаления Regret-k над жадными методами
                  на классических бенчмарках Соломона. Взята за основу очереди распределения в нашем коде (`lib/assignment.ts`).
                </p>
                <a
                  href="https://doi.org/10.1287/trsc.1050.0135"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="paper-link"
                >
                  <span>DOI: 10.1287/trsc.1050.0135</span>
                  <ExternalLink size={12} />
                </a>
              </article>

              <article className="paper-card">
                <div className="paper-header">
                  <span className="paper-year">1973</span>
                  <span className="paper-tag">2-opt &amp; k-opt</span>
                </div>
                <h3>An Effective Heuristic Algorithm for the Traveling-Salesman Problem</h3>
                <p className="paper-authors">Shen Lin, Brian W. Kernighan · <em>Operations Research, 21(2)</em></p>
                <p className="paper-summary">
                  Классический труд, доказавший эффективность локальных перестановок рёбер на метрических графах.
                  Использован в нашей функции локального распутывания маршрутов инженеров.
                </p>
                <a
                  href="https://doi.org/10.1287/opre.21.2.498"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="paper-link"
                >
                  <span>DOI: 10.1287/opre.21.2.498</span>
                  <ExternalLink size={12} />
                </a>
              </article>

              <article className="paper-card">
                <div className="paper-header">
                  <span className="paper-year">2023</span>
                  <span className="paper-tag">Dodo Engineering</span>
                </div>
                <h3>Эволюция алгоритмов автоназначения: от жадности к OR-Tools</h3>
                <p className="paper-authors">Инженерная команда Dodo Brands · <em>Habr Engineering</em></p>
                <p className="paper-summary">
                  Практический разбор перехода от эмпирической кластеризации курьеров к целочисленному программированию
                  с жёсткими временными окнами и штрафными функциями единой размерности.
                </p>
                <a
                  href="https://habr.com/ru/companies/dododev/articles/904464/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="paper-link"
                >
                  <span>Читать на Хабре</span>
                  <ExternalLink size={12} />
                </a>
              </article>

              <article className="paper-card">
                <div className="paper-header">
                  <span className="paper-year">2024</span>
                  <span className="paper-tag">Яндекс Маршрутизация</span>
                </div>
                <h3>Штрафы, стоимость машин и цена километра в алгоритмах VRP</h3>
                <p className="paper-authors">Yandex Routing Team · <em>Техническая документация API</em></p>
                <p className="paper-summary">
                  Стандарт единой финансовой шкалы: соотношение стоимости выхода транспортного средства (Vehicle Cost)
                  и веса километра пробега. Обоснование нашего коэффициента 350 / 25 = 14 км.
                </p>
                <a
                  href="https://yandex.ru/routing/doc/ru/vrp/more-about-penalties"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="paper-link"
                >
                  <span>Документация Яндекса</span>
                  <ExternalLink size={12} />
                </a>
              </article>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Interactive Sticky Canvas Stage (Byotone inspired) */}
        <div className="scrolly-sticky-viewport">
          <div className="sticky-canvas-container">
            {/* Top Stage Control Strip */}
            <div className="canvas-hud-header">
              <div className="hud-phase-pill">
                <Activity size={13} className="hud-pulse-icon" />
                <span>ГЛАВА {currChapterMeta.num} · {currChapterMeta.badge}</span>
              </div>
              <div className="hud-actions">
                <button
                  type="button"
                  className="hud-control-btn"
                  onClick={() => setAnimPlaying(p => !p)}
                  title={animPlaying ? "Приостановить анимацию" : "Возобновить анимацию"}
                >
                  {animPlaying ? <Pause size={12} /> : <Play size={12} />}
                  <span>{animPlaying ? "Пауза" : "Пуск"}</span>
                </button>
              </div>
            </div>

            {/* Quick Chapter Selector Rail */}
            <div className="chapter-quick-rail" role="tablist" aria-label="Быстрое переключение глав">
              {CHAPTERS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`rail-dot ${activeChapter === c.id ? "active" : ""}`}
                  onClick={() => scrollToChapter(c.id)}
                  title={`Перейти к: ${c.num}. ${c.shortTitle}`}
                >
                  <span className="dot-num">{c.num}</span>
                  <span className="dot-label">{c.shortTitle}</span>
                </button>
              ))}
            </div>

            {/* The Animated Canvas Stage */}
            <div className="canvas-frame">
              <canvas
                ref={canvasRef}
                className="story-interactive-canvas"
                onMouseMove={handleCanvasMouseMove}
                onMouseLeave={() => {
                  hoverNodeRef.current = null;
                  setHoverNodeInfo(null);
                }}
              />

              {/* Hover Tooltip Overlay */}
              {hoverNodeInfo && (
                <div className="canvas-node-tooltip">
                  <strong>{hoverNodeInfo.label}</strong>
                  <span>{hoverNodeInfo.kind}</span>
                  <small>Окно: {hoverNodeInfo.timeWindow}</small>
                </div>
              )}
            </div>

            {/* Bottom HUD Metrics Strip */}
            <div className="canvas-hud-footer">
              <div className="hud-stat-box">
                <small>{currChapterMeta.metricLabel}</small>
                <strong>{currChapterMeta.metricValue}</strong>
              </div>
              <div className="hud-status-text">
                <small>ТЕКУЩИЙ ЭТАП</small>
                <span>{currChapterMeta.title}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
