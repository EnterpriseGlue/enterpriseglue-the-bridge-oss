import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ClickableTile, InlineNotification, Search, Stack, Tag, Tile } from '@carbon/react'
import { type OrganizationMembership } from './OrganizationSession'

export function OrganizationList({ memberships, lastOrganization, onChoose, busy }: {
  memberships: OrganizationMembership[]
  lastOrganization: string | null
  onChoose: (membership: OrganizationMembership) => void
  busy: boolean
}) {
  const [filter, setFilter] = useState('')
  const [focusedId, setFocusedId] = useState<string>()
  const instructionsId = useId()
  const links = useRef(new Map<string, HTMLAnchorElement>())
  const firstFocus = useRef(false)
  const items = useMemo(() => memberships
    .filter((item) => `${item.tenantName} ${item.tenantSlug}`.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) =>
      Number(b.tenantId === lastOrganization) - Number(a.tenantId === lastOrganization)
      || a.tenantName.localeCompare(b.tenantName) || a.tenantSlug.localeCompare(b.tenantSlug),
    ), [filter, lastOrganization, memberships])
  const selectable = items.filter((item) => item.tenantStatus === 'active')
  const tabStop = selectable.find((item) => item.tenantId === focusedId)?.tenantId ?? selectable[0]?.tenantId

  useEffect(() => {
    if (firstFocus.current || !tabStop) return
    firstFocus.current = true
    links.current.get(tabStop)?.focus({ preventScroll: true })
  }, [tabStop])

  return (
    <Stack gap={4}>
      {memberships.length > 7 && (
        <Search id="organization-search" labelText="Search organizations" placeholder="Search organizations"
          value={filter} onChange={(event) => setFilter(event.target.value)} />
      )}
      {items.length === 0 && <InlineNotification
        kind="info" lowContrast hideCloseButton
        title={filter ? 'No organizations match your search' : 'No organizations yet'}
      />}
      {selectable.length > 1 && <p id={instructionsId} className="eg-organization-keyboard-help">
        Use the arrow keys to choose an organization. Press Enter to open it.
      </p>}
      <div role="listbox" aria-label="Your organizations" aria-orientation="vertical"
        aria-describedby={selectable.length > 1 ? instructionsId : undefined}
        aria-busy={busy} className="eg-organization-list">
        {items.map((item) => {
          const details = <>
            <span className="cds--type-heading-compact-01">{item.tenantName}</span>
            <span className="eg-organization-slug cds--type-body-compact-01">{item.tenantSlug}</span>
          </>
          return (
            <div role="presentation" key={item.tenantId}>
              {item.tenantStatus === 'active' ? (
                <ClickableTile
                  ref={(link) => { if (link) links.current.set(item.tenantId, link); else links.current.delete(item.tenantId) }}
                  role="option"
                  aria-selected={item.tenantId === tabStop}
                  clicked={item.tenantId === tabStop}
                  tabIndex={item.tenantId === tabStop ? 0 : -1}
                  onFocus={() => setFocusedId(item.tenantId)}
                  aria-disabled={busy}
                  onKeyDown={(event) => {
                    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
                    if (!step && event.key !== 'Home' && event.key !== 'End') return
                    event.preventDefault()
                    const current = selectable.findIndex((candidate) => candidate.tenantId === item.tenantId)
                    const index = event.key === 'Home' ? 0 : event.key === 'End' ? selectable.length - 1
                      : (current + step + selectable.length) % selectable.length
                    const next = selectable[index]
                    links.current.get(next.tenantId)?.focus()
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    if (!busy) onChoose(item)
                  }}>
                  {details}
                </ClickableTile>
              ) : (
                <Tile role="option" aria-selected={false} aria-disabled="true">
                  {details}
                  <Tag size="sm" type="gray">{
                    item.tenantStatus === 'provisioning' ? 'Setting up'
                      : item.tenantStatus === 'suspended' ? 'Suspended' : 'Unavailable'
                  }</Tag>
                </Tile>
              )}
            </div>
          )
        })}
      </div>
    </Stack>
  )
}
