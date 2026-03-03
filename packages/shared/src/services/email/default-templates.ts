/**
 * Default Email Templates
 * These are used when no custom template is configured in the database
 */

export interface TemplateVars {
  [key: string]: string;
}

// Common email styles
const COMMON_STYLES = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  primaryColor: '#667eea',
  secondaryColor: '#764ba2',
  textColor: '#333',
  mutedColor: '#666',
  lightGray: '#999',
  bgColor: '#f9f9f9',
};

/**
 * Welcome email template
 */
export function getWelcomeEmailHtml(params: {
  to: string;
  firstName?: string;
  temporaryPassword: string;
  loginUrl: string;
}): string {
  const { to, firstName, temporaryPassword, loginUrl } = params;
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: ${COMMON_STYLES.fontFamily}; line-height: 1.6; color: ${COMMON_STYLES.textColor}; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, ${COMMON_STYLES.primaryColor} 0%, ${COMMON_STYLES.secondaryColor} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Voyager</h1>
    </div>
    
    <div style="background: ${COMMON_STYLES.bgColor}; padding: 30px; border-radius: 0 0 10px 10px;">
      <p style="font-size: 16px; margin-bottom: 20px;">
        ${firstName ? `Hi ${firstName},` : 'Hello,'}
      </p>
      
      <p style="font-size: 16px; margin-bottom: 20px;">
        Your account has been created! Here are your login credentials:
      </p>
      
      <div style="background: white; border-left: 4px solid ${COMMON_STYLES.primaryColor}; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; font-size: 14px; color: ${COMMON_STYLES.mutedColor};">Email:</p>
        <p style="margin: 5px 0 15px 0; font-size: 16px; font-weight: 600;">${to}</p>
        
        <p style="margin: 0; font-size: 14px; color: ${COMMON_STYLES.mutedColor};">Temporary Password:</p>
        <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace; color: ${COMMON_STYLES.primaryColor};">${temporaryPassword}</p>
      </div>
      
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; font-size: 14px; color: #856404;">
          <strong>⚠️ Important:</strong> You must reset this password on your first login.
        </p>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${loginUrl}" style="display: inline-block; background: ${COMMON_STYLES.primaryColor}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; font-size: 16px;">
          Login to Voyager
        </a>
      </div>
      
      <p style="font-size: 14px; color: ${COMMON_STYLES.mutedColor}; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
        If you have any questions, please contact your administrator.
      </p>
      
      <p style="font-size: 12px; color: ${COMMON_STYLES.lightGray}; margin-top: 20px;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
  </body>
</html>`;
}

export function getWelcomeEmailText(params: {
  to: string;
  firstName?: string;
  temporaryPassword: string;
  loginUrl: string;
}): string {
  const { to, firstName, temporaryPassword, loginUrl } = params;
  return `
Welcome to Voyager

${firstName ? `Hi ${firstName},` : 'Hello,'}

Your account has been created! Here are your login credentials:

Email: ${to}
Temporary Password: ${temporaryPassword}

⚠️ Important: You must reset this password on your first login.

Login at: ${loginUrl}

If you have any questions, please contact your administrator.

This is an automated message. Please do not reply to this email.
`.trim();
}

/**
 * Email verification template
 */
export function getVerificationEmailHtml(params: {
  firstName?: string;
  verificationUrl: string;
}): string {
  const { firstName, verificationUrl } = params;
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: ${COMMON_STYLES.fontFamily}; line-height: 1.6; color: ${COMMON_STYLES.textColor}; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, ${COMMON_STYLES.primaryColor} 0%, ${COMMON_STYLES.secondaryColor} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px;">✉️ Verify Your Email</h1>
    </div>
    
    <div style="background: ${COMMON_STYLES.bgColor}; padding: 30px; border-radius: 0 0 10px 10px;">
      <p style="font-size: 16px; margin-bottom: 20px;">
        ${firstName ? `Hi ${firstName},` : 'Hello,'}
      </p>
      
      <p style="font-size: 16px; margin-bottom: 20px;">
        Welcome to Voyager! Please verify your email address to complete your account setup.
      </p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" style="display: inline-block; background: ${COMMON_STYLES.primaryColor}; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; font-weight: 600; font-size: 16px;">
          Verify Email Address
        </a>
      </div>
      
      <div style="background: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; font-size: 14px; color: #0d47a1;">
          <strong>ℹ️ Note:</strong> This link will expire in 24 hours.
        </p>
      </div>
      
      <p style="font-size: 14px; color: ${COMMON_STYLES.mutedColor}; margin-top: 20px;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="font-size: 13px; color: ${COMMON_STYLES.primaryColor}; word-break: break-all; background: white; padding: 10px; border-radius: 4px; font-family: 'Courier New', monospace;">
        ${verificationUrl}
      </p>
      
      <p style="font-size: 14px; color: ${COMMON_STYLES.mutedColor}; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
        If you didn't create an account with Voyager, you can safely ignore this email.
      </p>
      
      <p style="font-size: 12px; color: ${COMMON_STYLES.lightGray}; margin-top: 20px;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
  </body>
</html>`;
}

export function getVerificationEmailText(params: {
  firstName?: string;
  verificationUrl: string;
}): string {
  const { firstName, verificationUrl } = params;
  return `
Verify Your Email - Voyager

${firstName ? `Hi ${firstName},` : 'Hello,'}

Welcome to Voyager! Please verify your email address to complete your account setup.

Click here to verify: ${verificationUrl}

Note: This link will expire in 24 hours.

If you didn't create an account with Voyager, you can safely ignore this email.

This is an automated message. Please do not reply to this email.
`.trim();
}

/**
 * Password reset template
 */
export function getPasswordResetEmailHtml(params: {
  firstName?: string;
  resetUrl: string;
}): string {
  const { firstName, resetUrl } = params;
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: ${COMMON_STYLES.fontFamily}; line-height: 1.6; color: ${COMMON_STYLES.textColor}; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, ${COMMON_STYLES.primaryColor} 0%, ${COMMON_STYLES.secondaryColor} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Reset Your Password</h1>
    </div>
    
    <div style="background: ${COMMON_STYLES.bgColor}; padding: 30px; border-radius: 0 0 10px 10px;">
      <p style="font-size: 16px; margin-bottom: 20px;">
        ${firstName ? `Hi ${firstName},` : 'Hello,'}
      </p>
      
      <p style="font-size: 16px; margin-bottom: 20px;">
        We received a request to reset your password for your Voyager account.
      </p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" style="display: inline-block; background: ${COMMON_STYLES.primaryColor}; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; font-weight: 600; font-size: 16px;">
          Reset Password
        </a>
      </div>
      
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; font-size: 14px; color: #856404;">
          <strong>⚠️ Security:</strong> This link will expire in 1 hour. If you didn't request this, you can ignore this email.
        </p>
      </div>
      
      <p style="font-size: 14px; color: ${COMMON_STYLES.mutedColor}; margin-top: 20px;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="font-size: 13px; color: ${COMMON_STYLES.primaryColor}; word-break: break-all; background: white; padding: 10px; border-radius: 4px; font-family: 'Courier New', monospace;">
        ${resetUrl}
      </p>
      
      <p style="font-size: 12px; color: ${COMMON_STYLES.lightGray}; margin-top: 20px;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
  </body>
</html>`;
}

export function getPasswordResetEmailText(params: {
  firstName?: string;
  resetUrl: string;
}): string {
  const { firstName, resetUrl } = params;
  return `
Reset Your Password - Voyager

${firstName ? `Hi ${firstName},` : 'Hello,'}

We received a request to reset your password for your Voyager account.

Click here to reset your password: ${resetUrl}

Security: This link will expire in 1 hour. If you didn't request this, you can ignore this email.

This is an automated message. Please do not reply to this email.
`.trim();
}

/**
 * Invitation email template
 */
export function getInvitationEmailHtml(params: {
  platformName: string;
  inviterName: string;
  inviteLink: string;
  resourceLabel: string;
  expiresIn: string;
}): string {
  const { platformName, inviterName, inviteLink, resourceLabel, expiresIn } = params;
  return `<!doctype html>
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
                <div style="font-family:${COMMON_STYLES.fontFamily};font-size:13px;line-height:18px;color:#6b7280;">
                  ${platformName}
                </div>
                <h1 style="margin:8px 0 0 0;font-family:${COMMON_STYLES.fontFamily};font-size:22px;line-height:28px;font-weight:700;color:#111827;">
                  You are invited
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;font-family:${COMMON_STYLES.fontFamily};font-size:16px;line-height:24px;color:#111827;">
                <p style="margin:0 0 16px 0;">
                  <strong>${inviterName}</strong> invited you to join <strong>${platformName}</strong> (${resourceLabel}).
                </p>
                <p style="margin:0 0 16px 0;">Click the button below to accept the invitation.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 24px 18px 24px;">
                <a href="${inviteLink}" style="display:inline-block;background-color:#0f62fe;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-family:${COMMON_STYLES.fontFamily};font-size:16px;font-weight:600;">
                  Accept invitation
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;font-family:${COMMON_STYLES.fontFamily};font-size:13px;line-height:20px;color:#6b7280;">
                <p style="margin:0 0 12px 0;">This invitation expires in ${expiresIn}.</p>
                <p style="margin:0 0 8px 0;">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="${inviteLink}" style="color:#0f62fe;text-decoration:none;">${inviteLink}</a>
                </p>
              </td>
            </tr>
          </table>

          <div style="max-width:600px;margin:12px auto 0 auto;font-family:${COMMON_STYLES.fontFamily};font-size:12px;line-height:18px;color:#9ca3af;text-align:center;">
            This is an automated message. Please do not reply.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function getInvitationEmailText(params: {
  platformName: string;
  inviterName: string;
  inviteLink: string;
  tenantName: string;
  resourceLabel: string;
}): string {
  const { platformName, inviterName, inviteLink, tenantName, resourceLabel } = params;
  return `You've been invited to join ${platformName}

${inviterName} has invited you to join the ${tenantName} ${resourceLabel}.

Accept the invitation by visiting: ${inviteLink}

This invitation will expire in 7 days.`;
}

/**
 * Contact admin email template
 */
export function getContactAdminEmailHtml(params: {
  userEmail: string;
  subject: string;
  message?: string;
}): string {
  const { userEmail, subject, message } = params;
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: ${COMMON_STYLES.fontFamily}; line-height: 1.6; color: ${COMMON_STYLES.textColor}; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px;">📧 Support Request</h1>
    </div>
    
    <div style="background: ${COMMON_STYLES.bgColor}; padding: 30px; border-radius: 0 0 10px 10px;">
      <div style="background: white; border-left: 4px solid #ff6b6b; padding: 15px; margin: 0 0 20px 0; border-radius: 4px;">
        <p style="margin: 0; font-size: 14px; color: ${COMMON_STYLES.mutedColor};">From:</p>
        <p style="margin: 5px 0 15px 0; font-size: 16px; font-weight: 600;">${userEmail}</p>
        
        <p style="margin: 0; font-size: 14px; color: ${COMMON_STYLES.mutedColor};">Subject:</p>
        <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600;">${subject}</p>
      </div>
      
      <div style="background: white; padding: 20px; border-radius: 4px; border: 1px solid #ddd;">
        <p style="margin: 0 0 10px 0; font-size: 14px; color: ${COMMON_STYLES.mutedColor};">Message:</p>
        <p style="margin: 0; font-size: 16px; white-space: pre-wrap;">${message || '(No message provided)'}</p>
      </div>
      
      <p style="font-size: 12px; color: ${COMMON_STYLES.lightGray}; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
        This email was sent from the Voyager login page contact form.
      </p>
    </div>
  </body>
</html>`;
}

export function getContactAdminEmailText(params: {
  userEmail: string;
  subject: string;
  message?: string;
}): string {
  const { userEmail, subject, message } = params;
  return `
Voyager Support Request

From: ${userEmail}
Subject: ${subject}

Message:
${message || '(No message provided)'}

---
This email was sent from the Voyager login page contact form.
`.trim();
}
