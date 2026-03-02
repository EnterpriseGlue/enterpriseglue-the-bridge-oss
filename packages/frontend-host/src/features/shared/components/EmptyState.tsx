import { Button } from '@carbon/react';
import { Add, Search, Filter, WarningAlt } from '@carbon/icons-react';

interface EmptyStateProps {
  icon?: React.ComponentType<any>;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ComponentType<any>;
  };
  variant?: 'default' | 'search' | 'filter' | 'error';
}

/**
 * Shared empty state component for consistent empty UX
 * Provides visual feedback when no data is available
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default'
}: EmptyStateProps) {
  const defaultIcons = {
    default: null,
    search: Search,
    filter: Filter,
    error: WarningAlt,
  };
  
  const DisplayIcon = Icon || defaultIcons[variant];
  
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3rem 1rem',
      textAlign: 'center',
      minHeight: '300px',
      color: '#525252'
    }}>
      {DisplayIcon && (
        <DisplayIcon 
          size={48} 
          style={{ 
            marginBottom: 'var(--spacing-4)', 
            opacity: 0.4,
            color: variant === 'error' ? 'var(--color-error)' : 'var(--color-text-secondary)'
          }} 
        />
      )}
      <h3 style={{ 
        fontSize: 'var(--text-20)', 
        fontWeight: 'var(--font-weight-semibold)', 
        marginBottom: 'var(--spacing-2)',
        color: '#161616'
      }}>
        {title}
      </h3>
      {description && (
        <p style={{ 
          maxWidth: '400px', 
          marginBottom: 'var(--spacing-6)',
          lineHeight: 1.5,
          color: '#525252'
        }}>
          {description}
        </p>
      )}
      {action && (
        <Button
          kind="primary"
          size="md"
          onClick={action.onClick}
          renderIcon={action.icon || Add}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * Empty state for when search/filter returns no results
 */
export function NoResultsState({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState
      variant="search"
      title="No results found"
      description="Try adjusting your search or filter criteria"
      action={onClear ? {
        label: 'Clear filters',
        onClick: onClear
      } : undefined}
    />
  );
}

/**
 * Empty state for when a resource collection is empty
 */
export function NoDataState({ 
  resource, 
  onCreate 
}: { 
  resource: string; 
  onCreate?: () => void;
}) {
  return (
    <EmptyState
      title={`No ${resource} yet`}
      description={`Get started by creating your first ${resource}`}
      action={onCreate ? {
        label: `Create ${resource}`,
        onClick: onCreate
      } : undefined}
    />
  );
}

/**
 * Empty state for error conditions
 */
export function ErrorState({ 
  message, 
  onRetry 
}: { 
  message?: string; 
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      variant="error"
      title="Something went wrong"
      description={message || "We couldn't load this data. Please try again."}
      action={onRetry ? {
        label: 'Try again',
        onClick: onRetry
      } : undefined}
    />
  );
}

/**
 * Empty state for when no items match current filters
 */
export function NoMatchesState({ 
  filterCount,
  onClear 
}: { 
  filterCount?: number;
  onClear?: () => void;
}) {
  return (
    <EmptyState
      variant="filter"
      title="No matches found"
      description={filterCount ? `${filterCount} filter${filterCount !== 1 ? 's' : ''} applied. Try removing some filters.` : "Try adjusting your filters"}
      action={onClear ? {
        label: 'Clear all filters',
        onClick: onClear
      } : undefined}
    />
  );
}
