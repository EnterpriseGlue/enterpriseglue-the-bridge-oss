import React from 'react';

interface LintIssue {
  id: string;
  message: string;
  category: 'error' | 'warn' | 'info';
  rule: string;
}

interface ProblemsPanelProps {
  modeler: any;
  rightOffset?: number;
}

export default function ProblemsPanel({ modeler, rightOffset = 0 }: ProblemsPanelProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [height, setHeight] = React.useState(200);
  const [issues, setIssues] = React.useState<Record<string, LintIssue[]>>({});
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStartY = React.useRef(0);
  const dragStartHeight = React.useRef(0);

  // Collect linting issues
  React.useEffect(() => {
    if (!modeler) return;

    const updateIssues = () => {
      try {
        const linting = modeler.get('linting');
        // Access internal state directly since getIssues() is not exposed
        const allIssues = linting._issues || {};
        setIssues(allIssues);
      } catch (e) {
        // Silently fail if linting is not available
        setIssues({});
      }
    };

    try {
      const eventBus = modeler.get('eventBus');
      eventBus.on('linting.completed', updateIssues);
      eventBus.on('import.done', updateIssues);
      
      // Initial update after a short delay to let linting complete
      setTimeout(updateIssues, 100);

      return () => {
        try {
          eventBus.off('linting.completed', updateIssues);
          eventBus.off('import.done', updateIssues);
        } catch (e) {
          // Ignore cleanup errors
        }
      };
    } catch (e) {
      // Silently fail if event bus is not available
    }
  }, [modeler]);

  // Calculate totals
  const flat = Object.values(issues).flat();
  const errorCount = flat.filter(i => i.category === 'error').length;
  const warningCount = flat.filter(i => i.category === 'warn').length;
  const infoCount = flat.filter(i => i.category === 'info').length;
  const totalCount = errorCount + warningCount + infoCount;

  // Handle drag to resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY;
      const newHeight = Math.max(100, Math.min(600, dragStartHeight.current + delta));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Navigate to element on click
  const handleIssueClick = (elementId: string) => {
    try {
      const elementRegistry = modeler.get('elementRegistry');
      const selection = modeler.get('selection');
      const canvas = modeler.get('canvas');
      
      const element = elementRegistry.get(elementId);
      if (element) {
        selection.select(element);
        canvas.scrollToElement(element);
      }
    } catch (e) {
      console.warn('Could not navigate to element:', e);
    }
  };

  return (
    <div
      style={{
        background: '#fff',
        borderTop: '1px solid #e0e0e0',
        marginRight: rightOffset,
        height: isOpen ? height : 24,
        transition: isDragging ? 'none' : 'height 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}
    >
      {/* Resize handle */}
      {isOpen && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            // Larger hit area to avoid overlapping text from side drawers
            height: 8,
            cursor: 'ns-resize',
            background: isDragging ? '#0f62fe' : 'transparent',
            transition: 'background 0.2s',
            borderTop: '4px solid transparent',
            borderBottom: '4px solid transparent'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#e0e0e0'}
          onMouseLeave={(e) => !isDragging && (e.currentTarget.style.background = 'transparent')}
        />
      )}

      {/* Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          height: 24,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          borderBottom: isOpen ? '1px solid #e0e0e0' : 'none',
          userSelect: 'none'
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 600 }}>Problems</span>
        {totalCount > 0 && (
          <span
            style={{
              background: errorCount > 0 ? 'var(--color-error)' : 'var(--color-warning)',
              color: 'var(--color-bg-primary)',
              padding: '2px var(--spacing-2)',
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 600
            }}
          >
            {totalCount}
          </span>
        )}
        {errorCount > 0 && (
          <span style={{ fontSize: 'var(--text-11)', color: 'var(--color-error)' }}>
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
        {warningCount > 0 && (
          <span style={{ fontSize: 'var(--text-11)', color: 'var(--color-warning)' }}>
            {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
          </span>
        )}
        {infoCount > 0 && (
          <span style={{ fontSize: 'var(--text-11)', color: 'var(--color-text-tertiary)' }}>
            {infoCount} {infoCount === 1 ? 'info' : 'infos'}
          </span>
        )}
      </div>

      {/* Issues list */}
      {isOpen && (
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-2) var(--spacing-3) 0 var(--spacing-3)' }}>
          {totalCount === 0 ? (
            <div style={{ padding: 'var(--spacing-4) var(--spacing-3)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-13)' }}>
              No problems detected
            </div>
          ) : (
            Object.entries(issues).map(([elementId, elementIssues]) =>
              elementIssues.map((issue, idx) => (
                <div
                  key={`${elementId}-${idx}`}
                  onClick={() => handleIssueClick(elementId)}
                  style={{
                    padding: 'var(--spacing-2) var(--spacing-3)',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--color-border-secondary)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f4f4f4'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <span
                    style={{
                      fontSize: 'var(--text-16)',
                      color: issue.category === 'error' ? 'var(--color-error)' : issue.category === 'warn' ? 'var(--color-warning)' : 'var(--color-text-tertiary)',
                      lineHeight: 1
                    }}
                  >
                    {issue.category === 'error' ? '⚠' : issue.category === 'warn' ? '⚠' : 'ℹ'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--text-13)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-1)' }}>
                      {issue.message}
                    </div>
                    <div style={{ fontSize: 'var(--text-11)', color: 'var(--color-text-tertiary)' }}>
                      {elementId} • {issue.rule}
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      )}
    </div>
  );
}
