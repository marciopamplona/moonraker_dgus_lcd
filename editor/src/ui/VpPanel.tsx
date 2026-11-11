import { useState } from "preact/hooks";
import { vpClashes, vpUses } from "../core/project/vp";
import { T5UID1 } from "../core/profile/t5uid1";
import { vpHex } from "./controls";
import { goPage, setState, useStore } from "./store";

export function VpPanel() {
  const s = useStore();
  const doc = s.doc!;
  const [filter, setFilter] = useState("");
  const [onlyPage, setOnlyPage] = useState(false);
  const uses = vpUses(doc);
  const clashes = vpClashes(uses);
  const bad = new Set(clashes.flatMap((c) => [c.a, c.b]));
  const q = filter.trim().toLowerCase().replace(/^0x/, "");
  const rows = uses.filter((u) =>
    (!onlyPage || u.page === s.pageId) &&
    (!q || u.vp.toString(16).includes(q) || u.typeName.toLowerCase().includes(q)));
  const open = (page: number, uid: string, kind: "touch" | "display") => {
    goPage(page);
    setState({ selection: { kind, uid } });
  };

  return (
    <>
      <h3>VPs <span class="muted">{new Set(uses.map((u) => u.vp)).size} addresses</span></h3>
      {clashes.length > 0 ? (
        <div class="clashes">
          <p class="bad small">{clashes.length} overlapping range(s):</p>
          <ul>
            {clashes.map((c, i) => (
              <li key={i} class="small">
                <button class="link" onClick={() => open(c.a.page, c.a.uid, c.a.kind)}>{vpHex(c.a.vp)}+{c.a.words}</button>
                {" "}({c.a.typeName}, p{c.a.page}) overlaps{" "}
                <button class="link" onClick={() => open(c.b.page, c.b.uid, c.b.kind)}>{vpHex(c.b.vp)}</button>
                {" "}({c.b.typeName}, p{c.b.page})
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p class="good small">No overlapping VP ranges.</p>
      )}
      <div class="row">
        <input placeholder="Filter: 0x1000 or type" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        <label class="small"><input type="checkbox" checked={onlyPage} onChange={(e) => setOnlyPage(e.currentTarget.checked)} /> this page</label>
      </div>
      <table class="fields vps">
        <thead><tr><th>VP</th><th>words</th><th>page</th><th>control</th></tr></thead>
        <tbody>
          {rows.map((u, i) => (
            <tr key={u.uid + i} class={bad.has(u) ? "clash" : ""} onClick={() => open(u.page, u.uid, u.kind)}>
              <td class="mono">{vpHex(u.vp)}{u.vp < T5UID1.userVp.start && <span class="warn" title="System variable range"> sys</span>}</td>
              <td>{u.words}</td>
              <td>{u.page}</td>
              <td><span class={`dot ${u.kind}`} />{u.typeName}{u.note && <span class="muted small"> · {u.note}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
