// No test talks to the network: an unstubbed fetch (e.g. the editor looking
// for the Pi bridge at start-up) gets a 404 instead of a real connection.
// Assigned directly so vi.unstubAllGlobals() falls back to this.
globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
