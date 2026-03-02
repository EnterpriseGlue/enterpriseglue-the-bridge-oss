import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'

type Version = {
  id: string
  author?: string
  message?: string
  createdAt: number
}

export default function VersionsPanel({ fileId }: { fileId: string }) {
  const q = useQuery({
    queryKey: ['versions', fileId],
    queryFn: () => apiClient.get<Version[]>(`/starbase-api/files/${fileId}/versions`),
    enabled: !!fileId,
  })
  if (q.isLoading) return <p>Loading versions…</p>
  if (q.isError) return <p>Failed to load versions.</p>
  if (!q.data || q.data.length === 0) return <p>No versions yet.</p>
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Versions</h3>
      <ul>
        {q.data.map((v) => (
          <li key={v.id}>
            <strong>{new Date(v.createdAt * 1000).toLocaleString()}</strong>
            {v.author ? ` • ${v.author}` : ''}
            {v.message ? ` • ${v.message}` : ''}
          </li>
        ))}
      </ul>
      <p style={{ opacity: 0.7 }}>Actions disabled (read-only).</p>
    </div>
  )
}
