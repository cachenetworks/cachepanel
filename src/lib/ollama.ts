// Thin Ollama client. By default we look at host.docker.internal:11434 because
// CachePanel runs in a container and Ollama almost always runs on the host.
// Override with OLLAMA_HOST in .env, or pass a per-server hostname to
// getOllamaStatus() to query a different machine.

import type { Server } from '@prisma/client';

export function getOllamaBase(): string {
  return (process.env.OLLAMA_HOST || 'http://host.docker.internal:11434').replace(/\/+$/, '');
}

// For non-primary servers we try the configured hostname directly on port 11434.
// (Most users run Ollama on every box rather than mirroring a single endpoint.)
export function getServerOllamaBase(server: Server): string {
  return `http://${server.hostname}:11434`;
}

export function getDefaultModel(): string {
  return process.env.OLLAMA_MODEL || 'mistral';
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export interface RunningModel {
  name: string;
  model: string;
  size?: number;
  size_vram?: number;
  expires_at?: string;
}

export interface OllamaStatus {
  available: boolean;
  base: string;
  defaultModel: string;
  version?: string;
  models: OllamaModel[];
  running: RunningModel[];
  error?: string;
}

export async function getOllamaStatus(server?: Server | null): Promise<OllamaStatus> {
  // Primary (or no server context) → use the configured OLLAMA_HOST.
  // Non-primary → try that server's hostname directly on port 11434.
  const base = server && !server.isPrimary ? getServerOllamaBase(server) : getOllamaBase();
  const defaultModel = getDefaultModel();
  try {
    const ctl = AbortSignal.timeout(2500);
    const [versionRes, tagsRes, psRes] = await Promise.all([
      fetch(`${base}/api/version`, { signal: ctl, cache: 'no-store' }).catch(() => null),
      fetch(`${base}/api/tags`, { signal: ctl, cache: 'no-store' }).catch(() => null),
      fetch(`${base}/api/ps`, { signal: ctl, cache: 'no-store' }).catch(() => null),
    ]);
    if (!tagsRes || !tagsRes.ok) {
      return {
        available: false,
        base,
        defaultModel,
        models: [],
        running: [],
        error: 'Ollama is not reachable at ' + base,
      };
    }
    const tagsJson = (await tagsRes.json()) as { models?: OllamaModel[] };
    const psJson = psRes && psRes.ok ? ((await psRes.json()) as { models?: RunningModel[] }) : { models: [] };
    const version =
      versionRes && versionRes.ok ? ((await versionRes.json()) as { version?: string }).version : undefined;
    return {
      available: true,
      base,
      defaultModel,
      version,
      models: tagsJson.models ?? [],
      running: psJson.models ?? [],
    };
  } catch (err) {
    return {
      available: false,
      base,
      defaultModel,
      models: [],
      running: [],
      error: err instanceof Error ? err.message : 'Ollama check failed',
    };
  }
}
