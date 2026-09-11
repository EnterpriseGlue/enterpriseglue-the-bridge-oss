import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DecisionsDataTable } from '@src/features/mission-control/decisions-overview/components/DecisionsDataTable';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('DecisionsDataTable', () => {
  it('exports DecisionsDataTable component', () => {
    expect(DecisionsDataTable).toBeDefined();
    expect(typeof DecisionsDataTable).toBe('function');
  });

  it('keeps the selected engine when opening a decision instance', () => {
    render(
      <MemoryRouter initialEntries={['/t/default/mission-control/decisions']}>
        <DecisionsDataTable
          data={[{
            id: 'decision-1',
            name: 'Approval',
            instanceKey: 'decision-1',
            version: 'v1',
            evaluationTime: '2026-09-01T10:00:00.000Z',
            processInstance: 'pi-1',
          }]}
          engineId="engine-2"
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'decision-1' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/t/default/mission-control/decisions/instances/decision-1?engineId=engine-2',
    );
  });
});
