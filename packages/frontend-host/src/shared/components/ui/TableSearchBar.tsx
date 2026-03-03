import * as React from 'react'
import { Search } from '@carbon/icons-react'

interface TableSearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  width?: string
}

export function TableSearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  width = '300px',
}: TableSearchBarProps) {
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '4px',
      padding: '2px 6px',
      backgroundColor: 'white',
      borderRadius: '4px',
      border: '1px solid #c6c6c6',
      width,
    }}>
      <Search size={12} style={{ color: '#6f6f6f', flexShrink: 0 }} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          backgroundColor: 'transparent',
          fontSize: '12px',
          color: '#161616',
          minWidth: 0,
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            padding: '0',
            fontSize: '10px',
            color: '#6f6f6f',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
