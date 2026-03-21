import React from 'react'
import { TextInput } from '@carbon/react'

export type UserLookupEmailFieldItem = {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

interface UserLookupEmailFieldProps {
  id: string
  labelText: string
  placeholder: string
  value: string
  searchValue: string
  suggestionItems: UserLookupEmailFieldItem[]
  selectedItem: UserLookupEmailFieldItem | null
  onChange: (value: string) => void
  onSelect: (item: UserLookupEmailFieldItem) => void
  onBlur?: () => void
  invalid?: boolean
  invalidText?: string
  disabled?: boolean
}

export default function UserLookupEmailField({
  id,
  labelText,
  placeholder,
  value,
  searchValue,
  suggestionItems,
  selectedItem,
  onChange,
  onSelect,
  onBlur,
  invalid,
  invalidText,
  disabled,
}: UserLookupEmailFieldProps) {
  const trimmedValue = String(value || '').trim()
  const showUserSuggestions =
    searchValue.trim().length >= 2 &&
    suggestionItems.length > 0 &&
    (!selectedItem || selectedItem.email !== trimmedValue)

  return (
    <div style={{ position: 'relative' }}>
      <TextInput
        id={id}
        labelText={labelText}
        placeholder={placeholder}
        type="text"
        value={value}
        invalid={invalid}
        invalidText={invalidText}
        onChange={(e: any) => onChange(String(e.target.value || ''))}
        onBlur={onBlur}
        disabled={disabled}
      />

      {showUserSuggestions ? (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            border: '1px solid var(--cds-border-subtle, #c6c6c6)',
            borderRadius: 0,
            background: 'var(--cds-layer, #ffffff)',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.16)',
            maxHeight: 180,
            overflowY: 'auto',
            zIndex: 2,
          }}
        >
          {suggestionItems.map((item, index) => {
            const name = `${item.firstName || ''}${item.firstName && item.lastName ? ' ' : ''}${item.lastName || ''}`.trim()
            return (
              <button
                key={item.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(item)}
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  padding: '12px 16px',
                  border: 0,
                  borderBottom: index === suggestionItems.length - 1 ? 0 : '1px solid var(--cds-border-subtle, #e0e0e0)',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: 600 }}>{name || item.email}</span>
                {name ? <span style={{ color: 'var(--cds-text-secondary, #525252)' }}>{item.email}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
