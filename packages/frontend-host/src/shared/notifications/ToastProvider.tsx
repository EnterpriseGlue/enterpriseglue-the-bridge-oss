import React from 'react';
import { ToastNotification } from '@carbon/react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface ToastInput {
  kind: ToastKind;
  title: string;
  subtitle?: string;
  timeout?: number;
}

interface ToastItem extends ToastInput {
  id: string;
  persistent: boolean;
  createdAt: number;
}

interface ToastContextValue {
  notify: (toast: ToastInput) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const DEFAULT_TIMEOUT = 10000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const timersRef = React.useRef<Map<string, number>>(new Map());
  const queryClient = useQueryClient();

  const clearToastTimer = React.useCallback((id: string) => {
    const timerId = timersRef.current.get(id);
    if (timerId) {
      window.clearTimeout(timerId);
      timersRef.current.delete(id);
    }
  }, []);

  const removeToast = React.useCallback((id: string) => {
    clearToastTimer(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, [clearToastTimer]);

  const persistToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, persistent: true } : t)));
    clearToastTimer(id);
  }, [clearToastTimer]);

  const notify = React.useCallback((toast: ToastInput) => {
    const id = crypto.randomUUID();
    const item: ToastItem = {
      id,
      kind: toast.kind,
      title: toast.title,
      subtitle: toast.subtitle,
      timeout: toast.timeout ?? DEFAULT_TIMEOUT,
      persistent: false,
      createdAt: Date.now(),
    };

    setToasts((prev) => [item, ...prev]);

    const timerId = window.setTimeout(() => removeToast(id), item.timeout);
    timersRef.current.set(id, timerId);

    apiClient.post('/api/notifications', {
      state: toast.kind,
      title: toast.title,
      subtitle: toast.subtitle,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }).catch(() => {
      // ignore notification persistence errors
    });
  }, [queryClient, removeToast]);

  React.useEffect(() => {
    return () => {
      timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 'calc(var(--header-height) + var(--spacing-5))',
          right: 'var(--spacing-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-3)',
          zIndex: 'var(--z-toast)',
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => persistToast(toast.id)}
            role="presentation"
          >
            <ToastNotification
              kind={toast.kind}
              title={toast.title}
              subtitle={toast.subtitle}
              timeout={toast.persistent ? undefined : toast.timeout}
              onClose={() => removeToast(toast.id)}
              hideCloseButton={false}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
