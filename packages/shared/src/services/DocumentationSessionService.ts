import { IsNull, MoreThan } from 'typeorm';
import { getDataSource } from '../db/data-source.js';
import { RefreshToken } from '../infrastructure/persistence/entities/RefreshToken.js';
import { Errors } from '../middleware/errorHandler.js';
import { type UserJwtPayload } from '../utils/jwt.js';
import { documentationSource, signDocumentationIdentity, verifyDocumentationGrant, verifyDocumentationIdentity, type DocumentationIdentity } from '../utils/documentation-identity.js';

/** The existing exact browser-session row is the durable replay and revocation boundary.
 * No tenant, placement, subscription or provisioning service is called here.
 */
export class DocumentationSessionService {
  async grant(principal: UserJwtPayload, challenge: string): Promise<string> {
    const source = documentationSource(principal);
    const repository = (await getDataSource()).getRepository(RefreshToken);
    const row = await repository.findOneBy({ id: source.sessionId, userId: source.userId, revokedAt: IsNull(), expiresAt: MoreThan(Date.now()) });
    if (!row) throw Errors.unauthorized('Sign in again');
    const code = signDocumentationIdentity('documentation_grant', source, 60, challenge);
    const claims = verifyDocumentationIdentity(code, 'documentation_grant');
    const metadata = JSON.parse(row.deviceInfo || '{}') as Record<string, unknown>;
    const updated = await repository.update({ id: row.id, userId: row.userId, revokedAt: IsNull(), deviceInfo: row.deviceInfo ?? IsNull() }, {
      deviceInfo: JSON.stringify({ ...metadata, documentationGrant: claims.jti }),
    });
    if (updated.affected !== 1) throw Errors.unauthorized('Session changed; try again');
    return code;
  }

  async exchange(code: string, verifier: string): Promise<string> {
    const claims = verifyDocumentationGrant(code, verifier);
    const repository = (await getDataSource()).getRepository(RefreshToken);
    const row = await repository.findOneBy({ id: claims.source.sessionId, userId: claims.source.userId, revokedAt: IsNull(), expiresAt: MoreThan(Date.now()) });
    if (!row) throw Errors.unauthorized('Sign in again');
    const metadata = JSON.parse(row.deviceInfo || '{}') as Record<string, unknown>;
    if (metadata.documentationGrant !== claims.jti) throw Errors.unauthorized('Documentation grant was already used or replaced');
    const lifetime = Math.min(900, Math.floor((Number(row.expiresAt) - Date.now()) / 1000));
    if (lifetime < 1) throw Errors.unauthorized('Session expired');
    const token = signDocumentationIdentity('documentation_session', claims.source, lifetime);
    const session = verifyDocumentationIdentity(token, 'documentation_session');
    delete metadata.documentationGrant;
    const existing = Array.isArray(metadata.documentationSessions) ? metadata.documentationSessions.filter((id): id is string => typeof id === 'string') : [];
    metadata.documentationSessions = [...existing.slice(-3), session.jti];
    const consumed = await repository.update({ id: row.id, userId: row.userId, revokedAt: IsNull(), deviceInfo: row.deviceInfo ?? IsNull() }, { deviceInfo: JSON.stringify(metadata) });
    if (consumed.affected !== 1) throw Errors.unauthorized('Documentation grant was already used');
    return token;
  }

  async requireSession(claims: DocumentationIdentity): Promise<void> {
    const row = await (await getDataSource()).getRepository(RefreshToken).findOneBy({ id: claims.source.sessionId, userId: claims.source.userId, revokedAt: IsNull(), expiresAt: MoreThan(Date.now()) });
    const metadata = JSON.parse(row?.deviceInfo || '{}') as Record<string, unknown>;
    if (!Array.isArray(metadata.documentationSessions) || !metadata.documentationSessions.includes(claims.jti)) throw Errors.unauthorized('Documentation session has been revoked');
  }

  async revokeSession(token: string): Promise<void> {
    const claims = verifyDocumentationIdentity(token, 'documentation_session');
    const repository = (await getDataSource()).getRepository(RefreshToken);
    const row = await repository.findOneBy({ id: claims.source.sessionId, userId: claims.source.userId, revokedAt: IsNull(), expiresAt: MoreThan(Date.now()) });
    if (!row) return;
    const metadata = JSON.parse(row.deviceInfo || '{}') as Record<string, unknown>;
    metadata.documentationSessions = Array.isArray(metadata.documentationSessions) ? metadata.documentationSessions.filter((id) => id !== claims.jti) : [];
    const revoked = await repository.update({ id: row.id, userId: row.userId, revokedAt: IsNull(), deviceInfo: row.deviceInfo ?? IsNull() }, { deviceInfo: JSON.stringify(metadata) });
    if (revoked.affected !== 1) throw Errors.conflict('Session changed; try sign-out again');
  }
}
export const documentationSessionService = new DocumentationSessionService();
