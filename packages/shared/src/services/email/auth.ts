import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { sendEmailWithConfig } from './config.js';
import {
  getWelcomeEmailHtml,
  getWelcomeEmailText,
  getVerificationEmailHtml,
  getVerificationEmailText,
} from './default-templates.js';

export interface WelcomeEmailParams {
  to: string;
  firstName?: string;
  temporaryPassword: string;
  loginUrl?: string;
  tenantId?: string;
}

/**
 * Send welcome email to new user with temporary password
 */
export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<{ success: boolean; error?: string }> {
  const { to, firstName, temporaryPassword, loginUrl = 'http://localhost:5173/login', tenantId } = params;

  const result = await sendEmailWithConfig(
    tenantId,
    to,
    'Welcome to EnterpriseGlue - Your Account Details',
    getWelcomeEmailHtml({ to, firstName, temporaryPassword, loginUrl }),
    getWelcomeEmailText({ to, firstName, temporaryPassword, loginUrl }),
  );

  if (result.success) {
    logger.info(`✅ Welcome email sent to ${to}`);
  } else {
    logger.error(`❌ Failed to send welcome email to ${to}: ${result.error}`);
  }

  return result;
}

export interface VerificationEmailParams {
  to: string;
  firstName?: string;
  verificationUrl: string;
  tenantId?: string;
}

/**
 * Send email verification link to user
 */
export async function sendVerificationEmail(params: VerificationEmailParams): Promise<{ success: boolean; error?: string }> {
  const { to, firstName, verificationUrl, tenantId } = params;

  const result = await sendEmailWithConfig(
    tenantId,
    to,
    'Verify Your Email - EnterpriseGlue',
    getVerificationEmailHtml({ firstName, verificationUrl }),
    getVerificationEmailText({ firstName, verificationUrl }),
  );

  if (result.success) {
    logger.info(`✅ Verification email sent to ${to}`);
  } else {
    logger.error(`❌ Failed to send verification email to ${to}: ${result.error}`);
  }

  return result;
}
