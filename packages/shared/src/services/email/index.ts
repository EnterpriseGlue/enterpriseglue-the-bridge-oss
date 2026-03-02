/**
 * Email service - consolidated exports
 */
export { sendWelcomeEmail, sendVerificationEmail, type WelcomeEmailParams, type VerificationEmailParams } from './auth.js';
export { sendPasswordResetEmail, type PasswordResetEmailParams } from './password.js';
export { sendInvitationEmail, type InvitationEmailParams } from './invitation.js';
export { sendContactAdminEmail, type ContactAdminParams } from './contact.js';
export { getEmailConfigForTenant, sendEmailWithConfig } from './config.js';
