/** OpenRouteService geocoding (Pelias). A first guess only: parks often land on a centroid or a namesake. */

export type Place = { label: string; layer: string; lat: number; lng: number };

export async function geocode(text: string, size = 5): Promise<Place[]> {
  const key = process.env.ORS_API_KEY?.trim();
  if (!key) throw new Error("ORS_API_KEY unset");
  const params = new URLSearchParams({ text, "boundary.country": "US", size: String(size) });
  const res = await fetch(`https://api.openrouteservice.org/geocode/search?${params}`, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ors geocode ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    features?: { geometry: { coordinates: [number, number] }; properties: { label: string; layer: string } }[];
  };
  return (data.features ?? []).map((f) => ({
    label: f.properties.label,
    layer: f.properties.layer,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}
