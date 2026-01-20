import { randomUUID } from 'crypto';
import { getDataSource } from './data-source.js';
import { User } from './entities/User.js';
import { config } from '@shared/config/index.js';
import { hashPassword } from '@shared/utils/password.js';

/**
 * Bootstrap admin account on first run
 * Creates the initial admin user if no users exist
 */
export async function bootstrapAdmin() {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);

  try {
    // Check if any users exist
    const userCount = await userRepo.count();

    if (userCount > 0) {
      console.log('ℹ️  Users already exist, skipping admin bootstrap');
      return;
    }

    // No users exist, create admin account
    console.log('🔧 Creating admin account...');

    const adminId = randomUUID();
    const passwordHash = await hashPassword(config.adminPassword);
    const now = Date.now();

    const admin = userRepo.create({
      id: adminId,
      email: config.adminEmail,
      authProvider: 'local',
      passwordHash: passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      platformRole: 'admin',
      isActive: true,
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      isEmailVerified: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      createdByUserId: null,
    });

    await userRepo.save(admin);

    console.log(`✅ Admin account created: ${config.adminEmail}`);
    console.log(`   Password: [REDACTED - check ADMIN_PASSWORD environment variable]`);
    console.log(`   Platform Role: admin`);
    console.log(`⚠️  IMPORTANT: Change the admin password in production!`);
  } catch (error) {
    console.error('❌ Failed to bootstrap admin account:', error);
    throw error;
  }
}

/**
 * @deprecated No longer needed - platformRole is now the only role field
 */
export async function backfillMissingPlatformRoles() {
  // No-op: legacy role field has been removed
  // This function is kept for backward compatibility but does nothing
}

export async function backfillKnownUserProfiles() {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);

  const email = 'hary@enterpriseglue.ai';
  const firstName = 'Hary';
  const lastName = 'Selman';

  try {
    const user = await userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    if (!user) return;

    const currentFirstName = String(user.firstName || '').trim();
    const currentLastName = String(user.lastName || '').trim();

    const isPlaceholderAdminUser = currentFirstName === 'Admin' && currentLastName === 'User';
    const shouldSetFirstName = !currentFirstName || isPlaceholderAdminUser;
    const shouldSetLastName = !currentLastName || isPlaceholderAdminUser;
    const shouldSetAdmin = user.platformRole !== 'admin';
    if (!shouldSetFirstName && !shouldSetLastName && !shouldSetAdmin) return;

    const now = Date.now();
    await userRepo.update(user.id, {
      firstName: shouldSetFirstName ? firstName : user.firstName,
      lastName: shouldSetLastName ? lastName : user.lastName,
      platformRole: 'admin',
      updatedAt: now,
    });

    if (shouldSetAdmin) {
      console.log(`✅ Granted platform admin role to ${email}`);
    }
  } catch (error) {
    console.error('❌ Failed to backfill known user profiles:', error);
  }
}
