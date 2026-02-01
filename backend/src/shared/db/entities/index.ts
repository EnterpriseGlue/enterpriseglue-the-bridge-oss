// TypeORM Entity Exports
export { AppBaseEntity } from './BaseEntity.js';

// Auth entities
export { User } from './User.js';
export { RefreshToken } from './RefreshToken.js';
export { PasswordResetToken } from './PasswordResetToken.js';

// Audit entities
export { AuditLog } from './AuditLog.js';
export { Notification } from './Notification.js';

// Starbase entities
export { Project } from './Project.js';
export { Folder } from './Folder.js';
export { File } from './File.js';
export { Version } from './Version.js';
export { Comment } from './Comment.js';
export { ProjectMember } from './ProjectMember.js';
export { ProjectMemberRole } from './ProjectMemberRole.js';

// Batch entities
export { Batch } from './Batch.js';

// Platform entities
export { EnvironmentTag } from './EnvironmentTag.js';
export { PlatformSettings } from './PlatformSettings.js';
export { EmailTemplate } from './EmailTemplate.js';
export { EmailSendConfig } from './EmailSendConfig.js';
// Tenant entities removed - multi-tenancy is EE-only
// export { Tenant } from './Tenant.js';
// export { TenantSettings } from './TenantSettings.js';
// export { TenantMembership } from './TenantMembership.js';
// export { Invitation } from './Invitation.js';
export { EngineMember } from './EngineMember.js';
export { EngineProjectAccess } from './EngineProjectAccess.js';
export { EngineAccessRequest } from './EngineAccessRequest.js';
export { PermissionGrant } from './PermissionGrant.js';
export { GitProvider } from './GitProvider.js';
export { SsoProvider } from './SsoProvider.js';
export { SsoClaimsMapping } from './SsoClaimsMapping.js';
export { AuthzPolicy } from './AuthzPolicy.js';
export { AuthzAuditLog } from './AuthzAuditLog.js';

// Versioning entities
export { Branch } from './Branch.js';
export { Commit } from './Commit.js';
export { WorkingFile } from './WorkingFile.js';
export { FileSnapshot } from './FileSnapshot.js';
export { FileCommitVersion } from './FileCommitVersion.js';
export { WorkingFolder } from './WorkingFolder.js';
export { RemoteSyncState } from './RemoteSyncState.js';
export { PendingChange } from './PendingChange.js';

// Mission Control entities
export { Engine } from './Engine.js';
export { SavedFilter } from './SavedFilter.js';
export { EngineHealth } from './EngineHealth.js';

// Git entities
export { GitRepository } from './GitRepository.js';
export { GitCredential } from './GitCredential.js';
export { GitLock } from './GitLock.js';
export { GitDeployment } from './GitDeployment.js';
export { GitTag } from './GitTag.js';
export { GitPushQueue } from './GitPushQueue.js';
export { GitAuditLog } from './GitAuditLog.js';

// Engine Deployment entities
export { EngineDeployment } from './EngineDeployment.js';
export { EngineDeploymentArtifact } from './EngineDeploymentArtifact.js';
