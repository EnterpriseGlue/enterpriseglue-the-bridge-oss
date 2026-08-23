import React from 'react'
import { describe, expect, it } from 'vitest'
import type { RouteObject } from 'react-router-dom'

import { createAppRoutes } from './index'

function tenantChildren(routes: RouteObject[]): RouteObject[] {
  return routes.find((route) => route.path === '/t/:tenantSlug')?.children ?? []
}

describe('native plugin route integration', () => {
  it('keeps native routes separate from legacy extension authorization validation', () => {
    const nativeElement = React.createElement('div', null, 'Native plugin')
    const routes = createAppRoutes(
      [],
      [],
      [],
      [{ path: 'support', element: nativeElement }],
    )

    expect(
      tenantChildren(routes).some(
        (route) => route.path === 'support' && route.element === nativeElement,
      ),
    ).toBe(true)
  })

  it('continues to reject legacy extension routes without FGA metadata', () => {
    const routes = createAppRoutes(
      [],
      [{ path: 'unsafe-legacy-extension', element: <div>Legacy</div> }],
    )

    expect(
      tenantChildren(routes).some(
        (route) => route.path === 'unsafe-legacy-extension',
      ),
    ).toBe(false)
  })
})
