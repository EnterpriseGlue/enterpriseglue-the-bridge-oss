import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { SettingsFormWorkflow, useSettingsWorkflowExit, WorkflowDiscardDialog } from '@src/features/platform-admin/components/SettingsFormWorkflow';

afterEach(cleanup);

function Editor({ busy = false, save = vi.fn() }: { busy?: boolean; save?: () => void }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const guard = useSettingsWorkflowExit(open && Boolean(name), () => { setOpen(false); setName(''); });
  return <>
    <nav aria-label="Settings"><Link to="/other">Other settings</Link>
      <button onClick={() => guard.requestExit(() => setOpen(false))}>Local section</button>
    </nav>
    <SettingsFormWorkflow open={open} title="Edit settings" description="Review changes."
      backLabel="Back to settings" primaryButtonText="Save" busy={busy}
      onCancel={() => guard.requestExit()} onSubmit={save}>
      <label>Name<input value={name} onChange={event => setName(event.target.value)} /></label>
    </SettingsFormWorkflow>
    <WorkflowDiscardDialog guard={guard} busy={busy} />
  </>;
}

function mount(props: Parameters<typeof Editor>[0] = {}) {
  const router = createMemoryRouter([
    { path: '/', element: <Editor {...props} /> },
    { path: '/other', element: <h1>Other page</h1> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe('settings form workflow', () => {
  it('keeps navigation visible and focuses the in-page heading without modal semantics', () => {
    mount();
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Edit settings' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Edit settings' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    expect(screen.queryByRole('region', { name: 'Edit settings' })).not.toBeInTheDocument();
  });

  it('protects a local section change, keeps the draft on cancellation, and discards only on confirmation', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Local section' }));
    let confirmation = screen.getByRole('dialog', { name: 'Leave without saving?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    confirmation = screen.getByRole('dialog', { name: 'Leave without saving?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: /Leave$/ }));
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('blocks SPA navigation until the user confirms leaving', async () => {
    const router = mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('link', { name: 'Other settings' }));
    expect(router.state.location.pathname).toBe('/');
    const confirmation = screen.getByRole('dialog', { name: 'Leave without saving?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: /Leave$/ }));
    expect(await screen.findByRole('heading', { name: 'Other page' })).toBeVisible();
  });

  it('disables fields and exit actions while saving', () => {
    const save = vi.fn();
    mount({ busy: true, save });
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'Edit settings' })).toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });
});
