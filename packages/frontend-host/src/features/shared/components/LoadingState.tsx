import { InlineLoading } from '@carbon/react';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
}

/**
 * Shared loading state component for consistent loading UX
 */
export function LoadingState({ 
  message = 'Loading...', 
  size = 'md',
  inline = false 
}: LoadingStateProps) {
  const sizeMap = {
    sm: '150px',
    md: '200px',
    lg: '300px',
  };

  if (inline) {
    return <InlineLoading description={message} />;
  }
  
  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center',
      padding: 'var(--spacing-7)',
      minHeight: sizeMap[size]
    }}>
      <InlineLoading description={message} />
    </div>
  );
}

/**
 * Loading state for tables and data grids
 */
export function TableLoadingState({ message = 'Loading data...' }: { message?: string }) {
  return <LoadingState message={message} size="md" />;
}

/**
 * Loading state for full pages
 */
export function PageLoadingState({ message = 'Loading page...' }: { message?: string }) {
  return <LoadingState message={message} size="lg" />;
}

/**
 * Inline loading indicator (no centering)
 */
export function InlineLoadingState({ message = 'Loading...' }: { message?: string }) {
  return <LoadingState message={message} inline />;
}

/**
 * Small loading state for buttons or compact areas
 */
export function SmallLoadingState({ message = 'Loading...' }: { message?: string }) {
  return <LoadingState message={message} size="sm" />;
}
