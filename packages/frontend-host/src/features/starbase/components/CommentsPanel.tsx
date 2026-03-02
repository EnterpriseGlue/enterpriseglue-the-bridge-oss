import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'

type Comment = {
  id: string
  author?: string
  message: string
  createdAt: number
}

export default function CommentsPanel({ fileId }: { fileId: string }) {
  const q = useQuery({
    queryKey: ['comments', fileId],
    queryFn: () => apiClient.get<Comment[]>(`/starbase-api/files/${fileId}/comments`),
    enabled: !!fileId,
  })
  if (q.isLoading) return <div style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}><p>Loading comments…</p></div>
  if (q.isError) return <div style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}><p>Failed to load comments.</p></div>

  const items = q.data || []

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-3) var(--spacing-4)' }}>
        {items.length === 0 ? (
          <div style={{ paddingTop: 'var(--spacing-5)', color: 'var(--color-text-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)' }}>
              <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M2 4h28v18H9l-7 6V4Z" stroke="#8D8D8D" strokeWidth="2" fill="none"/>
              </svg>
              <strong>Add comments</strong>
            </div>
            <p style={{ margin: 0 }}>You can add comments about diagrams or specific BPMN elements.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            {items.map((c) => (
              <div key={c.id} style={{ borderBottom: '1px solid var(--color-border-primary)', paddingBottom: 'var(--spacing-2)' }}>
                <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>{c.author || 'unknown'}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.message}</div>
                <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-12)' }}>{new Date(c.createdAt * 1000).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--color-border-primary)', padding: 'var(--spacing-2)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
        <input disabled placeholder="Reply…" style={{ flex: 1, padding: 'var(--spacing-2) var(--spacing-3)', border: '1px solid var(--color-divider)', borderRadius: 'var(--border-radius-sm)', background: 'var(--color-bg-secondary)' }} />
        <button disabled style={{ padding: 'var(--spacing-2) var(--spacing-3)', borderRadius: 'var(--border-radius-sm)', background: 'var(--color-border-primary)', border: '1px solid var(--color-divider)', color: 'var(--color-text-tertiary)' }}>Send</button>
      </div>
    </div>
  )
}
