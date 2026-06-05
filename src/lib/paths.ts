// Central path resolver. The Linux container install hard-codes
// /app/data, /run/secrets, etc; the native Windows panel-host install
// can't use those (no /app, no /run). Anything that reaches for one of
// these constants should call the helper here instead so both deployment
// modes Just Work.
//
// Env-var overrides always win — useful for non-default installs (e.g.
// CP_DATA_DIR=/srv/cachepanel) and for tests.

import path from 'node:path';
import os from 'node:os';

const isWin = process.platform === 'win32';

// Pick a sane Windows base depending on whether the process runs as a
// service (PROGRAMDATA available) or interactive user (APPDATA).
function winBase(): string {
  return process.env.PROGRAMDATA
    ? path.join(process.env.PROGRAMDATA, 'CachePanel')
    : path.join(process.env.APPDATA || os.homedir(), 'CachePanel');
}

export function getDataDir(): string {
  if (process.env.CP_DATA_DIR) return process.env.CP_DATA_DIR;
  return isWin ? path.join(winBase(), 'data') : '/app/data';
}

export function getSecretsDir(): string {
  if (process.env.SECRETS_DIR) return process.env.SECRETS_DIR;
  return isWin ? path.join(winBase(), 'secrets') : '/run/secrets';
}

export function getRuntimeSecretsDir(): string {
  if (process.env.RUNTIME_SECRETS_DIR) return process.env.RUNTIME_SECRETS_DIR;
  return isWin ? path.join(winBase(), 'secrets-servers') : '/run/secrets-servers';
}

export function getPerUserSecretsDir(): string {
  if (process.env.PER_USER_SECRETS_DIR) return process.env.PER_USER_SECRETS_DIR;
  return isWin ? path.join(winBase(), 'secrets-users') : '/run/secrets-users';
}

export function getLogsDir(): string {
  if (process.env.CP_LOG_DIR) return process.env.CP_LOG_DIR;
  return isWin ? path.join(winBase(), 'logs') : '/app/data/logs';
}

// Helper for code that needs to know which mode it's in.
export function isWindowsPanelHost(): boolean {
  return isWin;
}
