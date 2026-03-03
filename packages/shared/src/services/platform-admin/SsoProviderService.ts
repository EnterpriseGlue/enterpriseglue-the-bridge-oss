/**
 * SSO Provider Service
 * 
 * Manages SSO identity provider configurations (Microsoft, Google, SAML, OIDC).
 * Handles CRUD operations and provider-specific logic.
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoProvider } from '@enterpriseglue/shared/db/entities/SsoProvider.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

export type SsoProviderType = 'microsoft' | 'google' | 'saml' | 'oidc';
export type PlatformRole = 'admin' | 'developer' | 'user';

export interface CreateSsoProviderInput {
  name: string;
  type: SsoProviderType;
  enabled?: boolean;
  
  // OIDC fields
  clientId?: string;
  clientSecret?: string; // Will be encrypted before storage
  tenantId?: string;
  issuerUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[];
  
  // SAML fields
  entityId?: string;
  ssoUrl?: string;
  sloUrl?: string;
  certificate?: string; // Will be encrypted before storage
  signatureAlgorithm?: 'sha1' | 'sha256' | 'sha512';
  
  // Display
  iconUrl?: string;
  buttonLabel?: string;
  buttonColor?: string;
  displayOrder?: number;
  
  // Provisioning
  autoProvision?: boolean;
  defaultRole?: PlatformRole;
}

export interface UpdateSsoProviderInput extends Partial<CreateSsoProviderInput> {
  enabled?: boolean;
}

export interface SsoProviderPublic {
  id: string;
  name: string;
  type: SsoProviderType;
  enabled: boolean;
  clientId?: string | null;
  tenantId?: string | null;
  issuerUrl?: string | null;
  authorizationUrl?: string | null;
  tokenUrl?: string | null;
  userInfoUrl?: string | null;
  scopes?: string[];
  entityId?: string | null;
  ssoUrl?: string | null;
  sloUrl?: string | null;
  signatureAlgorithm?: string | null;
  callbackUrl?: string | null;
  iconUrl?: string | null;
  buttonLabel?: string | null;
  buttonColor?: string | null;
  displayOrder: number;
  autoProvision: boolean;
  defaultRole: string;
  createdAt: number;
  updatedAt: number;
  // Indicate if secrets are configured (without exposing them)
  hasClientSecret: boolean;
  hasCertificate: boolean;
}

class SsoProviderServiceClass {
  private hasText(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private ensureProviderCanBeEnabled(
    type: SsoProviderType,
    configToValidate: {
      entityId?: string | null;
      ssoUrl?: string | null;
      hasCertificate: boolean;
    }
  ): void {
    if (type !== 'saml') return;

    const missingFields: string[] = [];
    if (!this.hasText(configToValidate.entityId)) missingFields.push('entityId');
    if (!this.hasText(configToValidate.ssoUrl)) missingFields.push('ssoUrl');
    if (!configToValidate.hasCertificate) missingFields.push('certificate');

    if (missingFields.length > 0) {
      throw Errors.validation(
        `Cannot enable SAML provider. Missing required fields: ${missingFields.join(', ')}`,
        { missingFields }
      );
    }
  }

  /**
   * Simple encryption for secrets (in production, use proper key management)
   */
  private encryptSecret(secret: string): string {
    // Base64 encode with a simple marker - in production use proper encryption
    return `enc:${Buffer.from(secret).toString('base64')}`;
  }

  /**
   * Decrypt a secret
   */
  private decryptSecret(encrypted: string): string {
    if (!encrypted.startsWith('enc:')) return encrypted;
    return Buffer.from(encrypted.slice(4), 'base64').toString('utf-8');
  }

  /**
   * Get all SSO providers (with secrets redacted for non-admin use)
   */
  async getAllProviders(): Promise<SsoProviderPublic[]> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const providers = await providerRepo.find({ order: { displayOrder: 'ASC' } });

    return providers.map((p) => this.toPublic(p));
  }

  /**
   * Get enabled SSO providers for login page
   */
  async getEnabledProviders(): Promise<SsoProviderPublic[]> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const providers = await providerRepo.find({
      where: { enabled: true },
      order: { displayOrder: 'ASC' },
    });

    return providers.map((p) => this.toPublic(p));
  }

  /**
   * Get a single provider by ID
   */
  async getProvider(id: string): Promise<SsoProviderPublic | null> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const p = await providerRepo.findOneBy({ id });

    if (!p) return null;
    return this.toPublic(p);
  }

  /**
   * Get provider with decrypted secrets (for internal use only)
   */
  async getProviderWithSecrets(id: string): Promise<SsoProvider | null> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const p = await providerRepo.findOneBy({ id });

    if (!p) return null;
    
    // Decrypt secrets in place
    if (p.clientSecretEnc) p.clientSecretEnc = this.decryptSecret(p.clientSecretEnc);
    if (p.certificateEnc) p.certificateEnc = this.decryptSecret(p.certificateEnc);
    return p;
  }

  /**
   * Get provider by type (for auth flow)
   */
  async getProviderByType(type: SsoProviderType): Promise<SsoProvider | null> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const p = await providerRepo.findOneBy({ type });

    if (!p) return null;
    
    // Decrypt secrets in place
    if (p.clientSecretEnc) p.clientSecretEnc = this.decryptSecret(p.clientSecretEnc);
    if (p.certificateEnc) p.certificateEnc = this.decryptSecret(p.certificateEnc);
    return p;
  }

  /**
   * Create a new SSO provider
   */
  async createProvider(input: CreateSsoProviderInput, createdById?: string): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const id = generateId();
    const now = Date.now();
    const enabled = input.enabled ?? false;

    if (enabled) {
      this.ensureProviderCanBeEnabled(input.type, {
        entityId: input.entityId || null,
        ssoUrl: input.ssoUrl || null,
        hasCertificate: this.hasText(input.certificate),
      });
    }

    // Generate callback URL based on type
    const baseUrl = config.frontendUrl || 'http://localhost:5173';
    const callbackUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/${input.type}/callback`;

    await providerRepo.insert({
      id,
      name: input.name,
      type: input.type,
      enabled,
      
      // OIDC
      clientId: input.clientId || null,
      clientSecretEnc: input.clientSecret ? this.encryptSecret(input.clientSecret) : null,
      tenantId: input.tenantId || null,
      issuerUrl: input.issuerUrl || null,
      authorizationUrl: input.authorizationUrl || null,
      tokenUrl: input.tokenUrl || null,
      userInfoUrl: input.userInfoUrl || null,
      scopes: input.scopes ? JSON.stringify(input.scopes) : '["openid", "profile", "email"]',
      
      // SAML
      entityId: input.entityId || null,
      ssoUrl: input.ssoUrl || null,
      sloUrl: input.sloUrl || null,
      certificateEnc: input.certificate ? this.encryptSecret(input.certificate) : null,
      signatureAlgorithm: input.signatureAlgorithm || 'sha256',
      
      // Display
      callbackUrl,
      iconUrl: input.iconUrl || null,
      buttonLabel: input.buttonLabel || this.getDefaultButtonLabel(input.type),
      buttonColor: input.buttonColor || this.getDefaultButtonColor(input.type),
      displayOrder: input.displayOrder ?? 0,
      
      // Provisioning
      autoProvision: input.autoProvision ?? true,
      defaultRole: input.defaultRole || 'user',
      
      createdAt: now,
      updatedAt: now,
      createdById: createdById || null,
    });

    return { id };
  }

  /**
   * Update an SSO provider
   */
  async updateProvider(id: string, input: UpdateSsoProviderInput): Promise<void> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    const now = Date.now();

    const existing = await providerRepo.findOneBy({ id });
    if (!existing) {
      throw Errors.providerNotFound(id);
    }

    const type = (input.type ?? existing.type) as SsoProviderType;
    const enabled = input.enabled ?? existing.enabled;
    const entityId = input.entityId !== undefined ? input.entityId || null : existing.entityId;
    const ssoUrl = input.ssoUrl !== undefined ? input.ssoUrl || null : existing.ssoUrl;
    const hasCertificate =
      input.certificate !== undefined ? this.hasText(input.certificate) : !!existing.certificateEnc;

    if (enabled) {
      this.ensureProviderCanBeEnabled(type, {
        entityId,
        ssoUrl,
        hasCertificate,
      });
    }

    const updates: any = { updatedAt: now };

    // Map input fields to database columns
    if (input.name !== undefined) updates.name = input.name;
    if (input.type !== undefined) updates.type = input.type;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    
    // OIDC
    if (input.clientId !== undefined) updates.clientId = input.clientId || null;
    if (input.clientSecret !== undefined) {
      updates.clientSecretEnc = input.clientSecret ? this.encryptSecret(input.clientSecret) : null;
    }
    if (input.tenantId !== undefined) updates.tenantId = input.tenantId || null;
    if (input.issuerUrl !== undefined) updates.issuerUrl = input.issuerUrl || null;
    if (input.authorizationUrl !== undefined) updates.authorizationUrl = input.authorizationUrl || null;
    if (input.tokenUrl !== undefined) updates.tokenUrl = input.tokenUrl || null;
    if (input.userInfoUrl !== undefined) updates.userInfoUrl = input.userInfoUrl || null;
    if (input.scopes !== undefined) updates.scopes = JSON.stringify(input.scopes);
    
    // SAML
    if (input.entityId !== undefined) updates.entityId = input.entityId || null;
    if (input.ssoUrl !== undefined) updates.ssoUrl = input.ssoUrl || null;
    if (input.sloUrl !== undefined) updates.sloUrl = input.sloUrl || null;
    if (input.certificate !== undefined) {
      updates.certificateEnc = input.certificate ? this.encryptSecret(input.certificate) : null;
    }
    if (input.signatureAlgorithm !== undefined) updates.signatureAlgorithm = input.signatureAlgorithm;
    
    // Display
    if (input.iconUrl !== undefined) updates.iconUrl = input.iconUrl || null;
    if (input.buttonLabel !== undefined) updates.buttonLabel = input.buttonLabel || null;
    if (input.buttonColor !== undefined) updates.buttonColor = input.buttonColor || null;
    if (input.displayOrder !== undefined) updates.displayOrder = input.displayOrder;
    
    // Provisioning
    if (input.autoProvision !== undefined) updates.autoProvision = input.autoProvision;
    if (input.defaultRole !== undefined) updates.defaultRole = input.defaultRole;

    await providerRepo.update({ id }, updates);
  }

  /**
   * Delete an SSO provider
   */
  async deleteProvider(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);
    await providerRepo.delete({ id });
  }

  /**
   * Toggle provider enabled status
   */
  async toggleProvider(id: string, enabled: boolean): Promise<void> {
    const dataSource = await getDataSource();
    const providerRepo = dataSource.getRepository(SsoProvider);

    if (enabled) {
      const existing = await providerRepo.findOneBy({ id });
      if (!existing) {
        throw Errors.providerNotFound(id);
      }

      this.ensureProviderCanBeEnabled(existing.type as SsoProviderType, {
        entityId: existing.entityId,
        ssoUrl: existing.ssoUrl,
        hasCertificate: !!existing.certificateEnc,
      });
    }

    await providerRepo.update({ id }, { enabled, updatedAt: Date.now() });
  }

  /**
   * Convert database record to public format (secrets redacted)
   */
  private toPublic(p: SsoProvider): SsoProviderPublic {
    let scopes: string[] = ['openid', 'profile', 'email'];
    try {
      scopes = JSON.parse(p.scopes || '[]');
    } catch {}

    return {
      id: p.id,
      name: p.name,
      type: p.type as SsoProviderType,
      enabled: p.enabled,
      clientId: p.clientId,
      tenantId: p.tenantId,
      issuerUrl: p.issuerUrl,
      authorizationUrl: p.authorizationUrl,
      tokenUrl: p.tokenUrl,
      userInfoUrl: p.userInfoUrl,
      scopes,
      entityId: p.entityId,
      ssoUrl: p.ssoUrl,
      sloUrl: p.sloUrl,
      signatureAlgorithm: p.signatureAlgorithm,
      callbackUrl: p.callbackUrl,
      iconUrl: p.iconUrl,
      buttonLabel: p.buttonLabel,
      buttonColor: p.buttonColor,
      displayOrder: p.displayOrder,
      autoProvision: p.autoProvision,
      defaultRole: p.defaultRole,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      hasClientSecret: !!p.clientSecretEnc,
      hasCertificate: !!p.certificateEnc,
    };
  }

  /**
   * Get default button label for provider type
   */
  private getDefaultButtonLabel(type: SsoProviderType): string {
    switch (type) {
      case 'microsoft': return 'Sign in with Microsoft';
      case 'google': return 'Sign in with Google';
      case 'saml': return 'Sign in with SSO';
      case 'oidc': return 'Sign in with SSO';
      default: return 'Sign in';
    }
  }

  /**
   * Get default button color for provider type
   */
  private getDefaultButtonColor(type: SsoProviderType): string {
    switch (type) {
      case 'microsoft': return '#00a4ef';
      case 'google': return '#4285f4';
      case 'saml': return '#6b7280';
      case 'oidc': return '#6b7280';
      default: return '#6b7280';
    }
  }
}

export const ssoProviderService = new SsoProviderServiceClass();
