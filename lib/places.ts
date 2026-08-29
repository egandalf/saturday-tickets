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

/** Signed woods pins. Greenbo is also woods. Twin Knobs is a camp pad, not a lake. Atlas id is kanawha-entry. */
export const SIGNED_WOODS_IDS = [
  "greenbo",
  "jesse-stuart",
  "carter-caves",
  "shawnee-packed",
  "shawnee-lodge",
  "ritter-park",
  "twin-knobs",
  "kanawha-entry",
  "ash-cave",
  "natural-bridge",
] as const;

/** Signed history pins. Do not relabel a covered bridge as a lake. */
export const SIGNED_HISTORY_IDS = ["bennetts-mill", "oldtown-bridge", "serpent-mound"] as const;

const SIGNED_TAGS: Record<string, Kind[]> = {};

function tagIds(ids: readonly string[], tag: Kind): void {
  for (const id of ids) {
    const current = SIGNED_TAGS[id] ?? [];
    if (!current.includes(tag)) current.push(tag);
    SIGNED_TAGS[id] = current;
  }
}

tagIds(SIGNED_TOWN_IDS, "town");
tagIds(SIGNED_LAKE_IDS, "lake");
tagIds(SIGNED_WOODS_IDS, "woods");
tagIds(SIGNED_HISTORY_IDS, "history");

export function signedTags(id: string): Kind[] {
  return SIGNED_TAGS[id] ?? [];
}

export type Place = {
  id: string;
  title: string;
  surface: Surface;
  tags?: Kind[];
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
