import { useEffect, useState } from "react";
import { getToken, request, setToken } from "./services";

type Status = {
  obstructionEventImportConfigured: boolean;
  xprotect: { configured: boolean; eventPublishingConfigured: boolean };
  hafnia: { configured: boolean; webhookConfigured: boolean; profile: string };
  cameraZones: { cameraId: string; mapId: string; label: string }[];
};
export function IntegrationsPanel({ onRefresh }: { onRefresh: () => void }) {
  const [status, setStatus] = useState<Status>();
  const [token, updateToken] = useState(getToken());
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState("");
  const [image, setImage] = useState("");
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await job();
      setOutput(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    const next = await request<Status>("/integrations");
    setStatus(next);
    setCamera((c) => c || next.cameraZones[0]?.cameraId || "");
    return next;
  };
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <section className="full-page-panel integration-panel">
      <div className="panel-heading">
        <div>
          <div className="panel-kicker">CONNECTIONS & EVIDENCE</div>
          <h2>XProtect & Hafnia</h2>
        </div>
        <span className="sim-tag">FLEETS REMAIN SIMULATED</span>
      </div>
      <p className="page-intro">
        The Python service connects to your private developer environment.
        Configure URLs, credentials, certificates, and surveyed camera zones in
        backend/.env. Connection status below means configured, not verified
        reachable.
      </p>
      <label className="form-label">
        Operator session token
        <input
          type="password"
          value={token}
          onChange={(e) => updateToken(e.target.value)}
          autoComplete="off"
          placeholder="Required when configured on the server"
        />
      </label>
      <button
        className="button button-quiet"
        onClick={() => {
          setToken(token);
          void run(async () => {
            const result = await load();
            onRefresh();
            return result;
          });
        }}
      >
        Save session & reconnect
      </button>
      <small className="integration-hint">
        Token stays in this tab's session storage. Provider credentials belong
        on the server.
      </small>
      <div className="profile-grid">
        <article className="profile-card">
          <h3>XProtect VMS</h3>
          <p>
            {status?.xprotect.configured
              ? "Configured · connection not yet verified"
              : "Not configured"}
          </p>
          <div className="integration-actions">
            <button
              disabled={busy || !status?.xprotect.configured}
              className="button button-quiet"
              onClick={() => void run(() => request("/xprotect/cameras"))}
            >
              Test camera access
            </button>
            <button
              disabled={busy || !status?.xprotect.configured}
              className="button button-quiet"
              onClick={() => void run(() => request("/xprotect/events"))}
            >
              Read recent events
            </button>
            <button
              disabled={
                busy ||
                !status?.xprotect.configured ||
                !status?.obstructionEventImportConfigured
              }
              className="button button-quiet"
              onClick={() =>
                void run(async () => {
                  const result = await request("/xprotect/import-events", {
                    method: "POST",
                  });
                  onRefresh();
                  return result;
                })
              }
            >
              Import obstruction events
            </button>
          </div>
          <p>
            Camera configuration and recent events use the API Gateway. Video
            streaming needs the environment's media API configuration; a
            camera-list response does not establish video access.
          </p>
        </article>
        <article className="profile-card">
          <h3>Hafnia analysis</h3>
          <p>
            {status?.hafnia.configured
              ? "Endpoint profile configured · unverified"
              : "Direct inference not configured"}
          </p>
          <p>
            Analyze an exported camera frame after checking the configured
            endpoint supports the documented OpenAI-compatible image profile.
            Camera-zone boundaries are surveyed configuration, never coordinates
            guessed by the VLM.
          </p>
          <label className="form-label">
            Surveyed camera zone
            <select
              aria-label="Analysis camera"
              value={camera}
              onChange={(e) => setCamera(e.target.value)}
            >
              <option value="">Select a configured camera</option>
              {status?.cameraZones.map((z) => (
                <option key={z.cameraId} value={z.cameraId}>
                  {z.label} · {z.mapId}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Camera frame (JPEG/PNG, max 4 MB)
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setImage("");
                if (!f) return;
                if (f.size > 4000000) {
                  setError("Use a JPEG/PNG under 4 MB");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => setImage(String(reader.result));
                reader.onerror = () => setError("Could not read image");
                reader.readAsDataURL(f);
              }}
            />
          </label>
          {image && (
            <img
              className="analysis-preview"
              src={image}
              alt="Selected camera frame for analysis"
            />
          )}
          <button
            disabled={busy || !image || !camera || !status?.hafnia.configured}
            className="button button-primary"
            onClick={() =>
              void run(async () => {
                const result = await request("/hafnia/analyze", {
                  method: "POST",
                  body: JSON.stringify({
                    cameraId: camera,
                    imageDataUrl: image,
                  }),
                });
                onRefresh();
                return result;
              })
            }
          >
            Analyze frame & propose incident
          </button>
          <p>
            Plugin results can also arrive through the authenticated
            /api/v1/hafnia/observations endpoint. Its normalized webhook
            contract requires an adapter to the actual plugin output.
          </p>
        </article>
      </div>
      {busy && <p role="status">Waiting for the service…</p>}
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {output && (
        <details open>
          <summary>Connection response</summary>
          <pre className="integration-output">{output}</pre>
        </details>
      )}
    </section>
  );
}
