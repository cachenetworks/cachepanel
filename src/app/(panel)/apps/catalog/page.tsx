import { requireApproved } from '@/lib/session';
import { CatalogClient } from './catalog-client';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const user = await requireApproved();
  return <CatalogClient user={user} />;
}
