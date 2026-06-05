-- v1.8.0: Windows-managed-host support. Add OS bookkeeping to the Server table.
--
-- `os` is populated by host-os.detect() the first time the panel successfully
-- reaches the host. Defaults to "unknown" so existing rows are forward-
-- compatible without a backfill — the next request flips them.
--
-- `shellPath` overrides the default Windows shell selection (the adapter
-- defaults to "pwsh" with a "powershell.exe" fallback). Null = adapter picks.

ALTER TABLE "Server" ADD COLUMN "os" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Server" ADD COLUMN "shellPath" TEXT;
