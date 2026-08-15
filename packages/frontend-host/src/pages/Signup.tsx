import { Link } from 'react-router-dom';
import { Button, InlineNotification } from '@carbon/react';
import { Login } from '@carbon/icons-react';
import { ExtensionSlot } from '../enterprise/ExtensionSlot';
import { isMultiTenantEnabled } from '../enterprise/extensionRegistry';
import PublicAuthShell from '../shared/components/PublicAuthShell';

/**
 * OSS Signup Page
 * 
 * In OSS single-tenant mode, self-service signup is disabled.
 * Users must be created by a platform administrator.
 * 
 * In EE multi-tenant mode, the full signup flow (with tenant creation)
 * is provided via the 'signup-form' extension slot.
 */
export default function Signup() {
  // Check if EE multi-tenant signup is available
  const multiTenantEnabled = isMultiTenantEnabled();
  
  // If EE plugin provides a signup form, render it
  if (multiTenantEnabled) {
    return <ExtensionSlot name="signup-form" fallback={<OSSSignupMessage />} />;
  }
  
  // OSS: Show message that signup is not available
  return <OSSSignupMessage />;
}

/**
 * OSS Signup Message - Displayed when self-service signup is disabled
 */
function OSSSignupMessage() {
  return (
    <PublicAuthShell
      title="Account registration"
      description="Self-service signup is not available on this EnterpriseGlue instance."
    >
      <InlineNotification
        kind="info"
        lowContrast
        hideCloseButton
        title="Administrator-created accounts"
        subtitle="This OSS installation uses single-tenant account administration. Contact a platform administrator to request access."
      />
      <div className="eg-public-auth-actions">
        <Button as={Link} to="/login" renderIcon={Login}>Go to login</Button>
      </div>
    </PublicAuthShell>
  );
}
