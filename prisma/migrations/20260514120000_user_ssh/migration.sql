-- Per-user SSH provisioning (Option A): each panel user can be granted their
-- own Linux account on the host, with optional passwordless sudo.

ALTER TABLE "User" ADD COLUMN "sshUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "sshAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "sshSudo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "sshProvisioned" BOOLEAN NOT NULL DEFAULT false;
