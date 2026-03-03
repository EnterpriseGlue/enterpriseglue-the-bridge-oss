import React from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BreadcrumbLink, BreadcrumbText, BreadcrumbSeparator } from './BreadcrumbHelpers'
import FileMenu from './FileMenu'
import { useDecisionsFilterStore } from '../../mission-control/shared/stores/decisionsFilterStore'
import { Copy } from '@carbon/icons-react'
import { apiClient } from '../../../shared/api/client'

type Project = { id: string; name: string }
type FileDetail = { id: string; name: string; projectId: string }

export default function Breadcrumbs() {
  const location = useLocation() as { pathname: string; state?: any }
  const { pathname } = location
  const { projectId, fileId, instanceId, id: decisionInstanceId } = useParams()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const effectivePathname = tenantSlug ? (pathname.replace(/^\/t\/[^/]+/, '') || '/') : pathname
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)
  
  // Get selected decision from store
  const selectedDecision = useDecisionsFilterStore((state) => state.selectedDefinition)
  const [copiedDecisionId, setCopiedDecisionId] = React.useState(false)

  // Path detection
  const paths = {
    isVoyagerHome: effectivePathname === '/',
    onProjectPage: effectivePathname.includes('/starbase/project/'),
    onEditorPage: effectivePathname.includes('/starbase/editor/'),
    onMissionControl: effectivePathname.startsWith('/mission-control'),
    onProcesses: effectivePathname.includes('/mission-control/processes'),
    onInstanceDetail: effectivePathname.includes('/mission-control/processes/instances/'),
    onMigration: effectivePathname.includes('/mission-control/migration'),
    onBatches: effectivePathname.includes('/mission-control/batches'),
    onDecisions: effectivePathname.includes('/mission-control/decisions'),
    onDecisionHistoryDetail: effectivePathname.includes('/mission-control/decisions/instances/'),
    onEngines: effectivePathname.includes('/engines'),
    onLeia: effectivePathname.startsWith('/admin'),
    onUserManagement: effectivePathname === '/admin/users',
    onAuditLogs: effectivePathname === '/admin/audit-logs',
    onPlatformSettings: effectivePathname === '/admin/settings',
    onGitConnections: false, // Git Connections page removed — redirects to StarBase
  }
  
  const folderId = searchParams.get('folder') || null

  // Data fetching
  const fileQ = useQuery({
    queryKey: ['file-breadcrumb', fileId],
    queryFn: () => apiClient.get<FileDetail>(`/starbase-api/files/${fileId}`),
    enabled: paths.onEditorPage && !!fileId,
  })

  const projectsQ = useQuery({
    queryKey: ['starbase', 'projects'],
    queryFn: () => apiClient.get<Project[]>('/starbase-api/projects'),
    enabled: paths.onProjectPage || paths.onEditorPage,
    staleTime: 60 * 1000,
  })

  const computedProjectId = paths.onEditorPage ? fileQ.data?.projectId : projectId

  const projectFolderCrumbQ = useQuery({
    queryKey: ['project-folder-breadcrumb', computedProjectId, folderId],
    queryFn: () => apiClient.get<{ breadcrumb: Array<{ id: string; name: string }> }>(
      `/starbase-api/projects/${computedProjectId}/contents`,
      { folderId: folderId || '' }
    ),
    enabled: paths.onProjectPage && !!computedProjectId && !!folderId,
  })

  const fileFolderId = paths.onEditorPage ? (fileQ.data as any)?.folderId as (string | null | undefined) : null
  const editorFolderCrumbQ = useQuery({
    queryKey: ['editor-folder-breadcrumb', computedProjectId, fileFolderId],
    queryFn: () => apiClient.get<{ breadcrumb: Array<{ id: string; name: string }> }>(
      `/starbase-api/projects/${computedProjectId}/contents`,
      { folderId: fileFolderId || '' }
    ),
    enabled: paths.onEditorPage && !!computedProjectId && !!fileFolderId,
  })

  const projectName = React.useMemo(() => {
    if (!projectsQ.data || !computedProjectId) return undefined
    return projectsQ.data.find((p) => p.id === computedProjectId)?.name
  }, [projectsQ.data, computedProjectId])

  const fileName = paths.onEditorPage ? fileQ.data?.name : undefined
  const fileType = paths.onEditorPage ? (fileQ.data as any)?.type as ('bpmn'|'dmn'|undefined) : undefined
  const [localName, setLocalName] = React.useState<string | undefined>(undefined)
  const displayFileName = localName ?? fileName

  // File rename state
  const [editing, setEditing] = React.useState<boolean>(false)
  const [draftName, setDraftName] = React.useState<string>('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  // Auto-enter edit mode if navigated with editName state
  const consumedEditNameRef = React.useRef(false)
  React.useEffect(() => {
    consumedEditNameRef.current = false
    setLocalName(undefined)
    setEditing(false)
    setDraftName('')
  }, [fileId])
  React.useEffect(() => {
    if (!consumedEditNameRef.current && paths.onEditorPage && location.state?.editName && fileName) {
      consumedEditNameRef.current = true
      setEditing(true)
      setDraftName(fileName)
    }
  }, [paths.onEditorPage, location.state, fileName])

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const committingRef = React.useRef(false)
  const commitRename = async () => {
    const name = draftName.trim() || 'New BPMN diagram'
    if (!paths.onEditorPage || !fileId) return setEditing(false)
    if (name === fileName) return setEditing(false)
    if (committingRef.current) return
    committingRef.current = true
    try {
      await apiClient.patch(`/starbase-api/files/${fileId}`, { name })
      qc.setQueryData(['file', fileId], (old: any) => old ? { ...old, name } : old)
      qc.setQueryData(['file-breadcrumb', fileId], (old: any) => old ? { ...old, name } : old)
      qc.invalidateQueries({ queryKey: ['file', fileId] })
      qc.invalidateQueries({ queryKey: ['file-breadcrumb', fileId] })
      if (computedProjectId) qc.invalidateQueries({ queryKey: ['files', computedProjectId] })
      setLocalName(name)
    } catch {}
    setEditing(false)
    committingRef.current = false
  }

  // Build breadcrumb trail
  const buildBreadcrumbs = () => {
    const crumbs: React.ReactNode[] = []
    
    // Hide breadcrumbs on level 1 pages
    if (paths.isVoyagerHome) {
      return crumbs
    }
    
    // Determine top level section
    const inVoyagerSection = effectivePathname.startsWith('/starbase') || effectivePathname.startsWith('/mission-control') || effectivePathname.startsWith('/engines')
    
    // Add top level
    if (inVoyagerSection) {
      crumbs.push(<BreadcrumbLink key="voyager" to={toTenantPath('/')}>Voyager</BreadcrumbLink>)
    } else if (paths.onLeia) {
      crumbs.push(
        <BreadcrumbLink key="admin" to={toTenantPath('/admin/users')} isActive={false}>
          Admin
        </BreadcrumbLink>
      )
    } else if (paths.onGitConnections) {
      crumbs.push(<BreadcrumbText key="settings">Settings</BreadcrumbText>)
    }

    // Engines section (now under Voyager)
    if (paths.onEngines) {
      crumbs.push(<BreadcrumbSeparator key="sep-eng" />)
      crumbs.push(<BreadcrumbText key="engines">Engines</BreadcrumbText>)
    }

    // Starbase section
    if (effectivePathname.startsWith('/starbase') && !paths.onMissionControl && !paths.onEngines) {
      crumbs.push(<BreadcrumbSeparator key="sep-sb" />)
      const isActive = !paths.onProjectPage && !paths.onEditorPage
      crumbs.push(<BreadcrumbLink key="starbase" to={toTenantPath('/starbase')} isActive={isActive}>Starbase</BreadcrumbLink>)
    }

    // Mission Control section
    if (paths.onMissionControl) {
      crumbs.push(<BreadcrumbSeparator key="sep-mc" />)
      crumbs.push(<BreadcrumbLink key="mc" to={toTenantPath('/mission-control')}>Mission Control</BreadcrumbLink>)

      if (paths.onProcesses) {
        crumbs.push(<BreadcrumbSeparator key="sep-proc" />)
        if (paths.onInstanceDetail) {
          crumbs.push(<BreadcrumbLink key="proc" to={toTenantPath('/mission-control/processes')}>Processes</BreadcrumbLink>)
          crumbs.push(<BreadcrumbSeparator key="sep-inst" />)
          crumbs.push(
            <BreadcrumbText key="inst">
              Instance {instanceId ? `${instanceId.substring(0, 8)}...` : 'Details'}
            </BreadcrumbText>
          )
        } else {
          crumbs.push(<BreadcrumbText key="proc">Processes</BreadcrumbText>)
        }
      } else if (paths.onMigration) {
        crumbs.push(<BreadcrumbSeparator key="sep-proc" />)
        crumbs.push(<BreadcrumbLink key="proc" to={toTenantPath('/mission-control/processes')}>Processes</BreadcrumbLink>)
        crumbs.push(<BreadcrumbSeparator key="sep-mig" />)
        crumbs.push(<BreadcrumbText key="mig">Migration</BreadcrumbText>)
      } else if (paths.onBatches) {
        crumbs.push(<BreadcrumbSeparator key="sep-batch" />)
        crumbs.push(<BreadcrumbText key="batch">Batches</BreadcrumbText>)
      } else if (paths.onDecisions) {
        crumbs.push(<BreadcrumbSeparator key="sep-dec" />)
        if (paths.onDecisionHistoryDetail) {
          crumbs.push(<BreadcrumbLink key="dec" to={toTenantPath('/mission-control/decisions')}>Decisions</BreadcrumbLink>)
          crumbs.push(<BreadcrumbSeparator key="sep-dec-inst" />)
          crumbs.push(
            <BreadcrumbText key="dec-inst">
              Instance {decisionInstanceId ? `${decisionInstanceId.substring(0, 8)}...` : 'Details'}
            </BreadcrumbText>
          )
        } else {
          crumbs.push(<BreadcrumbText key="dec">Decisions</BreadcrumbText>)
          // Show decision definition ID when a decision is selected
          if (selectedDecision?.id) {
            crumbs.push(
              <button
                key={`dec-id-${selectedDecision.key}`}
                onClick={() => {
                  navigator.clipboard.writeText(selectedDecision.key)
                  setCopiedDecisionId(true)
                  setTimeout(() => setCopiedDecisionId(false), 2000)
                }}
                style={{
                  marginLeft: '0px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  backgroundColor: 'rgba(255, 255, 255, 0.85)',
                  color: '#161616',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 1)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.85)')}
                title="Click to copy Decision Key"
              >
                {selectedDecision.key}
                <Copy size={12} />
                {copiedDecisionId && <span style={{ fontSize: '10px', color: '#42be65' }}>Copied!</span>}
              </button>
            )
          }
        }
      }
    }

    // Platform Admin sub-pages
    if (paths.onUserManagement) {
      crumbs.push(<BreadcrumbSeparator key="sep-users" />)
      crumbs.push(<BreadcrumbText key="users">Users</BreadcrumbText>)
    } else if (paths.onAuditLogs) {
      crumbs.push(<BreadcrumbSeparator key="sep-audit" />)
      crumbs.push(<BreadcrumbText key="audit">Audit Logs</BreadcrumbText>)
    } else if (paths.onPlatformSettings) {
      crumbs.push(<BreadcrumbSeparator key="sep-settings" />)
      crumbs.push(<BreadcrumbText key="settings">Settings</BreadcrumbText>)
    }
    
    // Git Connections (under platform settings)
    if (paths.onGitConnections) {
      crumbs.push(<BreadcrumbSeparator key="sep-git" />)
      crumbs.push(<BreadcrumbText key="git">Git Connections</BreadcrumbText>)
    }
    
    // Starbase project/editor pages
    if (paths.onProjectPage || paths.onEditorPage) {
      crumbs.push(<BreadcrumbSeparator key="sep-proj" />)
      
      // Project name
      if (computedProjectId) {
        crumbs.push(
          <BreadcrumbLink key="project" to={`/starbase/project/${computedProjectId}`}>
            {projectName || 'Project'}
          </BreadcrumbLink>
        )
      } else {
        crumbs.push(<BreadcrumbText key="project">{projectName || 'Project'}</BreadcrumbText>)
      }

      // Folder breadcrumbs
      const folderBreadcrumbs = paths.onProjectPage 
        ? projectFolderCrumbQ.data?.breadcrumb 
        : editorFolderCrumbQ.data?.breadcrumb

      if (folderBreadcrumbs) {
        folderBreadcrumbs.forEach((f) => {
          crumbs.push(<BreadcrumbSeparator key={`sep-${f.id}`} />)
          crumbs.push(
            <BreadcrumbLink key={f.id} to={toTenantPath(`/starbase/project/${computedProjectId}?folder=${f.id}`)}>
              {f.name}
            </BreadcrumbLink>
          )
        })
      }

      // File name for editor page
      if (paths.onEditorPage) {
        crumbs.push(<BreadcrumbSeparator key="sep-file" />)
        if (editing) {
          crumbs.push(
            <input
              key="file-input"
              ref={inputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setDraftName(fileName || '') }
              }}
              style={{
                fontSize: 'var(--text-14)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-text-tertiary)',
                borderRadius: 'var(--border-radius-sm)',
                padding: '2px 6px',
                outline: 'none',
              }}
            />
          )
        } else {
          crumbs.push(<BreadcrumbText key="file-name">{displayFileName || 'Process'}</BreadcrumbText>)
        }

        // File menu
        if (!editing) {
          crumbs.push(
            <FileMenu
              key="file-menu"
              fileId={fileId}
              fileName={fileName}
              fileType={fileType}
              displayFileName={displayFileName}
              onRename={() => { setEditing(true); setDraftName(fileName || '') }}
            />
          )
        }
      }
    }

    return crumbs
  }

  return (
    <div style={{ 
      fontSize: 'var(--text-14)',
      fontWeight: 'var(--font-weight-medium)',
      fontFeatureSettings: '"liga"',
      display: 'flex',
      alignItems: 'center',
      gap: '15px',
      marginLeft: 'var(--spacing-8)'
    }}>
      {buildBreadcrumbs()}
    </div>
  )
}
