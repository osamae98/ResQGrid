import type { Incident, LatLng, Report, Resource, Shelter, Task, Team } from "@resqgrid/api-client";

export interface MapLayers {
  reports: boolean;
  teams: boolean;
  units: boolean;
  shelters: boolean;
  incidents: boolean;
}

export const ALL_LAYERS: MapLayers = { reports: true, teams: true, units: true, shelters: true, incidents: true };

export interface LiveMapProps {
  reports?: Report[];
  teams?: Team[];
  resources?: Resource[];
  shelters?: Shelter[];
  incidents?: Incident[];
  tasks?: Task[];
  layers?: MapLayers;
  selectedReportId?: string;
  onSelectReport?: (id: string) => void;
  center?: LatLng;
  zoom?: number;
  trail?: LatLng[];
  pick?: { value?: LatLng; onChange: (l: LatLng) => void };
  focus?: LatLng;
  dark?: boolean;
  className?: string;
}
