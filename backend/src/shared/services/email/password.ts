import { logger } from '@shared/utils/logger.js';
import { config } from '@shared/config/index.js';
import { getDataSource } from '@shared/db/data-source.js';
import { PlatformSettings } from '@shared/db/entities/PlatformSettings.js';
import { sendEmailWithConfig } from './config.js';
import { getActiveTemplateByType, renderBracesTemplate, escapeHtml } from './utils.js';

export interface PasswordResetEmailParams {
  to: string;
  firstName?: string;
  resetToken: string;
  resetUrl?: string;
  tenantId?: string;
}

/**
 * Send password reset email with reset link
 */
export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<{ success: boolean; error?: string }> {
  const { to, firstName, resetToken, resetUrl, tenantId } = params;
  
  // Build reset URL
  const frontendUrl = config.frontendUrl || 'http://localhost:5173';
  const fullResetUrl = resetUrl || `${frontendUrl}/password-reset?token=${resetToken}`;
  
  // Get platform name from settings
  const dataSource = await getDataSource();
  const platformRepo = dataSource.getRepository(PlatformSettings);
  const platformSetting = await platformRepo.findOneBy({ id: 'default' });
  const platformName = platformSetting?.emailPlatformName || 'EnterpriseGlue';

  // Try to get custom template
  const template = await getActiveTemplateByType('password_reset');
  
  const vars = {
    platformName,
    resetLink: fullResetUrl,
    expiresIn: '1 hour',
  };
  
  const subject = template?.subject 
    ? renderBracesTemplate(template.subject, vars)
    : `Reset your ${platformName} password`;

  const htmlVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));

  const defaultHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Password Reset</h1>
    </div>
    
    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
      <p style="font-size: 16px; margin-bottom: 20px;">
        ${firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,'}
      </p>
      
      <p style="font-size: 16px; margin-bottom: 20px;">
        We received a request to reset your password for your {{platformName}} account.
      </p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="{{resetLink}}" style="display: inline-block; background: #667eea; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; font-weight: 600; font-size: 16px;">
          Reset Password
        </a>
      </div>
      
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; font-size: 14px; color: #856404;">
          <strong>⚠️ This link expires in {{expiresIn}}.</strong>
        </p>
      </div>
      
      <p style="font-size: 14px; color: #666; margin-top: 20px;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="font-size: 13px; color: #667eea; word-break: break-all; background: white; padding: 10px; border-radius: 4px; font-family: 'Courier New', monospace;">
        {{resetLink}}
      </p>
      
      <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
        If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
      </p>
      
      <p style="font-size: 12px; color: #999; margin-top: 20px;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
  </body>
</html>`;

  const html = renderBracesTemplate(template?.htmlTemplate || defaultHtml, htmlVars);

  const defaultText = `Password Reset Request

${firstName ? `Hi ${firstName},` : 'Hello,'}

We received a request to reset your password for your ${platformName} account.

Click here to reset your password: ${fullResetUrl}

⚠️ This link expires in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

This is an automated message. Please do not reply to this email.`;

  const text = template?.textTemplate
    ? renderBracesTemplate(template.textTemplate, vars)
    : defaultText;

  // Send using tenant config or fallback
  const result = await sendEmailWithConfig(tenantId, to, subject, html, text);
  
  if (result.success) {
    logger.info(`✅ Password reset email sent to ${to}`);
  } else {
    logger.error(`❌ Failed to send password reset email to ${to}:`, result.error);
  }
  
  return result;
}
