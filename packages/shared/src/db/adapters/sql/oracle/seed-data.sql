-- Oracle Seed Data
-- Note: Oracle uses MERGE for upsert operations instead of ON CONFLICT

-- Environment Tags
MERGE INTO environment_tags t
USING (SELECT 'env-dev' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, name, color, manual_deploy_allowed, sort_order, is_default, created_at, updated_at)
VALUES ('env-dev', 'Dev', '#22c55e', 1, 0, 1, :now, :now);

MERGE INTO environment_tags t
USING (SELECT 'env-test' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, name, color, manual_deploy_allowed, sort_order, is_default, created_at, updated_at)
VALUES ('env-test', 'Test', '#3b82f6', 1, 1, 0, :now, :now);

MERGE INTO environment_tags t
USING (SELECT 'env-acc' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, name, color, manual_deploy_allowed, sort_order, is_default, created_at, updated_at)
VALUES ('env-acc', 'Acceptance', '#f59e0b', 1, 2, 0, :now, :now);

MERGE INTO environment_tags t
USING (SELECT 'env-prod' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, name, color, manual_deploy_allowed, sort_order, is_default, created_at, updated_at)
VALUES ('env-prod', 'Production', '#ef4444', 0, 3, 0, :now, :now);

-- Platform Settings
MERGE INTO platform_settings t
USING (SELECT 'default' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, updated_at) VALUES ('default', :now);

-- Default Tenant
MERGE INTO tenants t
USING (SELECT 'tenant-default' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, name, slug, status, created_at, updated_at)
VALUES ('tenant-default', 'Default Tenant', 'default', 'active', :now, :now);

MERGE INTO tenant_settings t
USING (SELECT 'tenant-default' AS tenant_id FROM DUAL) s ON (t.tenant_id = s.tenant_id)
WHEN NOT MATCHED THEN INSERT (tenant_id, updated_at) VALUES ('tenant-default', :now);

-- Email Templates
MERGE INTO email_templates t
USING (SELECT 'tpl-invite' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, type, name, subject, html_template, text_template, variables, is_active, created_at, updated_at)
VALUES ('tpl-invite', 'invite', 'User Invitation', 'You''ve been invited to {{platformName}}', 
  '<h1>Welcome!</h1><p>You have been invited to join {{platformName}}.</p><p><a href="{{inviteUrl}}">Accept Invitation</a></p>',
  'Welcome! You have been invited to join {{platformName}}. Accept here: {{inviteUrl}}',
  '["platformName", "inviteUrl", "inviterName"]', 1, :now, :now);

MERGE INTO email_templates t
USING (SELECT 'tpl-verify' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, type, name, subject, html_template, text_template, variables, is_active, created_at, updated_at)
VALUES ('tpl-verify', 'verification', 'Email Verification', 'Verify your email for {{platformName}}',
  '<h1>Verify Your Email</h1><p>Please verify your email address by clicking the link below.</p><p><a href="{{verificationUrl}}">Verify Email</a></p>',
  'Please verify your email address: {{verificationUrl}}',
  '["platformName", "verificationUrl"]', 1, :now, :now);

MERGE INTO email_templates t
USING (SELECT 'tpl-reset' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, type, name, subject, html_template, text_template, variables, is_active, created_at, updated_at)
VALUES ('tpl-reset', 'password_reset', 'Password Reset', 'Reset your {{platformName}} password',
  '<h1>Password Reset</h1><p>Click the link below to reset your password.</p><p><a href="{{resetUrl}}">Reset Password</a></p>',
  'Reset your password: {{resetUrl}}',
  '["platformName", "resetUrl"]', 1, :now, :now);

-- SSO Claims Mappings
MERGE INTO sso_claims_mappings t
USING (SELECT 'default-admin-group' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, provider_id, claim_type, claim_key, claim_value, target_role, priority, is_active, created_at, updated_at)
VALUES ('default-admin-group', NULL, 'group', 'groups', 'Platform Admins', 'admin', 100, 1, :now, :now);

MERGE INTO sso_claims_mappings t
USING (SELECT 'default-user-group' AS id FROM DUAL) s ON (t.id = s.id)
WHEN NOT MATCHED THEN INSERT (id, provider_id, claim_type, claim_key, claim_value, target_role, priority, is_active, created_at, updated_at)
VALUES ('default-user-group', NULL, 'group', 'groups', 'Platform Users', 'user', 50, 1, :now, :now);
