import React from 'react'
import { Breadcrumb } from '@carbon/react'
import styles from './BreadcrumbBar.module.css'

interface BreadcrumbBarProps {
  children: React.ReactNode
  rightActions?: React.ReactNode
}

/**
 * Shared breadcrumb bar component with consistent Carbon g10 styling.
 * Wraps Carbon's Breadcrumb component in a styled container.
 */
export function BreadcrumbBar({ children, rightActions }: BreadcrumbBarProps) {
  const safeChildren = React.Children.toArray(children).filter((c) => React.isValidElement(c))
  return (
    <div className={styles.breadcrumbBar}>
      <div className={styles.breadcrumbMain}>
        <Breadcrumb noTrailingSlash>
          {safeChildren}
        </Breadcrumb>
      </div>
      {rightActions ? <div className={styles.rightActions}>{rightActions}</div> : null}
    </div>
  )
}

export default BreadcrumbBar
