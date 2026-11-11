import { useEffect, useState } from "preact/hooks";
import * as idb from "../io/idb";
import { importFolder, newBlank, openFile, openStored } from "./actions";
import { FilePickers } from "./Toolbar";

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
