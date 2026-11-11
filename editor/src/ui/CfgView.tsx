import { getCfg, setCfg } from "../core/files/ops";
import { CFG_BAUD_CLOCK, actualBaud, baudValue, type T5uid1Config } from "../core/formats/cfg";
import { edit, useStore } from "./store";

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 921600];

function possible(b: number): number | null {
  try {
    return baudValue(b);
  } catch {
    return null;
  }
}

export function CfgView({ name }: { name: string }) {
  const s = useStore();
  const doc = s.doc!;
  const c = getCfg(doc);
  if (!c) return <section class="stage fileview"><p>No CFG.</p></section>;
  const set = (patch: Partial<T5uid1Config>, key?: string) =>
    edit((d) => setCfg(d, { ...getCfg(d)!, ...patch }), key ? { coalesce: `cfg:${key}` } : {});
  const baud = actualBaud(c.baudValue);
  const check = (k: keyof T5uid1Config, label: string, note?: string) => (
    <label class="prop"><span title={note}>{label}</span>
      <input type="checkbox" checked={c[k] as boolean} onChange={(e) => set({ [k]: e.currentTarget.checked } as Partial<T5uid1Config>)} /></label>
  );

  return (
    <section class="stage fileview">
      <h2>{name} <span class="muted small">hardware configuration (read from the SD card only)</span></h2>
      <div class="cfg">
        <fieldset>
          <legend>Serial</legend>
          <label class="prop"><span>Baud rate</span>
            <select value={String(c.baudValue)} onChange={(e) => set({ baudValue: Number(e.currentTarget.value) })}>
              {!BAUDS.some((b) => possible(b) === c.baudValue) && <option value={String(c.baudValue)}>{Math.round(baud)} (custom)</option>}
              {BAUDS.map((b) => {
                const v = possible(b);
                return v === null ? null : (
                  <option key={b} value={String(v)}>{b}{Math.abs(actualBaud(v) - b) / b > 0.002 ? ` (really ${Math.round(actualBaud(v))})` : ""}</option>
                );
              })}
            </select></label>
          <p class="muted small">UART2 = {CFG_BAUD_CLOCK} / {c.baudValue} = {Math.round(baud)} baud. If you change it, set the same <code>baud:</code> in dgus_lcd.cfg and pass <code>-b</code> to dgustool.</p>
          {check("autoUpload", "Auto-upload touch changes", "Send VP changes to the host on its own (System_Config1 .7)")}
          {check("uartCrc", "CRC on UART2")}
        </fieldset>
        <fieldset>
          <legend>Display</legend>
          <label class="prop"><span>Rotation</span>
            <select value={String(c.rotation)} onChange={(e) => set({ rotation: Number(e.currentTarget.value) as 0 })}>
              {[0, 90, 180, 270].map((r) => <option key={r} value={String(r)}>{r}°</option>)}
            </select></label>
          {check("controls128", "128 display controls per page", "Else 64 (System_Config1 .6)")}
          {check("syncUpdate", "Synchronous display update")}
          <label class="prop"><span>Boot page</span>
            <span class="field-edit">
              <input type="checkbox" checked={c.bootPageEn} onChange={(e) => set({ bootPageEn: e.currentTarget.checked })} />
              <select value={String(c.bootPage)} disabled={!c.bootPageEn} onChange={(e) => set({ bootPage: Number(e.currentTarget.value) })}>
                {!doc.project.pages.some((p) => p.id === c.bootPage) && <option value={String(c.bootPage)}>{c.bootPage} (missing)</option>}
                {doc.project.pages.map((p) => <option key={p.id} value={String(p.id)}>{p.id} {p.name}</option>)}
              </select>
            </span></label>
        </fieldset>
        <fieldset>
          <legend>Backlight</legend>
          {check("ledSetEn", "Dim when idle")}
          <label class="prop"><span>Brightness on / idle</span>
            <span class="field-edit">
              <input type="number" class="num" min={0} max={100} value={c.ledOn} disabled={!c.ledSetEn}
                onChange={(e) => set({ ledOn: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} />
              <input type="number" class="num" min={0} max={100} value={c.ledIdle} disabled={!c.ledSetEn}
                onChange={(e) => set({ ledIdle: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} />
            </span></label>
          <label class="prop"><span>Idle after (s)</span>
            <input type="number" class="num" min={0} max={327} step={0.5} value={(c.ledIdleTime * 5) / 1000} disabled={!c.ledSetEn}
              onChange={(e) => set({ ledIdleTime: Math.max(0, Math.min(0xffff, Math.round((Number(e.currentTarget.value) || 0) * 200))) })} /></label>
          {check("backlightStandby", "Backlight standby control")}
        </fieldset>
        <fieldset>
          <legend>Sound and touch</legend>
          {check("touchTone", "Touch click")}
          {check("buzzer", "Use the buzzer (else the audio player)")}
          <label class="prop"><span>Boot sound</span>
            <span class="field-edit">
              <input type="checkbox" checked={c.bootMusicEn} onChange={(e) => set({ bootMusicEn: e.currentTarget.checked })} />
              <input type="number" class="num" min={0} max={255} value={c.bootMusic.id} disabled={!c.bootMusicEn} title="WAV id"
                onChange={(e) => set({ bootMusic: { ...c.bootMusic, id: Number(e.currentTarget.value) & 0xff } })} />
              <input type="number" class="num" min={0} max={255} value={c.bootMusic.volume} disabled={!c.bootMusicEn} title="Volume"
                onChange={(e) => set({ bootMusic: { ...c.bootMusic, volume: Number(e.currentTarget.value) & 0xff } })} />
            </span></label>
        </fieldset>
        <fieldset>
          <legend>Start-up</legend>
          {check("sdEnabled", "SD card interface")}
          {check("init22", "Load 22*.BIN initial values")}
          {check("watchdog", "Hardware watchdog")}
        </fieldset>
      </div>
      <p class="muted small">Bytes this form doesn't show are kept as they are.</p>
    </section>
  );
}
