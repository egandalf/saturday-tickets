import { z } from "zod";
import { describe, parkingNear, photosByName, photosNear, routeFromHome } from "../../lib/enrich";
import { APP_HOME } from "../../lib/origin";
import type { ToolDef } from "../types";

const point = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };

export const route_from_home: ToolDef<{ lat: number; lng: number }> = {
  name: "route_from_home",
  description: `Drive from home (${APP_HOME.label}) to a point (OpenRouteService on OpenStreetMap): miles, minutes, the last 5 miles' surface (paved/gravel/rough/unknown), fords, ferries, tracks, and how far the point sits from a road. Unmapped surface reads unknown, not absent.`,
  effect: "read",
  input: z.object(point),
  run: async (at) => {
    const route = await routeFromHome(at);
    const { flags } = describe({ at: "", route, parking: { lots: [], turningCircles: 0 }, photos: [] });
    return { ...route, flags };
  },
};

export const parking_near: ToolDef<{ lat: number; lng: number; radiusMeters: number }> = {
  name: "parking_near",
  description: "Mapped parking lots (name, surface, coordinates, distance) and turning circles around a point (OpenStreetMap via Overpass). None mapped is not proof there is none.",
  effect: "read",
  input: z.object({ ...point, radiusMeters: z.number().int().min(100).max(3000) }),
  run: ({ lat, lng, radiusMeters }) => parkingNear({ lat, lng }, radiusMeters),
};

export const photos_near: ToolDef<{ lat: number; lng: number; radiusMeters?: number }> = {
  name: "photos_near",
  description:
    "Openly licensed landscape photos near a point (Wikimedia Commons), closest first, with author and license already formatted as a ticket credit.",
  effect: "read",
  input: z.object({ ...point, radiusMeters: z.number().int().min(100).max(10000).optional() }),
  run: ({ lat, lng, radiusMeters }) => photosNear({ lat, lng }, radiusMeters ?? 1500, 6),
};

export const photo_search: ToolDef<{ query: string }> = {
  name: "photo_search",
  description:
    "Search Wikimedia Commons by name for openly licensed landscape photos, for places whose photos aren't geotagged (photos_near found none). Check each title and description actually shows this place.",
  effect: "read",
  input: z.object({ query: z.string().min(3) }),
  run: ({ query }) => photosByName(query),
};
