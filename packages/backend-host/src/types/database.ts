/**
 * Database type definitions
 * Type-safe interfaces for database rows
 */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  role: 'admin' | 'user';
  is_active: number; // SQLite stores as 0/1
  must_reset_password: number; // SQLite stores as 0/1
  failed_login_attempts: number;
  locked_until: number | null;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

export interface FileRow {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  type: 'bpmn' | 'dmn' | 'form';
  xml: string;
  created_at: number;
  updated_at: number;
}

export interface FolderRow {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: string | null; // JSON string
  created_at: number;
}

/**
 * Helper function to parse SQL.js row into typed object
 */
export function parseRow<T>(columns: string[], values: any[]): T {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = values[idx];
  });
  return obj as T;
}
