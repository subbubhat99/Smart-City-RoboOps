import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  Clock3,
  Command,
  Crosshair,
  Eye,
  Menu,
  Navigation,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  Settings2,
  Shield,
  X,
} from "lucide-react";
import type { Dashboard, Mission, Restriction } from "./models";
import { operations, request } from "./services";
import OperationsMap from "./MapView";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { StreetContext } from "./StreetContext";

const stamp = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/Copenhagen",
    dateStyle: "short",
    timeStyle: "short",
  });
const active = (r: Restriction) =>
  ["Approved", "Review overdue"].includes(r.status);
function Badge({ text }: { text: string }) {
  return (
    <span className={`badge ${text.toLowerCase().replaceAll(" ", "-")}`}>
      {text}
    </span>
  );
}
function execution(m: Mission, items: Restriction[]) {
  const impacted = items.filter(
    (r) => active(r) && r.missionIds.includes(m.id),
  );
  if (!impacted.length) return "In progress";
  if (impacted.every((r) => r.replans[m.robot] === "Confirmed"))
    return "Rerouted";
  if (impacted.every((r) => r.recipients[m.robot] === "Robot applied"))
    return "Restriction applied · replan pending";
  if (
    impacted.some((r) =>
      ["Failed", "Rejected", "Timed out"].includes(r.recipients[m.robot]),
    )
  )
    return "Delivery delayed";
  return impacted.some((r) => r.recipients[m.robot] === "Fleet accepted")
    ? "Awaiting robot application"
    : "Awaiting delivery";
}

export default function OperationsApp() {
  const [snapshot, setSnapshot] = useState<Dashboard>();
  const [selectedId, setSelectedId] = useState("");
  const [section, setSection] = useState("Overview");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All incidents");
  const [mode, setMode] = useState<"roadmap" | "satellite">("roadmap");
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const loadingSequence = useRef(0);
  const mutation = useRef(false);
  const [boundary, setBoundary] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState("Fleet accepted");
  const [preview, setPreview] = useState("");
  const reload = useCallback(async () => {
    const sequence = ++loadingSequence.current;
    try {
      const next = await operations.dashboard();
      if (sequence !== loadingSequence.current) return;
      setSnapshot(next);
      setOnline(true);
      setUpdatedAt(next.serverTime);
      setSelectedId((id) =>
        next.restrictions.some((r) => r.id === id)
          ? id
          : next.restrictions[0]?.id || "",
      );
    } catch (e) {
      if (sequence === loadingSequence.current) {
        setOnline(false);
        setError(e instanceof Error ? e.message : "Could not load dashboard");
      }
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!mutation.current) void reload();
    }, 15000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    setBoundary(null);
    setPreview("");
    setReason("");
  }, [selectedId]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const run = async (job: () => Promise<unknown>, message: string) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await job();
      await reload();
      setToast(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
      await reload();
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const items = snapshot?.restrictions || [];
  const robots = snapshot?.robots || [];
  const missions = snapshot?.missions || [];
  const selected = items.find((i) => i.id === selectedId);
  const disabled = busy || !online;
  const action = (name: string, robotId?: string, result?: string) =>
    selected &&
    void run(
      () => operations.action(selected, name, robotId, reason, result),
      "Operation recorded.",
    );
  const choose = useCallback((id: string) => setSelectedId(id), []);
  const filtered = items.filter(
    (i) =>
      (filter === "All incidents" ||
        (filter === "Needs review" &&
          ["Proposed", "Under review", "Review overdue"].includes(i.status)) ||
        filter === i.status) &&
      `${i.title} ${i.id} ${i.cameraId}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const needsReview = items.filter((r) =>
    ["Proposed", "Under review", "Review overdue"].includes(r.status),
  ).length;
  const saveBoundary = () => {
    if (!selected || boundary === null) return;
    try {
      const data = JSON.parse(boundary);
      const geometry = data.type === "Feature" ? data.geometry : data;
      if (geometry?.type !== "Polygon" || geometry.coordinates?.length !== 1)
        throw new Error(
          "Use a single-ring GeoJSON Polygon; holes are not supported.",
        );
      const ring = geometry.coordinates[0];
      if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        ring.some(
          (p: unknown) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some((v) => typeof v !== "number" || !Number.isFinite(v)),
        )
      )
        throw new Error("Use numeric [longitude, latitude] coordinate pairs.");
      if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))
        throw new Error(
          "Close the ring by repeating its first coordinate pair.",
        );
      void run(async () => {
        await operations.boundary(
          selected,
          ring.slice(0, -1).map(([lng, lat]: number[]) => ({ lat, lng })),
        );
        setBoundary(null);
      }, "Boundary saved; review the new revision.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid GeoJSON");
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark">
            <Command size={19} />
          </div>
          <div>
            <strong>Smart City</strong>
            <span>ROBOOPS</span>
          </div>
          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <div className="workspace-label">AARHUS · MUNICIPAL OPERATIONS</div>
        <div className="city-switch">
          <span className="city-dot" /> Central district
        </div>
        <div className="side-caption">OPERATIONS</div>
        <nav className="side-nav">
          {[
            ["Overview", Activity],
            ["Incidents", AlertTriangle],
            ["Missions & routes", Route],
            ["Fleet profiles", Radio],
            ["Connections", Settings2],
          ].map(([name, Icon]: any) => (
            <button
              key={name}
              className={section === name ? "active" : ""}
              data-testid={`nav-${name}`}
              onClick={() => {
                setSection(name);
                setMobile(false);
              }}
            >
              <Icon size={17} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-status">
            <span className="pulse-dot" />
            <div>
              <b>SIMULATED FLEETS</b>
              <small>
                {online ? "Python service connected" : "Service disconnected"}
              </small>
            </div>
          </div>
          <div className="operator">
            <div className="operator-avatar">OP</div>
            <div>
              <b>Operator console</b>
              <small>Approval before action</small>
            </div>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Operations</span>
            <ChevronRight size={14} />
            <b>{section}</b>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">
              {online ? "API CONNECTED · DEMO FLEETS" : "API OFFLINE"}
            </span>
            <button
              className="icon-button"
              title="Show incidents needing review"
              aria-label="Show incidents needing review"
              onClick={() => {
                setSection("Incidents");
                setFilter("Needs review");
              }}
            >
              <Bell size={17} />
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void reload()}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MUNICIPAL FIELD OPERATIONS / AARHUS</div>
              <h1>
                Field operations<span className="heading-period">.</span>
              </h1>
              <p>
                Observe obstructions. Review restrictions. Confirm the fleet
                response.
              </p>
            </div>
            <div className="heading-actions">
              <button
                disabled={disabled}
                className="button button-quiet"
                onClick={() => {
                  if (
                    window.confirm(
                      "Reset fictional fleet observations? Real observations will be retained.",
                    )
                  )
                    void run(
                      () => operations.reset(),
                      "Demo reset; real observations retained.",
                    );
                }}
              >
                <RefreshCw size={15} /> Reset demo
              </button>
              <button
                disabled={disabled}
                className="button button-primary"
                data-testid="button-simulate-obstruction"
                onClick={() =>
                  void run(async () => {
                    const next = await operations.simulate();
                    setSelectedId(next.id);
                    setSection("Overview");
                  }, "Simulated observation created.")
                }
              >
                <Plus size={16} /> Simulate obstruction
              </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {!online && (
            <div className="connection-banner">
              {snapshot
                ? "Showing the last saved snapshot. Controls are disabled until reconnection."
                : "Start the Python service to load operational data."}{" "}
              <button
                className="text-button"
                onClick={() => setSection("Connections")}
              >
                Connection settings
              </button>
            </div>
          )}
          <section className="metric-strip">
            <div className="metric">
              <div className="metric-label">ROBOTS ON SHIFT</div>
              <div className="metric-value">
                {robots.length.toString().padStart(2, "0")}
              </div>
              <div className="metric-foot">Fictional fleet profiles</div>
            </div>
            <div className="metric">
              <div className="metric-label">MAINTENANCE MISSIONS</div>
              <div className="metric-value">
                {missions.length.toString().padStart(2, "0")}
              </div>
              <div className="metric-foot">
                Remaining routes checked for impact
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">RESTRICTIONS TO REVIEW</div>
              <div className="metric-value">
                {needsReview.toString().padStart(2, "0")}
              </div>
              <div className="metric-foot">Operator attention required</div>
            </div>
            <div className="metric">
              <div className="metric-label">ACTIVE RESTRICTIONS</div>
              <div className="metric-value">
                {items.filter(active).length.toString().padStart(2, "0")}
              </div>
              <div className="metric-foot">Overdue zones remain active</div>
            </div>
          </section>
          {section === "Connections" ? (
            <IntegrationsPanel onRefresh={() => void reload()} />
          ) : section === "Fleet profiles" ? (
            <section className="full-page-panel">
              <h2>Fleet profiles</h2>
              <p className="page-intro">
                Capability declarations and coordinate alignments below are
                fictional demo configuration. No live fleet adapter or MQTT
                control is enabled.
              </p>
              <div className="profile-grid">
                {robots.map((r) => (
                  <article className="profile-card" key={r.id}>
                    <h3>{r.name}</h3>
                    <p>{r.profile}</p>
                    <div className="profile-meta">
                      <span>Robot mapId</span>
                      <code>{r.mapId}</code>
                      <span>Alignment</span>
                      <b>{r.alignment}</b>
                      <span>Connection</span>
                      <b>{r.connectivity} · simulated</b>
                    </div>
                    <div className="capability-list">
                      {r.capabilities.map((c) => (
                        <div key={c}>
                          <Check size={14} />
                          {c}
                        </div>
                      ))}
                    </div>
                    <p>
                      Designed for future fleet-manager integration; no verified
                      VDA 5050 compliance claim.
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : section === "Missions & routes" ? (
            <section className="full-page-panel">
              <h2>Missions & routes</h2>
              <p className="page-intro">
                Zone application and route replanning are separate
                acknowledgements. All paths are predefined demonstration
                geometry.
              </p>
              {missions.map((m) => (
                <article className="route-card" key={m.id}>
                  <div className="route-card-top">
                    <span
                      className="route-color"
                      style={{ background: m.color }}
                    />
                    <div>
                      <h3>{m.name}</h3>
                      <span>
                        {m.id} · {m.robot} · {m.area}
                      </span>
                    </div>
                    <Badge text={execution(m, items)} />
                  </div>
                  <div className="progress-track">
                    <i
                      style={{ width: `${m.progress}%`, background: m.color }}
                    />
                  </div>
                  <p>
                    {
                      items.filter(
                        (r) => active(r) && r.missionIds.includes(m.id),
                      ).length
                    }{" "}
                    active restrictions intersect this mission.{" "}
                    {m.alternative
                      ? "A predefined alternative is available; confirmation checks other active zones."
                      : "No alternative route is configured."}
                  </p>
                </article>
              ))}
            </section>
          ) : (
            <div className="dashboard-grid">
              <section className="map-card">
                <div className="panel-heading">
                  <div>
                    <div className="panel-kicker">
                      <Crosshair size={13} /> FIELD OVERVIEW · DEMONSTRATION
                      GEOMETRY
                    </div>
                    <h2>Central Aarhus</h2>
                  </div>
                </div>
                <OperationsMap
                  selected={selected}
                  mode={mode}
                  setMode={setMode}
                  robots={robots}
                  missions={missions}
                  restrictions={items}
                  onSelect={choose}
                />
                <div className="map-legend">
                  <span>
                    <i className="legend-line" /> Maintenance route
                  </span>
                  <span>
                    <i className="legend-zone amber" /> Proposed
                  </span>
                  <span>
                    <i className="legend-zone red" /> Approved restriction
                  </span>
                </div>
                <div className="map-status-row">
                  Red indicates approval. Check recipient acknowledgements below
                  to establish application.
                </div>
              </section>
              <section className="incident-card">
                <div className="panel-heading">
                  <div>
                    <div className="panel-kicker">OPERATOR QUEUE</div>
                    <h2>
                      Incidents{" "}
                      <span className="count-bubble">{filtered.length}</span>
                    </h2>
                  </div>
                </div>
                <div className="incident-tools">
                  <div className="search-field">
                    <Search size={15} />
                    <input
                      aria-label="Search incidents"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Find incident or camera…"
                    />
                  </div>
                  <select
                    aria-label="Filter incidents"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "All incidents",
                      "Needs review",
                      "Proposed",
                      "Under review",
                      "Approved",
                      "Rejected",
                      "Review overdue",
                      "Cleared",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="incident-list">
                  {filtered.map((i) => (
                    <button
                      key={i.id}
                      className={`incident-row ${selectedId === i.id ? "selected" : ""}`}
                      onClick={() => choose(i.id)}
                    >
                      <span className="incident-symbol">
                        <AlertTriangle size={16} />
                      </span>
                      <span className="incident-copy">
                        <span className="incident-title">{i.title}</span>
                        <span className="incident-sub">
                          {i.cameraId} ·{" "}
                          {i.source === "simulation"
                            ? "Simulated"
                            : "External camera observation"}
                        </span>
                      </span>
                      <span className="incident-row-end">
                        <Badge text={i.status} />
                      </span>
                    </button>
                  ))}
                  {!filtered.length && (
                    <div className="empty-state">
                      <Eye />
                      <b>
                        {snapshot
                          ? "No matching observations"
                          : "Loading observations…"}
                      </b>
                      <span>
                        Use simulation or configure an analysis source.
                      </span>
                    </div>
                  )}
                </div>
              </section>
              <div className="detail-shell incidents-detail">
                {selected ? (
                  <section className="detail-card">
                    <div className="detail-head">
                      <div>
                        <div className="panel-kicker">
                          {selected.id} · REVISION {selected.revision} ·{" "}
                          {selected.source.toUpperCase()}
                        </div>
                        <h2>{selected.title}</h2>
                        <div className="detail-meta">
                          <Clock3 size={13} />
                          {stamp(selected.observedAt)}
                          <Badge text={selected.status} />
                        </div>
                      </div>
                    </div>
                    <div className="detail-columns">
                      <div className="detail-main">
                        <div className="evidence-block">
                          <div className="subsection-title">
                            OBSERVATION EVIDENCE · {selected.cameraId}
                          </div>
                          {selected.evidenceDataUrl ? (
                            <img
                              className="analysis-preview"
                              src={selected.evidenceDataUrl}
                              alt="Camera frame analyzed for this observation"
                            />
                          ) : (
                            <div className="empty-state">
                              <Eye />
                              <b>
                                {selected.source === "simulation"
                                  ? "Illustrative observation · no camera footage"
                                  : "Plugin result · no image attached"}
                              </b>
                            </div>
                          )}
                          <p className="observation-note">{selected.note}</p>
                          <StreetContext point={selected.center} />
                        </div>
                        <div className="boundary-block">
                          <div className="subsection-title">
                            RESTRICTION BOUNDARY · {selected.polygon.length}{" "}
                            VERTICES
                          </div>
                          <div className="geo-summary">
                            <code>{selected.zoneSetId}</code>
                            <button
                              disabled={
                                disabled ||
                                !["Proposed", "Under review"].includes(
                                  selected.status,
                                )
                              }
                              onClick={() =>
                                setBoundary(
                                  JSON.stringify(
                                    {
                                      type: "Polygon",
                                      coordinates: [
                                        [
                                          ...selected.polygon,
                                          selected.polygon[0],
                                        ].map((p) => [p.lng, p.lat]),
                                      ],
                                    },
                                    null,
                                    2,
                                  ),
                                )
                              }
                            >
                              Edit boundary
                            </button>
                            <button
                              onClick={() =>
                                void navigator.clipboard
                                  ?.writeText(
                                    JSON.stringify({
                                      type: "Polygon",
                                      coordinates: [
                                        [
                                          ...selected.polygon,
                                          selected.polygon[0],
                                        ].map((p) => [p.lng, p.lat]),
                                      ],
                                    }),
                                  )
                                  .then(() => setToast("GeoJSON copied."))
                                  .catch(() =>
                                    setError(
                                      "Clipboard access unavailable. Use the boundary editor to copy the geometry.",
                                    ),
                                  )
                              }
                            >
                              Copy GeoJSON
                            </button>
                          </div>
                          {boundary !== null && (
                            <div className="editor-wrap">
                              <textarea
                                aria-label="GeoJSON boundary"
                                value={boundary}
                                onChange={(e) => setBoundary(e.target.value)}
                              />
                              <div className="editor-actions">
                                <button
                                  disabled={disabled}
                                  className="button button-quiet"
                                  onClick={() => setBoundary(null)}
                                >
                                  Cancel
                                </button>
                                <button
                                  disabled={disabled}
                                  className="button button-primary"
                                  onClick={saveBoundary}
                                >
                                  Save proposed boundary
                                </button>
                              </div>
                            </div>
                          )}
                          <small>
                            Active boundaries remain immutable. Changes to a
                            proposal require a new review.
                          </small>
                        </div>
                        <div className="mission-impact">
                          <div className="subsection-title">
                            AFFECTED REMAINING MISSIONS ·{" "}
                            {selected.missionIds.length}
                          </div>
                          {missions
                            .filter((m) => selected.missionIds.includes(m.id))
                            .map((m) => (
                              <div className="affected-mission" key={m.id}>
                                <Route size={15} />
                                <div>
                                  <b>{m.name}</b>
                                  <small>
                                    {m.robot} · remaining path intersects this
                                    zone
                                  </small>
                                </div>
                                <Badge text={execution(m, items)} />
                              </div>
                            ))}
                          {!selected.missionIds.length && (
                            <p>
                              No remaining demo mission path intersects this
                              zone.
                            </p>
                          )}
                        </div>
                        <details className="dispatch-history">
                          <summary>
                            Audit history · {selected.dispatchLog.length} events
                          </summary>
                          <div className="history-list">
                            {selected.dispatchLog.map((event, index) => (
                              <div
                                className={`history-event ${event.tone}`}
                                key={index}
                              >
                                <i />
                                <div>
                                  <span className="mono">
                                    {stamp(event.at)}
                                  </span>
                                  <p>{event.message}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                      <aside className="detail-side">
                        <div className="review-card">
                          <div className="subsection-title">
                            OPERATOR REVIEW
                          </div>
                          <label className="form-label">
                            Review notes / clearance evidence
                            <textarea
                              aria-label="Review rationale"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Record the evidence behind your decision"
                            />
                          </label>
                          <div className="review-actions">
                            {selected.status === "Proposed" && (
                              <button
                                disabled={disabled}
                                className="button button-primary"
                                data-testid="button-start-review"
                                onClick={() => action("begin_review")}
                              >
                                Begin inspection
                              </button>
                            )}
                            {selected.status === "Under review" && (
                              <button
                                disabled={disabled}
                                className="button button-primary"
                                data-testid="button-approve-restriction"
                                onClick={() => action("approve")}
                              >
                                Approve restriction
                              </button>
                            )}
                            {["Proposed", "Under review"].includes(
                              selected.status,
                            ) && (
                              <button
                                disabled={disabled}
                                className="button button-danger-quiet"
                                onClick={() => action("reject")}
                              >
                                Reject observation
                              </button>
                            )}
                            {active(selected) &&
                              selected.clearance === "none" && (
                                <button
                                  disabled={disabled}
                                  className="button button-quiet"
                                  onClick={() => action("request_clearance")}
                                >
                                  Request clearance review
                                </button>
                              )}
                            {selected.clearance === "review" && (
                              <button
                                disabled={disabled || !reason.trim()}
                                className="button button-primary"
                                onClick={() => action("approve_clearance")}
                              >
                                Approve clearance with notes
                              </button>
                            )}
                          </div>
                          <div className="approval-separation">
                            <Shield size={13} /> Approval, fleet acceptance,
                            robot application and replanning are separate facts.
                          </div>
                          <p>
                            Review by {stamp(selected.expiresAt)}. Overdue
                            restrictions stay active.
                          </p>
                          {selected.source !== "simulation" &&
                            active(selected) && (
                              <button
                                disabled={
                                  disabled || selected.xprotectEventPublished
                                }
                                className="button button-quiet"
                                onClick={() =>
                                  void run(
                                    () =>
                                      request(
                                        `/incidents/${selected.id}/xprotect-event`,
                                        { method: "POST" },
                                      ),
                                    "XProtect accepted the event.",
                                  )
                                }
                              >
                                {selected.xprotectEventPublished
                                  ? "Published to XProtect"
                                  : "Publish event to XProtect"}
                              </button>
                            )}
                        </div>
                        <div className="delivery-card">
                          <div className="subsection-title">
                            RESTRICTION DELIVERY · SIMULATED
                          </div>
                          {selected.source !== "simulation" && (
                            <p>
                              Live observations are reviewable. No live fleet
                              adapter is configured; dispatch to fictional
                              fleets is disabled.
                            </p>
                          )}
                          <label className="form-label">
                            Next simulated submission outcome
                            <select
                              aria-label="Simulated dispatch outcome"
                              value={outcome}
                              onChange={(e) => setOutcome(e.target.value)}
                            >
                              {[
                                "Fleet accepted",
                                "Timed out",
                                "Rejected",
                                "Failed",
                              ].map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                          {Object.entries(selected.recipients).map(
                            ([id, status]) => (
                              <div className="delivery-recipient" key={id}>
                                <div className="recipient-top">
                                  <b>{id}</b>
                                  <Badge text={status} />
                                </div>
                                <small>
                                  {selected.replans[id] === "Confirmed"
                                    ? "Alternative route confirmed · simulated"
                                    : "Replan not confirmed"}
                                </small>
                                {active(selected) &&
                                  selected.clearance === "none" &&
                                  selected.source === "simulation" && (
                                    <div className="recipient-actions">
                                      {status !== "Robot applied" && (
                                        <button
                                          disabled={disabled}
                                          className="text-button"
                                          data-testid={`button-dispatch-${id}`}
                                          onClick={() =>
                                            action("dispatch", id, outcome)
                                          }
                                        >
                                          {status === "Not sent"
                                            ? "Send restriction"
                                            : "Retry submission"}
                                        </button>
                                      )}
                                      {status === "Fleet accepted" && (
                                        <>
                                          <button
                                            disabled={disabled}
                                            className="text-button"
                                            onClick={() =>
                                              action("robot_response", id)
                                            }
                                          >
                                            Simulate robot application
                                          </button>
                                          <button
                                            disabled={disabled}
                                            className="text-button"
                                            onClick={() =>
                                              action(
                                                "robot_response",
                                                id,
                                                "Rejected",
                                              )
                                            }
                                          >
                                            Simulate robot rejection
                                          </button>
                                        </>
                                      )}
                                      {status === "Robot applied" &&
                                        !selected.replans[id] &&
                                        missions.some(
                                          (m) =>
                                            m.robot === id && m.alternative,
                                        ) && (
                                          <button
                                            disabled={disabled}
                                            className="text-button"
                                            onClick={() =>
                                              action("confirm_replan", id)
                                            }
                                          >
                                            Confirm simulated replan
                                          </button>
                                        )}
                                      <button
                                        disabled={disabled}
                                        className="text-button"
                                        onClick={() =>
                                          void run(
                                            async () =>
                                              setPreview(
                                                JSON.stringify(
                                                  await request(
                                                    `/restrictions/${selected.id}/preview?robotId=${encodeURIComponent(id)}`,
                                                  ),
                                                  null,
                                                  2,
                                                ),
                                              ),
                                            "Illustrative adapter preview loaded.",
                                          )
                                        }
                                      >
                                        Adapter preview
                                      </button>
                                    </div>
                                  )}
                              </div>
                            ),
                          )}
                          {!Object.keys(selected.recipients).length && (
                            <p>No affected recipients.</p>
                          )}
                          {preview && (
                            <details open>
                              <summary>Illustrative adapter request</summary>
                              <pre className="integration-output">
                                {preview}
                              </pre>
                            </details>
                          )}
                        </div>
                        {selected.clearance !== "none" && (
                          <div className="review-card">
                            <div className="subsection-title">
                              CLEARANCE · {selected.clearance.toUpperCase()}
                            </div>
                            <small>
                              Restriction remains active until all required
                              recipients confirm clearance application.
                            </small>
                            {Object.entries(selected.clearanceRecipients).map(
                              ([id, status]) => (
                                <div className="delivery-recipient" key={id}>
                                  <b>{id}</b>
                                  <Badge text={status} />
                                  {selected.clearance === "approved" && (
                                    <div className="recipient-actions">
                                      {status !== "Robot applied" && (
                                        <button
                                          disabled={disabled}
                                          className="text-button"
                                          onClick={() =>
                                            action(
                                              "dispatch_clearance",
                                              id,
                                              outcome,
                                            )
                                          }
                                        >
                                          Send / retry clearance
                                        </button>
                                      )}
                                      {status === "Fleet accepted" && (
                                        <button
                                          disabled={disabled}
                                          className="text-button"
                                          onClick={() =>
                                            action("clearance_response", id)
                                          }
                                        >
                                          Simulate clearance applied
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ),
                            )}
                            {selected.clearance === "approved" &&
                              !Object.keys(selected.clearanceRecipients)
                                .length && (
                                <button
                                  disabled={disabled}
                                  className="button button-quiet"
                                  onClick={() => action("close_unsent")}
                                >
                                  Close restriction never dispatched
                                </button>
                              )}
                          </div>
                        )}
                      </aside>
                    </div>
                  </section>
                ) : (
                  <div className="detail-empty">
                    Select an observation to inspect it.
                  </div>
                )}
              </div>
            </div>
          )}
          <footer className="page-footer">
            <span>SMART CITY ROBOOPS · AARHUS</span>
            <span>
              {updatedAt
                ? `Snapshot ${stamp(updatedAt)} · Europe/Copenhagen`
                : "Waiting for service"}{" "}
              · fleet movements and responses simulated
            </span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast-message" role="status">
          {toast}
        </div>
      )}
      {busy && (
        <div className="request-indicator" role="status">
          Recording operation…
        </div>
      )}
    </div>
  );
}
