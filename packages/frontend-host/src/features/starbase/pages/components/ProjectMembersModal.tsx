import React from 'react'
import {
  Button,
  DataTable,
  DataTableSkeleton,
  InlineNotification,
  Tag,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  OverflowMenu,
  OverflowMenuItem,
  ComposedModal,
  ModalHeader,
  ModalBody,
} from '@carbon/react'
import { StarbaseTableShell } from '../../components/StarbaseTableShell'
import type { ProjectMember, ProjectRole } from '../../components/project-detail'

interface ProjectMembersModalProps {
  open: boolean
  onClose: () => void
  membersLoading: boolean
  membersError: boolean
  members: ProjectMember[]
  memberHeaders: Array<{ key: string; header: string }>
  visibleRows: Array<{ id: string; name?: string; email?: string }>
  collaboratorsSearch: string
  setCollaboratorsSearch: (value: string) => void
  collaboratorsSearchExpanded: boolean
  setCollaboratorsSearchExpanded: (value: boolean) => void
  canManageMembers: boolean
  onInvite: () => void
  onAddUser: () => void
  onEditRoles: (member: ProjectMember) => void
  onToggleDeploy: (member: ProjectMember, next: boolean) => void
  onRemove: (member: ProjectMember) => void
  tagTypeForRole: (role: ProjectRole) => any
}

export const ProjectMembersModal = ({
  open,
  onClose,
  membersLoading,
  membersError,
  members,
  memberHeaders,
  visibleRows,
  collaboratorsSearch,
  setCollaboratorsSearch,
  collaboratorsSearchExpanded,
  setCollaboratorsSearchExpanded,
  canManageMembers,
  onInvite,
  onAddUser,
  onEditRoles,
  onToggleDeploy,
  onRemove,
  tagTypeForRole,
}: ProjectMembersModalProps) => (
  <ComposedModal open={open} size="lg" onClose={onClose}>
    <ModalHeader label="" title="Project members" closeModal={onClose} />
    <ModalBody>
      <div data-eg-collaborators-panel>
        {membersLoading && (
          <div style={{ paddingTop: 'var(--spacing-3)' }}>
            <DataTableSkeleton showHeader={false} showToolbar={false} rowCount={6} columnCount={memberHeaders.length} headers={memberHeaders as any} />
          </div>
        )}
        {membersError && (
          <div style={{ paddingTop: 'var(--spacing-3)' }}>
            <InlineNotification lowContrast kind="error" title="Failed to load members" />
          </div>
        )}

        {!membersLoading && !membersError && (
          <div style={{ height: '60vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <DataTable rows={visibleRows} headers={memberHeaders}>
                {({ rows, headers, getHeaderProps, getRowProps, getTableProps, getToolbarProps }) => {
                  const toolbarProps: any = getToolbarProps()
                  return (
                    <StarbaseTableShell>
                      <TableToolbar
                        {...toolbarProps}
                        className={`${toolbarProps.className || ''} cds--table-toolbar--sm`.trim()}
                      >
                        <TableToolbarContent>
                          <TableToolbarSearch
                            size="sm"
                            expanded={collaboratorsSearchExpanded}
                            onExpand={() => setCollaboratorsSearchExpanded(true)}
                            onBlur={() => {
                              if (!collaboratorsSearch) setCollaboratorsSearchExpanded(false)
                            }}
                            value={collaboratorsSearch}
                            onChange={(e: any) => setCollaboratorsSearch(e.target.value)}
                            placeholder="Search project members"
                          />
                          {canManageMembers && (
                            <>
                              <Button kind="tertiary" size="sm" onClick={onInvite}>
                                Invite
                              </Button>
                              <Button kind="primary" size="sm" onClick={onAddUser}>
                                Add user
                              </Button>
                            </>
                          )}
                        </TableToolbarContent>
                      </TableToolbar>

                      <Table {...getTableProps()} size="sm">
                        <TableHead>
                          <TableRow>
                            {headers.map((h) => {
                              const { key, ...headerProps } = getHeaderProps({ header: h })
                              return (
                                <TableHeader
                                  key={key}
                                  {...headerProps}
                                  style={h.key === 'actions' ? { width: 44 } : undefined}
                                >
                                  {h.header}
                                </TableHeader>
                              )
                            })}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.map((r) => {
                            const rowProps: any = getRowProps({ row: r })
                            const member = members.find((m: ProjectMember) => m.userId === r.id)
                            const roles = member
                              ? ((Array.isArray(member.roles) && member.roles.length > 0 ? member.roles : [member.role]) as ProjectRole[])
                              : ([] as ProjectRole[])
                            const isOwner = roles.includes('owner')
                            const isEditor = String(member?.role) === 'editor'

                            const name = r.cells.find((c) => c.info.header === 'name')?.value
                            const email = member?.user?.email || ''

                            return (
                              <TableRow key={rowProps.key} {...rowProps}>
                                <TableCell style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                    {email ? (
                                      <div style={{ color: 'var(--cds-text-secondary, #6f6f6f)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {email}
                                      </div>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {roles.map((role) => (
                                      <Tag key={role} type={tagTypeForRole(role)} size="sm">
                                        {role}
                                      </Tag>
                                    ))}
                                    {isEditor && (member as any)?.deployAllowed ? (
                                      <Tag key="deploy" type="green" size="sm">
                                        deploy
                                      </Tag>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell style={{ textAlign: 'right' }}>
                                  {canManageMembers && !isOwner ? (
                                    <OverflowMenu size="sm" flipped iconDescription="Options">
                                      <OverflowMenuItem itemText="Edit roles" onClick={() => member && onEditRoles(member)} />
                                      {isEditor && (
                                        <OverflowMenuItem
                                          itemText={(member as any)?.deployAllowed ? 'Revoke deploy permission' : 'Grant deploy permission'}
                                          onClick={() => member && onToggleDeploy(member, !(member as any)?.deployAllowed)}
                                        />
                                      )}
                                      <OverflowMenuItem itemText="Remove" isDelete hasDivider onClick={() => member && onRemove(member)} />
                                    </OverflowMenu>
                                  ) : null}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </StarbaseTableShell>
                  )
                }}
              </DataTable>
            </div>
          </div>
        )}
      </div>
    </ModalBody>
  </ComposedModal>
)
