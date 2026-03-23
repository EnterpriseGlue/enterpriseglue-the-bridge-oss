import React from 'react';
import { BreadcrumbItem } from '@carbon/react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BreadcrumbBar } from '@src/features/shared/components/BreadcrumbBar';

describe('BreadcrumbBar', () => {
  it('renders children within breadcrumb container', () => {
    render(
      <BreadcrumbBar>
        <span>Home</span>
        <span>Projects</span>
      </BreadcrumbBar>
    );

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('filters out invalid children', () => {
    render(
      <BreadcrumbBar>
        <span>Valid</span>
        {null}
        {undefined}
        <span>Also Valid</span>
      </BreadcrumbBar>
    );

    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(screen.getByText('Also Valid')).toBeInTheDocument();
  });

  it('collapses middle breadcrumb items into an overflow menu and preserves their actions', async () => {
    const user = userEvent.setup();
    const onMiddleClick = vi.fn();

    render(
      <BreadcrumbBar>
        <BreadcrumbItem><button onClick={() => {}}>Starbase</button></BreadcrumbItem>
        <BreadcrumbItem><button onClick={onMiddleClick}>Project Alpha</button></BreadcrumbItem>
        <BreadcrumbItem><button onClick={() => {}}>Folder A</button></BreadcrumbItem>
        <BreadcrumbItem><button onClick={() => {}}>Folder B</button></BreadcrumbItem>
        <BreadcrumbItem><button onClick={() => {}}>Process One</button></BreadcrumbItem>
        <BreadcrumbItem isCurrentPage>Current Diagram</BreadcrumbItem>
      </BreadcrumbBar>
    );

    expect(screen.getByText('Starbase')).toBeInTheDocument();
    expect(screen.getByText('Process One')).toBeInTheDocument();
    expect(screen.getByText('Current Diagram')).toBeInTheDocument();
    expect(screen.queryByText('Project Alpha')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Show more breadcrumbs'));
    await user.click(await screen.findByText('Project Alpha'));

    expect(onMiddleClick).toHaveBeenCalledTimes(1);
  });
});
