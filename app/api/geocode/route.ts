import { NextRequest, NextResponse } from "next/server";

type Hit = { lon: string; lat: string; display_name?: string; addresstype?: string; type?: string; class?: string; category?: string; place_rank?: string | number };

const PARK_RE = /park|wood|forest|nature|grass|pitch|station|subway|halt|peak|water|river|cemetery|leisure/i;
const BUILDING_RE = /building|house|apartments|residential|yes|address|office|retail|commercial|industrial/i;

function scoreHit(hit: Hit) {
  const kind = `${hit.addresstype ?? ""} ${hit.category ?? ""} ${hit.type ?? ""} ${hit.class ?? ""}`;
  if (PARK_RE.test(kind)) return -2;
  if (BUILDING_RE.test(kind)) return 4;
  if (Number(hit.place_rank) >= 26) return 2;
  return 0;
}

async function nominatim(query: string) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query.includes("Москва") ? query : `${query}, Москва`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "ru");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("layer", "address");
  const response = await fetch(url, { headers: { "user-agent": "FieldFlow-Hackathon/1.0", "accept-language": "ru" } });
  if (!response.ok) throw new Error(`Nominatim ${response.status}`);
  const data = await response.json() as Hit[];
  const best = [...data].sort((a, b) => scoreHit(b) - scoreHit(a)).find(hit => scoreHit(hit) >= 0);
  if (!best) return null;
  return { coordinates: [Number(best.lon), Number(best.lat)] as [number, number], displayName: best.display_name ?? "", provider: "nominatim" };
}

async function yandexGeocode(query: string, apiKey: string) {
  const url = new URL("https://geocode-maps.yandex.ru/1.x/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("geocode", query.includes("Москва") ? query : `Москва, ${query}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "ru_RU");
  url.searchParams.set("results", "1");
  const response = await fetch(url, { headers: { "user-agent": "FieldFlow-Hackathon/1.0" } });
  if (!response.ok) throw new Error(`Yandex geocoder ${response.status}`);
  const data = await response.json() as { response?: { GeoObjectCollection?: { featureMember?: Array<{ GeoObject?: { Point?: { pos?: string }; metaDataProperty?: { GeocoderMetaData?: { text?: string; kind?: string } } } }> } } };
  const geo = data.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
  const [lon, lat] = (geo?.Point?.pos ?? "").split(" ").map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const kind = geo?.metaDataProperty?.GeocoderMetaData?.kind ?? "";
  if (/vegetation|hydro|railway|metro/i.test(kind)) return null;
  return { coordinates: [lon, lat] as [number, number], displayName: geo?.metaDataProperty?.GeocoderMetaData?.text ?? "", provider: "yandex" };
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 5 || query.length > 180) return NextResponse.json({ error: "Укажите адрес" }, { status: 400 });
  const apiKey = (process.env.YANDEX_GEOCODER_API_KEY || "").trim();
  try {
    if (apiKey) {
      const yandex = await yandexGeocode(query, apiKey);
      if (yandex) return NextResponse.json(yandex);
    }
    const nominatimHit = await nominatim(query);
    if (!nominatimHit) return NextResponse.json({ error: "Адрес не найден" }, { status: 404 });
    return NextResponse.json(nominatimHit);
  } catch {
    return NextResponse.json({ error: "Геокодер временно недоступен" }, { status: 503 });
  }
}
