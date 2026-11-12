import { useEffect, useRef, useState } from "preact/hooks";
import * as bridge from "../io/bridge";
import { pageFileNames, pagePictureRefs } from "../core/project/compile";
import { bridgeProblem, projectZip, refreshBridge } from "./bridgeUi";
import { setState, useStore } from "./store";

const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const STATUS: Record<bridge.FlashFile["status"], string> = {
  pending: "waiting", unchanged: "unchanged (skipped)", skipped: "SD card only", uploading: "uploading",
  done: "done", failed: "failed", cancelled: "cancelled",
};

export function FlashDialog() {
  const s = useStore();
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [verify, setVerify] = useState(false);
  const [reset, setReset] = useState(true);
  const [scope, setScope] = useState<"all" | "page">(s.flashScope);
  const [withRefs, setWithRefs] = useState(true);
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId) ?? null;
  const refs = page ? pagePictureRefs(doc, page.id) : [];
  const only = scope === "page" && page ? pageFileNames(doc, page.id, withRefs) : undefined;
  const [job, setJob] = useState<bridge.FlashJob | null>(null);
  const [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const problem = bridgeProblem();
  const running = job?.state === "running";

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      try {
        const j = await bridge.job(id);
        setJob(j);
        if (j.state === "running") poll(id);
        else void refreshBridge();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }, 500);
  };

  async function start() {
    setErr("");
    try {
      const j = await bridge.flash(projectZip(only), { onlyChanged, verify, reset });
      setJob(j);
      poll(j.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const files = job?.files ?? [];
  const total = files.filter((f) => f.status !== "unchanged" && f.status !== "skipped").reduce((n, f) => n + f.size, 0);
  const done = files.reduce((n, f) => n + (f.status === "done" ? f.size : f.status === "uploading" ? f.done : 0), 0);

  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && !running && setState({ flashOpen: false })}>
      <div class="modal" role="dialog" aria-label="Flash to the screen">
        <h2>Flash to the screen</h2>
        <p class="muted small">
          Uploads the project over serial ({s.bridge ? `${s.bridge.serial}, ${s.bridge.baud} baud` : "no bridge"}).
          Fonts and icons go first, then pictures; the screen restarts at the end. T5UID1.CFG and sounds can only be loaded from an SD card.
        </p>
        {problem && <p class="bad small">{problem}</p>}
        {!job && (
          <>
            <fieldset class="scope">
              <label class="small"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} /> Whole project</label>
              <label class="small">
                <input type="radio" name="scope" checked={scope === "page"} disabled={!page} onChange={() => setScope("page")} />{" "}
                This page{page ? ` (${page.id} ${page.name})` : ""}
              </label>
              {scope === "page" && page && (
                <div class="scope-detail">
                  {refs.length > 0 && (
                    <label class="small"><input type="checkbox" checked={withRefs} onChange={(e) => setWithRefs(e.currentTarget.checked)} />{" "}
                      with the pictures it shows: pages {refs.join(", ")} (pressed states, keypads, popups)</label>
                  )}
                  <p class="muted small">
                    Sends {only!.join(", ")}. Every page's buttons and displays are in {doc.project.touchFile} and {doc.project.variables.file},
                    so those go too (they're small). Icon libraries and fonts aren't included.
                  </p>
                </div>
              )}
            </fieldset>
            <label class="small"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.currentTarget.checked)} /> only files changed since the last flash</label>
            <label class="small"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.currentTarget.checked)} /> verify fonts and icons after writing (slower)</label>
            <label class="small"><input type="checkbox" checked={reset} onChange={(e) => setReset(e.currentTarget.checked)} /> restart the screen when done</label>
          </>
        )}
        {job && (
          <>
            <progress value={done} max={Math.max(1, total)} />
            <p class="small">
              {job.state === "running" ? `Flashing… ${kb(done)} of ${kb(total)} · ${job.elapsed}s` : `${job.state} after ${job.elapsed}s${job.reset ? ", screen restarted" : ""}`}
              {job.error && <span class="bad"> · {job.error}</span>}
            </p>
            <table class="fields flash">
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} class={f.status}>
                    <td class="mono small">{f.name}</td>
                    <td class="small">{kb(f.size)}</td>
                    <td class="small">
                      {f.status === "uploading" && f.total ? `${Math.round((f.done / f.total) * 100)}%` : STATUS[f.status]}
                      {f.error && f.status !== "skipped" && <span class="bad"> · {f.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {err && <p class="bad small">{err}</p>}
        <div class="row end">
          {!job && <button class="small" title="Next flash sends every file" onClick={() => void bridge.forgetFlashed().then(() => alert("The next flash sends every file."), (e) => setErr(String(e)))}>Forget what was flashed</button>}
          {!job && <button class="primary" disabled={!!problem} onClick={() => void start()}>Flash</button>}
          {running && <button onClick={() => void bridge.cancelJob(job!.id)}>Cancel</button>}
          {!running && <button onClick={() => setState({ flashOpen: false })}>Close</button>}
        </div>
      </div>
    </div>
  );
}
