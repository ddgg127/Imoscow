import { coordKey, fallbackTravel, type TravelMatrix } from "./vrptw.ts";
import type { Coordinate } from "./map-providers.ts";

export type SavedTravel = { points: Coordinate[]; modes: Record<string, { distances: number[][]; durations: number[][]; known: boolean[][] }> };
export function saveTravel(travel: TravelMatrix | undefined, points: Coordinate[], transports: string[]): SavedTravel | null {
  if (!travel) return null;
  const modes: SavedTravel["modes"] = {};
  for (const transport of ["default", ...new Set(transports)]) {
    const source = transport === "default" ? travel : travel.forTransport?.(transport) ?? travel;
    modes[transport] = { distances: points.map(a => points.map(b => source.distanceKm(a,b))), durations: points.map(a => points.map(b => source.durationMin(a,b))), known: points.map(a => points.map(b => source.knows?.(a,b) ?? true)) };
  }
  return { points, modes };
}
export function restoreTravel(saved: SavedTravel | null, speedKmh: number): TravelMatrix | undefined {
  if (!saved) return undefined;
  const indices = new Map(saved.points.map((point,index) => [coordKey(point),index]));
  const fallback = fallbackTravel(speedKmh);
  const modes = Object.fromEntries(Object.entries(saved.modes).map(([mode,table]) => {
    const get = (a:Coordinate,b:Coordinate,values:number[][]) => values[indices.get(coordKey(a)) ?? -1]?.[indices.get(coordKey(b)) ?? -1];
    return [mode, { distanceKm: (a:Coordinate,b:Coordinate) => get(a,b,table.distances) ?? fallback.distanceKm(a,b), durationMin: (a:Coordinate,b:Coordinate) => get(a,b,table.durations) ?? fallback.durationMin(a,b), knows: (a:Coordinate,b:Coordinate) => table.known[indices.get(coordKey(a)) ?? -1]?.[indices.get(coordKey(b)) ?? -1] ?? false }];
  }));
  const base = modes.default ?? fallbackTravel(speedKmh);
  return { ...base, forTransport: transport => modes[transport] ?? base };
}

const DB_NAME = "fieldflow-workspace";
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("Хранилище занято другой вкладкой")); };
  });
}
export async function loadWorkspace<T>(): Promise<T | null> {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const request = db.transaction("workspace", "readonly").objectStore("workspace").get("current");
    request.onsuccess = () => resolve(request.result?.version === 1 ? request.result.state as T : null);
    request.onerror = () => reject(request.error);
  });
}
export async function writeWorkspace<T>(state: T) {
  const db = await openDatabase();
  await new Promise<void>((resolve,reject) => {
    const transaction = db.transaction("workspace", "readwrite");
    transaction.objectStore("workspace").put({ version: 1, state }, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** One writer prevents an older large snapshot from replacing a later cleared scenario. */
export function createWorkspaceWriter<T>(write: (state:T) => Promise<void>) {
  let queue = Promise.resolve();
  return (state:T) => {
    const task = queue.catch(() => {}).then(() => write(state));
    queue = task;
    return task;
  };
}
