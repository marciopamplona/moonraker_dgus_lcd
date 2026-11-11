import { pageControls, vpHex } from "./controls";
import { parseNumber } from "./Inspector";
import { resetSim, simChanged, useStore } from "./store";

export function SimPanel() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  const vps = page
    ? [...new Set(pageControls(doc, page).map((p) => p.info.vp).filter((v): v is number => v !== null))].sort((a, b) => a - b)
    : [];
  const log = s.sim.log.slice(-40).reverse();

  return (
    <>
      <h3>Simulator</h3>
      <p class="muted small">
        Click buttons on the screen. The printer service isn't simulated: set VP values here to see
        what displays show, and use the page list to switch pages.
      </p>
      <button class="small" onClick={resetSim}>Reset VPs</button>
      <h4>VPs on this page</h4>
      <table class="fields">
        <tbody>
          {vps.map((vp) => (
            <tr key={vp}>
              <td class="mono">{vpHex(vp)}</td>
              <td>
                <input class="mono num" value={String(s.sim.get(vp))} key={`${vp}:${s.simTick}`}
                  title="16-bit word (decimal or 0x…)"
                  onChange={(e) => {
                    const v = parseNumber(e.currentTarget.value);
                    if (v === null) return;
                    s.sim.set(vp, v);
                    simChanged();
                  }} />
              </td>
              <td class="muted small mono">0x{s.sim.get(vp).toString(16).padStart(4, "0")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Events</h4>
      <ul class="log small mono">
        {log.map((e, i) => (
          <li key={i}>
            {e.type === "write" && `write ${vpHex(e.vp)} = ${e.value}${e.words > 1 ? ` (${e.words} words)` : ""} · ${e.source}`}
            {e.type === "key" && `key code 0x${e.code.toString(16).padStart(4, "0")}`}
            {e.type === "jump" && `→ page ${e.page}`}
            {e.type === "info" && e.text}
          </li>
        ))}
        {!log.length && <li class="muted">Nothing yet.</li>}
      </ul>
    </>
  );
}
