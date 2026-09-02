import React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CopyableLink } from '@src/features/mission-control/shared/components/CopyableLink';

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe('CopyableLink', () => {
  it('preserves the active tenant prefix when navigating', () => {
    render(
      <MemoryRouter initialEntries={['/t/default/mission-control/processes']}>
        <CopyableLink
          fullValue="instance-1"
          navigateTo="/mission-control/processes/instances/instance-1"
          isHovered={false}
        />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'instance-1' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/t/default/mission-control/processes/instances/instance-1'
    );
  });
});
