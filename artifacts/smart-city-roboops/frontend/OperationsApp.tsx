import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleDot, Clock3, Command, Compass, Crosshair,
  Download, Eye, Layers, LocateFixed, MapPin, Menu, MoreHorizontal,
  Navigation, Plus, Radio, RefreshCw, Route, Search, Settings2,
  Shield, ShieldAlert, SlidersHorizontal, X, XCircle,
} from 'lucide-react';
import type { Mission, Restriction, Robot } from './models';
import { dispatchService, incidentService, missionService, restrictionService } from './services';

const robots: Robot[] = [
  { id: 'Moss-03', name: 'Moss-03', profile: 'VDA 5050 3.0 demo adapter', mapId: 'aarhus_mid-01', position: { lat: 56.1609, lng: 10.2130 }, connectivity: 'Connected', battery: 82, capabilities: ['BLOCKED zone', 'Zone-set activation'], alignment: 'Aligned · predefined demo transform' },
  { id: 'Birk-07', name: 'Birk-07', profile: 'Legacy municipal adapter', mapId: 'aarhus_mid-legacy', position: { lat: 56.1598, lng: 10.2094 }, connectivity: 'Intermittent', battery: 61, capabilities: ['Fleet-specific route restriction', 'Mission pause'], alignment: 'Aligned · predefined demo transform' },
  { id: 'Lime-02', name: 'Lime-02', profile: 'Legacy municipal adapter', mapId: 'aarhus_mid-legacy', position: { lat: 56.1620, lng: 10.2084 }, connectivity: 'Connected', battery: 94, capabilities: ['Mission pause'], alignment: 'Not aligned' },
];
const missions: Mission[] = [
  { id: 'MIS-118', name: 'Canal promenade sweep', robot: 'Moss-03', area: 'Indre By · waterfront', progress: 63, status: 'Rerouted', color: '#318c77', points: [{ lat: 56.1621, lng: 10.2085 }, { lat: 56.1612, lng: 10.2096 }, { lat: 56.1604, lng: 10.2102 }, { lat: 56.1601, lng: 10.2127 }], alternative: [{ lat: 56.1621, lng: 10.2085 }, { lat: 56.1618, lng: 10.2104 }, { lat: 56.1613, lng: 10.2120 }, { lat: 56.1601, lng: 10.2127 }] },
  { id: 'MIS-121', name: 'Plaza washdown', robot: 'Birk-07', area: 'Dokk1 · south apron', progress: 38, status: 'Awaiting application', color: '#d99b2b', points: [{ lat: 56.1594, lng: 10.2083 }, { lat: 56.1597, lng: 10.2096 }, { lat: 56.1604, lng: 10.2102 }, { lat: 56.1613, lng: 10.2127 }] },
  { id: 'MIS-126', name: 'Park edge litter patrol', robot: 'Lime-02', area: 'Mølleparken', progress: 21, status: 'In progress', color: '#87949c', points: [{ lat: 56.1631, lng: 10.2070 }, { lat: 56.1625, lng: 10.2084 }, { lat: 56.1622, lng: 10.2100 }] },
];
const serviceAreas = [
  [{ lat: 56.1624, lng: 10.2077 }, { lat: 56.1630, lng: 10.2095 }, { lat: 56.1618, lng: 10.2101 }, { lat: 56.1609, lng: 10.2090 }],
  [{ lat: 56.1612, lng: 10.2108 }, { lat: 56.1617, lng: 10.2130 }, { lat: 56.1592, lng: 10.2131 }, { lat: 56.1593, lng: 10.2106 }],
  [{ lat: 56.1635, lng: 10.2067 }, { lat: 56.1642, lng: 10.2085 }, { lat: 56.1628, lng: 10.2094 }, { lat: 56.1622, lng: 10.2075 }],
];
const fmt = (date: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
const shortTime = (date: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(date));
const statusClass = (s: string) => `badge ${s.toLowerCase().replaceAll(' ', '-')}`;
const pointToSvg = (p: { lat: number; lng: number }) => ({ x: 45 + (p.lng - 10.2040) * 65000, y: 30 + (56.1650 - p.lat) * 78000 });
const pathFor = (points: { lat: number; lng: number }[]) => points.map((p, i) => { const v = pointToSvg(p); return `${i ? 'L' : 'M'} ${v.x} ${v.y}`; }).join(' ');
const missionStatusFor = (mission: Mission, restriction?: Restriction) => {
  if (!restriction?.missionIds.includes(mission.id)) return mission.status;
  if (restriction.status === 'Rejected' || restriction.status === 'Cleared') return 'In progress';
  const recipientState = restriction.recipients[mission.robot] ?? 'Not sent';
  if (recipientState === 'Robot applied') return 'Rerouted';
  if (recipientState === 'Fleet accepted') return 'Awaiting application';
  if (['Timed out', 'Rejected', 'Failed'].includes(recipientState)) return 'Delivery delayed';
  if (restriction.status === 'Approved' || restriction.status === 'Review overdue') return 'Awaiting delivery';
  return 'In progress';
};

function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`${statusClass(String(children))} ${className}`}>{children}</span>;
}
function GoogleMapView({ selected, mode, setMode }: { selected: Restriction | undefined; mode: 'roadmap' | 'satellite'; setMode: (m: 'roadmap' | 'satellite') => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const [googleReady, setGoogleReady] = useState(!!(window as any).google?.maps);
  const [loadFailed, setLoadFailed] = useState(false);
  const [layersShown, setLayersShown] = useState(true);
  const [centerRevision, setCenterRevision] = useState(0);
  useEffect(() => {
    if (!googleKey || (window as any).google?.maps) { setGoogleReady(!!(window as any).google?.maps); return; }
    const existing = document.querySelector<HTMLScriptElement>('[data-google-maps]');
    const script = existing || document.createElement('script');
    const callbackName = `roboOpsMapReady_${Math.random().toString(36).slice(2)}`;
    (window as any)[callbackName] = () => setGoogleReady(true);
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleKey)}&callback=${callbackName}`;
    script.async = true; script.defer = true; script.dataset.googleMaps = 'true';
    script.onerror = () => setLoadFailed(true);
    if (!existing) document.head.appendChild(script);
    return () => { delete (window as any)[callbackName]; };
  }, [googleKey]);
  useEffect(() => {
    const g = (window as any).google?.maps;
    if (!googleReady || !g || !mapElement.current) return;
    if (!mapRef.current) mapRef.current = new g.Map(mapElement.current, { center: { lat: 56.16, lng: 10.21 }, zoom: 16, mapTypeId: mode, disableDefaultUI: true, zoomControl: true, clickableIcons: false });
    else mapRef.current.setMapTypeId(mode);
    const map = mapRef.current;
    const markers = robots.map((robot, i) => new g.Marker({ position: robot.position, map, title: `${robot.name} · simulated`, label: { text: `${i + 1}`, color: '#fff' } }));
    const cameras = [
      { id: 'CAM-14', position: selected?.center ?? { lat: 56.16035, lng: 10.210475 } },
      { id: 'CAM-09', position: { lat: 56.16245, lng: 10.20895 } },
    ].map(camera => new g.Marker({ position: camera.position, map, title: `${camera.id} · simulated camera`, label: { text: 'C', color: '#fff' } }));
    const overlays: any[] = [];
    if (layersShown) {
      overlays.push(...serviceAreas.map((area, i) => new g.Polygon({
        paths: area, map, fillColor: i === 1 ? '#d9ae48' : '#4c927d', fillOpacity: .08,
        strokeColor: i === 1 ? '#d0a43e' : '#68a28d', strokeOpacity: .6, strokeWeight: 1,
      })));
      overlays.push(...missions.map(m => new g.Polyline({
        path: m.id === 'MIS-118' && selected?.recipients['Moss-03'] === 'Robot applied' && m.alternative ? m.alternative : m.points,
        map, strokeColor: m.color, strokeOpacity: .82, strokeWeight: 4,
      })));
      if (selected && (selected.status === 'Approved' || selected.status === 'Review overdue')) overlays.push(new g.Polygon({ paths: selected.polygon, map, fillColor: '#c9443d', fillOpacity: .24, strokeColor: '#c9443d', strokeWeight: 2 }));
      else if (selected && selected.status !== 'Rejected' && selected.status !== 'Cleared') overlays.push(new g.Polygon({ paths: selected.polygon, map, fillColor: '#daa33c', fillOpacity: .24, strokeColor: '#c58c20', strokeWeight: 2 }));
    }
    return () => { [...markers, ...cameras].forEach((m: any) => m.setMap(null)); overlays.forEach((o: any) => o.setMap(null)); };
  }, [googleReady, mode, selected, layersShown]);
  useEffect(() => { mapRef.current?.panTo({ lat: 56.16, lng: 10.21 }); }, [centerRevision]);
  const useFallback = !googleKey || !googleReady || loadFailed;
  return <div className="map-stage">
    {useFallback ? <FallbackMap selected={selected} layersShown={layersShown} onCenter={() => setCenterRevision(v => v + 1)} /> : <div className="google-map" ref={mapElement} data-testid="map-google" />}
    <div className="map-controls">
      <div className="map-toggle" aria-label="Map layer">
        <button data-testid="button-map-road" onClick={() => setMode('roadmap')} className={mode === 'roadmap' ? 'selected' : ''}>Road</button>
        <button data-testid="button-map-satellite" onClick={() => setMode('satellite')} disabled={!googleReady || loadFailed} title={!googleReady || loadFailed ? 'Configure Google Maps to enable satellite imagery' : 'Satellite imagery'} className={mode === 'satellite' ? 'selected' : ''}>Satellite</button>
      </div>
      <button className="map-icon" title="Center map" onClick={() => { setCenterRevision(v => v + 1); mapRef.current?.setZoom(16); }} data-testid="button-map-center"><LocateFixed size={16} /></button>
      <button className={`map-icon ${layersShown ? 'map-layer-active' : ''}`} title={layersShown ? 'Hide service-area overlays' : 'Show service-area overlays'} onClick={() => setLayersShown(v => !v)} data-testid="button-map-layers"><Layers size={16} /></button>
    </div>
    {useFallback && <div className={`map-key-note ${googleKey ? 'warning' : ''}`} data-testid="text-map-key-note">
      <MapPin size={14} />
      <span>{googleKey ? (loadFailed ? 'Google Maps unavailable · interactive demo map shown' : 'Loading Google Maps · demo map shown meanwhile') : <>Demo map · Add a domain-restricted <b>VITE_GOOGLE_MAPS_API_KEY</b> for Google road / satellite tiles.</>}</span>
    </div>}
    <div className="map-coordinates mono">56.1600° N&nbsp; 10.2100° E <span>·</span> Aarhus, DK</div>
  </div>;
}
function FallbackMap({ selected, layersShown, onCenter }: { selected?: Restriction; layersShown: boolean; onCenter: () => void }) {
  const [zoom, setZoom] = useState(1);
  const showPoly = selected && selected.status !== 'Rejected' && selected.status !== 'Cleared';
  return <div className="fallback-map" data-testid="map-fallback">
    <div className="map-texture" style={{ transform: `scale(${zoom})` }}>
      <svg viewBox="0 0 720 510" role="img" aria-label="Illustrative interactive map of central Aarhus">
        <rect width="720" height="510" fill="#e9eee8" />
        <path d="M0 362 C120 323 175 390 285 363 S480 324 720 362 L720 510H0Z" fill="#d3e5e0" />
        <path d="M0 376 C135 336 170 406 292 378 S492 345 720 376" fill="none" stroke="#bdd8d2" strokeWidth="7" />
        <path d="M-30 120L750 280 M40 -15L150 530 M235 -20L312 530 M485 -20L421 530 M-10 236L730 100 M-15 443L720 260 M620 -10L534 520" fill="none" stroke="#fffdf8" strokeWidth="13" />
        <path d="M-30 120L750 280 M40 -15L150 530 M235 -20L312 530 M485 -20L421 530 M-10 236L730 100 M-15 443L720 260 M620 -10L534 520" fill="none" stroke="#d5d8cf" strokeWidth="1.3" />
        {layersShown && serviceAreas.map((area, index) => <polygon key={`service-area-${index}`} points={area.map(p => { const q = pointToSvg(p); return `${q.x},${q.y}`; }).join(' ')} fill={index === 1 ? '#e6bd6040' : '#6caa9540'} stroke={index === 1 ? '#d1a640' : '#78a994'} strokeDasharray="5 4" strokeWidth="1.5" />)}
        <path d={pathFor(selected?.recipients['Moss-03'] === 'Robot applied' && missions[0].alternative ? missions[0].alternative : missions[0].points)} fill="none" stroke={missions[0].color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathFor(missions[1].points)} fill="none" stroke={missions[1].color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 5" />
        {showPoly && <polygon points={selected.polygon.map(p => { const q = pointToSvg(p); return `${q.x},${q.y}`; }).join(' ')} fill={selected.status === 'Approved' || selected.status === 'Review overdue' ? '#c9443d44' : '#e5ad454c'} stroke={selected.status === 'Approved' || selected.status === 'Review overdue' ? '#c9443d' : '#bc8420'} strokeWidth="2" strokeDasharray={selected.status === 'Approved' ? undefined : '5 3'} />}
        <g className="map-labels">
          <text x="262" y="158">LATINERKVARTERET</text><text x="483" y="190">DOKK1</text><text x="185" y="327">AARHUS DOMKIRKE</text>
          <text x="265" y="437">AARHUS Å</text><text x="564" y="310">HAVNEPLADSEN</text>
        </g>
        {robots.map((r, i) => { const p = pointToSvg(r.position); return <g key={r.id} transform={`translate(${p.x} ${p.y})`}><circle r="13" fill="#fff" stroke={i === 1 ? '#d69b2e' : '#2f8974'} strokeWidth="3" /><text y="4" textAnchor="middle" className="robot-index">{i + 1}</text><text x="16" y="4" className="robot-name">{r.name}</text></g>; })}
        {[{ id: 'CAM-14', point: selected?.center ?? { lat: 56.16035, lng: 10.210475 } }, { id: 'CAM-09', point: { lat: 56.16245, lng: 10.20895 } }].map(camera => { const p = pointToSvg(camera.point); return <g key={camera.id} transform={`translate(${p.x} ${p.y})`}><circle r="11" fill="#fff" stroke="#c9443d" strokeWidth="2"/><path d="M-5 -3h5l2-2h4v10H-5z" fill="#c9443d"/><text x="15" y="4" className="robot-name">{camera.id}</text></g>; })}
      </svg>
    </div>
    <div className="map-zoom">
      <button data-testid="button-zoom-in" onClick={() => setZoom(z => Math.min(1.55, z + .12))}>+</button>
      <button data-testid="button-zoom-out" onClick={() => setZoom(z => Math.max(.88, z - .12))}>−</button>
    </div>
    <button className="map-center-reset" aria-label="Center map" onClick={() => { setZoom(1); onCenter(); }} data-testid="button-center-fallback"><LocateFixed size={14} /> Center</button>
  </div>;
}
function App() {
  const [items, setItems] = useState<Restriction[]>(() => incidentService.list());
  const [selectedId, setSelectedId] = useState<string>(() => incidentService.list()[0]?.id || '');
  const [filter, setFilter] = useState('All incidents');
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('Overview');
  const [mode, setMode] = useState<'roadmap' | 'satellite'>('roadmap');
  const [mobileNav, setMobileNav] = useState(false);
  const [editing, setEditing] = useState(false);
  const [boundaryText, setBoundaryText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showClearance, setShowClearance] = useState(false);
  const [clearanceConfirm, setClearanceConfirm] = useState(false);
  const [toast, setToast] = useState('');
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setTime(new Date(now));
      setItems(current => current.map(item => item.status === 'Approved' && new Date(item.expiresAt).getTime() < now ? { ...item, status: 'Review overdue' } : item));
    }, 30000);
    const now = Date.now();
    setItems(current => current.map(item => item.status === 'Approved' && new Date(item.expiresAt).getTime() < now ? { ...item, status: 'Review overdue' } : item));
    return () => clearInterval(id);
  }, []);
  useEffect(() => { incidentService.save(items); }, [items]);
  const selected = items.find(i => i.id === selectedId);
  const filtered = useMemo(() => items.filter(i => (filter === 'All incidents' || (filter === 'Needs review' && ['Proposed', 'Under review', 'Review overdue'].includes(i.status)) || i.status === filter) && `${i.id} ${i.title} ${i.status}`.toLowerCase().includes(search.toLowerCase())), [items, filter, search]);
  const update = (next: Restriction) => setItems(current => current.map(i => i.id === next.id ? next : i));
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3200); };
  const simulate = () => {
    const item = incidentService.create(); setItems(current => [item, ...current]); setSelectedId(item.id);
    setSection('Overview'); flash('Simulated obstruction created · exactly 2 missions affected.');
  };
  const startReview = () => { if (selected) { update({ ...selected, status: 'Under review' }); flash('Incident moved to operator review.'); } };
  const approve = () => { if (!selected) return; const approved = restrictionService.approve(selected); update(approved); flash('Restriction approved. Delivery is a separate simulated step.'); };
  const reject = () => { if (!selected) return; update(restrictionService.reject(selected)); flash('Rejected incident retained in the feed; no dispatch sent.'); };
  const editBoundary = () => {
    if (!selected) return;
    try {
      const parsed = JSON.parse(boundaryText);
      const coordinates = parsed.type === 'Feature' ? parsed.geometry.coordinates[0] : parsed.type === 'Polygon' ? parsed.coordinates[0] : null;
      if (!Array.isArray(coordinates) || coordinates.length < 4) throw new Error('Use a GeoJSON Polygon or Feature with at least four coordinate pairs.');
      const first = coordinates[0] as number[];
      const last = coordinates[coordinates.length - 1] as number[];
      if (!Array.isArray(first) || !Array.isArray(last) || first[0] !== last[0] || first[1] !== last[1]) throw new Error('GeoJSON polygon ring must be closed: repeat the first [longitude, latitude] pair at the end.');
      const points = coordinates.slice(0, -1).map(([lng, lat]: number[]) => ({ lat: Number(lat), lng: Number(lng) }));
      if (points.length < 3 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)) throw new Error('Coordinates must be valid [longitude, latitude] pairs in geographic ranges.');
      update(restrictionService.editBoundary(selected, points)); setEditing(false); flash('Boundary saved. Zone-set contents changed; a fresh zoneSetId was assigned.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid GeoJSON polygon.'); }
  };
  const dispatch = async (robotId: string) => {
    const robot = robots.find(r => r.id === robotId);
    const supportsRestriction = robot?.capabilities.some(capability => capability === 'BLOCKED zone' || capability === 'Fleet-specific route restriction');
    if (!selected || busy || !['Approved', 'Review overdue'].includes(selected.status) || !selected.zoneSetId || !robot || !supportsRestriction || robot.alignment.includes('Not aligned')) return;
    const incidentId = selected.id;
    setBusy(robotId);
    const startedAt = new Date().toLocaleTimeString('en-GB');
    setItems(current => current.map(item => item.id === incidentId ? {
      ...item,
      recipients: { ...item.recipients, [robotId]: 'Sending' },
      dispatchLog: [{ at: startedAt, message: `${robotId}: Sending restriction to simulated fleet adapter.`, tone: 'neutral' }, ...item.dispatchLog],
    } : item));
    try {
      const previous = { ...selected, recipients: { ...selected.recipients, [robotId]: selected.recipients[robotId] ?? 'Not sent' } };
      const outcome = await dispatchService.deliver(previous, robotId);
      setItems(current => current.map(item => item.id === incidentId ? {
        ...item,
        recipients: { ...item.recipients, [robotId]: outcome },
        dispatchLog: [{
          at: new Date().toLocaleTimeString('en-GB'),
          message: `${robotId}: ${outcome} (simulated adapter response).`,
          tone: outcome === 'Robot applied' ? 'good' : outcome === 'Rejected' || outcome === 'Failed' ? 'bad' : 'warn',
        }, ...item.dispatchLog],
      } : item));
      flash(`${robotId}: simulated delivery response received.`);
    }
    catch {
      setItems(current => current.map(item => item.id === incidentId ? {
        ...item,
        recipients: { ...item.recipients, [robotId]: 'Failed' },
        dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: `${robotId}: simulated delivery failed. Explicit retry is available.`, tone: 'bad' }, ...item.dispatchLog],
      } : item));
      setError('The simulated adapter response failed. Retry is available.');
    }
    finally { setBusy(null); }
  };
  const retryAll = async () => {
    if (!selected || busy) return;
    const retryable = robots.filter(r => {
      const state = selected.recipients[r.id] ?? 'Not sent';
      return state !== 'Robot applied' && state !== 'Unsupported' && !r.alignment.includes('Not aligned')
        && r.capabilities.some(capability => capability === 'BLOCKED zone' || capability === 'Fleet-specific route restriction');
    });
    for (const robot of retryable) await dispatch(robot.id);
  };
  const requestClearance = () => { if (!selected) return; update({ ...selected, clearance: 'review', dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: 'Clearance requested. Restriction stays active until clearance review is approved and acknowledged.', tone: 'warn' }, ...selected.dispatchLog] }); setShowClearance(true); };
  const approveClearance = () => { if (!selected) return; update({ ...selected, clearance: 'approved', dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: 'Clearance review approved. Awaiting simulated fleet acknowledgement.', tone: 'neutral' }, ...selected.dispatchLog] }); setShowClearance(false); setClearanceConfirm(true); };
  const confirmClearanceDelivery = () => { if (!selected) return; update({ ...selected, clearance: 'cleared', status: 'Cleared', dispatchLog: [{ at: new Date().toLocaleTimeString('en-GB'), message: 'Fleet acknowledged clearance (simulated). Restriction cleared.', tone: 'good' }, ...selected.dispatchLog] }); setClearanceConfirm(false); flash('Clearance acknowledgement received (simulated).'); };
  const reset = () => { const defaults = ((): Restriction[] => { localStorage.removeItem('smart-city-roboops.demo.v1'); return incidentService.list(); })(); setItems(defaults); setSelectedId(defaults[0]?.id || ''); setFilter('All incidents'); setError(''); flash('Demo data reset to its initial state.'); };
  const openEditor = () => {
    if (!selected) return;
    const ring = [...selected.polygon, selected.polygon[0]].map(p => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
    setBoundaryText(JSON.stringify({ type: 'Polygon', coordinates: [ring] }, null, 2)); setEditing(true); setError('');
  };
  const missionsAffected = selected ? missionService.affectedBy(selected, missions) : [];
  const needsReview = items.filter(i => ['Proposed', 'Under review', 'Review overdue'].includes(i.status)).length;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><Command size={19} /></div><div><strong>Smart City</strong><span>ROBOOPS</span></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
      <div className="workspace-label">AARHUS MUNICIPALITY</div>
      <div className="city-switch"><span className="city-dot" /> Aarhus · Central district <ChevronDown size={14} /></div>
      <div className="side-caption">OPERATIONS</div>
      <nav className="side-nav">
        {[['Overview', Activity], ['Incidents', AlertTriangle], ['Missions & routes', Route], ['Fleet profiles', Radio]].map(([label, Icon]: any) => <button key={label} onClick={() => { setSection(label); setMobileNav(false); }} className={section === label ? 'active' : ''} data-testid={`nav-${String(label).toLowerCase().replaceAll(/[^a-z]+/g, '-')}`}><Icon size={17} /><span>{label}</span>{label === 'Incidents' && needsReview > 0 && <em>{needsReview}</em>}</button>)}
      </nav>
      <div className="side-caption side-caption-spaced">SYSTEM</div>
      <nav className="side-nav"><button onClick={() => flash('Settings are part of this local demonstration.')} data-testid="nav-settings"><Settings2 size={17} /><span>Settings</span></button></nav>
      <div className="sidebar-bottom">
        <div className="demo-status"><span className="pulse-dot" /><div><b>DEMO ENVIRONMENT</b><small>No live fleet connection</small></div></div>
        <div className="operator"><div className="operator-avatar">OP</div><div><b>Demo operator</b><small>Municipal operations</small></div><MoreHorizontal size={18} /></div>
      </div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileNav(true)} data-testid="button-menu"><Menu size={19} /></button><span className="breadcrumb">Operations</span><ChevronRight size={14} /><b>{section}</b></div><div className="topbar-right"><span className="demo-pill"><span /> SIMULATED ENVIRONMENT</span><button className="icon-button notification" data-testid="button-notifications" onClick={() => flash('No new operator notifications.')}><Bell size={17} /><i /></button><span className="top-time mono">{time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} CEST</span></div></header>
      <div className="page-content">
        <div className="page-heading">
          <div><div className="eyebrow"><span className="live-mark" /> MUNICIPAL FIELD OPERATIONS <span className="eyebrow-sep">/</span> AARHUS</div><h1>Good morning, operator<span className="heading-period">.</span></h1><p>Coordinate autonomous mobile robots for outdoor groundskeeping and sanitary maintenance of paved public spaces.</p></div>
          <div className="heading-actions"><button className="button button-quiet" onClick={reset} data-testid="button-reset-demo"><RefreshCw size={15} /> Reset demo</button><button className="button button-primary" onClick={simulate} data-testid="button-simulate-obstruction"><Plus size={16} /> Simulate obstruction</button></div>
        </div>
        <section className="metric-strip" aria-label="Operations summary">
          <div className="metric"><div className="metric-label">ROBOTS ON SHIFT <span><Radio size={14} /></span></div><div className="metric-value">03 <small>/ 03</small></div><div className="metric-foot"><span className="metric-green"><span className="mini-dot" /> 2 connected</span><span>1 intermittent</span></div></div>
          <div className="metric"><div className="metric-label">ACTIVE MISSIONS <span><Route size={15} /></span></div><div className="metric-value">03</div><div className="metric-foot">Across <b>3 service areas</b></div></div>
          <div className="metric"><div className="metric-label">RESTRICTIONS TO REVIEW <span><ShieldAlert size={15} /></span></div><div className="metric-value">{String(needsReview).padStart(2, '0')}</div><div className="metric-foot">{needsReview ? <><span className="metric-amber">Operator attention</span><span>·</span><span>{needsReview} need review</span></> : 'All observations reviewed'}</div></div>
          <div className="metric"><div className="metric-label">FLEET ADAPTER <span><Activity size={15} /></span></div><div className="metric-value metric-value-small">SIMULATED</div><div className="metric-foot"><span className="neutral-pill">No live connection</span></div></div>
        </section>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
        {section === 'Overview' || section === 'Incidents' ? <div className="dashboard-grid">
          <section className="map-card">
            <div className="panel-heading map-panel-heading"><div><div className="panel-kicker"><Crosshair size={13} /> FIELD OVERVIEW <span className="sim-tag">SIMULATED DATA</span></div><h2>Central Aarhus <small>· 3 service areas</small></h2></div><button className="text-button" onClick={() => setSection('Missions & routes')} data-testid="button-view-routes">View routes <ArrowUpRight size={14} /></button></div>
            <GoogleMapView selected={selected} mode={mode} setMode={setMode} />
            <div className="map-legend">
              <span><i className="legend-line" /> Maintenance route</span><span><i className="legend-service" /> Service area</span>
              <span><i className="legend-zone amber" /> Proposed restriction</span><span><i className="legend-zone red" /> Approved zone</span>
            </div>
            <div className="map-status-row"><span><span className="status-square awaiting" /> Awaiting application</span><span><span className="status-square applied" /> Confirmed applied</span><span className="map-status-note">Polygons display on overhead map only</span></div>
          </section>
          <section className="incident-card">
            <div className="panel-heading incident-heading"><div><div className="panel-kicker"><Shield size={13} /> OPERATOR QUEUE</div><h2>Incidents <span className="count-bubble">{filtered.length}</span></h2></div><button className="icon-button" title="Toggle needs-review filter" onClick={() => setFilter(filter === 'Needs review' ? 'All incidents' : 'Needs review')} data-testid="button-filter"><SlidersHorizontal size={17} /></button></div>
            <div className="incident-tools"><div className="search-field"><Search size={15} /><input aria-label="Search incidents" data-testid="input-search-incidents" placeholder="Find incident…" value={search} onChange={e => setSearch(e.target.value)} /></div><select aria-label="Filter incidents" value={filter} onChange={e => setFilter(e.target.value)} data-testid="select-incident-filter"><option>All incidents</option><option>Needs review</option><option>Proposed</option><option>Under review</option><option>Approved</option><option>Rejected</option><option>Review overdue</option><option>Cleared</option></select></div>
            <div className="incident-list" data-testid="list-incidents">
              {filtered.length ? filtered.map((incident, idx) => <button key={incident.id} className={`incident-row ${selectedId === incident.id ? 'selected' : ''}`} onClick={() => { setSelectedId(incident.id); setEditing(false); }} data-testid={`incident-${incident.id}`}>
                <span className={`incident-symbol ${incident.status === 'Approved' || incident.status === 'Review overdue' ? 'approved' : incident.status === 'Rejected' ? 'rejected' : ''}`}><AlertTriangle size={16} /></span>
                <span className="incident-copy"><span className="incident-title">{incident.title}</span><span className="incident-sub mono">{incident.id} <span>·</span> {shortTime(incident.observedAt)} <span>·</span> {incident.robot}</span></span>
                <span className="incident-row-end"><Badge>{incident.status}</Badge><ChevronRight size={15} /></span>
              </button>) : <div className="empty-state"><div className="empty-icon"><Search size={19} /></div><b>No matching incidents</b><span>Try another status or search term.</span><button onClick={() => { setFilter('All incidents'); setSearch(''); }}>Clear filters</button></div>}
            </div>
            <button className="incident-footer" onClick={() => { setSection('Incidents'); setFilter('All incidents'); }} data-testid="button-all-incidents">Incident register <ArrowUpRight size={14} /></button>
          </section>
          <div className="detail-shell incidents-detail"><IncidentDetail {...{ selected, missionsAffected, startReview, approve, reject, openEditor, editing, setEditing, boundaryText, setBoundaryText, editBoundary, dispatch, busy, retryAll, requestClearance, continueClearanceReview: () => setShowClearance(true), sendClearance: () => setClearanceConfirm(true), flash }} /></div>
          <section className="mission-panel">
            <div className="panel-heading compact-heading"><div><div className="panel-kicker"><Route size={13} /> ROUTE EXECUTION <span className="sim-tag">SIMULATED</span></div><h2>Active missions <small>3 scheduled</small></h2></div><button className="text-button" onClick={() => setSection('Missions & routes')} data-testid="button-all-missions">All missions <ArrowUpRight size={14} /></button></div>
            <div className="mission-table">
              <div className="mission-table-head"><span>MISSION / SERVICE AREA</span><span>ROBOT</span><span>PROGRESS</span><span>EXECUTION</span></div>
              {missions.map(m => { const executionStatus = missionStatusFor(m, selected); return <div className="mission-row" key={m.id} data-testid={`mission-${m.id}`}><div className="mission-name"><i style={{ background: m.color }} /><div><b>{m.name}</b><span>{m.id} <span>·</span> {m.area}</span></div></div><span className="mission-robot"><span className="robot-avatar">{m.robot.slice(0, 1)}</span>{m.robot}</span><div className="progress-wrap"><span>{m.progress}%</span><div className="progress-track"><i style={{ width: `${m.progress}%`, background: m.color }} /></div></div><Badge className={executionStatus === 'Rerouted' ? 'mission-rerouted' : ''}>{executionStatus}</Badge></div>; })}
            </div>
          </section>
          <section className="fleet-panel">
            <div className="panel-heading compact-heading"><div><div className="panel-kicker"><Radio size={13} /> ROBOT PROFILES</div><h2>Fleet status</h2></div><button className="text-button" onClick={() => setSection('Fleet profiles')} data-testid="button-fleet-profiles">Profiles <ArrowUpRight size={14} /></button></div>
            <div className="fleet-list">{robots.map((r, i) => <div className="fleet-row" key={r.id} data-testid={`robot-${r.id}`}><div className={`fleet-avatar fleet-${i}`}><Navigation size={15} /></div><div className="fleet-identity"><b>{r.name}<span className={`connectivity ${r.connectivity.toLowerCase()}`} /></b><small>{r.profile}</small></div><div className="fleet-battery"><span>{r.battery}%</span><div><i style={{ width: `${r.battery}%` }} /></div></div><span className={`fleet-connectivity ${r.connectivity === 'Connected' ? 'connected' : 'intermittent'}`}>{r.connectivity}</span></div>)}</div>
          </section>
         </div> : section === 'Missions & routes' ? <RoutesPage selected={selected} /> : <FleetPage />}
        <footer className="page-footer"><span>SMART CITY ROBOOPS <span>·</span> Aarhus field operations</span><span>All footage, robot movement, fleet responses and reroutes are simulated.</span><button onClick={reset} data-testid="button-footer-reset">Reset demo state</button></footer>
      </div>
    </main>
    {toast && <div className="toast-message" role="status" data-testid="status-toast"><CheckCircle2 size={16} />{toast}</div>}
    {selected && section !== 'Incidents' && <button className="detail-peek" onClick={() => setSection('Incidents')} data-testid="button-open-selected-incident"><span className="peek-icon"><AlertTriangle size={16} /></span><span><b>Selected observation</b><small>{selected.id} · {selected.status}</small></span><ChevronRight size={16} /></button>}
    {showClearance && selected && <div className="modal-scrim" role="presentation"><div className="modal-card" role="dialog" aria-modal="true"><div className="modal-icon"><Shield size={20} /></div><button className="modal-close" onClick={() => setShowClearance(false)}><X size={17} /></button><div className="panel-kicker">CLEARANCE REVIEW</div><h2>Review restriction clearance</h2><p>The zone remains active until this review is approved and simulated fleet acknowledgement is received. It will not reopen automatically.</p><div className="modal-facts"><span>Restriction</span><b>{selected.id} · {selected.title}</b><span>Current status</span><Badge>{selected.status}</Badge></div><div className="modal-actions"><button className="button button-quiet" onClick={() => setShowClearance(false)}>Keep active</button><button className="button button-primary" onClick={approveClearance} data-testid="button-approve-clearance"><Check size={15} /> Approve clearance review</button></div></div></div>}
    {clearanceConfirm && <div className="modal-scrim"><div className="modal-card" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setClearanceConfirm(false)}><X size={17} /></button><div className="modal-icon"><Radio size={20} /></div><div className="panel-kicker">SIMULATED DELIVERY</div><h2>Send clearance to fleet?</h2><p>Clearance is approved, but remains pending until the adapter acknowledgement step is completed.</p><div className="modal-actions"><button className="button button-quiet" onClick={() => setClearanceConfirm(false)}>Not yet</button><button className="button button-primary" onClick={confirmClearanceDelivery} data-testid="button-send-clearance">Simulate fleet acknowledgement</button></div></div></div>}
  </div>;
}

type DetailProps = {
  selected?: Restriction; missionsAffected: string[]; startReview: () => void; approve: () => void; reject: () => void;
  openEditor: () => void; editing: boolean; setEditing: (v: boolean) => void; boundaryText: string;
  setBoundaryText: (v: string) => void; editBoundary: () => void; dispatch: (id: string) => void;
  busy: string | null; retryAll: () => void; requestClearance: () => void; continueClearanceReview: () => void;
  sendClearance: () => void; flash: (s: string) => void;
};
function IncidentDetail({ selected, missionsAffected, startReview, approve, reject, openEditor, editing, setEditing, boundaryText, setBoundaryText, editBoundary, dispatch, busy, retryAll, requestClearance, continueClearanceReview, sendClearance, flash }: DetailProps) {
  if (!selected) return <div className="detail-empty"><AlertTriangle size={21} /><b>Select an observation</b><span>Choose an incident from the operator queue.</span></div>;
  const approved = selected.status === 'Approved' || selected.status === 'Review overdue';
  const appliedCount = Object.values(selected.recipients).filter(v => v === 'Robot applied').length;
  const activeDelivery = Object.values(selected.recipients).some(v => ['Not sent', 'Sending', 'Fleet accepted', 'Timed out', 'Rejected', 'Failed'].includes(v));
  const streetKey = !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return <div className="detail-card" data-testid={`incident-detail-${selected.id}`}>
    <div className="detail-head"><div><div className="panel-kicker"><span className="incident-id mono">{selected.id}</span><span className="sim-tag">SIMULATED</span></div><h2>{selected.title}</h2><div className="detail-meta"><span><Clock3 size={13} /> Observed {fmt(selected.observedAt)}</span><Badge>{selected.status}</Badge></div></div><button className="icon-button" title="More incident actions" onClick={() => flash('All available actions are shown in this review panel.')}><MoreHorizontal size={18} /></button></div>
    <div className="workflow-rail"><div className={`workflow-step done`}><i><Eye size={12} /></i><span>Observed</span></div><div className={`workflow-line ${selected.status !== 'Proposed' ? 'done' : ''}`} /><div className={`workflow-step ${selected.status !== 'Proposed' ? 'done' : 'current'}`}><i>2</i><span>Review</span></div><div className={`workflow-line ${approved || selected.status === 'Rejected' ? 'done' : ''}`} /><div className={`workflow-step ${approved ? 'done' : selected.status === 'Rejected' ? 'rejected-step' : ''}`}><i>{approved ? <Check size={12} /> : selected.status === 'Rejected' ? <X size={12} /> : '3'}</i><span>{selected.status === 'Rejected' ? 'Rejected' : 'Approve'}</span></div><div className={`workflow-line ${appliedCount > 0 ? 'done' : ''}`} /><div className={`workflow-step ${appliedCount ? 'done' : ''}`}><i>{appliedCount ? <Check size={12} /> : '4'}</i><span>Robot applied</span></div></div>
    <div className="detail-columns">
      <div className="detail-main">
        <div className="evidence-block"><div className="subsection-title"><span>OBSERVATION EVIDENCE</span><span className="sim-tag">SIMULATED FOOTAGE</span></div><div className="evidence-placeholder"><div className="camera-frame"><div className="camera-crosshair" /><div className="barrier-shape"><i /><i /><i /></div><div className="camera-caption"><CircleDot size={11} /> CAMERA CAM-14 <span>09:42:07</span></div></div><div className="evidence-copy"><span className="camera-graphic"><Eye size={17} /></span><b>Camera frame placeholder</b><small>Construction barrier · detector confidence 0.91</small><span>Footage is illustrative only. No video system is connected.</span></div></div>
          <div className="street-context"><div className="subsection-title">STREET VIEW CONTEXT <span className="context-distance">~12 m</span></div>{streetKey ? <a className="street-link" href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selected.center.lat},${selected.center.lng}`} target="_blank" rel="noreferrer" data-testid="link-street-view"><Compass size={15} /><span><b>Open nearby Street View</b><small>Google coverage may not be available at this location. The restriction polygon is not displayed on Street View.</small></span><ArrowUpRight size={14} /></a> : <div className="street-unavailable"><Compass size={16} /><span><b>Street View context unavailable</b><small>Configure VITE_GOOGLE_MAPS_API_KEY to offer a Google Street View link. Coverage at this point is not guaranteed.</small></span></div>}</div>
        </div>
        <div className="boundary-block"><div className="subsection-title"><span>GEOJSON RESTRICTION BOUNDARY</span><button className="text-button small" onClick={openEditor} data-testid="button-edit-boundary"><SlidersHorizontal size={13} /> Edit boundary</button></div><div className="geo-summary"><span className={`boundary-dot ${approved ? 'red' : ''}`} /><span>Polygon · {selected.polygon.length} vertices</span><code>{selected.polygon[0].lat.toFixed(5)}, {selected.polygon[0].lng.toFixed(5)}</code><button onClick={() => { navigator.clipboard?.writeText(JSON.stringify({ type: 'Polygon', coordinates: [[...selected.polygon.map(p => [p.lng, p.lat]), [selected.polygon[0].lng, selected.polygon[0].lat]]] })); flash('GeoJSON boundary copied.'); }} data-testid="button-copy-geojson"><Download size={13} /> Copy</button></div>
          {editing && <div className="editor-wrap"><textarea value={boundaryText} onChange={e => setBoundaryText(e.target.value)} aria-label="Editable GeoJSON boundary" data-testid="input-geojson-boundary" spellCheck={false} /><div className="editor-actions"><span>GeoJSON Polygon · [longitude, latitude]</span><button className="button button-quiet button-xs" onClick={() => setEditing(false)}>Cancel</button><button className="button button-primary button-xs" onClick={editBoundary} data-testid="button-save-boundary">Save boundary</button></div></div>}
          <div className="zone-set-line"><span>Active zoneSetId</span><code data-testid="text-zone-set-id">{selected.zoneSetId}</code><span className="zone-set-note">New ID assigned on every boundary edit</span></div>
        </div>
        <div className="mission-impact"><div className="subsection-title">AFFECTED MISSIONS <span className="affected-count">{missionsAffected.length} of 3</span></div>{missionsAffected.length === 0 ? <div className="empty-inline">No active mission affected.</div> : missions.filter(m => missionsAffected.includes(m.id)).map(m => { const executionStatus = missionStatusFor(m, selected); return <div className="affected-mission" key={m.id}><span className="mission-mini-line" style={{ background: m.color }} /><div><b>{m.name}</b><small>{m.id} · {m.robot} · {m.area}</small></div><Badge className={executionStatus === 'Rerouted' ? 'mission-rerouted' : ''}>{executionStatus}</Badge></div>; })}</div>
      </div>
      <aside className="detail-side">
        <div className="review-card"><div className="subsection-title">OPERATOR REVIEW</div><div className="review-status"><div className={`review-icon ${selected.status === 'Rejected' ? 'reject' : approved ? 'approved-icon' : ''}`}>{selected.status === 'Rejected' ? <XCircle size={17} /> : approved ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</div><div><b>{selected.status === 'Proposed' ? 'Awaiting inspection' : selected.status === 'Under review' ? 'Under review' : selected.status === 'Rejected' ? 'Rejected · retained' : selected.status === 'Review overdue' ? 'Review overdue · active' : 'Restriction approved'}</b><small>{selected.status === 'Rejected' ? 'No fleet dispatch will be attempted.' : approved ? 'Approval is separate from delivery and robot application.' : 'Inspect the boundary and context before deciding.'}</small></div></div>
          <div className="review-actions">{selected.status === 'Proposed' && <button className="button button-quiet full-button" onClick={startReview} data-testid="button-start-review"><Eye size={15} /> Begin inspection</button>}{selected.status === 'Under review' && <><button className="button button-primary full-button" onClick={approve} data-testid="button-approve-restriction"><Check size={15} /> Approve restriction</button><button className="button button-danger-quiet full-button" onClick={reject} data-testid="button-reject-restriction"><X size={15} /> Reject observation</button></>}{selected.status === 'Proposed' && <button className="button button-danger-quiet full-button" onClick={reject} data-testid="button-reject-restriction"><X size={15} /> Reject observation</button>}{approved && selected.clearance === 'none' && <button className="button button-quiet full-button" onClick={requestClearance} data-testid="button-request-clearance"><Shield size={15} /> Request clearance review</button>}{approved && selected.clearance === 'review' && <button className="button button-quiet full-button" onClick={continueClearanceReview} data-testid="button-continue-clearance">Continue clearance review</button>}{approved && selected.clearance === 'approved' && <button className="button button-quiet full-button" onClick={sendClearance} data-testid="button-open-clearance-delivery">Complete clearance acknowledgement</button>}{selected.status === 'Rejected' && <button className="button button-quiet full-button" onClick={() => flash('Rejected incidents remain visible; reset demo restores the initial state.')} data-testid="button-rejected-info">Rejected · no dispatch</button>}</div>
          <div className="approval-separation"><Shield size={13} /> Approval does not mean the fleet accepted or robots applied it.</div>
        </div>
        <div className="delivery-card"><div className="subsection-title"><span>FLEET DELIVERY</span><span className="sim-tag">SIMULATED</span></div><div className="zone-delivery-meta">Zone set <code>{selected.zoneSetId}</code></div>{robots.map(r => { const state = selected.recipients[r.id] || 'Not sent'; const blocked = !r.capabilities.includes('BLOCKED zone') && !r.capabilities.includes('Fleet-specific route restriction'); const aligned = !r.alignment.includes('Not aligned'); return <div className="delivery-recipient" key={r.id} data-testid={`delivery-${r.id}`}><div className="recipient-top"><span><span className={`recipient-light ${state === 'Robot applied' ? 'applied-light' : state === 'Fleet accepted' ? 'accepted-light' : ''}`} />{r.name}</span><Badge>{blocked ? 'Unsupported' : state}</Badge></div><div className="recipient-sub">{r.profile.replace(' demo adapter', '')}</div>{(state === 'Not sent' || ['Failed', 'Timed out', 'Rejected'].includes(state)) && <div className="delivery-explainer">{state === 'Not sent' ? 'Awaiting operator dispatch after approval.' : state === 'Timed out' ? 'Fleet acceptance is not confirmed. Explicit retry is available.' : state === 'Rejected' ? 'The recipient rejected this delivery.' : 'Adapter delivery failed.'}</div>}{state === 'Fleet accepted' && <div className="delivery-explainer applied-pending">Fleet accepted · robot application still awaiting acknowledgement.</div>}{state === 'Robot applied' && <div className="delivery-explainer applied-success"><CheckCircle2 size={13} /> Confirmed applied · alternative route selected (simulated).</div>}{state === 'Sending' && <div className="delivery-explainer"><span className="sending-dot" /> Sending to adapter…</div>}{approved && !blocked && (state === 'Not sent' || state === 'Fleet accepted' || ['Timed out', 'Failed', 'Rejected'].includes(state)) && <button className="text-button delivery-action" disabled={!aligned || busy !== null} onClick={() => void dispatch(r.id)} data-testid={`button-dispatch-${r.id}`}>{busy === r.id ? 'Sending…' : state === 'Not sent' ? 'Send restriction' : state === 'Fleet accepted' ? 'Simulate robot response' : 'Retry delivery'} <ArrowUpRight size={13} /></button>}{!aligned && <div className="unsupported-note">Dispatch disabled · map alignment required.</div>}{blocked && <div className="unsupported-note">Profile lacks a supported restriction operation.</div>}</div>; })}
          {approved && activeDelivery && <button className="button button-quiet full-button retry-all" onClick={retryAll} disabled={!!busy} data-testid="button-retry-partial"><RefreshCw size={14} /> Retry partial outcomes</button>}
          <div className="adapter-note">VDA 5050 3.0 is a demo adapter target, not a verified compliance claim. Adapter capability declaration is simulated.</div>
        </div>
        <div className="dispatch-history"><div className="subsection-title">DISPATCH HISTORY <span>{selected.dispatchLog.length} EVENTS</span></div><div className="history-list">{selected.dispatchLog.map((event, idx) => <div className={`history-event ${event.tone}`} key={`${event.at}-${idx}`}><i /><div><span className="mono">{event.at}</span><p>{event.message}</p></div></div>)}</div><div className="history-foot">Responses and robot acknowledgements are simulated.</div></div>
        <div className="expiry-card"><div className="expiry-icon"><Clock3 size={15} /></div><div><span>REVIEW BY</span><b>{fmt(selected.expiresAt)}</b><small>{new Date(selected.expiresAt) < new Date() && selected.status === 'Approved' ? 'Review overdue · still active' : 'Operator review required before clearing'}</small></div></div>
        {selected.clearance !== 'none' && <div className={`clearance-state clearance-${selected.clearance}`}><div className="subsection-title">CLEARANCE CYCLE</div><b>{selected.clearance === 'review' ? 'Review requested' : selected.clearance === 'approved' ? 'Approved · acknowledgement pending' : 'Fleet acknowledgement received'}</b><small>{selected.clearance === 'cleared' ? 'Restriction is cleared after simulated fleet acknowledgement.' : 'Restriction remains active until the clearance acknowledgement is complete.'}</small>{selected.clearance === 'review' && <button className="button button-quiet full-button" onClick={continueClearanceReview} data-testid="button-continue-clearance-cycle">Continue clearance review</button>}{selected.clearance === 'approved' && <button className="button button-primary full-button" onClick={sendClearance} data-testid="button-clearance-pending">Simulate clearance acknowledgement</button>}</div>}
      </aside>
    </div>
  </div>;
}
function RoutesPage({ selected }: { selected?: Restriction }) {
  return <section className="full-page-panel"><div className="panel-heading"><div><div className="panel-kicker"><Route size={13} /> EXECUTION PLAN · SIMULATED</div><h2>Missions & routes</h2></div><span className="sim-tag">NO LIVE ROBOTS</span></div><p className="page-intro">Three municipal service runs across central Aarhus. A confirmed robot application can select a predefined alternative route; a fleet acceptance alone cannot.</p>{missions.map(m => { const executionStatus = missionStatusFor(m, selected); return <div className="route-card" key={m.id}><div className="route-card-top"><span className="route-color" style={{ background: m.color }} /><div><h3>{m.name}</h3><span>{m.id} · {m.area}</span></div><Badge className={executionStatus === 'Rerouted' ? 'mission-rerouted' : ''}>{executionStatus}</Badge></div><div className="route-progress"><div><span>Run progress</span><b>{m.progress}%</b></div><div className="progress-track"><i style={{ width: `${m.progress}%`, background: m.color }} /></div></div><div className="route-waypoints"><span>START · {m.robot}</span><Route size={15} /><span>{m.alternative ? executionStatus === 'Rerouted' ? 'Alternative via Mejlgade · selected in demo' : 'Alternative via Mejlgade · available' : 'Paving sweep · predefined path'}</span><ArrowDownRight size={15} /><span>END · {m.area}</span></div>{m.alternative && executionStatus === 'Rerouted' && <div className="route-alt"><CheckCircle2 size={14} /> Alternative route taken after zone application · simulated</div>}</div>; })}</section>;
}
function FleetPage() {
  return <section className="full-page-panel"><div className="panel-heading"><div><div className="panel-kicker"><Radio size={13} /> ADAPTER CONFIGURATION · SIMULATED</div><h2>Fleet profiles</h2></div><Badge>Demo only</Badge></div><p className="page-intro">Profiles declare supported operations. Dispatch is disabled unless the explicitly predefined map alignment is configured.</p><div className="profile-grid">{robots.map((r, idx) => <article className="profile-card" key={r.id}><div className="profile-heading"><span className={`fleet-avatar fleet-${idx}`}><Navigation size={16} /></span><div><h3>{r.name}</h3><span>{r.profile}</span></div><span className={`fleet-connectivity ${r.connectivity === 'Connected' ? 'connected' : 'intermittent'}`}>{r.connectivity}</span></div><div className="profile-meta"><span>Adapter version</span><b>{idx === 0 ? '3.0 · fictional demo profile' : 'Legacy · fictional municipal profile'}</b><span>Robot mapId</span><code>{r.mapId}</code><span>Geographic position</span><code>{r.position.lat.toFixed(5)}, {r.position.lng.toFixed(5)}</code><span>Map alignment</span><b className={r.alignment.includes('Not aligned') ? 'text-warning' : 'text-success'}>{r.alignment}</b></div><div className="capability-list"><span>DECLARED CAPABILITIES</span>{r.capabilities.map(c => <div key={c}><CheckCircle2 size={14} /> {c}</div>)}</div>{idx === 0 && <div className="vda-disclaimer">VDA 5050 3.0 is an adapter target only; this fictional profile makes no verified compliance claim.</div>}{idx > 0 && <div className="vda-disclaimer">Legacy operation uses fleet-specific route restrictions or mission pause. BLOCKED-zone operation is unsupported.</div>}</article>)}</div><div className="alignment-banner"><Crosshair size={17} /><div><b>Predefined alignment controls are part of this demo</b><span>Geographic coordinates and robot mapId coordinates are separate spaces. No automatic coordinate conversion or live map transform is configured.</span></div><Badge>Explicitly configured for Moss-03 & Birk-07</Badge></div></section>;
}
export default App;
