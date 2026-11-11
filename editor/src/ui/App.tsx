import { useEffect, useRef, useState } from "preact/hooks";
import type { Bitmap } from "../core";
import { inspect, type FileReport } from "./inspect";

function Preview({ bm }: { bm: Bitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = bm.w;
    c.height = bm.h;
    c.getContext("2d")!.putImageData(new ImageData(bm.toRGBA(), bm.w, bm.h), 0, 0);
  }, [bm]);
  return <canvas ref={ref} class="thumb" />;
}

export function App() {
  const [reports, setReports] = useState<FileReport[]>([]);

  async function load(files: FileList | null) {
    if (!files) return;
    const out: FileReport[] = [];
    for (const f of Array.from(files).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(inspect(f.name, new Uint8Array(await f.arrayBuffer())));
    }
    setReports(out);
  }

  const bad = reports.filter((r) => r.status === "differs" || r.status === "error").length;
  return (
    <main>
      <header>
        <h1>DGUS Studio</h1>
        <p class="muted">M0 codec check — pick a DWIN_SET folder. Files are read locally and never uploaded.</p>
        <label class="button">
          Open DWIN_SET folder
          {/* @ts-expect-error non-standard but widely supported */}
          <input type="file" webkitdirectory multiple hidden onChange={(e) => load((e.target as HTMLInputElement).files)} />
        </label>
      </header>
      {reports.length > 0 && (
        <p class={bad ? "bad" : "good"}>
          {reports.length} files, {bad ? `${bad} with problems` : "all codecs round-trip"}
        </p>
      )}
      <table>
        <tbody>
          {reports.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td class="muted">{r.kind}</td>
              <td class={`status ${r.status}`}>{r.status}</td>
              <td>{r.detail}</td>
              <td>{r.preview && <Preview bm={r.preview} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
