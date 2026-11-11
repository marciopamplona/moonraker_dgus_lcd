import { formatField } from "../core/controls/describe";
import { pageControls, vpHex } from "./controls";
import { setState, useStore } from "./store";

function hexDump(b: Uint8Array): string {
  const rows: string[] = [];
  for (let i = 0; i < b.length; i += 16) {
    rows.push(i.toString(16).padStart(2, "0") + "  " +
      Array.from(b.subarray(i, i + 16), (x) => x.toString(16).padStart(2, "0")).join(" "));
  }
  return rows.join("\n");
}

export function Inspector() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  if (!page) return <aside class="inspector" />;
  const placed = pageControls(doc, page);
  const cur = placed.find((p) => p.control.uid === s.selection?.uid);

  if (!cur) {
    return (
      <aside class="inspector">
        <h3>Page {page.id}: {page.name}</h3>
        <dl>
          <dt>Picture</dt><dd>{page.background ?? "none"}</dd>
          <dt>Touch areas</dt><dd>{page.touch.length}</dd>
          <dt>Display variables</dt><dd>{page.display.length}</dd>
        </dl>
        <h4>Controls</h4>
        <ul class="ctl-list">
          {placed.map((p) => (
            <li key={p.control.uid}>
              <button class="link" onClick={() => setState({ selection: { kind: p.kind, uid: p.control.uid } })}>
                <span class={`dot ${p.kind}`} />{p.info.typeName}
              </button>
              <span class="muted small">{vpHex(p.info.vp)}</span>
            </li>
          ))}
        </ul>
        {s.warnings.length > 0 && (
          <>
            <h4>Import notes</h4>
            <ul class="warnings">{s.warnings.map((w, i) => <li key={i} class="warn small">{w}</li>)}</ul>
          </>
        )}
      </aside>
    );
  }

  const i = cur.info;
  return (
    <aside class="inspector">
      <button class="ghost small" onClick={() => setState({ selection: null })}>← page</button>
      <h3><span class={`dot ${cur.kind}`} />{i.typeName}</h3>
      <p class="muted small">
        {cur.kind === "touch" ? "Touch area (13*.BIN)" : "Display variable (14*.BIN)"} · VP {vpHex(i.vp)}
        {i.bounds && ` · (${i.bounds[0]}, ${i.bounds[1]})–(${i.bounds[2]}, ${i.bounds[3]})`}
        {i.estimated && " · size estimated"}
      </p>
      {i.jumpTo !== null && (
        <button class="link" onClick={() => setState({ pageId: i.jumpTo!, selection: null })}>Go to page {i.jumpTo} →</button>
      )}
      <table class="fields">
        <tbody>
          {i.fields.map((f) => (
            <tr key={f.name + f.off}>
              <td class="muted small">{f.off.toString(16).padStart(2, "0")}</td>
              <td title={f.note}>{f.name}</td>
              <td class="mono">{formatField(f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">Read-only for now; editing comes in M2.</p>
      <pre class="hex">{hexDump(cur.bytes)}</pre>
    </aside>
  );
}
