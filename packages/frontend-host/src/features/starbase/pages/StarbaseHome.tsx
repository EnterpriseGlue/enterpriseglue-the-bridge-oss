import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiClient } from '../../../shared/api/client'

type Project = { id: string; name: string; createdAt: number }
type FileRow = { id: string; name: string; type: string; updatedAt: number }

export default function StarbaseHome() {
  const projectsQ = useQuery({
    queryKey: ['starbase', 'projects'],
    queryFn: () => apiClient.get<Project[]>('/starbase-api/projects'),
  })

  const [activeProject, setActiveProject] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (projectsQ.data && projectsQ.data.length > 0 && !activeProject) {
      setActiveProject(projectsQ.data[0].id)
    }
  }, [projectsQ.data, activeProject])

  const filesQ = useQuery({
    queryKey: ['files', activeProject],
    queryFn: () => apiClient.get<FileRow[]>(`/starbase-api/projects/${activeProject}/files`),
    enabled: !!activeProject,
  })

  return (
    <div>
      <h2>Starbase</h2>
      {projectsQ.isLoading ? <p>Loading projects…</p> : null}
      {projectsQ.data && (
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-4)' }}>
          {projectsQ.data.map((p) => (
            <button
              key={p.id}
              className={`cds--btn ${activeProject === p.id ? 'cds--btn--primary' : 'cds--btn--tertiary'}`}
              onClick={() => setActiveProject(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {filesQ.isLoading ? <p>Loading files…</p> : null}
      {filesQ.data && filesQ.data.length === 0 ? <p>No files found.</p> : null}
      {filesQ.data && filesQ.data.length > 0 && (
        <ul>
          {filesQ.data.map((f) => (
            <li key={f.id}>
              <Link to={`/starbase/editor/${f.id}`}>{f.name}</Link> ({f.type})
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
