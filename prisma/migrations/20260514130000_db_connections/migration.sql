-- Saved database connection profiles for the DB management section.

CREATE TABLE "DbConnection" (
    "id"          TEXT PRIMARY KEY,
    "name"        TEXT NOT NULL,
    "driver"      TEXT NOT NULL,
    "host"        TEXT,
    "port"        INTEGER,
    "username"    TEXT,
    "password"    TEXT,
    "database"    TEXT,
    "ssl"         BOOLEAN NOT NULL DEFAULT false,
    "ownerOnly"   BOOLEAN NOT NULL DEFAULT false,
    "readOnly"    BOOLEAN NOT NULL DEFAULT false,
    "notes"       TEXT,
    "createdById" TEXT,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL
);
CREATE INDEX "DbConnection_driver_idx" ON "DbConnection"("driver");
