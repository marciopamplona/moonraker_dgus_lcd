import { Inspector } from "./Inspector";
import { SimPanel } from "./SimPanel";
import { VpPanel } from "./VpPanel";
import { setState, useStore } from "./store";

export function Panel() {
  const s = useStore();
  if (s.mode === "simulate") return <aside class="inspector"><SimPanel /></aside>;
  return (
    <aside class="inspector">
      <div class="tabs">
        <button class={s.panel === "inspect" ? "tab active" : "tab"} onClick={() => setState({ panel: "inspect" })}>Inspector</button>
        <button class={s.panel === "vps" ? "tab active" : "tab"} onClick={() => setState({ panel: "vps" })}>VPs</button>
      </div>
      {s.panel === "inspect" ? <Inspector /> : <VpPanel />}
    </aside>
  );
}
