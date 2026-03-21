/**
 * Authentication routes
 * Handles login, logout, token refresh, password management, email verification, Microsoft OAuth
 */

import loginRoute from './login.js';
import logoutRoute from './logout.js';
import refreshRoute from './refresh.js';
import passwordRoute from './password.js';
import meRoute from './me.js';
import verifyEmailRoute from './verify-email.js';
import microsoftRoute from './microsoft.js';
import forgotPasswordRoute from './forgot-password.js';
import ssoConfigRoute from './sso-config.js';
import samlRoute from './saml.js';
import onboardingRoute from './onboarding.js';

export {
  loginRoute,
  logoutRoute,
  refreshRoute,
  passwordRoute,
  meRoute,
  verifyEmailRoute,
  microsoftRoute,
  samlRoute,
  forgotPasswordRoute,
  ssoConfigRoute,
  onboardingRoute,
};
