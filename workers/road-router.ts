/// <reference lib="webworker" />

import { LocalRoadGraph, type LocalRoadRoute, type PackedRoadGraph } from "../lib/local-road-graph.ts";
import type { Coordinate, TravelMode } from "../lib/map-providers.ts";

let graphPromise: Promise<LocalRoadGraph> | null = null;

function loadGraph(origin: string) {
  if (!graphPromise) graphPromise = (async () => {
    const response = await fetch(new URL("/road-graph.json.gz", origin));
    if (!response.ok) throw new Error("Локальные дорожные данные не загружены");
    // Static servers may transparently decode .gz before fetch exposes the body.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(bytes);
    const data = JSON.parse(text) as PackedRoadGraph;
    return new LocalRoadGraph(data);
  })().catch(error => { graphPromise = null; throw error; });
  return graphPromise;
}

self.onmessage = async (event: MessageEvent<{ id: number; points: Coordinate[]; mode: TravelMode; origin: string }>) => {
  const { id, points, mode, origin } = event.data;
  try {
    const graph = await loadGraph(origin);
    const result: LocalRoadRoute = graph.route(points, mode);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
