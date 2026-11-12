// Client for the Pi bridge (dgus_lcd/editor_bridge.py). The bridge serves
// the editor, so the API is on the same origin (in `npm run dev`, Vite
// proxies /api to it). On a LAN address it wants the token from the URL it
// printed: ?token=... is kept for the session and removed from the URL.

export interface BridgeInfo {
  bridge: number;
  serial: string;
  baud: number;
  service_running: boolean;
  force: boolean;
  busy: boolean;
  token_required: boolean;
  templates: { id: string; name: string }[];
}

export interface FlashFile {
  name: string;
  kind: string | null;
  id: number | null;
  size: number;
  status: "pending" | "unchanged" | "skipped" | "uploading" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  where: string | null;
  error: string | null;
}

export interface FlashJob {
  id: string;
  state: "running" | "done" | "error" | "cancelled";
  error: string | null;
  files: FlashFile[];
  reset: boolean;
  elapsed: number;
}

export interface StoredProject {
  id: string;
  name: string;
  modified: string;
  pages: number;
  size: number;
}

const TOKEN_KEY = "dgus-bridge-token";
let token: string | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** Take ?token= from the page URL (once) into session storage. */
export function initToken(): void {
  if (typeof location === "undefined") return;
  const url = new URL(location.href);
  const t = url.searchParams.get("token");
  if (t) {
    token = t;
    try {
      storage()?.setItem(TOKEN_KEY, t);
    } catch {
      /* private mode */
    }
    url.searchParams.delete("token");
    try {
      history.replaceState(null, "", url.toString());
    } catch {
      /* ignore */
    }
  } else {
    try {
      token = storage()?.getItem(TOKEN_KEY) ?? token;
    } catch {
      /* keep the current token */
    }
  }
}

export function setToken(t: string | null): void {
  token = t;
}

export class BridgeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("X-Bridge-Token", token);
  const r = await fetch(`api/${path}`, { ...init, headers });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* not JSON */
    }
    throw new BridgeError(r.status, msg);
  }
  return r;
}

const json = async <T>(path: string, init?: RequestInit) => (await (await call(path, init)).json()) as T;
const post = (body: unknown): RequestInit => ({
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});

/** The bridge's info, or null when the editor isn't served by one. */
export async function detect(): Promise<BridgeInfo | null> {
  if (typeof location !== "undefined" && location.protocol === "file:") return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch("api/info", { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const info = (await r.json()) as BridgeInfo;
    return typeof info.bridge === "number" ? info : null;
  } catch {
    return null;
  }
}

export const screenInfo = () => json<Record<string, unknown>>("screen");
export const showPage = (page: number) => json<{ page: number }>("page", post({ page }));
export const writeVp = (vp: number, words: number[]) => json<{ vp: number }>("vp", post({ vp, words }));
export const readVp = (vp: number, words: number) => json<{ words: number[] }>(`vp?vp=${vp}&words=${words}`);

export function flash(zip: Uint8Array, o: { onlyChanged: boolean; verify: boolean; reset: boolean }): Promise<FlashJob> {
  const q = `only_changed=${o.onlyChanged ? 1 : 0}&verify=${o.verify ? 1 : 0}&reset=${o.reset ? 1 : 0}`;
  return json<FlashJob>(`flash?${q}`, { method: "POST", body: zip as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/zip" } });
}
export const job = (id: string) => json<FlashJob>(`jobs/${encodeURIComponent(id)}`);
export const cancelJob = (id: string) => json<FlashJob>(`jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
export const forgetFlashed = () => json<{ ok: boolean }>("flash/forget", { method: "POST" });

export const listProjects = () => json<StoredProject[]>("projects");
export async function getProject(id: string): Promise<Uint8Array> {
  return new Uint8Array(await (await call(`projects/${encodeURIComponent(id)}`)).arrayBuffer());
}
export const putProject = (id: string, data: Uint8Array) =>
  json<StoredProject>(`projects/${encodeURIComponent(id)}`, { method: "PUT", body: data as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/zip" } });
export const deleteProject = (id: string) => json<{ ok: boolean }>(`projects/${encodeURIComponent(id)}`, { method: "DELETE" });

/** All files of a template DWIN_SET, by name. */
export async function templateFiles(id: string, progress?: (done: number, total: number) => void): Promise<Map<string, Uint8Array>> {
  const t = await json<{ files: { name: string; size: number }[] }>(`templates/${encodeURIComponent(id)}`);
  const out = new Map<string, Uint8Array>();
  let k = 0;
  for (const f of t.files) {
    const r = await call(`templates/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`);
    out.set(f.name, new Uint8Array(await r.arrayBuffer()));
    progress?.(++k, t.files.length);
  }
  return out;
}
