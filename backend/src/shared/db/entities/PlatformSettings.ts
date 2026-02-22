import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity({ name: 'platform_settings', schema: 'main' })
export class PlatformSettings {
  @PrimaryColumn({ type: 'text', default: 'default' })
  id!: string;

  @Column({ name: 'default_environment_tag_id', type: 'text', nullable: true })
  defaultEnvironmentTagId!: string | null;

  @Column({ name: 'sync_push_enabled', type: 'boolean', default: true })
  syncPushEnabled!: boolean;

  @Column({ name: 'sync_pull_enabled', type: 'boolean', default: false })
  syncPullEnabled!: boolean;

  @Column({ name: 'sync_both_enabled', type: 'boolean', default: false })
  syncBothEnabled!: boolean;

  @Column({ name: 'git_project_token_sharing_enabled', type: 'boolean', default: false })
  gitProjectTokenSharingEnabled!: boolean;

  @Column({ name: 'default_deploy_roles', type: 'text', default: '["owner","delegate","operator","deployer"]' })
  defaultDeployRoles!: string;

  @Column({ name: 'invite_allow_all_domains', type: 'boolean', default: true })
  inviteAllowAllDomains!: boolean;

  @Column({ name: 'invite_allowed_domains', type: 'text', default: '[]' })
  inviteAllowedDomains!: string;

  @Column({ name: 'sso_auto_redirect_single_provider', type: 'boolean', default: false })
  ssoAutoRedirectSingleProvider!: boolean;

  @Column({ name: 'pii_regex_enabled', type: 'boolean', default: false })
  piiRegexEnabled!: boolean;

  @Column({ name: 'pii_external_provider_enabled', type: 'boolean', default: false })
  piiExternalProviderEnabled!: boolean;

  @Column({ name: 'pii_external_provider_type', type: 'text', nullable: true })
  piiExternalProviderType!: string | null;

  @Column({ name: 'pii_external_provider_endpoint', type: 'text', nullable: true })
  piiExternalProviderEndpoint!: string | null;

  @Column({ name: 'pii_external_provider_auth_header', type: 'text', nullable: true })
  piiExternalProviderAuthHeader!: string | null;

  @Column({ name: 'pii_external_provider_auth_token', type: 'text', nullable: true })
  piiExternalProviderAuthToken!: string | null;

  @Column({ name: 'pii_external_provider_project_id', type: 'text', nullable: true })
  piiExternalProviderProjectId!: string | null;

  @Column({ name: 'pii_external_provider_region', type: 'text', nullable: true })
  piiExternalProviderRegion!: string | null;

  @Column({ name: 'pii_redaction_style', type: 'text', default: '<TYPE>' })
  piiRedactionStyle!: string;

  @Column({ name: 'pii_scopes', type: 'text', default: '["processDetails","history","logs","errors","audit"]' })
  piiScopes!: string;

  @Column({ name: 'pii_max_payload_size_bytes', type: 'integer', default: 262144 })
  piiMaxPayloadSizeBytes!: number;

  @Column({ name: 'email_platform_name', type: 'text', default: 'EnterpriseGlue' })
  emailPlatformName!: string;

  @Column({ name: 'logo_url', type: 'text', nullable: true })
  logoUrl!: string | null;

  @Column({ name: 'login_logo_url', type: 'text', nullable: true })
  loginLogoUrl!: string | null;

  @Column({ name: 'login_title_vertical_offset', type: 'integer', default: 0 })
  loginTitleVerticalOffset!: number;

  @Column({ name: 'login_title_color', type: 'text', nullable: true })
  loginTitleColor!: string | null;

  @Column({ name: 'logo_title', type: 'text', nullable: true })
  logoTitle!: string | null;

  @Column({ name: 'logo_scale', type: 'integer', default: 100 })
  logoScale!: number;

  @Column({ name: 'title_font_url', type: 'text', nullable: true })
  titleFontUrl!: string | null;

  @Column({ name: 'title_font_weight', type: 'text', default: '600' })
  titleFontWeight!: string;

  @Column({ name: 'title_font_size', type: 'integer', default: 14 })
  titleFontSize!: number;

  @Column({ name: 'title_vertical_offset', type: 'integer', default: 0 })
  titleVerticalOffset!: number;

  @Column({ name: 'menu_accent_color', type: 'text', nullable: true })
  menuAccentColor!: string | null;

  @Column({ name: 'favicon_url', type: 'text', nullable: true })
  faviconUrl!: string | null;

  @Column({ name: 'updated_at', type: 'bigint' })
  updatedAt!: number;

  @Column({ name: 'updated_by_id', type: 'text', nullable: true })
  updatedById!: string | null;
}
