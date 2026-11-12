import { useEffect, useState } from "preact/hooks";
import * as idb from "../io/idb";
import { importFolder, newBlank, openFile, openStored } from "./actions";
import * as bridge from "../io/bridge";
import { newFromTemplate, openFromPi } from "./bridgeUi";
import { useStore } from "./store";
import { FilePickers } from "./Toolbar";

function PiSection() {
  const s = useStore();
  const [list, setList] = useState<bridge.StoredProject[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const refresh = () => bridge.listProjects().then(setList, (e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => void (s.bridge && refresh()), [!!s.bridge]);
  if (!s.bridge) return null;
  return (
    <>
      <h2>On the Pi</h2>
      <div class="row">
        {s.bridge.templates.map((t) => (
          <button key={t.id} disabled={loading !== null} onClick={() => {
            setLoading("0%");
            void newFromTemplate(t.id, t.name, (d, n) => setLoading(`${Math.round((d / n) * 100)}%`)).finally(() => setLoading(null));
          }}>New from {t.name}{loading ? ` (${loading})` : ""}</button>
        ))}
      </div>
      {err && <p class="bad small">{err}</p>}
      {list && !list.length && <p class="muted small">No projects saved on the Pi yet (use “Save to Pi”).</p>}
      {list && list.length > 0 && (
        <ul class="recent">
          {list.map((p) => (
            <li key={p.id}>
              <button class="link" onClick={() => void openFromPi(p.id)}>{p.name}</button>
              <span class="muted small">{p.pages} pages · {p.modified ? new Date(p.modified).toLocaleString() : ""}</span>
              <button class="ghost small" onClick={() => confirm(`Delete "${p.name}" from the Pi?`) && void bridge.deleteProject(p.id).then(refresh)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Welcome() {
  const [recent, setRecent] = useState<idb.ProjectSummary[] | null>(null);
  const [err, setErr] = useState("");
  const refresh = () =>
    idb.available()
      ? idb.listProjects().then(setRecent, (e: unknown) => setErr(String(e)))
      : setErr("This browser has no IndexedDB, so projects can't be kept between visits.");
  useEffect(() => void refresh(), []);

  async function remove(p: idb.ProjectSummary) {
    if (!confirm(`Delete "${p.name}" from browser storage? This can't be undone.`)) return;
    await idb.deleteProject(p.id);
    void refresh();
  }

  return (
    <div class="welcome">
      <h1>DGUS Studio</h1>
      <p class="muted">Editor for DWIN DGUS II (T5UID1) screen projects. Everything stays in this browser.</p>
      <div class="row">
        <button class="primary" onClick={() => void newBlank()}>New blank project</button>
        <FilePickers onFolder={importFolder} onFile={openFile} />
      </div>
      <p class="muted small">Or drop a DWIN_SET folder, a DWIN_SET .zip or a .dgusproj file anywhere on this page.</p>
      <PiSection />
      <h2>Projects in this browser</h2>
      {err && <p class="bad">{err}</p>}
      {recent && !recent.length && <p class="muted">None yet.</p>}
      {recent && recent.length > 0 && (
        <ul class="recent">
          {recent.map((p) => (
            <li key={p.id}>
              <button class="link" onClick={() => void openStored(p.id)}>{p.name}</button>
              <span class="muted small">{p.pages} pages · {new Date(p.modified).toLocaleString()}</span>
              <button class="ghost small" title="Delete from browser storage" onClick={() => void remove(p)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
