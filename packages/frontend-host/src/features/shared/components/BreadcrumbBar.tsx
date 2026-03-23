import React from 'react'
import { Breadcrumb, BreadcrumbItem, OverflowMenu, OverflowMenuItem } from '@carbon/react'
import styles from './BreadcrumbBar.module.css'

interface BreadcrumbBarProps {
  children: React.ReactNode
  rightActions?: React.ReactNode
  maxItemsBeforeOverflow?: number
  overflowMenuAriaLabel?: string
}

function getNodeText(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (React.isValidElement(child)) return getNodeText((child.props as { children?: React.ReactNode }).children)
      return ''
    })
    .join('')
    .trim()
}

function getOverflowItemAction(child: React.ReactElement): (() => void) | undefined {
  const childProps = child.props as { children?: React.ReactNode; href?: string; onClick?: ((event: any) => void) | undefined }
  const nestedChild = React.isValidElement<{ href?: string; onClick?: ((event: any) => void) | undefined; children?: React.ReactNode }>(childProps.children)
    ? childProps.children
    : null
  const nestedProps = nestedChild?.props as { href?: string; onClick?: ((event: any) => void) | undefined } | undefined
  const onClick = nestedProps?.onClick ?? childProps.onClick
  const href = nestedProps?.href ?? childProps.href

  if (typeof onClick === 'function') {
    return () => onClick({ preventDefault() {}, stopPropagation() {} })
  }

  if (typeof href === 'string' && href) {
    return () => {
      if (typeof window !== 'undefined') window.location.assign(href)
    }
  }

  return undefined
}

function getOverflowItemLabel(child: React.ReactElement, fallbackIndex: number): string {
  const childProps = child.props as { children?: React.ReactNode }
  const nestedChild = React.isValidElement<{ children?: React.ReactNode }>(childProps.children) ? childProps.children : null
  const label = getNodeText(nestedChild?.props?.children ?? childProps.children)
  return label || `Breadcrumb ${fallbackIndex + 1}`
}

/**
 * Shared breadcrumb bar component with consistent Carbon g10 styling.
 * Wraps Carbon's Breadcrumb component in a styled container.
 */
export function BreadcrumbBar({
  children,
  rightActions,
  maxItemsBeforeOverflow = 5,
  overflowMenuAriaLabel = 'Show more breadcrumbs',
}: BreadcrumbBarProps) {
  const safeChildren = React.Children.toArray(children).filter((c): c is React.ReactElement => React.isValidElement(c))
  const shouldCollapse = Number.isFinite(maxItemsBeforeOverflow) && maxItemsBeforeOverflow >= 4 && safeChildren.length > maxItemsBeforeOverflow
  const renderedChildren = shouldCollapse
    ? [
        safeChildren[0],
        <BreadcrumbItem key="breadcrumb-overflow-menu">
          <OverflowMenu aria-label={overflowMenuAriaLabel} iconDescription={overflowMenuAriaLabel} size="sm">
            {safeChildren.slice(1, -2).map((child, index) => (
              <OverflowMenuItem
                key={String(child.key ?? `overflow-${index}`)}
                itemText={getOverflowItemLabel(child, index + 1)}
                onClick={getOverflowItemAction(child)}
              />
            ))}
          </OverflowMenu>
        </BreadcrumbItem>,
        ...safeChildren.slice(-2),
      ]
    : safeChildren
  return (
    <div className={styles.breadcrumbBar}>
      <div className={styles.breadcrumbMain}>
        <Breadcrumb noTrailingSlash>
          {renderedChildren}
        </Breadcrumb>
      </div>
      {rightActions ? <div className={styles.rightActions}>{rightActions}</div> : null}
    </div>
  )
}

export default BreadcrumbBar
