import { useEffect, useState } from "preact/hooks";
import { importDropped } from "./actions";
import { onKey } from "./commands";
import { Panel } from "./Panel";
import { PageCanvas } from "./PageCanvas";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { Welcome } from "./Welcome";
import { useStore } from "./store";

export function App() {
  const s = useStore();
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        setDrag(true);
      }
    };
    const leave = (e: DragEvent) => e.relatedTarget === null && setDrag(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDrag(false);
      if (e.dataTransfer) void importDropped(e.dataTransfer);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      {s.doc ? (
        <div class="app">
          <Toolbar />
          <Sidebar />
          <PageCanvas />
          <Panel />
        </div>
      ) : (
        <Welcome />
      )}
      {drag && <div class="dropzone">Drop a DWIN_SET folder, .zip or .dgusproj</div>}
    </>
  );
}
