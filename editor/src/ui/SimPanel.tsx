import { useState } from "preact/hooks";
import { DGUS_RELOADED_RULES, hostRules } from "../core/sim/host";
import type { HostRule } from "../core/project/schema";
import { pageControls, vpHex } from "./controls";
import { parseNumber } from "./Inspector";
import { edit, resetSim, simChanged, useStore } from "./store";

function setRules(rules: HostRule[]) {
  edit((d) => void (d.project.sim = { rules }));
}

function RuleEditor({ rules, detected }: { rules: HostRule[]; detected: boolean }) {
  const [vp, setVp] = useState("");
  const [value, setValue] = useState("");
  const [page, setPage] = useState("");
  const [err, setErr] = useState("");

  const add = () => {
    const v = parseNumber(vp);
    const val = value.trim() ? parseNumber(value) : undefined;
    const pg = page.trim() ? parseNumber(page) : undefined;
    if (v === null || val === null || pg === null) return setErr("VP, value and page must be numbers");
    if ((val === undefined) !== (pg === undefined)) return setErr("Give both value and page, or neither");
    setErr("");
    setRules([...rules, { vp: v, ...(val !== undefined ? { value: val, page: pg } : {}) }]);
    setVp(""); setValue(""); setPage("");
  };

  return (
    <>
      <h4>Host page switches</h4>
      <p class="muted small">
        The printer service, not the screen, switches pages when it receives some key codes.
        These rules stand in for it.
        {detected && rules.length > 0 && " Detected DGUS-reloaded; edit to keep your own."}
      </p>
      <ul class="rules small">
        {rules.map((r, i) => (
          <li key={i}>
            <span class="mono">{vpHex(r.vp)}</span>{" "}
            {r.value === undefined ? "→ page = value" : `= ${r.value} → page ${r.page}`}
            {r.note && <span class="muted"> · {r.note}</span>}
            <button class="ghost small" title="Remove" onClick={() => setRules(rules.filter((_, k) => k !== i))}>✕</button>
          </li>
        ))}
        {!rules.length && <li class="muted">No rules: only the screen's own page jumps (Pic_Next) work.</li>}
      </ul>
      <div class="rule-form">
        <input class="mono" placeholder="VP 0x2000" value={vp} onInput={(e) => setVp(e.currentTarget.value)} />
        <input class="mono" placeholder="value (any)" value={value} onInput={(e) => setValue(e.currentTarget.value)} />
        <input class="mono" placeholder="page (= value)" value={page} onInput={(e) => setPage(e.currentTarget.value)} />
        <button class="small" onClick={add}>Add</button>
      </div>
      {err && <p class="bad small">{err}</p>}
      <button class="small" onClick={() => setRules(DGUS_RELOADED_RULES.map((r) => ({ ...r })))}>Use DGUS-reloaded rules</button>
    </>
  );
}

export function SimPanel() {
  const s = useStore();
  const doc = s.doc!;
  const page = doc.project.pages.find((p) => p.id === s.pageId);
  const vps = page
    ? [...new Set(pageControls(doc, page).map((p) => p.info.vp).filter((v): v is number => v !== null))].sort((a, b) => a - b)
    : [];
  const log = s.sim.log.slice(-40).reverse();
  const { rules, detected } = hostRules(doc);

  return (
    <>
      <h3>Simulator</h3>
      <p class="muted small">
        Click buttons on the screen. Set VP values here to see what displays show; use the page
        list to switch pages by hand.
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
            {e.type === "jump" && `→ page ${e.page}${e.via === "host" ? " (host)" : ""}`}
            {e.type === "info" && e.text}
          </li>
        ))}
        {!log.length && <li class="muted">Nothing yet.</li>}
      </ul>
      <RuleEditor rules={rules} detected={detected} />
    </>
  );
}
