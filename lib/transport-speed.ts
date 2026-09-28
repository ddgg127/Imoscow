export const transportSpeedsKmh: Record<string, number> = {
  "Автомобиль": 24,
  "Пешком": 6,
  "Пешеход": 6,
  "Велосипед": 15,
  "Общественный транспорт": 18,
  "Служебный вертолёт": 120,
};

export function engineerSpeedKmh(transport: string, override: number | undefined, carSpeedKmh: number) {
  // Older generated scenarios stored the car speed on every engineer.
  // A pedestrian can never inherit that value, even when it is saved as an override.
  if (transport === "Пешком" || transport === "Пешеход") return Math.min(6, override != null && Number.isFinite(override) && override >= 2 ? override : transportSpeedsKmh[transport]);
  if (override != null && Number.isFinite(override) && override >= 2 && override <= 200) return override;
  return transport === "Автомобиль" ? carSpeedKmh : transportSpeedsKmh[transport] ?? carSpeedKmh;
}

export function transportTravelMinutes(transport: string, roadKm: number, carMinutes: number, speedKmh: number, carSpeedKmh: number) {
  if (roadKm < 0.001) return 0;
  if (transport === "Автомобиль") return Math.max(1, carMinutes * carSpeedKmh / speedKmh);
  if (transport === "Служебный вертолёт") return Math.max(1, roadKm / speedKmh * 60 + 8);
  const accessMinutes = transport === "Общественный транспорт" ? 6 : 2;
  return Math.max(1, roadKm / speedKmh * 60 + accessMinutes);
}
