export type Surface = "PAVED" | "PACKED GRAVEL";
export type Kind = "lake" | "woods" | "town" | "history";

/** Signed town pins: murals and river-town streets. Ritter is a city park until signed. */
export const SIGNED_TOWN_IDS = ["ashland-floodwall", "portsmouth-murals"] as const;

/** Signed water pins. Jesse Stuart and Bennett's Mill are not lakes. */
export const SIGNED_LAKE_IDS = [
  "greenbo",
  "grayson-lake",
  "vesuvius-beach",
  "beech-fork",
  "yatesville",
  "east-lynn",
  "twin-knobs",
  "paintsville-lake",
] as const;

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
    kind: "lake",
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
