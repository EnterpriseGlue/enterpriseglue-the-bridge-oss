import React from 'react'
import { Button } from '@carbon/react'

export default function TopBar() {
  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-2)', margin: 'var(--spacing-2) 0' }}>
      <Button kind="ghost" size="sm">Hand</Button>
      <Button kind="ghost" size="sm">Lasso</Button>
      <Button kind="ghost" size="sm">Space</Button>
      <Button kind="ghost" size="sm">Connect</Button>
    </div>
  )
}
