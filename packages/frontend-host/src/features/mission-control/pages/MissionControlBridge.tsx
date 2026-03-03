import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Tile, Button } from '@carbon/react'
import { FlowData, BatchJob, DecisionTree, GameConsole } from '@carbon/icons-react'
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout'

export default function MissionControlHome() {
  const navigate = useNavigate()

  const sections = [
    {
      title: 'Processes',
      description: 'Monitor and manage process instances. View active processes, track incidents, and perform bulk operations on running instances.',
      icon: FlowData,
      path: '/mission-control/processes',
      color: 'var(--color-success)',
    },
    {
      title: 'Batches',
      description: 'Track batch operations and background jobs. Monitor the status of bulk operations like retries, suspensions, and deletions.',
      icon: BatchJob,
      path: '/mission-control/batches',
      color: 'var(--color-info)',
    },
    {
      title: 'Decisions',
      description: 'Test and evaluate DMN decision tables. Input variables and see decision outcomes in real-time.',
      icon: DecisionTree,
      path: '/mission-control/decisions',
      color: 'var(--color-warning)',
    },
  ]

  return (
    <PageLayout style={{ 
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-5)',
      background: 'var(--color-bg-primary)',
      minHeight: '100vh'
    }}>
      <PageHeader
        icon={GameConsole}
        title="Mission Control"
        subtitle="Manage and monitor your process automation infrastructure"
        gradient={PAGE_GRADIENTS.green}
      />

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 'var(--spacing-4)'
      }}>
        {sections.map((section) => {
          const Icon = section.icon
          return (
            <Tile
              key={section.path}
              style={{
                padding: 'var(--spacing-6)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                border: '1px solid var(--color-border-primary)',
                borderRadius: '8px',
                backgroundColor: 'var(--color-bg-secondary)',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
              }}
              onClick={() => navigate(section.path)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = section.color
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border-primary)'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-4)' }}>
                <div style={{ 
                  padding: 'var(--spacing-3)',
                  borderRadius: 'var(--border-radius-md)',
                  backgroundColor: `${section.color}20`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Icon size={32} style={{ color: section.color }} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ 
                    fontSize: 'var(--text-18)', 
                    fontWeight: 'var(--font-weight-semibold)',
                    marginBottom: 'var(--spacing-2)',
                    color: 'var(--color-text-primary)'
                  }}>
                    {section.title}
                  </h3>
                  <p style={{ 
                    fontSize: 'var(--text-14)', 
                    color: 'var(--color-text-secondary)',
                    lineHeight: '1.5',
                    marginBottom: 'var(--spacing-4)'
                  }}>
                    {section.description}
                  </p>
                  <Button 
                    size="sm" 
                    kind="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(section.path)
                    }}
                  >
                    Open {section.title} →
                  </Button>
                </div>
              </div>
            </Tile>
          )
        })}
      </div>
    </PageLayout>
  )
}
