// Surface every running container's volumes + bind mounts as virtual
// "roots" for the file manager. Lets users browse a container's data
// directly from the panel without knowing where the host-side path lives.

import { listContainers, type DockerContainer, type DockerMount } from './docker-api';

export interface DockerRoot {
  /** Display label, e.g. "vaultwarden · /data (volume: vw_data)". */
  label: string;
  /** Host-side absolute path the file manager opens. */
  path: string;
  containerId: string;
  containerName: string;
  /** Where the path lives inside the container. */
  destination: string;
  type: 'bind' | 'volume' | 'tmpfs' | string;
  volumeName: string | null;
  readOnly: boolean;
  /** Container state (running, exited, etc.) — useful for grouping. */
  containerState: string;
}

// Cheap heuristic: don't surface system-internal mounts that aren't useful
// to browse (the docker socket itself, /proc, /sys, /dev, /etc/resolv.conf).
function isInteresting(m: DockerMount): boolean {
  if (!m.source) return false;
  if (m.type === 'tmpfs') return false;
  const s = m.source;
  if (s === '/var/run/docker.sock') return false;
  if (s.startsWith('/proc/') || s.startsWith('/sys/') || s.startsWith('/dev/')) return false;
  if (/\/etc\/(resolv\.conf|hosts|hostname|mtab)$/.test(s)) return false;
  return true;
}

export async function listDockerRoots(): Promise<DockerRoot[]> {
  const containers = await listContainers();
  const roots: DockerRoot[] = [];
  for (const c of containers) {
    for (const m of c.mounts ?? []) {
      if (!isInteresting(m)) continue;
      roots.push(rootFor(c, m));
    }
  }
  // Sort: running containers first, then alphabetical.
  roots.sort((a, b) => {
    if (a.containerState === b.containerState) return a.label.localeCompare(b.label);
    if (a.containerState === 'running') return -1;
    if (b.containerState === 'running') return 1;
    return a.label.localeCompare(b.label);
  });
  return roots;
}

function rootFor(c: DockerContainer, m: DockerMount): DockerRoot {
  const volLabel = m.type === 'volume' && m.name ? ` (volume: ${m.name})` : '';
  return {
    label: `${c.name} · ${m.destination}${volLabel}`,
    path: m.source,
    containerId: c.id,
    containerName: c.name,
    destination: m.destination,
    type: m.type,
    volumeName: m.name,
    readOnly: m.readOnly,
    containerState: c.state,
  };
}
