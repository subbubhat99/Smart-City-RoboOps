import { useEffect, useRef, useState } from "react";
import { request } from "./services";

type Job = {
  id: string;
  cameraId: string;
  summaryId?: string;
  progress: string;
  startTime: string;
  endTime: string;
  response?: string;
  message?: string;
  incidentId?: string;
};
type Camera = { id: string; name?: string; displayName?: string };
type Prompt = { id: string; title: string };
const terminal = new Set([
  "Completed",
  "Failed",
  "Submission uncertain",
  "Timed out",
  "Submitting",
]);
const utcInput = (date: Date) => date.toISOString().slice(0, 19);

export function HafniaGatewayPanel({ onRefresh }: { onRefresh: () => void }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [camera, setCamera] = useState("");
  const [prompt, setPrompt] = useState("");
  const [start, setStart] = useState(() =>
    utcInput(new Date(Date.now() - 35000)),
  );
  const [end, setEnd] = useState(() => utcInput(new Date(Date.now() - 5000)));
  const [summary, setSummary] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const submitting = useRef(false);
  const refreshParent = useRef(onRefresh);
  refreshParent.current = onRefresh;

  async function loadJobs() {
    const result = await request<{ jobs: Job[] }>("/hafnia/gateway/jobs");
    setJobs(result.jobs);
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gateway request failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(loadJobs);
  }, []);

  const activeKey = jobs
    .filter((j) => !terminal.has(j.progress))
    .map((j) => j.id)
    .join(",");
  useEffect(() => {
    if (!activeKey) return;
    let stopped = false;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        const updates: Job[] = [];
        for (const id of activeKey.split(",")) {
          updates.push(
            await request<Job>(`/hafnia/gateway/jobs/${id}/refresh`, {
              method: "POST",
            }),
          );
        }
        if (!stopped) {
          setJobs((current) =>
            current.map((j) => updates.find((u) => u.id === j.id) || j),
          );
          if (updates.some((j) => terminal.has(j.progress)))
            refreshParent.current();
          setError("");
        }
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : "Status check failed");
          // Stop polling on connection failure; manual Refresh resumes it.
          window.clearInterval(timer);
        }
      } finally {
        inFlight = false;
      }
    }, 4000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeKey]);

  return (
    <article className="profile-card">
      <h3>Hafnia gateway · recorded video</h3>
      <p>
        The backend must run inside the assigned VM. A completed analysis costs
        one gateway request. Status checks and importing an existing summary do
        not submit video again.
      </p>
      <div className="integration-actions">
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await request<{ array: Camera[] }>(
                "/xprotect/cameras",
              );
              if (!Array.isArray(result.array))
                throw new Error("Unexpected XProtect camera response");
              setCameras(result.array);
            })
          }
        >
          Load XProtect cameras
        </button>
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await request<{
                prompts: Prompt[];
                totalCount: number;
              }>("/hafnia/gateway/prompts");
              setPrompts(result.prompts);
              if (result.totalCount > result.prompts.length)
                throw new Error(
                  "Only the first 100 prompts are shown. Remove unused prompts in the gateway.",
                );
            })
          }
        >
          Load saved gateway prompts
        </button>
        <button
          className="button button-quiet"
          disabled={busy}
          onClick={() => void run(loadJobs)}
        >
          Reload saved jobs
        </button>
      </div>
      <label className="form-label">
        XProtect camera
        <select
          value={camera}
          onChange={(e) => {
            setCamera(e.target.value);
            setConsent(false);
          }}
        >
          <option value="">Select a camera</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName || c.name || c.id}
            </option>
          ))}
        </select>
      </label>
      {camera && (
        <p>
          Camera ID: <code>{camera}</code>
        </p>
      )}
      <label className="form-label">
        Saved gateway prompt (select the one linked to your rule)
        <select
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setConsent(false);
          }}
        >
          <option value="">Select a saved prompt</option>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {p.id}
            </option>
          ))}
        </select>
      </label>
      <p>
        Both fields below use <strong>UTC</strong>, regardless of the browser
        timezone. Choose recorded footage from the last 24 hours; maximum
        duration 120 seconds.
      </p>
      <label className="form-label">
        Clip start (UTC)
        <input
          type="datetime-local"
          step="1"
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            setConsent(false);
          }}
        />
      </label>
      <label className="form-label">
        Clip end (UTC)
        <input
          type="datetime-local"
          step="1"
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
            setConsent(false);
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I intend to submit one new clip analysis against the daily allowance.
      </label>
      <button
        className="button button-primary"
        disabled={busy || !consent || !camera || !prompt || !start || !end}
        onClick={() =>
          void run(async () => {
            if (submitting.current) return;
            submitting.current = true;
            setConsent(false);
            try {
              await request<Job>("/hafnia/gateway/jobs", {
                method: "POST",
                body: JSON.stringify({
                  requestId: crypto.randomUUID(),
                  cameraId: camera,
                  promptId: prompt,
                  startTime: new Date(start + "Z").toISOString(),
                  endTime: new Date(end + "Z").toISOString(),
                }),
              });
              await loadJobs();
              refreshParent.current();
            } catch (e) {
              await loadJobs().catch(() => {});
              throw e;
            } finally {
              submitting.current = false;
            }
          })
        }
      >
        Analyze recorded clip · one request
      </button>

      <hr />
      <h4>Import a summary already generated in Smart Client</h4>
      <p>
        Copy its summary ID from gateway History or Swagger. Importing does not
        run the VLM again. A confirmed obstruction creates a proposed incident
        only after its camera zone is configured.
      </p>
      <label className="form-label">
        Existing summary ID
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Summary UUID"
        />
      </label>
      <button
        className="button button-quiet"
        disabled={busy || !summary.trim()}
        onClick={() =>
          void run(async () => {
            await request<Job>("/hafnia/gateway/import", {
              method: "POST",
              body: JSON.stringify({ summaryId: summary.trim() }),
            });
            await loadJobs();
            refreshParent.current();
          })
        }
      >
        Import existing result · no new analysis
      </button>

      {busy && <p role="status">Contacting the backend…</p>}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {jobs.map((job) => (
        <details key={job.id} open={jobs[0]?.id === job.id}>
          <summary>
            {job.progress} · {job.summaryId || job.id}
            {job.incidentId ? ` · incident ${job.incidentId}` : ""}
          </summary>
          <p>
            Camera: {job.cameraId}
            <br />
            UTC: {job.startTime} → {job.endTime}
          </p>
          {job.message && <p>{job.message}</p>}
          {job.response && (
            <pre className="integration-output">{job.response}</pre>
          )}
          <button
            disabled={busy || !job.summaryId}
            className="button button-quiet"
            onClick={() =>
              void run(async () => {
                await request<Job>(`/hafnia/gateway/jobs/${job.id}/refresh`, {
                  method: "POST",
                });
                await loadJobs();
                refreshParent.current();
              })
            }
          >
            Refresh result · no new analysis
          </button>
        </details>
      ))}
    </article>
  );
}
