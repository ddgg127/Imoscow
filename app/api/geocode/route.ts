import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 5 || query.length > 180) return NextResponse.json({ error: "Укажите адрес" }, { status: 400 });
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query.includes("Москва") ? query : `${query}, Москва`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ru");
  try {
    const response = await fetch(url, { headers: { "user-agent": "FieldFlow-Hackathon/1.0", "accept-language": "ru" } });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const data = await response.json() as Array<{ lon: string; lat: string; display_name: string }>;
    if (!data[0]) return NextResponse.json({ error: "Адрес не найден" }, { status: 404 });
    return NextResponse.json({ coordinates: [Number(data[0].lon), Number(data[0].lat)], displayName: data[0].display_name, provider: "nominatim" });
  } catch {
    return NextResponse.json({ error: "Геокодер временно недоступен" }, { status: 503 });
  }
}

