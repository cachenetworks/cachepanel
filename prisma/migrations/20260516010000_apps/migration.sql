-- One-click app installations.
--
-- Each row tracks a docker-compose-managed app dropped under
-- /opt/cachepanel/apps/<slug> on a target Server. v1 enforces one install
-- per (server, slug) — multi-instance is a future concern.

CREATE TABLE "InstalledApp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'installing',
    "variables" TEXT NOT NULL,
    "composeYaml" TEXT NOT NULL,
    "ports" TEXT NOT NULL DEFAULT '[]',
    "imageTag" TEXT NOT NULL DEFAULT '',
    "hasUpdate" BOOLEAN NOT NULL DEFAULT false,
    "installedById" TEXT,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstalledApp_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstalledApp_installedById_fkey" FOREIGN KEY ("installedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InstalledApp_serverId_slug_key" ON "InstalledApp"("serverId", "slug");
CREATE INDEX "InstalledApp_serverId_idx" ON "InstalledApp"("serverId");
