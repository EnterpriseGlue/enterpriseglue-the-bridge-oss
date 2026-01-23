import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngineSelector } from '@src/components/EngineSelector';

const dropdownSpy = vi.fn();
const setSelectedEngineId = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

vi.mock('@src/stores/engineSelectorStore', () => ({
  useEngineSelectorStore: () => ({
    selectedEngineId: null,
    setSelectedEngineId,
  }),
}));

vi.mock('@carbon/react', () => ({
  Dropdown: (props: any) => {
    dropdownSpy(props);
    return <div data-testid="engine-dropdown" />;
  },
}));

describe('EngineSelector', () => {
  it('renders dropdown when engines are available', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as any).mockReturnValue({
      data: [
        { id: 'e1', name: 'Engine 1', baseUrl: 'http://e1', active: true },
        { id: 'e2', name: 'Engine 2', baseUrl: 'http://e2', active: true },
      ],
      isLoading: false,
    });

    render(<EngineSelector />);

    expect(screen.getByTestId('engine-dropdown')).toBeInTheDocument();
    const props = dropdownSpy.mock.calls[0][0];
    expect(props.items[0]).toMatchObject({ id: 'e1', label: 'Engine 1' });
  });

  it('auto-selects single engine', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as any).mockReturnValue({
      data: [{ id: 'only-1', name: 'Only', baseUrl: 'http://only', active: true }],
      isLoading: false,
    });

    render(<EngineSelector />);

    expect(setSelectedEngineId).toHaveBeenCalledWith('only-1');
  });
});
