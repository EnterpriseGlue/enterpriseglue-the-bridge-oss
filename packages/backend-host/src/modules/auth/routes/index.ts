/**
 * Authentication routes
 * Handles login, logout, token refresh, password management, email verification, and provider-neutral identity login.
 */

import loginRoute from './login.js';
import logoutRoute from './logout.js';
import refreshRoute from './refresh.js';
import passwordRoute from './password.js';
import meRoute from './me.js';
import verifyEmailRoute from './verify-email.js';
import forgotPasswordRoute from './forgot-password.js';
import ssoConfigRoute from './sso-config.js';
import onboardingRoute from './onboarding.js';
import identityOidcRoute from './identity-oidc.js';

export {
  loginRoute,
  logoutRoute,
  refreshRoute,
  passwordRoute,
  meRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  ssoConfigRoute,
  onboardingRoute,
  identityOidcRoute,
};
