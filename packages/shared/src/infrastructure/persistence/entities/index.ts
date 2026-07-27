/**
 * Infrastructure - Persistence Layer
 * 
 * Database entities and repositories.
 * This module handles all data persistence concerns.
 * 
 * During Phase 2 migration, entities are re-exported from db/entities.
 * After full migration, entities will be moved here physically.
 */

// Entities (local clean-architecture persistence layer)
export { AuditLog } from './AuditLog.js';
export { AuthzAuditLog } from './AuthzAuditLog.js';
export { AuthzPolicy } from './AuthzPolicy.js';
export { AppBaseEntity as BaseEntity } from './BaseEntity.js';
export { Batch } from './Batch.js';
export { Branch } from './Branch.js';
export { Comment } from './Comment.js';
export { Commit } from './Commit.js';
export { EmailSendConfig } from './EmailSendConfig.js';
export { EmailTemplate } from './EmailTemplate.js';
export { Engine } from './Engine.js';
export { EngineAccessRequest } from './EngineAccessRequest.js';
export { EngineDeployment } from './EngineDeployment.js';
export { EngineDeploymentArtifact } from './EngineDeploymentArtifact.js';
export { EngineHealth } from './EngineHealth.js';
export { EngineMember } from './EngineMember.js';
export { EngineProjectAccess } from './EngineProjectAccess.js';
export { EnvironmentTag } from './EnvironmentTag.js';
export { File } from './File.js';
export { FileCommitVersion } from './FileCommitVersion.js';
export { FileSnapshot } from './FileSnapshot.js';
export { Folder } from './Folder.js';
export { GitAuditLog } from './GitAuditLog.js';
export { GitCredential } from './GitCredential.js';
export { GitDeployment } from './GitDeployment.js';
export { GitLock } from './GitLock.js';
export { GitProvider } from './GitProvider.js';
export { GitPushQueue } from './GitPushQueue.js';
export { GitRepository } from './GitRepository.js';
export { GitTag } from './GitTag.js';
export { Invitation } from './Invitation.js';
export { Notification } from './Notification.js';
export { PasswordResetToken } from './PasswordResetToken.js';
export { PendingChange } from './PendingChange.js';
export { PermissionGrant } from './PermissionGrant.js';
export { PlatformSettings } from './PlatformSettings.js';
export {
  PluginPlatformState,
  PluginEmergencyControlOperation,
  PluginInstallation,
  PluginBrokerReplay,
  PluginStorageEntry,
  PluginGatewayAdmissionState,
  PluginGatewaySubjectBucket,
  PluginGatewayConcurrencyLease,
  PluginEventDelivery,
  PluginEventSubscriptionState,
  PluginEventQueueState,
  PluginNotificationPublication,
  PluginScheduledJob,
  PluginScheduleCommand,
  PluginContributionAvailabilityState,
  PluginLifecycleOperation,
  PluginPermissionGrant,
  PluginPlatformAudit,
  PluginTenantEnablement,
  pluginPlatformEntities,
} from './PluginPlatform.js';
export { Project } from './Project.js';
export { ProjectMember } from './ProjectMember.js';
export { ProjectMemberRole } from './ProjectMemberRole.js';
export { RefreshToken } from './RefreshToken.js';
export { RemoteSyncState } from './RemoteSyncState.js';
export { SavedFilter } from './SavedFilter.js';
export { SsoClaimsMapping } from './SsoClaimsMapping.js';
export { SsoProvider } from './SsoProvider.js';
export { User } from './User.js';
export { Version } from './Version.js';
export { WorkingFile } from './WorkingFile.js';
export { WorkingFolder } from './WorkingFolder.js';
