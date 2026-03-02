import { Folder, DecisionTree, TableSplit } from '@carbon/icons-react'
import React from 'react'
export type FileItem = { 
  id: string
  name: string
  type: 'folder' | 'bpmn' | 'dmn' | 'form'
  createdBy?: string | null
  updatedBy?: string | null
  updatedAt: number
}

export type Project = { id: string; name: string; filesCount?: number; foldersCount?: number }

export type UserSearchItem = {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

export type FolderSummary = { 
  id: string
  name: string
  parentFolderId: string | null
  createdBy?: string | null
  updatedBy?: string | null
  createdAt?: number
  updatedAt?: number 
}

export type ProjectContents = { 
  breadcrumb: FolderSummary[]
  folders: FolderSummary[]
  files: { 
    id: string
    name: string
    type: 'bpmn'|'dmn'|'form'
    createdBy?: string | null
    updatedBy?: string | null
    createdAt: number
    updatedAt: number 
  }[] 
}

export type ProjectRole = 'owner' | 'delegate' | 'developer' | 'editor' | 'viewer'

export type ProjectMember = {
  id: string
  projectId: string
  userId: string
  role: ProjectRole
  roles?: ProjectRole[]
  deployAllowed?: boolean | null
  joinedAt: number
  invitedById?: string | null
  user?: { id: string; email: string; firstName?: string | null; lastName?: string | null } | null
}

export const COLLABORATORS_PANEL_WIDTH = 420

export const memberHeaders = [
  { key: 'name', header: 'Name' },
  { key: 'roles', header: 'Roles' },
  { key: 'actions', header: '' },
]

export const editableRoleOptions: ProjectRole[] = ['delegate', 'developer', 'editor', 'viewer']

export function roleLabel(role: ProjectRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function tagTypeForRole(role: ProjectRole): 'red' | 'magenta' | 'blue' | 'teal' | 'gray' {
  switch (role) {
    case 'owner':
      return 'red'
    case 'delegate':
      return 'magenta'
    case 'developer':
      return 'blue'
    case 'editor':
      return 'teal'
    case 'viewer':
    default:
      return 'gray'
  }
}

export const tableHeaders = [
  { key: 'name', header: 'Name' },
  { key: 'updatedByDisplay', header: 'Updated by' },
  { key: 'updated', header: 'Last changed' },
  { key: 'actions', header: '' },
]

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

export function getFileIcon(type: FileItem['type']): React.ReactNode {
  switch (type) {
    case 'folder':
      return React.createElement(Folder, { size: 20 })
    case 'bpmn':
      return React.createElement(DecisionTree, { size: 20 })
    case 'dmn':
      return React.createElement(TableSplit, { size: 20 })
    default:
      return null
  }
}
