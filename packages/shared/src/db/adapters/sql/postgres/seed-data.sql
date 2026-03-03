-- PostgreSQL Seed Data
-- Environment Tags
INSERT INTO environment_tags (id, name, color, manual_deploy_allowed, sort_order, is_default, created_at, updated_at) 
VALUES 
  ('env-dev', 'Dev', '#22c55e', true, 0, true, $1, $1),
  ('env-test', 'Test', '#3b82f6', true, 1, false, $1, $1),
  ('env-acc', 'Acceptance', '#f59e0b', true, 2, false, $1, $1),
  ('env-prod', 'Production', '#ef4444', false, 3, false, $1, $1)
ON CONFLICT (id) DO NOTHING;

-- Platform Settings
INSERT INTO platform_settings (id, updated_at) 
VALUES ('default', $1)
ON CONFLICT (id) DO NOTHING;

-- Default Tenant
INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
SELECT 'tenant-default', 'Default Tenant', 'default', 'active', $1, $1
WHERE NOT EXISTS (
  SELECT 1 FROM tenants WHERE slug = 'default'
);

INSERT INTO tenant_settings (tenant_id, updated_at)
SELECT 'tenant-default', $1
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_settings WHERE tenant_id = 'tenant-default'
);

-- Email Templates
INSERT INTO email_templates (id, type, name, subject, html_template, text_template, variables, is_active, created_at, updated_at)
VALUES 
  ('tpl-invite', 'invite', 'User Invitation', 'You''ve been invited to {{platformName}}', 
   '<h1>Welcome!</h1><p>You have been invited to join {{platformName}}.</p><p><a href="{{inviteUrl}}">Accept Invitation</a></p>',
   'Welcome! You have been invited to join {{platformName}}. Accept here: {{inviteUrl}}',
   '["platformName", "inviteUrl", "inviterName"]', true, $1, $1),
  ('tpl-verify', 'verification', 'Email Verification', 'Verify your email for {{platformName}}',
   '<h1>Verify Your Email</h1><p>Please verify your email address by clicking the link below.</p><p><a href="{{verificationUrl}}">Verify Email</a></p>',
   'Please verify your email address: {{verificationUrl}}',
   '["platformName", "verificationUrl"]', true, $1, $1),
  ('tpl-reset', 'password_reset', 'Password Reset', 'Reset your {{platformName}} password',
   '<h1>Password Reset</h1><p>Click the link below to reset your password.</p><p><a href="{{resetUrl}}">Reset Password</a></p>',
   'Reset your password: {{resetUrl}}',
   '["platformName", "resetUrl"]', true, $1, $1)
ON CONFLICT (id) DO NOTHING;

-- SSO Claims Mappings
INSERT INTO sso_claims_mappings (id, provider_id, claim_type, claim_key, claim_value, target_role, priority, is_active, created_at, updated_at)
VALUES
  ('default-admin-group', NULL, 'group', 'groups', 'Platform Admins', 'admin', 100, true, $1, $1),
  ('default-user-group', NULL, 'group', 'groups', 'Platform Users', 'user', 50, true, $1, $1)
ON CONFLICT (id) DO NOTHING;
