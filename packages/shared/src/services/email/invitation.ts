import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PlatformSettings } from '@enterpriseglue/shared/db/entities/PlatformSettings.js';
import { sendEmailWithConfig } from './config.js';
import { getActiveTemplateByType, renderBracesTemplate, escapeHtml } from './utils.js';

export interface InvitationEmailParams {
  to: string;
  tenantName: string;
  inviteUrl: string;
  resourceType: 'tenant' | 'project' | 'engine';
  invitedByName: string;
  tenantId?: string;
}

export async function sendInvitationEmail(params: InvitationEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    const { to, tenantName, inviteUrl, resourceType, invitedByName, tenantId } = params;
    const resourceLabel = resourceType === 'tenant' ? 'workspace' : resourceType;

    const dataSource = await getDataSource();
    const platformRepo = dataSource.getRepository(PlatformSettings);
    const platformSetting = await platformRepo.findOneBy({ id: 'default' });
    const emailPlatformName = platformSetting?.emailPlatformName || 'EnterpriseGlue';

    const vars = {
      platformName: emailPlatformName,
      inviterName: invitedByName,
      inviteLink: inviteUrl,
      expiresIn: '7 days',
    };

    const template = await getActiveTemplateByType('invite');
    const subject = renderBracesTemplate(template?.subject || "You've been invited to {{platformName}}", vars);

    const htmlVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));

    const defaultHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#f5f7fb;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#ffffff;border:1px solid #e6e8eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:22px 24px 0 24px;">
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:18px;color:#6b7280;">
                  {{platformName}}
                </div>
                <h1 style="margin:8px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:#111827;">
                  You are invited
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#111827;">
                <p style="margin:0 0 16px 0;">
                  <strong>{{inviterName}}</strong> invited you to join <strong>{{platformName}}</strong> (${escapeHtml(resourceLabel)}).
                </p>
                <p style="margin:0 0 16px 0;">Click the button below to accept the invitation.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 24px 18px 24px;">
                <a href="{{inviteLink}}" style="display:inline-block;background-color:#0f62fe;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;">
                  Accept invitation
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b7280;">
                <p style="margin:0 0 12px 0;">This invitation expires in {{expiresIn}}.</p>
                <p style="margin:0 0 8px 0;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="{{inviteLink}}" style="color:#0f62fe;text-decoration:none;">{{inviteLink}}</a>
                </p>
              </td>
            </tr>
          </table>

          <div style="max-width:600px;margin:12px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">
            This is an automated message. Please do not reply.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const html = renderBracesTemplate(template?.htmlTemplate || defaultHtml, htmlVars);

    const defaultText = `You've been invited to join ${emailPlatformName}

${invitedByName} has invited you to join the ${tenantName} ${resourceLabel}.

Accept the invitation by visiting: ${inviteUrl}

This invitation will expire in 7 days.`;

    const text = template?.textTemplate
      ? renderBracesTemplate(template.textTemplate, vars)
      : defaultText;

    const result = await sendEmailWithConfig(tenantId, to, subject, html, text);

    if (result.success) {
      logger.info(`✅ Invitation email sent to ${to}`);
    } else {
      logger.error(`❌ Failed to send invitation email to ${to}: ${result.error}`);
    }

    return result;
  } catch (error) {
    logger.error('❌ Error sending invitation email:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
