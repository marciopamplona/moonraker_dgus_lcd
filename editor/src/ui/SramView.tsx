import { useState } from "preact/hooks";
import { getCfg, setCfg, setSramRuns, textWords } from "../core/files/ops";
import { SramInit, type InitRun } from "../core/formats/config22";
import { vpUses } from "../core/project/vp";
import { vpHex } from "./controls";
import { parseNumber } from "./Inspector";
import { edit, useStore } from "./store";

function words(s: string): number[] | null {
  const parts = s.split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const v = parseNumber(p);
    if (v === null || v < -0x8000 || v > 0xffff) return null;
    out.push(v & 0xffff);
  }
  return out;
}

export function SramView({ name }: { name: string }) {
  const s = useStore();
  const doc = s.doc!;
  const data = doc.assets.get(name)!;
  const runs = SramInit.parse(data).runs();
  const cfg = getCfg(doc);
  const uses = vpUses(doc);
  const [vp, setVp] = useState("");
  const [val, setVal] = useState("");
  const [asText, setAsText] = useState(false);
  const [err, setErr] = useState("");
  const save = (next: InitRun[]) => edit((d) => setSramRuns(d, next));

  return (
    <section class="stage fileview">
      <h2>{name} <span class="muted small">initial VP values · {data.length / 2} words</span></h2>
      {cfg && !cfg.init22 && (
        <p class="warn small">
          The CFG doesn't load this file at start-up.{" "}
          <button class="link" onClick={() => edit((d) => setCfg(d, { ...getCfg(d)!, init22: true }))}>Turn it on</button>
        </p>
      )}
      <p class="muted small">Values the VPs have at power on (otherwise 0). Words are 16-bit; text is stored two characters per word.</p>
      <table class="fields sram">
        <thead><tr><th>VP</th><th>words</th><th>used by</th><th /></tr></thead>
        <tbody>
          {runs.map((r, i) => {
            const users = [...new Set(uses.filter((u) => u.vp >= r.vp && u.vp < r.vp + r.words.length).map((u) => `${u.typeName} (p${u.page})`))];
            return (
              <tr key={r.vp}>
                <td class="mono">{vpHex(r.vp)}</td>
                <td class="mono small">{r.words.slice(0, 12).map((w) => "0x" + w.toString(16).padStart(4, "0")).join(" ")}{r.words.length > 12 ? ` … (${r.words.length})` : ""}</td>
                <td class="small">{users.join(", ") || <span class="muted">—</span>}</td>
                <td><button class="ghost small" title="Remove" onClick={() => save(runs.filter((_, k) => k !== i))}>✕</button></td>
              </tr>
            );
          })}
          {!runs.length && <tr><td colSpan={4} class="muted">All VPs start at 0.</td></tr>}
        </tbody>
      </table>
      <div class="rule-form sram-form">
        <input class="mono" placeholder="VP 0x1000" value={vp} onInput={(e) => setVp(e.currentTarget.value)} />
        <input class="mono" placeholder={asText ? "text" : "words: 1 2 0x10"} value={val} onInput={(e) => setVal(e.currentTarget.value)} />
        <label class="small"><input type="checkbox" checked={asText} onChange={(e) => setAsText(e.currentTarget.checked)} /> text</label>
        <button class="small" onClick={() => {
          const v = parseNumber(vp);
          const w = asText ? textWords(val) : words(val);
          if (v === null || !w || !w.length) return setErr("Need a VP and at least one value");
          setErr("");
          const map = new Map<number, number>();
          for (const r of runs) r.words.forEach((x, k) => map.set(r.vp + k, x));
          w.forEach((x, k) => map.set(v + k, x));
          const next = SramInit.fromRuns([...map].map(([a, x]) => ({ vp: a, words: [x] })), data.length).runs();
          if (edit((d) => (setSramRuns(d, next), true))) { setVp(""); setVal(""); }
        }}>Set</button>
      </div>
      {err && <p class="bad small">{err}</p>}
    </section>
  );
}
