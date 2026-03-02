import { PaintBrush } from '@carbon/icons-react';
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../shared/components/PageLayout';
import BrandingSettingsTab from '../../features/platform-admin/components/BrandingSettingsTab';

export default function Branding() {
  return (
    <PageLayout
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-5)',
        background: 'var(--color-bg-primary)',
        minHeight: '100vh',
      }}
    >
      <PageHeader
        icon={PaintBrush}
        title="Branding"
        subtitle="Configure platform-wide branding (applies across all tenants)"
        gradient={PAGE_GRADIENTS.red}
      />

      <div style={{ padding: 'var(--spacing-5)' }}>
        <BrandingSettingsTab />
      </div>
    </PageLayout>
  );
}
