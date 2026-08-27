/** 41144 Greenup, KY. Leave-by follows sunset that Saturday, not a fixed 7:30. */
const LAT = 38.578;
const LNG = -82.83;
const TZ = "America/New_York";

const PI = Math.PI;
const rad = PI / 180;
const dayMs = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const e = rad * 23.4397;
const J0 = 0.0009;

export type SaturdaySunset = {
  date: string;
  minutes: number;
  clock: string;
};

function toJulian(ms: number): number {
  return ms / dayMs - 0.5 + J1970;
}

function fromJulian(j: number): number {
  return (j + 0.5 - J1970) * dayMs;
}

function toDays(ms: number): number {
  return toJulian(ms) - J2000;
}

function declination(l: number, b: number): number {
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
}

function solarMeanAnomaly(d: number): number {
  return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number): number {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + PI;
}

function julianCycle(d: number, lw: number): number {
  return Math.round(d - J0 - lw / (2 * PI));
}

function approxTransit(Ht: number, lw: number, n: number): number {
  return J0 + (Ht + lw) / (2 * PI) + n;
}

function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

function hourAngle(h: number, phi: number, d: number): number {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
}

function sunsetJulian(ms: number, lat: number, lng: number): number {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(ms);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const w = hourAngle(-0.833 * rad, phi, dec);
  const a = approxTransit(w, lw, n);
  return solarTransitJ(a, M, L);
}

function nyParts(date: Date): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    weekday: pick("weekday"),
  };
}

function addDays(year: number, month: number, day: number, extra: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + extra));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** Coming Saturday in Eastern time. Thursday night deals this Saturday. */
export function upcomingSaturday(from = new Date()): { year: number; month: number; day: number; date: string } {
  const ny = nyParts(from);
  const order = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const idx = order.indexOf(ny.weekday);
  const ahead = idx === 6 ? 0 : 6 - idx;
  const sat = addDays(ny.year, ny.month, ny.day, ahead);
  const date = `${sat.year}-${String(sat.month).padStart(2, "0")}-${String(sat.day).padStart(2, "0")}`;
  return { ...sat, date };
}

function clockFromMinutes(total: number): string {
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour = hour24 % 12 || 12;
  return minute === 0 ? `${hour} ${suffix}` : `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function saturdaySunset(from = new Date()): SaturdaySunset {
  const sat = upcomingSaturday(from);
  const noonUtc = Date.UTC(sat.year, sat.month - 1, sat.day, 12, 0, 0);
  const setMs = fromJulian(sunsetJulian(noonUtc, LAT, LNG));
  const set = new Date(setMs);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(set);
  const [h, m] = clock.split(":").map(Number);
  const minutes = h * 60 + m;
  return { date: sat.date, minutes, clock: clockFromMinutes(minutes) };
}
