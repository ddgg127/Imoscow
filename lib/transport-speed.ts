export const transportSpeedsKmh: Record<string, number> = {
  "Автомобиль": 24,
  "Пешком": 5,
  "Пешеход": 5,
  "Велосипед": 15,
  "Общественный транспорт": 18,
};

export function engineerSpeedKmh(transport: string, override: number | undefined, carSpeedKmh: number) {
  if (override != null && Number.isFinite(override) && override >= 2 && override <= 200) return override;
  return transport === "Автомобиль" ? carSpeedKmh : transportSpeedsKmh[transport] ?? carSpeedKmh;
}

export function transportTravelMinutes(transport: string, roadKm: number, carMinutes: number, speedKmh: number, carSpeedKmh: number) {
  if (roadKm < 0.001) return 0;
  if (transport === "Автомобиль") return Math.max(1, carMinutes * carSpeedKmh / speedKmh);
  const accessMinutes = transport === "Общественный транспорт" ? 6 : 2;
  return Math.max(1, roadKm / speedKmh * 60 + accessMinutes);
}
