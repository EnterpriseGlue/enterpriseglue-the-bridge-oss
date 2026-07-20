/** Provider-neutral normalized identity claims used by OIDC, SAML, and LDAP. */
export interface IdentityClaims {
  email?: string;
  groups?: string[];
  roles?: string[];
  [key: string]: unknown;
}
