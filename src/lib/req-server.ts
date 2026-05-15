// Helper: pull a server-id query param (or x-cachepanel-server header) off a
// Request. Returns null when not specified, in which case host probes use the
// primary server.

export function getRequestServerId(req: Request): string | null {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('server');
    if (id) return id;
  } catch {
    // ignore
  }
  // Headers fallback so non-GET callers don't need to embed a query string.
  // Browsers can't set arbitrary headers cross-origin without CORS, but our
  // API is same-origin so it's fine.
  const headerVal = req.headers.get('x-cachepanel-server');
  return headerVal || null;
}
