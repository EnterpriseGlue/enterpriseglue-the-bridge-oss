import { config } from '../config/index.js';
import { Errors } from '../middleware/errorHandler.js';
import { DocumentationWorkspacePolicySchema, DocumentationWorkspaceIdSchema } from '../schemas/auth/documentation.js';
import type { UserJwtPayload } from '../utils/jwt.js';

/** Evaluated after live account/session verification, without a user or grant cache.
 * This policy is private operator configuration, never a browser-controlled tenant selector.
 */
export class DocumentationWorkspaceService {
  list(principal: UserJwtPayload): Array<{ id: string; name: string }> {
    if (!config.documentationWorkspacesJson) return [];
    try {
      if (Buffer.byteLength(config.documentationWorkspacesJson) > 262144) throw new Error('Policy size exceeded');
      const policy = DocumentationWorkspacePolicySchema.parse(JSON.parse(config.documentationWorkspacesJson));
      const email = principal.email?.toLowerCase();
      const domain = email?.slice(email.lastIndexOf('@') + 1);
      return policy.workspaces.filter(workspace => workspace.active
        && domain && workspace.allowedEmailDomains.includes(domain)
        && (workspace.accessMode === 'verified_domain'
          || workspace.readers.some(reader => reader.userId === principal.userId && reader.expiresAt > Date.now())))
        .map(({ id, name }) => ({ id, name }));
    } catch { throw Errors.serviceUnavailable('Documentation workspace policy'); }
  }

  require(principal: UserJwtPayload, workspaceId: string): void {
    if (!DocumentationWorkspaceIdSchema.safeParse(workspaceId).success
      || !this.list(principal).some(workspace => workspace.id === workspaceId)) {
      throw Errors.notFound('Documentation workspace');
    }
  }
}
export const documentationWorkspaceService = new DocumentationWorkspaceService();
