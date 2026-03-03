import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { getAdapter } from './index.js';

/**
 * Query Helper Utilities
 * Provides database-agnostic query operations
 */

/**
 * Add a case-insensitive equality condition to a query builder
 * PostgreSQL: Uses LOWER() function
 * Oracle: Uses UPPER() function (Oracle is case-sensitive by default)
 * 
 * @param qb - TypeORM QueryBuilder
 * @param alias - Entity alias
 * @param column - Column name
 * @param paramName - Parameter name for the value
 * @param value - Value to compare
 */
export function addCaseInsensitiveEquals<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  column: string,
  paramName: string,
  value: string
): SelectQueryBuilder<T> {
  const adapter = getAdapter();
  const dbType = adapter.getDatabaseType();
  
  if (dbType === 'oracle' || dbType === 'spanner') {
    // Oracle/Spanner: Use UPPER for case-insensitive comparison
    return qb.andWhere(`UPPER(${alias}.${column}) = UPPER(:${paramName})`, { [paramName]: value });
  } else {
    // PostgreSQL/SQL Server: Use LOWER for case-insensitive comparison
    return qb.andWhere(`LOWER(${alias}.${column}) = LOWER(:${paramName})`, { [paramName]: value });
  }
}

/**
 * Add a case-insensitive LIKE condition to a query builder
 * PostgreSQL: Uses ILIKE (native case-insensitive)
 * Oracle: Uses UPPER() LIKE UPPER()
 * 
 * @param qb - TypeORM QueryBuilder
 * @param alias - Entity alias
 * @param column - Column name
 * @param paramName - Parameter name for the value
 * @param value - Value to search for (with % wildcards)
 */
export function addCaseInsensitiveLike<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  column: string,
  paramName: string,
  value: string
): SelectQueryBuilder<T> {
  const adapter = getAdapter();
  const dbType = adapter.getDatabaseType();
  
  if (dbType === 'oracle') {
    // Oracle: Use UPPER for case-insensitive LIKE
    return qb.andWhere(`UPPER(${alias}.${column}) LIKE UPPER(:${paramName})`, { [paramName]: value });
  } else if (adapter.supportsFeature('ilike')) {
    // PostgreSQL: Use native ILIKE
    return qb.andWhere(`${alias}.${column} ILIKE :${paramName}`, { [paramName]: value });
  } else {
    // Fallback: Use LOWER
    return qb.andWhere(`LOWER(${alias}.${column}) LIKE LOWER(:${paramName})`, { [paramName]: value });
  }
}

/**
 * Get the SQL for a case-insensitive comparison
 * Returns the appropriate SQL fragment for the current database
 * 
 * @param column - Column expression (e.g., "user.email")
 * @returns SQL fragment for case-insensitive column
 */
export function caseInsensitiveColumn(column: string): string {
  const adapter = getAdapter();
  const dbType = adapter.getDatabaseType();
  
  if (dbType === 'oracle' || dbType === 'spanner') {
    return `UPPER(${column})`;
  } else {
    return `LOWER(${column})`;
  }
}

/**
 * Get the SQL for a case-insensitive value
 * Returns the appropriate SQL fragment for the current database
 * 
 * @param paramName - Parameter name (e.g., ":email")
 * @returns SQL fragment for case-insensitive value
 */
export function caseInsensitiveValue(paramName: string): string {
  const adapter = getAdapter();
  const dbType = adapter.getDatabaseType();
  
  if (dbType === 'oracle' || dbType === 'spanner') {
    return `UPPER(${paramName})`;
  } else {
    return `LOWER(${paramName})`;
  }
}

/**
 * Check if the current database supports a specific feature
 * Useful for conditional query building
 */
export function supportsFeature(feature: 'ilike' | 'returning' | 'onConflict' | 'jsonb' | 'uuid' | 'sequences'): boolean {
  const adapter = getAdapter();
  return adapter.supportsFeature(feature);
}

/**
 * Get the current database type
 */
export function getDatabaseType(): 'postgres' | 'oracle' | 'mssql' | 'spanner' | 'mysql' {
  const adapter = getAdapter();
  return adapter.getDatabaseType();
}
