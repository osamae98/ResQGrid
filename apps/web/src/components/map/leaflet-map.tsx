"use client";

import { capName } from "@/lib/api";
import { PRIORITY_LABEL, REPORT_STATUS_LABEL } from "@/lib/format";
import type { LatLng, Report, Resource, Shelter, Team } from "@resqgrid/api-client";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import { ago, initials } from "@/lib/format";
import { ALL_LAYERS, type LiveMapProps } from "./map-types";
import { useI18n, useT } from "@/lib/i18n";

// Same shapes as PriorityIcon (lucide paths), as markup because Leaflet divIcons take HTML strings.
const svg = (paths: string, size = 14) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PRIORITY_PIN = {
  critical: svg('<path d="M12 6v7"/><path d="M12 18h.01"/>'),
  high: svg('<path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>'),
  medium: svg('<path d="M6 12h12"/>'),
  low: svg('<path d="m6 9 6 6 6-6"/>'),
};
const HOUSE = svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/>', 12);

const priorityVar = { critical: "var(--p-critical)", high: "var(--p-high)", medium: "var(--p-medium)", low: "var(--p-low)" };

function reportIcon(r: Report, selected: boolean) {
  return L.divIcon({
    className: "rq-icon",
    iconSize: [26, 26],
    iconAnchor: [4, 26],
    html: `<div class="rq-report st-${r.status} ${selected ? "selected" : ""}" style="background:${priorityVar[r.priority]}"><span>${PRIORITY_PIN[r.priority]}</span></div>`,
  });
}

function teamIcon(t: Team) {
  const color = t.is_stale || t.availability === "off_duty" ? "var(--t-stale)" : t.availability === "busy" ? "var(--t-busy)" : "var(--t-available)";
  return L.divIcon({
    className: "rq-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div class="rq-team" style="background:${color}">${t.is_stale ? "⏱" : initials(t.name)}</div>`,
  });
}

const UNIT_LETTER: Record<string, string> = { ambulance: "A", boat: "B", generator: "G", vehicle: "V" };
function unitIcon(r: Resource) {
  return L.divIcon({
    className: "rq-icon",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div class="rq-unit ${r.status}">${UNIT_LETTER[r.type] ?? "U"}</div>`,
  });
}

function shelterIcon(s: Shelter) {
  const free = Math.max(0, s.capacity - s.occupancy);
  const label = s.status === "closed" ? "×" : String(free);
  // Width follows the number so "129" never wraps under the icon.
  const w = 32 + label.length * 7;
  return L.divIcon({
    className: "rq-icon",
    iconSize: [w, 22],
    iconAnchor: [w / 2, 11],
    html: `<div class="rq-shelter ${s.status}">${HOUSE}<span>${label}</span></div>`,
  });
}

const pickIcon = L.divIcon({
  className: "rq-icon",
  iconSize: [26, 26],
  iconAnchor: [4, 26],
  html: `<div class="rq-report" style="background:var(--primary)"><span><i class="rq-dot"></i></span></div>`,
});

function Focus({ to }: { to?: LatLng }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.flyTo([to.lat, to.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [to?.lat, to?.lng, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function PickHandler({ onPick }: { onPick: (l: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function LeafletMap({
  reports = [],
  teams = [],
  resources = [],
  shelters = [],
  incidents = [],
  tasks = [],
  layers = ALL_LAYERS,
  selectedReportId,
  onSelectReport,
  center = { lat: 30.07, lng: 31.33 },
  zoom = 13,
  trail,
  pick,
  focus,
  dark,
  className,
}: LiveMapProps) {
  const tr = useT();
  const { dir } = useI18n();
  const reportById = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);
  const activeLines = useMemo(
    () =>
      tasks
        .filter((t) => ["accepted", "en_route", "on_site", "pending"].includes(t.status) && t.assigned_team_id)
        .map((t) => ({ task: t, team: teams.find((x) => x.id === t.assigned_team_id) }))
        .filter((x) => x.team?.last_location),
    [tasks, teams],
  );

  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} className={className ?? "h-full w-full"} zoomControl={false} attributionControl>
      {/* Zoom sits at the start edge so overlays anchored to the end (map filters) never cover it, in LTR and RTL. */}
      <ZoomControl position={dir === "rtl" ? "topright" : "topleft"} zoomInTitle={tr("Zoom in")} zoomOutTitle={tr("Zoom out")} key={dir} />
      <InvalidateOnResize />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className={dark ? "rq-tiles-dark" : undefined}
        key={dark ? "dark" : "light"}
      />
      <Focus to={focus} />
      {pick ? <PickHandler onPick={pick.onChange} /> : null}
      {pick?.value ? (
        <Marker
          position={[pick.value.lat, pick.value.lng]}
          icon={pickIcon}
          draggable
          eventHandlers={{ dragend: (e) => pick.onChange((e.target as L.Marker).getLatLng()) }}
        />
      ) : null}

      {layers.incidents &&
        incidents
          .filter((i) => i.status !== "closed")
          .map((i) => (
            <Circle key={i.id} center={[i.center.lat, i.center.lng]} radius={i.radius_km * 1000} pathOptions={{ color: "#6366f1", weight: 1.5, fillOpacity: 0.06, dashArray: "6 6" }}>
              <Tooltip sticky>{i.title}</Tooltip>
            </Circle>
          ))}

      {trail && trail.length > 1 ? <Polyline positions={trail.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#7c3aed", weight: 3, opacity: 0.8 }} /> : null}

      {layers.teams &&
        activeLines.map(({ task, team }) => {
          const r = reportById.get(task.report_id);
          const to = r?.location ?? task.report.location;
          return (
            <Polyline
              key={`line-${task.id}`}
              positions={[
                [team!.last_location!.lat, team!.last_location!.lng],
                [to.lat, to.lng],
              ]}
              pathOptions={{ color: team!.is_stale ? "#8b8f98" : "#7c3aed", weight: 2, dashArray: "4 6" }}
            />
          );
        })}

      {layers.shelters &&
        shelters.map((s) => (
          <Marker key={s.id} position={[s.location.lat, s.location.lng]} icon={shelterIcon(s)}>
            <Tooltip direction="top" offset={[0, -10]}>
              <strong>{s.name}</strong>
              <br />
              {s.capacity - s.occupancy} {tr("of")} {s.capacity} {tr("beds free")} · {tr(s.status)}
            </Tooltip>
          </Marker>
        ))}

      {layers.units &&
        resources
          .filter((r) => r.kind === "unit" && r.status !== "unavailable")
          .map((r) => (
            <Marker key={r.id} position={[r.location.lat, r.location.lng]} icon={unitIcon(r)}>
              <Tooltip direction="top" offset={[0, -8]}>
                <strong>{r.name}</strong> · {tr(r.status ?? "")}
                {r.depot_name ? <><br />{r.depot_name}</> : null}
              </Tooltip>
            </Marker>
          ))}

      {layers.teams &&
        teams
          .filter((t) => t.last_location)
          .map((t) => (
            <Marker key={t.id} position={[t.last_location!.lat, t.last_location!.lng]} icon={teamIcon(t)} zIndexOffset={500}>
              <Tooltip direction="top" offset={[0, -12]}>
                <strong>{t.name}</strong> · {t.is_stale ? tr("stale") : tr(t.availability.replace("_", " "))}
                <br />
                {tr("Last seen")} {ago(t.last_location_at)}
                <br />
                {t.capabilities.map((c) => tr(capName(c))).join("، ") || tr("no capabilities on duty")}
              </Tooltip>
            </Marker>
          ))}

      {layers.reports &&
        reports.map((r) => (
          <Marker
            key={r.id}
            position={[r.location.lat, r.location.lng]}
            icon={reportIcon(r, r.id === selectedReportId)}
            zIndexOffset={r.id === selectedReportId ? 2000 : r.priority === "critical" ? 1000 : 600}
            eventHandlers={{ click: () => onSelectReport?.(r.id) }}
            keyboard
            title={`${r.reference_code} ${r.title}`}
          >
            <Tooltip direction="top" offset={[8, -24]}>
              <strong>{r.reference_code}</strong> · {tr(PRIORITY_LABEL[r.priority])} · {tr(REPORT_STATUS_LABEL[r.status])}
              <br />
              {r.title}
            </Tooltip>
          </Marker>
        ))}
    </MapContainer>
  );
}
