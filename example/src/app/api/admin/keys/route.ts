import { logAdminAction, logAudit } from '@/lib/audit';

export async function POST() {
  await logAdminAction({ action: 'api-key.create' });
}

/** The original defect: a sink is reached, but the action is not namespaced. */
export async function DELETE() {
  await logAudit({ action: 'ADMIN_ACTION' });
}
