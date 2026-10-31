import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Command,
  Compass,
  Crosshair,
  Download,
  Eye,
  Layers,
  LocateFixed,
  MapPin,
  Menu,
  MoreHorizontal,
  Navigation,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  X,
  XCircle,
} from "lucide-react";
import type { Mission, Restriction, Robot } from "./models";
import demo from "../../../shared/demo.json";
let googleLoading: Promise<void> | undefined;
function loadGoogleMaps(key: string) {
  if ((window as any).google?.maps) return Promise.resolve();
  if (!googleLoading)
    googleLoading = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Google Maps load timed out")),
        15000,
      );
      (window as any).roboOpsGoogleReady = () => {
        clearTimeout(timer);
        resolve();
      };
      (window as any).gm_authFailure = () =>
        window.dispatchEvent(new Event("roboops:maps-error"));
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=roboOpsGoogleReady`;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Google Maps failed to load"));
      };
      document.head.appendChild(script);
    });
  return googleLoading;
}

const MapContext = createContext<{
  robots: Robot[];
  missions: Mission[];
  restrictions: Restriction[];
  onSelect: (id: string) => void;
}>({ robots: [], missions: [], restrictions: [], onSelect: () => {} });
const serviceAreas = demo.serviceAreas;
export default function OperationsMap(props: {
  selected?: Restriction;
  mode: "roadmap" | "satellite";
  setMode: (m: "roadmap" | "satellite") => void;
  robots: Robot[];
  missions: Mission[];
  restrictions: Restriction[];
  onSelect: (id: string) => void;
}) {
  return (
    <MapContext.Provider value={props}>
      <GoogleMapView
        selected={props.selected}
        mode={props.mode}
        setMode={props.setMode}
      />
    </MapContext.Provider>
  );
}
const fmt = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
const shortTime = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
const statusClass = (s: string) =>
  `badge ${s.toLowerCase().replaceAll(" ", "-")}`;
const pointToSvg = (p: { lat: number; lng: number }) => ({
  x: 45 + (p.lng - 10.204) * 65000,
  y: 30 + (56.165 - p.lat) * 78000,
});
const pathFor = (points: { lat: number; lng: number }[]) =>
  points
    .map((p, i) => {
      const v = pointToSvg(p);
      return `${i ? "L" : "M"} ${v.x} ${v.y}`;
    })
    .join(" ");
function GoogleMapView({
  selected,
  mode,
  setMode,
}: {
  selected: Restriction | undefined;
  mode: "roadmap" | "satellite";
  setMode: (m: "roadmap" | "satellite") => void;
}) {
  const { robots, missions, restrictions, onSelect } = useContext(MapContext);
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as
    string | undefined;
  const [googleReady, setGoogleReady] = useState(
    !!(window as any).google?.maps,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [layersShown, setLayersShown] = useState(true);
  const [centerRevision, setCenterRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const fail = () => setLoadFailed(true);
    window.addEventListener("roboops:maps-error", fail);
    if (googleKey)
      loadGoogleMaps(googleKey)
        .then(() => {
          if (!cancelled) setGoogleReady(true);
        })
        .catch(() => {
          if (!cancelled) setLoadFailed(true);
        });
    return () => {
      cancelled = true;
      window.removeEventListener("roboops:maps-error", fail);
    };
  }, [googleKey]);
  useEffect(() => {
    const g = (window as any).google?.maps;
    if (!googleReady || !g || !mapElement.current) return;
    if (!mapRef.current)
      mapRef.current = new g.Map(mapElement.current, {
        center: { lat: 56.16, lng: 10.21 },
        zoom: 16,
        mapTypeId: mode,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
      });
    else mapRef.current.setMapTypeId(mode);
    const map = mapRef.current;
    const markers = robots.map(
      (robot, i) =>
        new g.Marker({
          position: robot.position,
          map,
          title: `${robot.name} · simulated`,
          label: { text: `${i + 1}`, color: "#fff" },
        }),
    );
    const cameras = [
      {
        id: "CAM-14",
        position: selected?.center ?? { lat: 56.16035, lng: 10.210475 },
      },
      { id: "CAM-09", position: { lat: 56.16245, lng: 10.20895 } },
    ].map(
      (camera) =>
        new g.Marker({
          position: camera.position,
          map,
          title: `${camera.id} · simulated camera`,
          label: { text: "C", color: "#fff" },
        }),
    );
    const overlays: any[] = [];
    if (layersShown) {
      overlays.push(
        ...serviceAreas.map(
          (area, i) =>
            new g.Polygon({
              paths: area,
              map,
              fillColor: i === 1 ? "#d9ae48" : "#4c927d",
              fillOpacity: 0.08,
              strokeColor: i === 1 ? "#d0a43e" : "#68a28d",
              strokeOpacity: 0.6,
              strokeWeight: 1,
            }),
        ),
      );
      overlays.push(
        ...missions.map(
          (m) =>
            new g.Polyline({
              path: m.activePoints || m.points,
              map,
              strokeColor: m.color,
              strokeOpacity: 0.82,
              strokeWeight: 4,
            }),
        ),
      );
      for (const zone of restrictions.filter(
        (r) => !["Rejected", "Cleared"].includes(r.status),
      )) {
        const active = ["Approved", "Review overdue"].includes(zone.status);
        const poly = new g.Polygon({
          paths: zone.polygon,
          map,
          fillColor: active ? "#c9443d" : "#daa33c",
          fillOpacity: zone.id === selected?.id ? 0.35 : 0.18,
          strokeColor: active ? "#c9443d" : "#c58c20",
          strokeWeight: zone.id === selected?.id ? 3 : 1,
        });
        poly.addListener("click", () => onSelect(zone.id));
        overlays.push(poly);
      }
    }
    return () => {
      [...markers, ...cameras].forEach((m: any) => m.setMap(null));
      overlays.forEach((o: any) => o.setMap(null));
    };
  }, [
    googleReady,
    mode,
    selected,
    layersShown,
    robots,
    missions,
    restrictions,
    onSelect,
  ]);
  useEffect(() => {
    mapRef.current?.panTo({ lat: 56.16, lng: 10.21 });
  }, [centerRevision]);
  const useFallback = !googleKey || !googleReady || loadFailed;
  return (
    <div className="map-stage">
      {useFallback ? (
        <FallbackMap
          selected={selected}
          layersShown={layersShown}
          onCenter={() => setCenterRevision((v) => v + 1)}
        />
      ) : (
        <div className="google-map" ref={mapElement} data-testid="map-google" />
      )}
      <div className="map-controls">
        <div className="map-toggle" aria-label="Map layer">
          <button
            data-testid="button-map-road"
            onClick={() => setMode("roadmap")}
            className={mode === "roadmap" ? "selected" : ""}
          >
            Road
          </button>
          <button
            data-testid="button-map-satellite"
            onClick={() => setMode("satellite")}
            disabled={!googleReady || loadFailed}
            title={
              !googleReady || loadFailed
                ? "Configure Google Maps to enable satellite imagery"
                : "Satellite imagery"
            }
            className={mode === "satellite" ? "selected" : ""}
          >
            Satellite
          </button>
        </div>
        <button
          className="map-icon"
          title="Center map"
          onClick={() => {
            setCenterRevision((v) => v + 1);
            mapRef.current?.setZoom(16);
          }}
          data-testid="button-map-center"
        >
          <LocateFixed size={16} />
        </button>
        <button
          className={`map-icon ${layersShown ? "map-layer-active" : ""}`}
          title={
            layersShown
              ? "Hide service-area overlays"
              : "Show service-area overlays"
          }
          onClick={() => setLayersShown((v) => !v)}
          data-testid="button-map-layers"
        >
          <Layers size={16} />
        </button>
      </div>
      {useFallback && (
        <div
          className={`map-key-note ${googleKey ? "warning" : ""}`}
          data-testid="text-map-key-note"
        >
          <MapPin size={14} />
          <span>
            {googleKey ? (
              loadFailed ? (
                "Google Maps unavailable · interactive demo map shown"
              ) : (
                "Loading Google Maps · demo map shown meanwhile"
              )
            ) : (
              <>
                Demo map · Add a domain-restricted{" "}
                <b>VITE_GOOGLE_MAPS_API_KEY</b> for Google road / satellite
                tiles.
              </>
            )}
          </span>
        </div>
      )}
      <div className="map-coordinates mono">
        56.1600° N&nbsp; 10.2100° E <span>·</span> Aarhus, DK
      </div>
    </div>
  );
}
function FallbackMap({
  selected,
  layersShown,
  onCenter,
}: {
  selected?: Restriction;
  layersShown: boolean;
  onCenter: () => void;
}) {
  const { robots, missions, restrictions, onSelect } = useContext(MapContext);
  const [zoom, setZoom] = useState(1);
  if (!missions.length)
    return <div className="empty-state">Loading mission map?</div>;
  const showPoly =
    selected && selected.status !== "Rejected" && selected.status !== "Cleared";
  return (
    <div className="fallback-map" data-testid="map-fallback">
      <div className="map-texture" style={{ transform: `scale(${zoom})` }}>
        <svg
          viewBox="0 0 720 510"
          role="img"
          aria-label="Illustrative interactive map of central Aarhus"
        >
          <rect width="720" height="510" fill="#e9eee8" />
          <path
            d="M0 362 C120 323 175 390 285 363 S480 324 720 362 L720 510H0Z"
            fill="#d3e5e0"
          />
          <path
            d="M0 376 C135 336 170 406 292 378 S492 345 720 376"
            fill="none"
            stroke="#bdd8d2"
            strokeWidth="7"
          />
          <path
            d="M-30 120L750 280 M40 -15L150 530 M235 -20L312 530 M485 -20L421 530 M-10 236L730 100 M-15 443L720 260 M620 -10L534 520"
            fill="none"
            stroke="#fffdf8"
            strokeWidth="13"
          />
          <path
            d="M-30 120L750 280 M40 -15L150 530 M235 -20L312 530 M485 -20L421 530 M-10 236L730 100 M-15 443L720 260 M620 -10L534 520"
            fill="none"
            stroke="#d5d8cf"
            strokeWidth="1.3"
          />
          {layersShown &&
            serviceAreas.map((area, index) => (
              <polygon
                key={`service-area-${index}`}
                points={area
                  .map((p) => {
                    const q = pointToSvg(p);
                    return `${q.x},${q.y}`;
                  })
                  .join(" ")}
                fill={index === 1 ? "#e6bd6040" : "#6caa9540"}
                stroke={index === 1 ? "#d1a640" : "#78a994"}
                strokeDasharray="5 4"
                strokeWidth="1.5"
              />
            ))}
          {missions.map((m) => (
            <path
              key={m.id}
              d={pathFor(m.activePoints || m.points)}
              fill="none"
              stroke={m.color}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={m.robot === "Birk-07" ? "7 5" : undefined}
            />
          ))}
          {restrictions
            .filter((r) => !["Rejected", "Cleared"].includes(r.status))
            .map((zone) => (
              <polygon
                key={zone.id}
                tabIndex={0}
                role="button"
                aria-label={`Select ${zone.title}`}
                onClick={() => onSelect(zone.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(zone.id);
                }}
                points={zone.polygon
                  .map((p) => {
                    const q = pointToSvg(p);
                    return `${q.x},${q.y}`;
                  })
                  .join(" ")}
                fill={
                  ["Approved", "Review overdue"].includes(zone.status)
                    ? "#c9443d44"
                    : "#e5ad454c"
                }
                stroke={
                  ["Approved", "Review overdue"].includes(zone.status)
                    ? "#c9443d"
                    : "#bc8420"
                }
                strokeWidth={zone.id === selected?.id ? 3 : 1}
              />
            ))}
          <g className="map-labels">
            <text x="262" y="158">
              LATINERKVARTERET
            </text>
            <text x="483" y="190">
              DOKK1
            </text>
            <text x="185" y="327">
              AARHUS DOMKIRKE
            </text>
            <text x="265" y="437">
              AARHUS Å
            </text>
            <text x="564" y="310">
              HAVNEPLADSEN
            </text>
          </g>
          {robots.map((r, i) => {
            const p = pointToSvg(r.position);
            return (
              <g key={r.id} transform={`translate(${p.x} ${p.y})`}>
                <circle
                  r="13"
                  fill="#fff"
                  stroke={i === 1 ? "#d69b2e" : "#2f8974"}
                  strokeWidth="3"
                />
                <text y="4" textAnchor="middle" className="robot-index">
                  {i + 1}
                </text>
                <text x="16" y="4" className="robot-name">
                  {r.name}
                </text>
              </g>
            );
          })}
          {[
            {
              id: "CAM-14",
              point: selected?.center ?? { lat: 56.16035, lng: 10.210475 },
            },
            { id: "CAM-09", point: { lat: 56.16245, lng: 10.20895 } },
          ].map((camera) => {
            const p = pointToSvg(camera.point);
            return (
              <g key={camera.id} transform={`translate(${p.x} ${p.y})`}>
                <circle r="11" fill="#fff" stroke="#c9443d" strokeWidth="2" />
                <path d="M-5 -3h5l2-2h4v10H-5z" fill="#c9443d" />
                <text x="15" y="4" className="robot-name">
                  {camera.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="map-zoom">
        <button
          data-testid="button-zoom-in"
          onClick={() => setZoom((z) => Math.min(1.55, z + 0.12))}
        >
          +
        </button>
        <button
          data-testid="button-zoom-out"
          onClick={() => setZoom((z) => Math.max(0.88, z - 0.12))}
        >
          −
        </button>
      </div>
      <button
        className="map-center-reset"
        aria-label="Center map"
        onClick={() => {
          setZoom(1);
          onCenter();
        }}
        data-testid="button-center-fallback"
      >
        <LocateFixed size={14} /> Center
      </button>
    </div>
  );
}
