import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getAllowedRoots } from '@/lib/fs-guard';
import { listDockerRoots } from '@/lib/docker-roots';

export const dynamic = 'force-dynamic';

// Returns both the configured filesystem roots AND the docker-derived virtual
// roots (named volumes + bind mounts). The file-manager UI can render the
// docker ones in a separate "Container volumes" section of the sidebar.
export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  let dockerRoots: Awaited<ReturnType<typeof listDockerRoots>> = [];
  try {
    dockerRoots = await listDockerRoots();
  } catch {
    /* docker unreachable — return configured roots only */
  }
  return NextResponse.json({
    roots: getAllowedRoots(),
    dockerRoots,
  });
}
