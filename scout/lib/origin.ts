/**
 * Where a scout run looks: a center and radius for discovery (home, a vacation base, a
 * contributor's town). Travel fields on a place are always from the app's home.
 */
import { HOME_COORDS } from "../../lib/sun";

export type Origin = { label: string; lat: number; lng: number };

export type Run = { origin: Origin; radiusMiles: number };

export const APP_HOME: Origin = { label: "41144 Greenup, Kentucky", ...HOME_COORDS };
export const APP_RADIUS_MILES = 150;
export const DEFAULT_RUN: Run = { origin: APP_HOME, radiusMiles: APP_RADIUS_MILES };

/** "lat,lng" or "lat,lng,Label with spaces". Free-text addresses need a geocoder (scout step 4). */
export function parseOrigin(value: string): Origin {
  const [latText, lngText, ...rest] = value.split(",");
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error(`origin must be "lat,lng[,label]", got "${value}"`);
  }
  const label = rest.join(",").trim() || `${lat},${lng}`;
  return { label, lat, lng };
}

export function parseRadius(value: string): number {
  const miles = Number(value);
  if (!Number.isFinite(miles) || miles <= 0 || miles > 500) throw new Error(`radius must be 1-500 miles, got "${value}"`);
  return miles;
}

/** Great-circle miles. Road miles can only be longer, so this catches a made-up milesFromHome. */
export function straightMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
