import React from 'react'
import { Checkbox, Toggletip, ToggletipButton, ToggletipContent } from '@carbon/react'
import { Information } from '@carbon/icons-react'

interface ExecutionOptionsPanelProps {
  skipCustomListeners: boolean
  onSkipCustomListenersChange: (checked: boolean) => void
  skipIoMappings: boolean
  onSkipIoMappingsChange: (checked: boolean) => void
  /** Unique prefix for checkbox IDs to avoid collisions when used in multiple places */
  idPrefix?: string
}

export function ExecutionOptionsPanel({
  skipCustomListeners,
  onSkipCustomListenersChange,
  skipIoMappings,
  onSkipIoMappingsChange,
  idPrefix = 'exec-opt',
}: ExecutionOptionsPanelProps) {
  return (
    <>
      <div>
        <Checkbox
          id={`${idPrefix}-skip-listeners`}
          labelText={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Skip custom listeners
              <Toggletip align="bottom" autoAlign>
                <ToggletipButton label="Learn more about Skip custom listeners">
                  <Information size={14} />
                </ToggletipButton>
                <ToggletipContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                      <strong>What it does:</strong> Execution and task listeners on affected activities will not be triggered.
                    </p>
                    <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                      <strong>When to use:</strong> If listeners cause side effects (emails, external calls, audit logs) you want to avoid.
                    </p>
                    <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                      <strong>Impact:</strong> Listener logic is skipped; the activity&apos;s core business logic still executes.
                    </p>
                  </div>
                </ToggletipContent>
              </Toggletip>
            </span>
          }
          checked={skipCustomListeners}
          onChange={(_: any, data: any) => onSkipCustomListenersChange(!!data.checked)}
        />
      </div>
      <div>
        <Checkbox
          id={`${idPrefix}-skip-io`}
          labelText={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Skip IO mappings
              <Toggletip align="bottom" autoAlign>
                <ToggletipButton label="Learn more about Skip IO mappings">
                  <Information size={14} />
                </ToggletipButton>
                <ToggletipContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                      <strong>What it does:</strong> Input/output variable mappings on affected activities will not be executed.
                    </p>
                    <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                      <strong>When to use:</strong> If mappings would overwrite data you want to preserve, or source variables aren&apos;t available.
                    </p>
                    <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                      <strong>Impact:</strong> Variables won&apos;t be copied into/out of the activity scope. Existing scope variables are used instead.
                    </p>
                  </div>
                </ToggletipContent>
              </Toggletip>
            </span>
          }
          checked={skipIoMappings}
          onChange={(_: any, data: any) => onSkipIoMappingsChange(!!data.checked)}
        />
      </div>
    </>
  )
}
