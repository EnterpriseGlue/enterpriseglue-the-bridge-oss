import { createHash, randomBytes } from 'node:crypto';
import { IsNull } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { TenantDiscoveryChallenge } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantDiscoveryChallenge.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type { TenantDiscoveryResponse } from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';
import { sendTenantDiscoveryEmail } from '@enterpriseglue/shared/services/email/tenant-discovery.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { tenantService, type TenantMembershipView, type TenantService } from './TenantService.js';

const DISCOVERY_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const NON_ENUMERATING_MESSAGE = 'If an active account can be found, a single-use organization link will be sent. You can also continue with an organization name.';

type DiscoveryEmailSender = typeof sendTenantDiscoveryEmail;
type DiscoveryTaskScheduler = (task: () => Promise<void>) => void;

const scheduleDiscoveryTask: DiscoveryTaskScheduler = (task) => {
  setImmediate(() => { void task().catch(() => undefined); });
};

export class TenantDiscoveryService {
  constructor(
    private readonly tenants: TenantService = tenantService,
    private readonly sendDiscoveryEmail: DiscoveryEmailSender = sendTenantDiscoveryEmail,
    private readonly scheduleTask: DiscoveryTaskScheduler = scheduleDiscoveryTask,
  ) {}

  async request(emailValue: string): Promise<TenantDiscoveryResponse> {
    if (config.tenancyMode !== 'pooled') throw Errors.notFound('Organization discovery');
    const email = emailValue.trim().toLowerCase();
    const domain = email.split('@')[1] || '';
    const matches = await this.tenants.findByDiscoveryDomain(domain);
    if (matches.length === 1) {
      const tenantSlug = matches[0].slug;
      return { status: 'resolved', tenantSlug, loginPath: `/t/${tenantSlug}/login` };
    }

    // Account lookup and email delivery are deliberately kept off the public response path so
    // account existence cannot be inferred from the response shape or ordinary delivery latency.
    this.scheduleTask(() => this.sendMembershipDiscoveryLink(email));
    return { status: 'verification_sent', message: NON_ENUMERATING_MESSAGE };
  }

  private async sendMembershipDiscoveryLink(email: string): Promise<void> {
    const dataSource = await getDataSource();
    const user = await dataSource.getRepository(User).findOneBy({ email, isActive: true });
    if (user) {
      const memberships = (await this.tenants.listForUser(user.id)).filter((membership) => membership.tenantStatus === 'active');
      if (memberships.length > 0) {
        const token = randomBytes(32).toString('base64url');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const now = Date.now();
        const challengeRepo = dataSource.getRepository(TenantDiscoveryChallenge);
        const existing = await challengeRepo.findOneBy({ userId: user.id });
        const challengeId = existing?.id || generateId();
        await challengeRepo.upsert({
          id: challengeId,
          userId: user.id,
          tokenHash,
          expiresAt: now + DISCOVERY_CHALLENGE_TTL_MS,
          createdAt: now,
          consumedAt: null,
        }, { conflictPaths: ['userId'] });
        const discoveryUrl = new URL('/login', config.frontendUrl);
        discoveryUrl.hash = new URLSearchParams({ discovery_token: token }).toString();
        let delivered = false;
        try {
          delivered = (await this.sendDiscoveryEmail({
            to: user.email,
            firstName: user.firstName || undefined,
            discoveryUrl: discoveryUrl.toString(),
          })).success;
        } catch {
          // The public response must remain independent of account existence and delivery state.
        }
        if (!delivered) {
          await challengeRepo.update({ id: challengeId, consumedAt: IsNull() }, { consumedAt: Date.now() });
        }
      }
    }
  }

  async exchange(tokenValue: string): Promise<TenantMembershipView[]> {
    if (config.tenancyMode !== 'pooled') throw Errors.notFound('Organization discovery');
    const tokenHash = createHash('sha256').update(tokenValue).digest('hex');
    const dataSource = await getDataSource();
    const challengeRepo = dataSource.getRepository(TenantDiscoveryChallenge);
    const challenge = await challengeRepo.findOneBy({ tokenHash, consumedAt: IsNull() });
    const now = Date.now();
    if (!challenge || Number(challenge.expiresAt) <= now) {
      throw Errors.validation('Invalid or expired organization discovery token');
    }
    const user = await dataSource.getRepository(User).findOneBy({ id: challenge.userId, isActive: true });
    if (!user) throw Errors.validation('Invalid or expired organization discovery token');
    const memberships = (await this.tenants.listForUser(user.id))
      .filter((membership) => membership.tenantStatus === 'active');
    const consumed = await challengeRepo.update({ id: challenge.id, consumedAt: IsNull() }, { consumedAt: now });
    if (consumed.affected !== 1) throw Errors.validation('Invalid or expired organization discovery token');
    return memberships;
  }
}

export const tenantDiscoveryService = new TenantDiscoveryService();
