import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * Error Boundary component to catch React errors
 * Prevents entire app from crashing due to feature flag errors
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error Boundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      
      return (
        <div style={{ 
          padding: 'var(--spacing-7)', 
          textAlign: 'center',
          backgroundColor: 'var(--color-bg-primary)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1 style={{ fontSize: 'var(--text-24)', marginBottom: 'var(--spacing-4)', color: 'var(--color-error)' }}>
            Something went wrong
          </h1>
          <p style={{ marginBottom: 'var(--spacing-4)', color: 'var(--color-text-secondary)' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: 'var(--spacing-3) var(--spacing-6)',
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-bg-primary)',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
