declare namespace GeoJSON {
  interface LineString {
    type: "LineString";
    coordinates: number[][];
  }

  interface Feature<G = LineString, P = Record<string, unknown>> {
    type: "Feature";
    geometry: G;
    properties: P;
  }

  interface FeatureCollection<G = LineString, P = Record<string, unknown>> {
    type: "FeatureCollection";
    features: Array<Feature<G, P>>;
  }
}
