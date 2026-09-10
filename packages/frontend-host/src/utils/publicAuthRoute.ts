import { isInvitationEnrollmentRoute } from './invitationRoute.js';

const SESSION_AWARE_PUBLIC_AUTH_ROUTE_PATTERN =
  /^(?:\/t\/[^/]+)?\/(?:login|admin-recovery|verify-email|forgot-password|password-reset|resend-verification)\/?$/;

const ROOT_SIGNUP_ROUTE_PATTERN = /^\/signup\/?$/;

export type PublicAuthRoutePolicy = Readonly<{
  skipSessionBootstrap: boolean;
}>;

/**
 * Classifies exact public authentication routes for both unauthorized-response
 * handling and initial session bootstrap. Login and recovery pages remain
 * public, but still restore a valid cookie session for their in-place redirect.
 * Signup and invitation enrollment leave the page after success, so they skip
 * the session probe entirely.
 */
export function getPublicAuthRoutePolicy(pathname: string): PublicAuthRoutePolicy | null {
  if (ROOT_SIGNUP_ROUTE_PATTERN.test(pathname) || isInvitationEnrollmentRoute(pathname)) {
    return { skipSessionBootstrap: true };
  }
  if (SESSION_AWARE_PUBLIC_AUTH_ROUTE_PATTERN.test(pathname)) {
    return { skipSessionBootstrap: false };
  }
  return null;
}
