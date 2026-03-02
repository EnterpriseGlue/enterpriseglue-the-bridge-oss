import React from 'react'
import { Toggle, Tile } from '@carbon/react'
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid'
import GitProvidersSettings from './GitProvidersSettings'
import type { PlatformSettings } from '../../../api/platform-admin'

interface GitSettingsSectionProps {
  settings: PlatformSettings | undefined
  gitProviders: any[]
  gitProvidersLoading: boolean
  onToggle: (key: 'syncPushEnabled' | 'syncPullEnabled' | 'gitProjectTokenSharingEnabled', value: boolean) => void
  onUpdateGitProvider: (id: string, updates: any) => Promise<void>
}

export function GitSettingsSection({
  settings,
  gitProviders,
  gitProvidersLoading,
  onToggle,
  onUpdateGitProvider,
}: GitSettingsSectionProps) {
  return (
    <PlatformGrid style={{ paddingInline: 0, alignItems: 'stretch' }}>
      <PlatformRow>
        <PlatformCol
          sm={4}
          md={4}
          lg={8}
          style={{ display: 'flex', flexDirection: 'column', marginInlineStart: 0 }}
        >
          <Tile style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>
              Git Sync Options
            </h3>
            <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Configure how StarBase syncs with Git repositories.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
              <Toggle
                id="sync-push"
                labelText="Push (StarBase → Git)"
                labelA="Off"
                labelB="On"
                toggled={settings?.syncPushEnabled ?? true}
                onToggle={(checked) => onToggle('syncPushEnabled', checked)}
              />
              <Toggle
                id="sync-pull"
                labelText="Pull (Git → StarBase)"
                labelA="Off"
                labelB="On"
                toggled={settings?.syncPullEnabled ?? false}
                onToggle={(checked) => onToggle('syncPullEnabled', checked)}
              />
              {/* Token reuse toggle removed — tokens now stored at project level */}
            </div>
          </Tile>
        </PlatformCol>

        <PlatformCol
          sm={4}
          md={4}
          lg={8}
          style={{ display: 'flex', flexDirection: 'column', marginInlineEnd: 0 }}
        >
          <Tile style={{ flex: 1 }}>
            <GitProvidersSettings
              providers={gitProviders || []}
              isLoading={gitProvidersLoading}
              onUpdateProvider={onUpdateGitProvider}
            />
          </Tile>
        </PlatformCol>
      </PlatformRow>
    </PlatformGrid>
  )
}
