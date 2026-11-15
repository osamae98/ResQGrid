import type { LatLng } from "@resqgrid/api-client";

const R = 6371; // km

/** Geodesic (haversine) distance in km — stands in for ST_Distance on geography. */
export function distanceKm(a: LatLng, b: LatLng) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Point `km` away from `p` on `bearingDeg`. */
export function offset(p: LatLng, km: number, bearingDeg: number): LatLng {
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (p.lat * Math.PI) / 180;
  const lng1 = (p.lng * Math.PI) / 180;
  const d = km / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** Move from `a` towards `b` by at most `km`. */
export function stepTowards(a: LatLng, b: LatLng, km: number): LatLng {
  const d = distanceKm(a, b);
  if (d <= km || d === 0) return { ...b };
  const t = km / d;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
