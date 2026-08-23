import { z } from 'zod';

export const pluginIdPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export const semVerPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const sha256Pattern = /^[a-f0-9]{64}$/;
export const ociDigestReferencePattern =
  /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;

export const pluginIdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(pluginIdPattern, 'Plugin IDs must be lowercase reverse-DNS names');

export const semVerSchema = z
  .string()
  .max(100)
  .regex(semVerPattern, 'Version must be valid SemVer');

export const sha256Schema = z
  .string()
  .regex(sha256Pattern, 'SHA-256 must contain exactly 64 lowercase hexadecimal characters');

export const ociDigestReferenceSchema = z
  .string()
  .max(500)
  .regex(
    ociDigestReferencePattern,
    'OCI reference must use a lowercase repository and immutable sha256 digest',
  );

export const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .superRefine((value, context) => {
    if (
      value.startsWith('/') ||
      value.includes('\\') ||
      value.includes('%') ||
      value.includes('?') ||
      value.includes('#')
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Path must be a relative decoded URL path without escapes, backslashes, query, or fragment',
      });
    }

    const segments = value.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      context.addIssue({
        code: 'custom',
        message: 'Path must not contain empty, current-directory, or parent-directory segments',
      });
    }
  });

export const namespacedIdentifierSchema = z
  .string()
  .min(3)
  .max(250)
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
    'Identifier must contain only lowercase letters, digits, dots, underscores, and hyphens',
  );

export const opaqueReferenceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Opaque reference contains unsupported characters');

export const pluginPermissionValues = [
  'host.identity.read_safe',
  'host.engine.incidents.read_metadata',
  'host.engine.failed_jobs.read_metadata',
  'host.engine.process_instances.read_metadata',
  'host.engine.metadata.read',
  'host.engine.access.list_safe',
  'host.engine.diagnostics.collect_sanitized',
  'host.events.subscribe.incident',
  'host.events.subscribe.failed_job',
  'host.events.subscribe.engine_inventory',
  'host.plugin_storage.deployment',
  'host.plugin_storage.tenant',
  'host.secret.use_reference',
  'host.notifications.publish_safe',
  'host.jobs.schedule_fixed',
] as const;

export const pluginPermissionSchema = z.enum(pluginPermissionValues);

export const pluginEventTypeValues = [
  'io.enterpriseglue.host.incident.v1',
  'io.enterpriseglue.host.failed-job.v1',
  'io.enterpriseglue.host.engine-inventory.v1',
] as const;

export const pluginEventTypeSchema = z.enum(pluginEventTypeValues);

export const pluginNotificationTemplateValues = [
  'host.plugin.action-required.v1',
  'host.plugin.operation-succeeded.v1',
  'host.plugin.operation-failed.v1',
] as const;

export const pluginNotificationTemplateSchema = z.enum(
  pluginNotificationTemplateValues,
);

export const pluginSlotIdValues = [
  'mission-control.incident.actions.v1',
  'mission-control.failed-job.actions.v1',
  'mission-control.process-instance.actions.v1',
  'mission-control.engine.actions.v1',
  'mission-control.engine.tabs.v1',
  'settings.tenant.pages.v1',
  'settings.deployment.pages.v1',
  'global.header.actions.v1',
] as const;

export const pluginSlotIdSchema = z.enum(pluginSlotIdValues);

export type PluginId = z.infer<typeof pluginIdSchema>;
export type SemVer = z.infer<typeof semVerSchema>;
export type OciDigestReference = z.infer<typeof ociDigestReferenceSchema>;
export type PluginPermissionV1 = z.infer<typeof pluginPermissionSchema>;
export type PluginEventTypeV1 = z.infer<typeof pluginEventTypeSchema>;
export type PluginSlotIdV1 = z.infer<typeof pluginSlotIdSchema>;
