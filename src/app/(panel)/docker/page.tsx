import { requireApproved } from '@/lib/session';
import { DockerClient } from './docker-client';

export const dynamic = 'force-dynamic';

export default async function DockerPage() {
  await requireApproved();
  return <DockerClient />;
}
