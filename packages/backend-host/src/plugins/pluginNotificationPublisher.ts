import { createHash, randomUUID } from 'node:crypto';

import {
  pluginNotificationPublishResponseV1Schema,
  type PluginNotificationPublishRequestV1,
  type PluginNotificationPublishResponseV1,
} from '@enterpriseglue/plugin-sdk';
import type { PluginNotificationPublisherV1 } from '@enterpriseglue/plugin-runtime/host-broker';
import { isFeatureEnabled } from '@enterpriseglue/shared/config/features.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Notification } from '@enterpriseglue/shared/infrastructure/persistence/entities/Notification.js';
import { PluginNotificationPublication } from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { notificationEvents } from '@enterpriseglue/shared/services/notifications/events.js';
import type { NotificationEvent } from '@enterpriseglue/shared/services/notifications/types.js';
import type { DataSource } from 'typeorm';

import { findPluginRowForUpdateV1 } from './pluginDatabaseLock.js';
import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';

interface RenderedNotificationV1 {
  state: 'success' | 'info' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

/**
 * Publishes only host-rendered notifications to the user represented by the
 * signed invocation subject. Plugin text never reaches the notification table.
 */
export class DatabasePluginNotificationPublisherV1
implements PluginNotificationPublisherV1 {
  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> =
      getDataSource,
  ) {}

  async publish(input: {
    pluginId: string;
    deploymentRef: string;
    tenantRef: string;
    subjectRef: string;
    request: PluginNotificationPublishRequestV1;
  }): Promise<PluginNotificationPublishResponseV1> {
    const keyHash = hash(
      [
        input.pluginId,
        input.deploymentRef,
        input.tenantRef,
        input.subjectRef,
        input.request.idempotencyKey,
      ].join('\0'),
    );
    const requestHash = hash(JSON.stringify(input.request));
    const rendered = render(input.pluginId, input.request);
    const dataSource = await this.dataSourceProvider();
    let savedNotification: Notification | undefined;
    try {
      const result = await runPluginTransactionV1(
        dataSource,
        async (manager) => {
        const publicationRepository = manager.getRepository(
          PluginNotificationPublication,
        );
        const existing = await findPluginRowForUpdateV1(
          publicationRepository,
          { idempotencyKeyHash: keyHash },
        );
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new Error('plugin_notification_idempotency_conflict');
          }
          return response(existing.notificationRef, 'duplicate');
        }
        const userExists = await manager.getRepository(User).exists({
          where: { id: input.subjectRef, isActive: true },
        });
        if (!userExists) {
          throw new Error('plugin_notification_subject_invalid');
        }
        const now = Date.now();
        savedNotification = await manager.getRepository(Notification).save({
          id: randomUUID(),
          userId: input.subjectRef,
          tenantId: input.tenantRef,
          state: rendered.state,
          title: rendered.title,
          subtitle: rendered.subtitle,
          readAt: null,
          createdAt: now,
        });
        await publicationRepository.insert({
          id: randomUUID(),
          idempotencyKeyHash: keyHash,
          requestHash,
          notificationRef: savedNotification.id,
          pluginId: input.pluginId,
          deploymentRef: input.deploymentRef,
          tenantRef: input.tenantRef,
          subjectRef: input.subjectRef,
          templateId: input.request.templateId,
          reasonCode: input.request.reasonCode,
          createdAt: now,
        });
        return response(savedNotification.id, 'published');
      });
      if (savedNotification) emit(savedNotification);
      return result;
    } catch (error) {
      const existing = await dataSource
        .getRepository(PluginNotificationPublication)
        .findOne({ where: { idempotencyKeyHash: keyHash } });
      if (existing && existing.requestHash === requestHash) {
        return response(existing.notificationRef, 'duplicate');
      }
      throw error;
    }
  }
}

function render(
  pluginId: string,
  request: PluginNotificationPublishRequestV1,
): RenderedNotificationV1 {
  const occurrence =
    request.occurrenceCount && request.occurrenceCount > 1
      ? ` · ${request.occurrenceCount} occurrences`
      : '';
  const source = `${pluginId} · ${request.reasonCode}${occurrence}`;
  if (request.templateId === 'host.plugin.action-required.v1') {
    return {
      state: 'warning',
      title: 'Plugin action required',
      subtitle: source,
    };
  }
  if (request.templateId === 'host.plugin.operation-succeeded.v1') {
    return {
      state: 'success',
      title: 'Plugin operation completed',
      subtitle: source,
    };
  }
  return {
    state: 'error',
    title: 'Plugin operation failed',
    subtitle: source,
  };
}

function emit(notification: Notification): void {
  if (!isFeatureEnabled('sseNotifications')) return;
  const event: NotificationEvent = {
    id: notification.id,
    type: 'notification',
    userId: notification.userId,
    tenantId: notification.tenantId,
    payload: {
      id: notification.id,
      state: notification.state,
      title: notification.title,
      subtitle: notification.subtitle,
      createdAt: notification.createdAt,
    },
    timestamp: Date.now(),
  };
  notificationEvents.emit(event);
}

function response(
  notificationRef: string,
  status: 'published' | 'duplicate',
): PluginNotificationPublishResponseV1 {
  return pluginNotificationPublishResponseV1Schema.parse({
    apiVersion: 'notification-publish-result.plugin.enterpriseglue.io/v1',
    notificationRef,
    status,
  });
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
