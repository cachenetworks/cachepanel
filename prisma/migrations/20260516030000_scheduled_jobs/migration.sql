-- User-managed cron jobs synced into the SSH user's crontab on the target server.
-- Each entry is tagged with `# cachepanel:<id>` in the crontab so the panel can
-- find/edit/remove just its own jobs without touching the rest.

CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpr" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastOutput" TEXT,
    "lastExitCode" INTEGER,
    "lastRanAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduledJob_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ScheduledJob_serverId_idx" ON "ScheduledJob"("serverId");
