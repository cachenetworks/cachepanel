-- Multi-server support: every host CachePanel manages, plus per-(user,server)
-- provisioning state.

CREATE TABLE "Server" (
    "id"             TEXT PRIMARY KEY,
    "name"           TEXT NOT NULL,
    "hostname"       TEXT NOT NULL,
    "port"           INTEGER NOT NULL DEFAULT 22,
    "defaultUser"    TEXT NOT NULL,
    "keyName"        TEXT NOT NULL DEFAULT 'cachepanel_id_ed25519',
    "knownHostsName" TEXT NOT NULL DEFAULT 'known_hosts',
    "tags"           TEXT NOT NULL DEFAULT '',
    "isPrimary"      BOOLEAN NOT NULL DEFAULT false,
    "notes"          TEXT,
    "addedById"      TEXT,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Server_name_key" ON "Server"("name");
CREATE INDEX "Server_isPrimary_idx" ON "Server"("isPrimary");

CREATE TABLE "UserServerProvision" (
    "id"           TEXT PRIMARY KEY,
    "userId"       TEXT NOT NULL,
    "serverId"     TEXT NOT NULL,
    "sshUsername"  TEXT NOT NULL,
    "sshSudo"      BOOLEAN NOT NULL DEFAULT false,
    "provisioned"  BOOLEAN NOT NULL DEFAULT false,
    "lastError"    TEXT,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL,
    CONSTRAINT "UserServerProvision_serverId_fkey"
        FOREIGN KEY ("serverId") REFERENCES "Server"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserServerProvision_userId_serverId_key"
    ON "UserServerProvision"("userId", "serverId");
CREATE INDEX "UserServerProvision_serverId_idx" ON "UserServerProvision"("serverId");
