-- Server health time-series. The alert-poller writes one row per server
-- every 60s. Rows older than 7 days are pruned in the same tick.

CREATE TABLE "ServerSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "cpuPct" REAL,
    "memPct" REAL,
    "diskPct" REAL,
    "loadAvg1" REAL,
    "reachable" BOOLEAN NOT NULL DEFAULT true,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerSnapshot_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ServerSnapshot_serverId_recordedAt_idx" ON "ServerSnapshot"("serverId", "recordedAt");
