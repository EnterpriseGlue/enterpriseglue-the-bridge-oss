import React from 'react';
import { Pagination } from '@carbon/react';

export interface AdminTablePaginationState {
  page: number;
  pageSize: number;
}

export function useAdminTablePagination<T>(
  items: T[],
  options: { initialPageSize?: number; resetKey?: string } = {},
) {
  const initialPageSize = options.initialPageSize ?? 10;
  const [state, setState] = React.useState<AdminTablePaginationState>({ page: 1, pageSize: initialPageSize });

  React.useEffect(() => {
    setState((current) => current.page === 1 ? current : { ...current, page: 1 });
  }, [options.resetKey]);

  React.useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(items.length / state.pageSize));
    if (state.page > lastPage) setState((current) => ({ ...current, page: lastPage }));
  }, [items.length, state.page, state.pageSize]);

  const pageItems = React.useMemo(() => {
    const start = (state.page - 1) * state.pageSize;
    return items.slice(start, start + state.pageSize);
  }, [items, state.page, state.pageSize]);

  return {
    ...state,
    pageItems,
    setPagination: (next: AdminTablePaginationState) => setState(next),
  };
}

export function AdminTablePagination({
  totalItems,
  page,
  pageSize,
  onChange,
  pageSizes = [10, 25, 50],
}: {
  totalItems: number;
  page: number;
  pageSize: number;
  onChange: (state: AdminTablePaginationState) => void;
  pageSizes?: number[];
}) {
  if (totalItems === 0) return null;
  return (
    <Pagination
      className="eg-admin-table-pagination"
      page={page}
      pageSize={pageSize}
      pageSizes={pageSizes}
      totalItems={totalItems}
      itemsPerPageText="Items per page"
      onChange={({ page: nextPage, pageSize: nextPageSize }) => onChange({ page: nextPage, pageSize: nextPageSize })}
    />
  );
}

export function AdminTableEmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="eg-admin-table-empty-state" role="status" aria-live="polite">
      <h3>{title}</h3>
      <p>{description}</p>
      {children ? <div className="eg-admin-table-empty-state__actions">{children}</div> : null}
    </section>
  );
}
