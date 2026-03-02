import { Link } from 'react-router-dom';
import { Button, Tile } from '@carbon/react';
import { Login, UserAdmin } from '@carbon/icons-react';
import { ExtensionSlot } from '../enterprise/ExtensionSlot';
import { isMultiTenantEnabled } from '../enterprise/extensionRegistry';

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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-6)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-6)' }}>
          <UserAdmin size={48} style={{ color: 'var(--cds-interactive-01)', marginBottom: 'var(--spacing-4)' }} />
          <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: 'var(--spacing-2)' }}>
            Account Registration
          </h1>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            Self-service signup is not available
          </p>
        </div>

        <Tile style={{ padding: 'var(--spacing-6)' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-4)', lineHeight: '1.5' }}>
              This EnterpriseGlue instance is configured for single-tenant mode.
              New user accounts must be created by a platform administrator.
            </p>
            <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px', marginBottom: 'var(--spacing-5)' }}>
              Please contact your administrator to request access.
            </p>
            <Link to="/login">
              <Button renderIcon={Login} style={{ width: '100%' }}>
                Go to Login
              </Button>
            </Link>
          </div>
        </Tile>

        <p style={{ textAlign: 'center', marginTop: 'var(--spacing-5)', color: 'var(--color-text-secondary)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--cds-link-01)' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
