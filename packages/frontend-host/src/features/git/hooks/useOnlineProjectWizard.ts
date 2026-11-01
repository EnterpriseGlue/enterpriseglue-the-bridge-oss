import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, type NavigateOptions } from 'react-router-dom'
import { gitApi } from '../api/gitApi'
import { apiClient } from '../../../shared/api/client'
import { fetchList } from '../../../shared/api/fetchList';
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import type { Repository } from '../types/git'
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions'
import { getBrowserSessionRevision } from '../../../utils/browserSession'
import { listPersonalGitCredentials, savePersonalGitCredential } from '../api/personalCredentials'
import { beginGitOAuth } from '../api/gitOAuthPopup'
import { sanitizePathParam, safeRelativePath } from '../../../shared/utils/sanitize'
import { useAuth } from '../../../shared/hooks/useAuth'
import { EnginePermission } from '../../../shared/auth/permissions'
import { evaluateActionSnapshot } from '../../../shared/auth/guards'
import { getAccessibleEngines } from '../../mission-control/engines/api/engines'
import type { AccessibleEngineSummary } from '@enterpriseglue/shared/schemas/mission-control/engine.js'
import type { CreateOnlineProjectRequest, CreateOnlineProjectResponse } from '@enterpriseglue/shared/schemas/git/online-project.js'
import type { ProjectImportPreview as SharedProjectImportPreview } from '@enterpriseglue/shared/schemas/starbase/project.js'
import type { CreateProjectResponse } from '@enterpriseglue/shared/schemas/starbase/project.js'
import type { GitCredential as ProviderCredential, GitCredentialNamespace as Namespace } from '@enterpriseglue/shared/schemas/git/repository.js'

export type AuthMethod = 'oauth' | 'pat'
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type ConnectionMode = 'select' | 'new'

export type EngineForImport = Pick<AccessibleEngineSummary, 'id' | 'name' | 'baseUrl'>

export type EngineImportPreview = SharedProjectImportPreview

type EnginePermissionCheck = (engineId: string | null | undefined, permission: string) => boolean

export function canImportFromEngineRow(engine: EngineForImport, hasPermission: EnginePermissionCheck): boolean {
  return hasPermission(engine?.id, EnginePermission.DEPLOY_VIEW)
}

export function formatImportPreviewSummary(preview: EngineImportPreview): string {
  const total = preview.counts.bpmn + preview.counts.dmn
  if (total === 0) {
    return 'No latest BPMN or DMN definitions found. The project-engine import target will be created.'
  }
  return `${preview.counts.bpmn} BPMN and ${preview.counts.dmn} DMN definitions found. The project-engine import target will be created.`
}

interface UseOnlineProjectWizardProps {
  open: boolean
  onClose: () => void
  existingProjectId?: string
  existingProjectName?: string
}

export function useOnlineProjectWizard({
  open,
  onClose,
  existingProjectId,
  existingProjectName,
}: UseOnlineProjectWizardProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const { hasEnginePermission, permissions, refreshPermissions, user, sessionRevision } = useAuth()
  const credentialOwner = user?.session?.principal.id || user?.id || ''
  const credentialAuthority = JSON.stringify([credentialOwner, user?.session?.tenant.id || null, sessionRevision ?? null, permissionSnapshotAuthorityKey(permissions)])
  const isExistingProject = !!existingProjectId
  const gitCreateDecision = evaluateActionSnapshot(permissions, 'project.create.git.create', { type: 'platform', id: null })
  const gitInspectDecision = evaluateActionSnapshot(permissions, 'project.create.git.inspect', { type: 'platform', id: null })

  const [existingRepo, setExistingRepo] = React.useState<Repository | null>(null)
  const isEditConnectedProject = isExistingProject && !!existingRepo

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const tenantSlug = tenantSlugMatch?.[1] ? sanitizePathParam(decodeURIComponent(tenantSlugMatch[1])) : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = React.useCallback((p: string) => {
    const safe = safeRelativePath(p)
    if (!tenantSlug) return safe
    const combined = `${tenantPrefix}${safe}`
    return safeRelativePath(combined, safe)
  }, [tenantSlug, tenantPrefix])
  const safeNavigate = React.useCallback((path: string, options?: NavigateOptions) => {
    try {
      const url = new URL(path, window.location.origin)
      if (url.origin !== window.location.origin) return
      navigate(url.pathname + url.search + url.hash, options)
    } catch { /* invalid URL — do not navigate */ }
  }, [navigate])

  // Form state
  const [projectName, setProjectName] = React.useState(existingProjectName || '')
  const [importFromEngine, setImportFromEngine] = React.useState(false)
  const [selectedImportEngineId, setSelectedImportEngineId] = React.useState('')
  const [connectToGit, setConnectToGit] = React.useState<boolean>(!!existingProjectId)
  const [repoMode, setRepoMode] = React.useState<'new' | 'existing' | null>(null)
  const [providerId, setProviderId] = React.useState('')
  const [namespace, setNamespace] = React.useState('')
  const [repositoryName, setRepositoryName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [isPrivate, setIsPrivate] = React.useState(true)
  const [existingRepos, setExistingRepos] = React.useState<{ name: string; fullName: string; url: string }[]>([])
  const [loadingRepos, setLoadingRepos] = React.useState(false)
  const [repoFetchError, setRepoFetchError] = React.useState<string | null>(null)
  const [selectedExistingRepoUrl, setSelectedExistingRepoUrl] = React.useState('')
  const [customRepoUrl, setCustomRepoUrl] = React.useState('')
  const [conflictStrategy, setConflictStrategy] = React.useState<'preferRemote' | 'preferLocal'>('preferRemote')

  // Auth state
  const [connectionMode, setConnectionMode] = React.useState<ConnectionMode>('select')
  const [selectedCredentialId, setSelectedCredentialId] = React.useState<string>('')
  const [authMethod, setAuthMethod] = React.useState<AuthMethod>('pat')
  const [token, setToken] = React.useState('')
  const [connectionName, setConnectionName] = React.useState('')
  const [connectionStatus, setConnectionStatus] = React.useState<ConnectionStatus>('disconnected')
  const [connectedUser, setConnectedUser] = React.useState<string | null>(null)
  const [connectionError, setConnectionError] = React.useState<string | null>(null)
  const [existingCredentials, setExistingCredentials] = React.useState<ProviderCredential[]>([])

  // Namespace state
  const [namespaces, setNamespaces] = React.useState<Namespace[]>([])
  const [loadingNamespaces, setLoadingNamespaces] = React.useState(false)

  // Error state
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [generalError, setGeneralError] = React.useState<string | null>(null)
  const gitInspectDeniedReason = !isExistingProject && connectToGit && repoMode === 'existing' && !gitInspectDecision.allowed
    ? gitInspectDecision.reason || 'Missing permission to inspect remote Git repositories'
    : null

  const credentialScope = JSON.stringify([open, providerId, existingProjectId, credentialAuthority])
  const credentialScopeRef = React.useRef(credentialScope), credentialLife = React.useRef(0), credentialMounted = React.useRef(true)
  if (credentialScopeRef.current !== credentialScope) { credentialScopeRef.current = credentialScope; credentialLife.current++ }
  const credentialSession = React.useRef({ authority: credentialAuthority, revision: getBrowserSessionRevision() })
  if (credentialSession.current.authority !== credentialAuthority) credentialSession.current = { authority: credentialAuthority, revision: getBrowserSessionRevision() }
  const authenticationIntent = React.useRef('')
  authenticationIntent.current = JSON.stringify([authMethod, connectionMode, selectedCredentialId])
  const credentialActive = React.useRef<number | null>(null), oauthCancel = React.useRef<(() => void) | null>(null)
  const credentialReadEpoch = React.useRef(0)
  React.useEffect(() => { credentialMounted.current = true; return () => { credentialMounted.current = false; credentialLife.current++; oauthCancel.current?.() } }, [])
  React.useEffect(() => () => { oauthCancel.current?.(); oauthCancel.current = null }, [credentialScope])
  const captureCredentialCheck = () => {
    const life = credentialLife.current, browser = credentialSession.current.revision, intent = authenticationIntent.current
    return () => {
      if (!open || !credentialMounted.current || life !== credentialLife.current || browser !== getBrowserSessionRevision() || intent !== authenticationIntent.current) throw new Error('Git credential context changed')
    }
  }

  // Reset connection when provider changes
  React.useEffect(() => {
    setConnectionStatus('disconnected')
    setConnectedUser(null)
    setConnectionError(null)
    setToken('')
    setConnectionName('')
    setSelectedCredentialId('')
    setConnectionMode('select')
    setExistingCredentials([])
    setNamespaces([])
    if (!isEditConnectedProject) {
      setNamespace('')
    }
  }, [providerId, isEditConnectedProject, credentialAuthority, open])

  // Default connect toggle based on context
  React.useEffect(() => {
    setConnectToGit(!!existingProjectId)
  }, [existingProjectId])

  // If we are opening the modal for an existing project, load the current repo connection (if any)
  React.useEffect(() => {
    if (!open) return

    let cancelled = false
    const load = async () => {
      if (!existingProjectId) {
        setExistingRepo(null)
        return
      }

      const repo = await gitApi.getRepositoryByProject(existingProjectId)
      if (cancelled) return

      setExistingRepo(repo)

      if (repo) {
        setConnectToGit(true)
        setProviderId(repo.providerId || '')
        setRepoMode(null)
        setSelectedExistingRepoUrl(repo.remoteUrl || '')
        setCustomRepoUrl('')
        setNamespace(repo.namespace || '')
        setRepositoryName(repo.repositoryName || '')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [open, existingProjectId])

  // Fetch existing repositories from provider when 'existing' mode is selected
  React.useEffect(() => {
    const fetchProviderRepos = async () => {
      if (!providerId || repoMode !== 'existing') {
        setExistingRepos([])
        setRepoFetchError(null)
        return
      }
      if (gitInspectDeniedReason) {
        setExistingRepos([])
        setRepoFetchError(gitInspectDeniedReason)
        setLoadingRepos(false)
        return
      }
      setLoadingRepos(true)
      setRepoFetchError(null)
      try {
        const repos = await gitApi.listProviderRepos(providerId)
        setExistingRepos(repos)
      } catch (e: unknown) {
        const parsed = parseApiError(e, 'Failed to load repositories')
        const errorMsg = parsed.message
        if (errorMsg.includes('Bad credentials')) {
          setRepoFetchError('Your saved Git token is invalid or expired. Please reconnect with a new token, or enter the repository URL manually below.')
        } else if (errorMsg.includes('credentials')) {
          setRepoFetchError('Git authentication failed. Please reconnect or enter the repository URL manually.')
        } else {
          setRepoFetchError(`Could not load repositories: ${errorMsg}. You can enter the URL manually.`)
        }
        setExistingRepos([])
      } finally {
        setLoadingRepos(false)
      }
    }
    fetchProviderRepos()
  }, [gitInspectDeniedReason, providerId, repoMode])

  // Auto-fill repository name from project name
  React.useEffect(() => {
    if (isEditConnectedProject) return
    const source = isExistingProject ? existingProjectName || '' : projectName
    if (source) {
      const repoName = source
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
      setRepositoryName(repoName)
    }
  }, [projectName, existingProjectName, isExistingProject, isEditConnectedProject])

  const fetchProviderCredentials = React.useCallback(async () => {
    if (!providerId || !credentialOwner) return
    const scope = credentialScopeRef.current, browser = credentialSession.current.revision, readEpoch = credentialReadEpoch.current
    try {
      const allCredentials = await listPersonalGitCredentials(credentialOwner)
      if (scope !== credentialScopeRef.current || browser !== getBrowserSessionRevision() || !credentialMounted.current || readEpoch !== credentialReadEpoch.current) return
      const providerCreds = allCredentials.filter((c: ProviderCredential) => c.providerId === providerId)
      setExistingCredentials(providerCreds)

      if (providerCreds.length > 0) {
        setConnectionMode('select')
        const firstCred = providerCreds[0]
        setSelectedCredentialId(firstCred.id)
        setConnectionStatus('connected')
        setConnectedUser(firstCred.name || firstCred.providerUsername || 'Unknown')
      } else {
        setConnectionMode('new')
      }
    } catch {
      if (scope === credentialScopeRef.current && browser === getBrowserSessionRevision() && credentialMounted.current && readEpoch === credentialReadEpoch.current) setConnectionMode('new')
    }
  }, [providerId, credentialOwner, credentialAuthority, open])

  // Fetch existing credentials for this provider when selected
  React.useEffect(() => {
    if (providerId && open) {
      fetchProviderCredentials()
    }
  }, [providerId, open, fetchProviderCredentials])

  // A selected credential owns its namespace continuation; an old selection
  // cannot populate the replacement provider's namespace choices.
  React.useEffect(() => {
    if (!selectedCredentialId || connectionStatus !== 'connected') return
    let cancelled = false
    const scope = credentialScopeRef.current, browser = credentialSession.current.revision
    const current = () => !cancelled && credentialMounted.current && scope === credentialScopeRef.current && browser === getBrowserSessionRevision()
    setLoadingNamespaces(true)
    void (async () => {
      try {
        const data = await fetchList<Namespace>(`/git-api/credentials/${encodeURIComponent(selectedCredentialId)}/namespaces`)
        if (!current()) return
        setNamespaces(data)
        if (data.length > 0 && !namespace) { const userNs = data.find(ns => ns.type === 'user'); setNamespace(userNs?.name || data[0].name) }
      } catch { if (current()) setNamespaces([]) }
      finally { if (current()) setLoadingNamespaces(false) }
    })()
    return () => { cancelled = true }
  }, [selectedCredentialId, connectionStatus, namespace, credentialAuthority, providerId, open])

  const providersQuery = useQuery({
    queryKey: ['git', 'providers', credentialAuthority],
    queryFn: () => gitApi.getProviders(),
    enabled: open,
  })

  const selectedProvider = React.useMemo(
    () => providersQuery.data?.find((p: { id: string }) => p.id === providerId),
    [providersQuery.data, providerId]
  )

  const importableEnginesQuery = useQuery({
    queryKey: ['engines', 'importable-on-project-create'],
    queryFn: () => getAccessibleEngines().catch(() => []),
    enabled: open && !isExistingProject,
  })

  const importableEngines = React.useMemo(() => {
    const rows = importableEnginesQuery.data || []
    return rows
      .filter((engine: EngineForImport) => {
        const importPreviewDecision = evaluateActionSnapshot(permissions, 'project.import.preview', { type: 'engine', id: engine.id })
        return canImportFromEngineRow(engine, hasEnginePermission) || importPreviewDecision.allowed
      })
      .map((engine: EngineForImport) => ({
        id: String(engine.id),
        name: String(engine.name || engine.baseUrl || 'Unnamed engine'),
      }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
  }, [hasEnginePermission, importableEnginesQuery.data, permissions])

  const canImportFromEngine = !isExistingProject && !(connectToGit && repoMode === 'existing')
  const selectedImportEngine = React.useMemo(
    () => (importableEnginesQuery.data || []).find((engine: EngineForImport) => String(engine.id) === String(selectedImportEngineId)) || null,
    [importableEnginesQuery.data, selectedImportEngineId]
  )
  const importPreviewDecision = React.useMemo(
    () => evaluateActionSnapshot(permissions, 'project.import.preview', { type: 'engine', id: selectedImportEngineId || null }),
    [permissions, selectedImportEngineId]
  )
  const canPreviewSelectedImportEngine = !selectedImportEngineId ||
    importPreviewDecision.allowed ||
    Boolean(selectedImportEngine && canImportFromEngineRow(selectedImportEngine, hasEnginePermission))
  const importPreviewDeniedReason = selectedImportEngineId && !canPreviewSelectedImportEngine
    ? importPreviewDecision.reason || 'Missing permission to preview imports from this engine'
    : null
  const gitCreateDeniedReason = !isExistingProject && !gitCreateDecision.allowed
    ? gitCreateDecision.reason || 'Missing permission to create Git-backed projects'
    : null

  const importPreviewQuery = useQuery({
    queryKey: ['starbase', 'projects', 'import-preview', selectedImportEngineId],
    queryFn: () => apiClient.post<EngineImportPreview>('/starbase-api/projects/import-preview', {
      engineId: selectedImportEngineId,
    }),
    enabled: open && canImportFromEngine && importFromEngine && !!selectedImportEngineId && canPreviewSelectedImportEngine,
    retry: false,
  })

  const importPreviewErrorMessage = React.useMemo(() => {
    if (!importPreviewQuery.isError) return null
    return parseApiError(importPreviewQuery.error, 'Unable to preview engine import').message
  }, [importPreviewQuery.error, importPreviewQuery.isError])

  React.useEffect(() => {
    if (canImportFromEngine) return
    setImportFromEngine(false)
    setSelectedImportEngineId('')
  }, [canImportFromEngine])

  const importFromEnginePayload = React.useMemo(() => {
    if (!canImportFromEngine || !importFromEngine || !selectedImportEngineId) {
      return undefined
    }

    return {
      enabled: true,
      engineId: selectedImportEngineId,
    }
  }, [canImportFromEngine, importFromEngine, selectedImportEngineId])

  const handleSelectCredential = React.useCallback((credentialId: string) => {
    credentialReadEpoch.current++
    if (credentialId === 'new') {
      setConnectionMode('new')
      setSelectedCredentialId('')
      setConnectionStatus('disconnected')
      setConnectedUser(null)
      setNamespaces([])
      setNamespace('')
    } else {
      const cred = existingCredentials.find((c: ProviderCredential) => c.id === credentialId)
      if (cred) {
        setSelectedCredentialId(credentialId)
        setConnectionStatus('connected')
        setConnectedUser(cred.name || cred.providerUsername || 'Unknown')
        setConnectionMode('select')
      }
    }
  }, [existingCredentials])

  const acceptCredential = (credential: ProviderCredential) => {
    setConnectionStatus('connected'); setConnectedUser(credential.name || credential.providerUsername || credential.id)
    setSelectedCredentialId(credential.id)
    setExistingCredentials(prev => [...prev.filter(row => row.providerId !== credential.providerId), credential])
    setConnectionMode('select'); setToken(''); setConnectionName('')
    queryClient.invalidateQueries({ queryKey: ['git', 'credentials'] })
  }
  const connectWithPAT = async () => {
    if (!token.trim() || !providerId || credentialActive.current === credentialLife.current) return
    const check = captureCredentialCheck(), life = credentialLife.current
    const request = { providerId, token: token.trim(), name: connectionName.trim() || undefined }
    try {
      check(); credentialReadEpoch.current++; credentialActive.current = life; setConnectionStatus('connecting'); setConnectionError(null)
      const credential = await savePersonalGitCredential(credentialOwner, request, check)
      check(); acceptCredential(credential)
    } catch (error) {
      try { check() } catch { return }
      setConnectionStatus('error'); setConnectionError(parseApiError(error, 'Failed to connect').message.split(request.token).join('[redacted]'))
    } finally { if (credentialActive.current === life) credentialActive.current = null }
  }
  const connectWithOAuth = async () => {
    if (!providerId || credentialActive.current === credentialLife.current) return
    const check = captureCredentialCheck(), life = credentialLife.current
    try {
      check(); credentialReadEpoch.current++; credentialActive.current = life; setConnectionStatus('connecting'); setConnectionError(null)
      const flow = beginGitOAuth(providerId, credentialOwner, check); oauthCancel.current = flow.cancel
      const credential = await flow.result
      check(); acceptCredential(credential)
    } catch {
      try { check() } catch { return }
      setConnectionStatus('error'); setConnectionError('Git authorization was not verified')
    } finally { if (credentialActive.current === life) { credentialActive.current = null; oauthCancel.current = null } }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!gitCreateDecision.allowed) {
        throw new Error(gitCreateDeniedReason || 'Missing permission to create Git-backed projects')
      }

      try {
        const request: CreateOnlineProjectRequest = {
          projectName: projectName.trim(),
          providerId,
          repositoryName: repositoryName.trim(),
          namespace: namespace.trim() || undefined,
          isPrivate,
          description: description.trim() || undefined,
          token: authMethod === 'pat' && token ? token : undefined,
          importFromEngine: importFromEnginePayload,
        }
        return await apiClient.post<CreateOnlineProjectResponse>('/git-api/create-online', request)
      } catch (error) {
        const parsed = parseApiError(error, 'Failed to create project')
        if (parsed.field) {
          setFieldErrors({ [parsed.field]: parsed.message })
        }
        throw new Error(parsed.message || 'Failed to create project')
      }
    },
    onSuccess: async (data: CreateOnlineProjectResponse) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] }),
        queryClient.invalidateQueries({ queryKey: ['git', 'repositories'] }),
        refreshPermissions(),
      ])
      resetForm()
      onClose()
      safeNavigate(toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(data.project.id))}`), { state: { name: data.project.name } })
    },
    onError: (error: Error) => {
      setGeneralError(error.message)
    },
  })

  const createLocalMutation = useMutation({
    mutationFn: async () => {
      try {
        return await apiClient.post<CreateProjectResponse>('/starbase-api/projects', {
          name: projectName.trim(),
          importFromEngine: importFromEnginePayload,
        })
      } catch (error) {
        const parsed = parseApiError(error, 'Failed to create project')
        throw new Error(parsed.message || 'Failed to create project')
      }
    },
    onSuccess: async (data: CreateProjectResponse) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] }),
        refreshPermissions(),
      ])
      resetForm()
      onClose()
      safeNavigate(toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(data.id))}`), { state: { name: data.name } })
    },
    onError: (error: Error) => {
      setGeneralError(error.message)
    },
  })

  const initExistingMutation = useMutation({
    mutationFn: async () => {
      const remoteUrl = generateRemoteUrl()
      return gitApi.initRepository({
        projectId: existingProjectId!,
        providerId,
        remoteUrl,
        namespace: namespace.trim() || undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] })
      queryClient.invalidateQueries({ queryKey: ['git', 'repositories'] })
      resetForm()
      onClose()
    },
    onError: (error: Error) => {
      setGeneralError(error.message)
    },
  })

  const cloneExistingMutation = useMutation({
    mutationFn: async (remoteUrl: string) => {
      return gitApi.cloneRepository({
        projectId: existingProjectId!,
        providerId,
        remoteUrl,
        namespace: namespace.trim() || undefined,
        conflictStrategy,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] })
      queryClient.invalidateQueries({ queryKey: ['git', 'repositories'] })
      resetForm()
      onClose()
    },
    onError: (error: Error) => {
      setGeneralError(error.message)
    },
  })

  const cloneNewProjectMutation = useMutation({
    mutationFn: async (remoteUrl: string) => {
      if (!gitCreateDecision.allowed) {
        throw new Error(gitCreateDeniedReason || 'Missing permission to create Git-backed projects')
      }

      return gitApi.cloneFromGit({
        providerId,
        repoUrl: remoteUrl,
        projectName: projectName.trim(),
        conflictStrategy,
      })
    },
    onSuccess: async (data: { projectId: string; projectName: string }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] }),
        queryClient.invalidateQueries({ queryKey: ['git', 'repositories'] }),
        refreshPermissions(),
      ])
      resetForm()
      onClose()
      if (data?.projectId) {
        safeNavigate(toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(data.projectId))}`), { state: { name: data.projectName } })
      }
    },
    onError: (error: Error) => {
      setGeneralError(error.message)
    },
  })

  const resetForm = React.useCallback(() => {
    setProjectName(existingProjectName || '')
    setImportFromEngine(false)
    setSelectedImportEngineId('')
    setConnectToGit(!!existingProjectId)
    setRepoMode(null)
    setProviderId('')
    setNamespace('')
    setRepositoryName('')
    setDescription('')
    setIsPrivate(true)
    setExistingRepos([])
    setSelectedExistingRepoUrl('')
    setCustomRepoUrl('')
    setConflictStrategy('preferRemote')
    setRepoFetchError(null)
    setAuthMethod('pat')
    setToken('')
    setConnectionStatus('disconnected')
    setConnectedUser(null)
    setConnectionError(null)
    setFieldErrors({})
    setGeneralError(null)
  }, [existingProjectId, existingProjectName])

  const handleClose = React.useCallback(() => {
    if (!createMutation.isPending && !initExistingMutation.isPending && !createLocalMutation.isPending && !cloneExistingMutation.isPending && !cloneNewProjectMutation.isPending) {
      credentialLife.current++; oauthCancel.current?.(); oauthCancel.current = null; setToken(''); setConnectionName(''); setConnectionStatus('disconnected')
      onClose()
    }
  }, [createLocalMutation.isPending, createMutation.isPending, cloneExistingMutation.isPending, cloneNewProjectMutation.isPending, initExistingMutation.isPending, onClose])

  const generateRemoteUrl = React.useCallback((): string => {
    if (repoMode === 'existing') {
      return selectedExistingRepoUrl || customRepoUrl.trim() || ''
    }
    if (!selectedProvider || !repositoryName) return ''
    const baseUrl = selectedProvider.baseUrl || ''
    const path = namespace ? `${namespace}/${repositoryName}` : repositoryName
    return `${baseUrl}/${path}.git`
  }, [customRepoUrl, namespace, repositoryName, repoMode, selectedExistingRepoUrl, selectedProvider])

  const handleSubmit = React.useCallback(() => {
    setFieldErrors({})
    setGeneralError(null)

    if (isEditConnectedProject) {
      onClose()
      return
    }

    if (importFromEngine && canImportFromEngine && !selectedImportEngineId) {
      setFieldErrors((prev: Record<string, string>) => ({ ...prev, importEngineId: 'Select an engine to import from' }))
      return
    }
    if (importFromEngine && canImportFromEngine && selectedImportEngineId) {
      if (!canPreviewSelectedImportEngine) {
        setFieldErrors((prev: Record<string, string>) => ({ ...prev, importEngineId: importPreviewDeniedReason || 'Selected engine is not available for import' }))
        return
      }
      if (importPreviewQuery.isLoading) {
        setFieldErrors((prev: Record<string, string>) => ({ ...prev, importEngineId: 'Import preview is still loading' }))
        return
      }
      if (importPreviewQuery.isError || !importPreviewQuery.data?.allowed) {
        setFieldErrors((prev: Record<string, string>) => ({ ...prev, importEngineId: 'Selected engine is not available for import' }))
        return
      }
    }

    const remoteUrl = repoMode === 'existing'
      ? (selectedExistingRepoUrl || customRepoUrl.trim())
      : generateRemoteUrl()

    if (!connectToGit) {
      if (isExistingProject) {
        onClose()
      } else {
        if (!projectName.trim()) {
          setFieldErrors((prev: Record<string, string>) => ({ ...prev, projectName: 'Project name is required' }))
          return
        }
        createLocalMutation.mutate()
      }
      return
    }

    if (gitInspectDeniedReason) {
      setGeneralError(gitInspectDeniedReason)
      return
    }
    if (repoMode === 'existing' && !remoteUrl) {
      setFieldErrors((prev: Record<string, string>) => ({ ...prev, repositoryName: 'Select or enter a repository to connect' }))
      return
    }

    if (repoMode === 'new') {
      if (isExistingProject) {
        initExistingMutation.mutate()
      } else {
        if (!gitCreateDecision.allowed) {
          setGeneralError(gitCreateDeniedReason || 'Missing permission to create Git-backed projects')
          return
        }
        createMutation.mutate()
      }
    } else {
      if (isExistingProject) {
        cloneExistingMutation.mutate(remoteUrl!)
      } else {
        if (!projectName.trim()) {
          setFieldErrors((prev: Record<string, string>) => ({ ...prev, projectName: 'Project name is required' }))
          return
        }
        if (!gitCreateDecision.allowed) {
          setGeneralError(gitCreateDeniedReason || 'Missing permission to create Git-backed projects')
          return
        }
        cloneNewProjectMutation.mutate(remoteUrl!)
      }
    }
  }, [canImportFromEngine, canPreviewSelectedImportEngine, cloneExistingMutation, cloneNewProjectMutation, connectToGit, createLocalMutation, createMutation, customRepoUrl, generateRemoteUrl, gitCreateDecision.allowed, gitCreateDeniedReason, gitInspectDeniedReason, importFromEngine, importPreviewDeniedReason, importPreviewQuery.data?.allowed, importPreviewQuery.isError, importPreviewQuery.isLoading, initExistingMutation, isEditConnectedProject, isExistingProject, onClose, projectName, repoMode, selectedExistingRepoUrl, selectedImportEngineId])

  const isConnected = connectionStatus === 'connected'
  const isValid = React.useMemo(() => {
    if (isEditConnectedProject) return true
    const importPreviewRequired = importFromEngine && canImportFromEngine && !!selectedImportEngineId
    const importPreviewReady = !importPreviewRequired || (
      canPreviewSelectedImportEngine &&
      importPreviewQuery.data?.allowed === true &&
      !importPreviewQuery.isError &&
      !importPreviewQuery.isLoading
    )
    const importValid = !importFromEngine || !canImportFromEngine || (!!selectedImportEngineId && importPreviewReady)
    if (!importValid) return false
    if (!connectToGit) {
      return isExistingProject ? true : !!projectName.trim()
    }
    if (!isExistingProject && !gitCreateDecision.allowed) return false
    if (!providerId || !isConnected) return false
    if (!repoMode) return false
    if (gitInspectDeniedReason) return false
    if (repoMode === 'new') {
      return (!!repositoryName.trim()) && (isExistingProject ? true : !!projectName.trim())
    }
    const remoteUrl = generateRemoteUrl()
    return !!remoteUrl && (isExistingProject ? true : !!projectName.trim())
  }, [canImportFromEngine, canPreviewSelectedImportEngine, connectToGit, generateRemoteUrl, gitCreateDecision.allowed, gitInspectDeniedReason, importFromEngine, importPreviewQuery.data?.allowed, importPreviewQuery.isError, importPreviewQuery.isLoading, isConnected, isEditConnectedProject, isExistingProject, projectName, providerId, repoMode, repositoryName, selectedImportEngineId])

  const isLoading =
    createMutation.isPending ||
    initExistingMutation.isPending ||
    createLocalMutation.isPending ||
    cloneExistingMutation.isPending ||
    cloneNewProjectMutation.isPending ||
    connectionStatus === 'connecting'

  return {
    navigate,
    toTenantPath,
    isExistingProject,
    isEditConnectedProject,
    existingRepo,
    projectName,
    setProjectName,
    importFromEngine,
    setImportFromEngine,
    selectedImportEngineId,
    setSelectedImportEngineId,
    importableEngines,
    importableEnginesQuery,
    importPreviewQuery,
    importPreviewErrorMessage,
    importPreviewDeniedReason,
    canImportFromEngine,
    gitInspectDeniedReason,
    gitCreateDeniedReason,
    connectToGit,
    setConnectToGit,
    repoMode,
    setRepoMode,
    providerId,
    setProviderId,
    namespace,
    setNamespace,
    repositoryName,
    setRepositoryName,
    description,
    setDescription,
    isPrivate,
    setIsPrivate,
    existingRepos,
    loadingRepos,
    repoFetchError,
    selectedExistingRepoUrl,
    setSelectedExistingRepoUrl,
    customRepoUrl,
    setCustomRepoUrl,
    conflictStrategy,
    setConflictStrategy,
    connectionMode,
    setConnectionMode,
    selectedCredentialId,
    authMethod,
    setAuthMethod,
    token,
    setToken,
    connectionName,
    setConnectionName,
    connectionStatus,
    connectedUser,
    connectionError,
    existingCredentials,
    namespaces,
    loadingNamespaces,
    fieldErrors,
    setFieldErrors,
    generalError,
    providersQuery,
    selectedProvider,
    handleSelectCredential,
    connectWithPAT,
    connectWithOAuth,
    handleClose,
    handleSubmit,
    generateRemoteUrl,
    isConnected,
    isValid,
    isLoading,
    createMutation,
    initExistingMutation,
    createLocalMutation,
    cloneExistingMutation,
    cloneNewProjectMutation,
  }
}
