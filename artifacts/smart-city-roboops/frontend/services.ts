import type { DeliveryStatus, Mission, Restriction } from './models';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '/api').replace(/\/+$/, '');

export interface IncidentService {
  list(): Restriction[];
  save(items: Restriction[]): void;
  create(): Restriction;
}
export interface MissionService { affectedBy(restriction: Restriction, missions: Mission[]): string[] }
export interface RestrictionService {
  approve(item: Restriction): Restriction;
  reject(item: Restriction): Restriction;
  editBoundary(item: Restriction, polygon: Restriction['polygon']): Restriction;
}
export interface DispatchService { deliver(item: Restriction, robotId: string): Promise<DeliveryStatus> }

const STORAGE_KEY = 'smart-city-roboops.demo.v1';
const initialPolygon = [
  { lat: 56.16025, lng: 10.20995 }, { lat: 56.16065, lng: 10.21045 },
  { lat: 56.16045, lng: 10.21095 }, { lat: 56.16005, lng: 10.21055 },
];
const fresh = (): Restriction[] => [{
   id: 'OBS-2048', title: 'Construction barrier on paving', observedAt: new Date().toISOString(),
   status: 'Approved', robot: 'Moss-03', mapId: 'aarhus_mid-01', center: { lat: 56.16035, lng: 10.210475 },
  polygon: initialPolygon, missionIds: ['MIS-118', 'MIS-121'],
  note: 'Temporary works area beside the canal path. Boundary is an operator-edited demo geometry.',
  expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), zoneSetId: 'ZS-2048-A',
  recipients: { 'Moss-03': 'Robot applied', 'Birk-07': 'Fleet accepted' }, clearance: 'none',
  dispatchLog: [
    { at: '09:44:18', message: 'Moss-03 confirmed zone-set application; alternative path selected (simulated).', tone: 'good' },
    { at: '09:44:12', message: 'Birk-07 fleet accepted. Robot application is still awaiting acknowledgement.', tone: 'warn' },
    { at: '09:43:51', message: 'Restriction approved by demo operator and sent to adapter.', tone: 'neutral' },
  ],
}];
export const incidentService: IncidentService = {
  list() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Restriction[] : fresh(); }
    catch { return fresh(); }
  },
  save(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); },
  create() {
    const n = Date.now().toString().slice(-4);
    return {
      id: `OBS-${n}`, title: 'Construction barrier on paving', observedAt: new Date().toISOString(),
      status: 'Proposed', robot: 'Moss-03', mapId: 'aarhus_mid-01',
       center: { lat: 56.16035, lng: 10.210475 }, polygon: initialPolygon.map(p => ({ ...p })),
      missionIds: ['MIS-118', 'MIS-121'], note: 'Simulated camera observation. Footage is a placeholder; no camera service is connected.',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      zoneSetId: `ZS-${n}-A`, recipients: { 'Moss-03': 'Not sent', 'Birk-07': 'Not sent' },
      clearance: 'none', dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: 'Simulated construction-barrier observation created. Exactly two missions are linked.', tone: 'neutral' }],
    };
  },
};
const pointInPolygon = (point: Mission['points'][number], polygon: Restriction['polygon']) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
};

const orientation = (a: Mission['points'][number], b: Mission['points'][number], c: Mission['points'][number]) =>
  (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);

const onSegment = (a: Mission['points'][number], b: Mission['points'][number], p: Mission['points'][number]) =>
  Math.abs(orientation(a, b, p)) < 1e-10
  && p.lng >= Math.min(a.lng, b.lng) - 1e-10 && p.lng <= Math.max(a.lng, b.lng) + 1e-10
  && p.lat >= Math.min(a.lat, b.lat) - 1e-10 && p.lat <= Math.max(a.lat, b.lat) + 1e-10;

const segmentsIntersect = (
  a: Mission['points'][number],
  b: Mission['points'][number],
  c: Mission['points'][number],
  d: Mission['points'][number],
) => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
};

const routeIntersects = (route: Mission['points'], polygon: Restriction['polygon']) => {
  if (route.some(point => pointInPolygon(point, polygon)) || polygon.some(point => pointInPolygon(point, route))) return true;
  for (let i = 1; i < route.length; i++) {
    for (let j = 0; j < polygon.length; j++) {
      if (segmentsIntersect(route[i - 1], route[i], polygon[j], polygon[(j + 1) % polygon.length])) return true;
    }
  }
  return false;
};

export const missionService: MissionService = {
  affectedBy: (restriction, missions) => missions
    .filter(mission => restriction.missionIds.includes(mission.id) && routeIntersects(mission.points, restriction.polygon))
    .map(mission => mission.id),
};
export const restrictionService: RestrictionService = {
  approve(item) { return { ...item, status: 'Approved', dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: 'Restriction approved. Zone-set contents unchanged; awaiting a separate delivery decision.', tone: 'good' }, ...item.dispatchLog] }; },
  reject(item) { return { ...item, status: 'Rejected', recipients: { ...item.recipients }, dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: 'Restriction rejected by operator. No fleet delivery will be attempted.', tone: 'bad' }, ...item.dispatchLog] }; },
  editBoundary(item, polygon) { return { ...item, polygon, zoneSetId: `ZS-${item.id.slice(-4)}-${Date.now().toString(36).toUpperCase()}`, recipients: Object.fromEntries(Object.keys(item.recipients).map(robot => [robot, 'Not sent' as const])), dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: 'Boundary edited. Fresh zoneSetId assigned; previous robot application acknowledgements reset for this revision.', tone: 'warn' }, ...item.dispatchLog] }; },
};
export const dispatchService: DispatchService = {
  async deliver(item, robotId) {
    await new Promise(resolve => window.setTimeout(resolve, 700));
    const old = item.recipients[robotId];
    const outcome = robotId === 'Moss-03' ? 'Robot applied' : old === 'Not sent' ? 'Timed out' : old === 'Timed out' ? 'Fleet accepted' : old === 'Fleet accepted' ? 'Rejected' : old === 'Rejected' ? 'Failed' : 'Timed out';
    return outcome;
  },
};
