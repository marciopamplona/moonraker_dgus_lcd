// Editor actions that go through the Pi bridge.
import { compile } from "../core/project/compile";
import { decompile } from "../core/project/decompile";
import type { SimEvent } from "../core/sim/simulator";
import * as bridge from "../io/bridge";
import { loadDgusproj, saveDgusproj } from "../io/dgusproj";
import { zipDwinSet } from "../io/dwinset";
import { flushSave, getState, openDoc, setState } from "./store";

export async function refreshBridge(): Promise<void> {
  const info = await bridge.detect();
  const cur = getState().bridge;
  if (JSON.stringify(info) !== JSON.stringify(cur)) setState({ bridge: info });
}

export function bridgeProblem(): string | null {
  const b = getState().bridge;
  if (!b) return "No Pi bridge: open the editor from python -m dgus_lcd.editor_bridge";
  if (b.service_running && !b.force) return "The dgus_lcd service is using the screen: sudo systemctl stop dgus_lcd";
  if (b.busy) return "A flash is in progress";
  return null;
}

const fail = (e: unknown) => alert(e instanceof Error ? e.message : String(e));

/** The project as the DWIN_SET zip the bridge flashes. */
export function projectZip(): Uint8Array {
  return zipDwinSet(compile(getState().doc!));
}

export async function showOnScreen(): Promise<void> {
  const page = getState().pageId;
  if (page === null) return;
  try {
    await bridge.showPage(page);
  } catch (e) {
    fail(e);
  }
}

/** Mirror simulator effects (VP writes, page jumps) to the screen. */
export async function mirror(events: SimEvent[]): Promise<void> {
  const s = getState();
  if (!s.mirror || !s.bridge) return;
  try {
    for (const ev of events) {
      if (ev.type === "write") {
        const words = Array.from({ length: ev.words }, (_, i) => s.sim.get(ev.vp + i));
        await bridge.writeVp(ev.vp, words);
      } else if (ev.type === "jump") {
        await bridge.showPage(ev.page);
      }
    }
  } catch (e) {
    setState({ mirror: false });
    fail(`Mirroring stopped: ${e instanceof Error ? e.message : e}`);
  }
}

export async function saveToPi(): Promise<void> {
  const doc = getState().doc;
  if (!doc) return;
  try {
    await bridge.putProject(doc.project.id, saveDgusproj(doc));
    alert(`Saved "${doc.project.name}" on the Pi.`);
  } catch (e) {
    fail(e);
  }
}

export async function openFromPi(id: string): Promise<void> {
  try {
    await flushSave();
    openDoc(loadDgusproj(await bridge.getProject(id)));
  } catch (e) {
    fail(e);
  }
}

export async function newFromTemplate(id: string, name: string, progress?: (done: number, total: number) => void): Promise<void> {
  try {
    await flushSave();
    const files = await bridge.templateFiles(id, progress);
    const { doc, warnings } = decompile(files, name);
    openDoc(doc, warnings);
  } catch (e) {
    fail(e);
  }
}
