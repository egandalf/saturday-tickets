export type Surface = "PAVED" | "PACKED GRAVEL";

export type Place = {
  id: string;
  title: string;
  surface: Surface;
  milesFromHome: number;
  minutesOut: number;
  onSiteMinutes: number;
  turnaround: boolean;
  waterCrossing: boolean;
  clayWhenWet: boolean;
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
  },
];
