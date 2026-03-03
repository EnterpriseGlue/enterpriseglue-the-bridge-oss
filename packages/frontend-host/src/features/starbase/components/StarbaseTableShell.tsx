import React from 'react'
import { TableContainer } from '@carbon/react'

type StarbaseTableShellProps = {
  children: React.ReactNode
}

export function StarbaseTableShell({ children }: StarbaseTableShellProps) {
  return (
    <TableContainer
      style={{
        width: '100%',
        maxWidth: '100%',
        minWidth: '100%',
        display: 'block',
      }}
    >
      {children}
    </TableContainer>
  )
}
