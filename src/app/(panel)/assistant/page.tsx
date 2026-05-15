import { requireApproved } from '@/lib/session';
import { AssistantClient } from './assistant-client';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  await requireApproved();
  return <AssistantClient />;
}
