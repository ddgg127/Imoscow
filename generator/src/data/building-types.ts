import type { Place } from "../engine/types";

export type BuildingKind = "residential" | "workplace";

export type Building = Place & {
  kind: BuildingKind;
  area: string;
};

export type BuildingsFile = {
  source: string;
  fetchedAt: string;
  buildings: Building[];
};
