-- CachePanel initial schema (SQLite).
-- Two-role system enforced at the application layer: "OWNER" | "ADMIN".
-- Status values: "PENDING" | "APPROVED" | "DISABLED".

CREATE TABLE "User" (
    "id"          TEXT PRIMARY KEY,
    "discordId"   TEXT NOT NULL,
    "username"    TEXT NOT NULL,
    "avatar"      TEXT,
    "email"       TEXT,
    "role"        TEXT NOT NULL DEFAULT 'ADMIN',
    "status"      TEXT NOT NULL DEFAULT 'PENDING',
    "lastLoginAt" DATETIME,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL
);
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE INDEX "User_role_idx"   ON "User"("role");
CREATE INDEX "User_status_idx" ON "User"("status");

CREATE TABLE "AuditLog" (
    "id"        TEXT PRIMARY KEY,
    "userId"    TEXT,
    "action"    TEXT NOT NULL,
    "target"    TEXT,
    "metadata"  TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_userId_idx"    ON "AuditLog"("userId");
CREATE INDEX "AuditLog_action_idx"    ON "AuditLog"("action");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE TABLE "TerminalSession" (
    "id"        TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"   DATETIME,
    "ipAddress" TEXT,
    "status"    TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT "TerminalSession_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TerminalSession_userId_idx" ON "TerminalSession"("userId");
CREATE INDEX "TerminalSession_status_idx" ON "TerminalSession"("status");

CREATE TABLE "FileAction" (
    "id"        TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "path"      TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileAction_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FileAction_userId_idx"    ON "FileAction"("userId");
CREATE INDEX "FileAction_createdAt_idx" ON "FileAction"("createdAt");

CREATE TABLE "AppSetting" (
    "id"        TEXT PRIMARY KEY,
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");
