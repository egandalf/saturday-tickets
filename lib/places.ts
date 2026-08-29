export type Surface = "PAVED" | "PACKED GRAVEL";
export type Kind = "lake" | "woods" | "town" | "history";

/** Signed town pins: murals and river-town streets. Ritter is Woods. */
export const SIGNED_TOWN_IDS = ["ashland-floodwall", "portsmouth-murals"] as const;

/** Signed water pins. Greenbo stays on Lake (furnace crop is fine). Twin Knobs is Woods. Jenny Wiley is Dewey Lake. */
export const SIGNED_LAKE_IDS = [
  "greenbo",
  "grayson-lake",
  "vesuvius-beach",
  "beech-fork",
  "yatesville",
  "east-lynn",
  "paintsville-lake",
  "jenny-wiley",
] as const;

/** Signed woods pins. Twin Knobs is a camp pad, not a lake. */
export const SIGNED_WOODS_IDS = [
  "jesse-stuart",
  "carter-caves",
  "shawnee-packed",
  "shawnee-lodge",
  "ritter-park",
  "twin-knobs",
  "kanawha",
  "ash-cave",
  "natural-bridge",
] as const;

/** Signed history pins. Do not relabel a covered bridge as a lake. */
export const SIGNED_HISTORY_IDS = ["bennetts-mill", "oldtown-bridge", "serpent-mound"] as const;

const SIGNED_KIND: Record<string, Kind> = {
  ...Object.fromEntries(SIGNED_TOWN_IDS.map((id) => [id, "town" as const])),
  ...Object.fromEntries(SIGNED_LAKE_IDS.map((id) => [id, "lake" as const])),
  ...Object.fromEntries(SIGNED_WOODS_IDS.map((id) => [id, "woods" as const])),
  ...Object.fromEntries(SIGNED_HISTORY_IDS.map((id) => [id, "history" as const])),
};

export function signedKind(id: string): Kind | undefined {
  return SIGNED_KIND[id];
}

export type Place = {
  id: string;
  title: string;
  surface: Surface;
  kind?: Kind;
  milesFromHome: number;
  minutesOut: number;
  onSiteMinutes: number;
  turnaround: boolean;
  waterCrossing: boolean;
  clayWhenWet: boolean;
  photo: string;
  photoAlt: string;
  credit?: string;
};

/** Home is 41144 Greenup, KY. Distances from published park listings, not a POI dump. */
export const PLACES: Place[] = [
  {
    id: "greenbo",
    title: "Greenbo Lake",
    surface: "PAVED",
    milesFromHome: 12,
    minutesOut: 20,
    onSiteMinutes: 180,
    turnaround: true,
    waterCrossing: false,
    clayWhenWet: false,
    photo: "https://mzzksomkbyrlajlw.public.blob.vercel-storage.com/photos/greenbo.jpg",
    photoAlt: "Buffalo Iron Furnace at Greenbo Lake State Resort Park",
  },
  {
    id: "carter-caves",
    title: "Carter Caves",
    surface: "PAVED",
    milesFromHome: 25,
    minutesOut: 35,
    onSiteMinutes: 180,
    turnaround: true,
    waterCrossing: false,
    clayWhenWet: false,
    photo: "https://mzzksomkbyrlajlw.public.blob.vercel-storage.com/photos/carter-caves.jpg",
    photoAlt: "Paved park roadway at Carter Caves State Resort Park",
  },
  {
    id: "shawnee-packed",
    title: "Shawnee packed forest roads",
    surface: "PACKED GRAVEL",
    milesFromHome: 31,
    minutesOut: 45,
    onSiteMinutes: 150,
    turnaround: true,
    waterCrossing: false,
    clayWhenWet: false,
    photo: "https://mzzksomkbyrlajlw.public.blob.vercel-storage.com/photos/shawnee-packed.jpg",
    photoAlt: "Picnic Point overlook, Shawnee State Forest",
    credit: "Analogue Kid (CC BY 3.0)",
  },
];
