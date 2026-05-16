import { requireApproved } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { HealthClient } from './health-client';

export const dynamic = 'force-dynamic';

export default async function ServerHealthPage({ params }: { params: { id: string } }) {
  await requireApproved();
  const server = await prisma.server.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, hostname: true, isPrimary: true },
  });
  if (!server) notFound();
  return <HealthClient server={server} />;
}
