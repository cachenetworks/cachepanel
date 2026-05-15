// In-memory presence map. Every API call from an authenticated user updates
// their last-seen timestamp; a user is considered "online" if their last beat
// is within the threshold.

const lastSeen = new Map<string, number>();
const ONLINE_THRESHOLD_MS = 60_000; // 60s without a heartbeat → offline

export function markSeen(userId: string) {
  lastSeen.set(userId, Date.now());
}

export function isOnline(userId: string): boolean {
  const t = lastSeen.get(userId);
  if (!t) return false;
  return Date.now() - t < ONLINE_THRESHOLD_MS;
}

export function getPresenceMap(): Record<string, { lastSeen: number; online: boolean }> {
  const now = Date.now();
  const out: Record<string, { lastSeen: number; online: boolean }> = {};
  for (const [uid, t] of lastSeen) {
    out[uid] = { lastSeen: t, online: now - t < ONLINE_THRESHOLD_MS };
  }
  return out;
}
