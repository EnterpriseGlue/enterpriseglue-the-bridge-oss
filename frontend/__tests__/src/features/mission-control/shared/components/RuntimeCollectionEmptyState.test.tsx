import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  getRuntimeCollectionEmptyState,
  RuntimeCollectionEmptyState,
} from '@src/features/mission-control/shared/components/RuntimeCollectionEmptyState';

describe('RuntimeCollectionEmptyState', () => {
  it('explains that process-instance results are authorization and filter scoped', () => {
    render(<RuntimeCollectionEmptyState kind="process_instances" />);

    expect(screen.getByText('No visible process instances')).toBeInTheDocument();
    expect(screen.getByText(/authorized instances match the current filters/i)).toBeInTheDocument();
  });

  it('provides collection-specific batch and migration guidance', () => {
    expect(getRuntimeCollectionEmptyState('batches')).toMatchObject({
      title: 'No visible batches',
      subtitle: expect.stringContaining('authorized runtime resources'),
    });
    expect(getRuntimeCollectionEmptyState('migration_definitions')).toMatchObject({
      title: 'No visible migration processes',
      subtitle: expect.stringContaining('only process definitions you can access'),
    });
  });
});
