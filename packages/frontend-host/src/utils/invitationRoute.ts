/** Enrollment uses its own HttpOnly credential, not an authenticated session. */
export function isInvitationEnrollmentRoute(pathname: string): boolean {
  return /^(?:\/t\/[^/]+)?\/invite\/[^/]+\/?$/.test(pathname);
}
