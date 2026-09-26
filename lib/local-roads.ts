import type { Coordinate, TravelMode } from "./map-providers.ts";
import type { LocalRoadRoute } from "./local-road-graph.ts";
import RoadRouterWorker from "../workers/road-router.ts?worker";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (result: LocalRoadRoute) => void; reject: (error: Error) => void }>();

export function localRoadRoute(points: Coordinate[], mode: TravelMode): Promise<LocalRoadRoute> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("Дорожный поток браузера недоступен"));
  if (!worker) {
    worker = new RoadRouterWorker();
    worker.onmessage = (event: MessageEvent<{ id: number; result?: LocalRoadRoute; error?: string }>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.result) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error ?? "Нет локального маршрута"));
    };
    worker.onerror = () => {
      for (const entry of pending.values()) entry.reject(new Error("Ошибка локального дорожного потока"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, points, mode, origin: window.location.origin });
  });
}
