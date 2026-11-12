import escapeHtml from 'escape-html';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { CloudOrganizationNotificationSchema, type CloudOrganizationNotification } from '@enterpriseglue/shared/schemas/platform-admin/cloud-organization-notification.js';
import { sendEmailWithConfig } from './config.js';

export async function sendCloudOrganizationNotification(input: CloudOrganizationNotification): Promise<void> {
  const message = CloudOrganizationNotificationSchema.parse(input);
  if (!config.tenancyCloudRequired || !config.cloudAccountIdentityEnabled) throw Errors.notFound('Cloud organization email');
  const url = new URL(config.frontendUrl);
  if (url.protocol !== 'https:') throw Errors.conflict('Cloud organization email requires the HTTPS app origin');

  let recipient: string;
  if (message.kind === 'review_requested') {
    if (!config.cloudOrganizationReviewEmail) throw Errors.conflict('Cloud organization review address is unavailable');
    recipient = config.cloudOrganizationReviewEmail;
  } else {
    const source = await getDataSource();
    const user = await source.getRepository(User).findOneBy({ id: message.accountId, isActive: true, isEmailVerified: true });
    if (!user || user.email.trim().toLowerCase() !== message.email.trim().toLowerCase()) throw Errors.notFound('Verified organization requester');
    recipient = user.email;
  }
  const link = message.kind === 'review_requested'
    ? new URL('/cloud/organizations/requests?request=' + message.requestId, url)
    : new URL(message.kind === 'ready' ? '/t/' + message.slug + '/login' : '/cloud/onboarding', url);
  const { subject, detail, action } = content(message);
  const text = detail + '\n\n' + action + '\n' + link.toString();
  const html = '<p>' + escapeHtml(detail) + '</p><p><a href="' + escapeHtml(link.toString()) + '">' + action + '</a></p>';
  const sent = await sendEmailWithConfig(undefined, recipient, subject, html, text);
  if (sent.notConfigured) throw Errors.conflict('Cloud organization email is not configured');
  if (!sent.success) throw Errors.serviceUnavailable('Cloud organization email delivery');
}

function content(message: CloudOrganizationNotification): { subject: string; detail: string; action: string } {
  switch (message.kind) {
    case 'review_requested':
      return { subject: 'New EnterpriseGlue organization request', detail: message.email + ' requested ' + message.name + ' (' + message.slug + ').', action: 'Review the request' };
    case 'received':
      return { subject: 'We received your EnterpriseGlue request', detail: 'We are reviewing your request for ' + message.name + '.', action: 'View your request' };
    case 'approved':
      return { subject: 'Your EnterpriseGlue request was approved', detail: 'We are preparing your workspace for ' + message.name + '.', action: 'Check setup status' };
    case 'rejected':
      return { subject: 'An update on your EnterpriseGlue request', detail: 'Your request for ' + message.name + ' was declined. Reason: ' + message.reason, action: 'View your request' };
    case 'ready':
      return { subject: 'Your EnterpriseGlue workspace is ready', detail: message.name + ' is ready to use.', action: 'Sign in to your organization' };
  }
}
