export type IncidentStatus =
  | "Proposed"
  | "Under review"
  | "Approved"
  | "Rejected"
  | "Review overdue"
  | "Cleared";
export type DeliveryStatus =
  | "Not sent"
  | "Sending"
  | "Fleet accepted"
  | "Robot applied"
  | "Rejected"
  | "Timed out"
  | "Unsupported"
  | "Failed";
export type Point = { lat: number; lng: number };
export type Restriction = {
  revision: number;
  source: "simulation" | "hafnia-plugin" | "hafnia-image" | "xprotect-event";
  cameraId: string;
  evidenceDataUrl?: string | null;
  xprotectEventPublished: boolean;
  clearanceRecipients: Record<string, DeliveryStatus>;
  clearanceZoneSetId?: string;
  replans: Record<string, string>;
  id: string;
  title: string;
  observedAt: string;
  status: IncidentStatus;
  robot: string;
  mapId: string;
  center: Point;
  polygon: Point[];
  missionIds: string[];
  note: string;
  expiresAt: string;
  zoneSetId: string;
  recipients: Record<string, DeliveryStatus>;
  clearance: "none" | "review" | "approved" | "cleared";
  dispatchLog: {
    at: string;
    message: string;
    tone: "neutral" | "good" | "warn" | "bad";
  }[];
};
export type Dashboard = {
  robots: Robot[];
  missions: Mission[];
  restrictions: Restriction[];
  serviceAreas: Point[][];
  serverTime: string;
};
export type Mission = {
  id: string;
  name: string;
  robot: string;
  area: string;
  progress: number;
  status: string;
  color: string;
  points: Point[];
  activePoints?: Point[];
  alternative?: Point[];
};
export type Robot = {
  id: string;
  name: string;
  profile: "VDA 5050 3.0 demo adapter" | "Legacy municipal adapter";
  mapId: string;
  position: Point;
  connectivity: "Connected" | "Intermittent";
  battery: number;
  capabilities: string[];
  alignment: string;
};
