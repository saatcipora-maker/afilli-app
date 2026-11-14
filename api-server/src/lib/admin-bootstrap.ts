import { createHash } from 'node:crypto';
import { clerkClient } from '@clerk/express';
import { pool } from '@workspace/db';
import { logger } from './logger';
import { getSettings } from './social';

// Only owner-configured server environment can select the initial administrator.
// The script uses the current environment's Clerk store; dev IDs are never copied.
export async function bootstrapAdministrator() {
  await getSettings();
  const email = process.env.AFILLI_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;
  const hash = createHash('sha256').update(email).digest('hex');
  if ((await pool.query('SELECT 1 FROM admin_bootstrap_grants WHERE identifier_hash=$1', [hash])).rowCount) return;
  const matches = await clerkClient.users.getUserList({ emailAddress: [email], limit: 2 });
  if (matches.data.length > 1) throw new Error('Ambiguous administrator identity');
  const user = matches.data[0] ?? await clerkClient.users.createUser({ emailAddress: [email], skipPasswordRequirement: true });
  if (!user.emailAddresses.some((address) => address.emailAddress.toLowerCase() === email && address.verification?.status === 'verified')) {
    throw new Error('Administrator email ownership is not verified');
  }
  // Record the attempt before granting, so restart cannot restore a revoked role.
  const claim = await pool.query(`INSERT INTO admin_bootstrap_grants(identifier_hash,user_id)
    VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING identifier_hash`, [hash, user.id]);
  if (!claim.rowCount) return;
  await clerkClient.users.updateUserMetadata(user.id, { publicMetadata: { ...user.publicMetadata, role: 'admin' } });
  await pool.query('UPDATE admin_bootstrap_grants SET applied_at=now() WHERE identifier_hash=$1', [hash]);
  logger.info('İlk yönetici yetkisi geçerli ortamda güvenle kuruldu');
}
