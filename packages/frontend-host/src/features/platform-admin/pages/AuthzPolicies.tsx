import React from 'react';
import AccessControl from './AccessControl';

/** Keep the existing policy entry point on the canonical editor and permission catalogue. */
export default function AuthzPolicies() {
  return <AccessControl initialSection="policies" />;
}
