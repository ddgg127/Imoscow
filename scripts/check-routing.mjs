const pairs = [
  [37.77396, 55.70220],
  [37.78222, 55.70085],
];
const coordinates = pairs.map(point => point.join(",")).join(";");
const providers = [
  ["configured car", process.env.OSRM_CAR_URL],
  ["configured foot", process.env.OSRM_FOOT_URL],
  ["configured bike", process.env.OSRM_BIKE_URL],
  ["public car", "https://router.project-osrm.org"],
  ["public car backup", "https://routing.openstreetmap.de/routed-car"],
  ["public foot", "https://routing.openstreetmap.de/routed-foot"],
  ["public bike", "https://routing.openstreetmap.de/routed-bike"],
].filter(([, url]) => Boolean(url));

await Promise.all(providers.map(async ([name, rawUrl]) => {
  const base = rawUrl.replace(/\/+$/, "");
  const started = performance.now();
  const checks = [];
  for (const endpoint of ["route", "table"]) {
    const suffix = endpoint === "route" ? "overview=false" : "annotations=duration,distance";
    try {
      const response = await fetch(`${base}/${endpoint}/v1/driving/${coordinates}?${suffix}`, { signal: AbortSignal.timeout(8000) });
      const body = await response.json();
      checks.push(response.ok && body.code === "Ok" ? `${endpoint}:ok` : `${endpoint}:${response.status}/${body.code ?? "error"}`);
    } catch (error) {
      checks.push(`${endpoint}:${error instanceof Error ? error.name : "error"}`);
    }
  }
  console.log(`${name}: ${checks.join(" ")} (${Math.round(performance.now() - started)} ms)`);
}));
