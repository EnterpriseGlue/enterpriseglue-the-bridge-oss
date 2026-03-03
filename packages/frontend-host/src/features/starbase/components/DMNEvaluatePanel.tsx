import React from 'react'
import { Button, TextInput, Dropdown, InlineNotification } from '@carbon/react'
import { Play } from '@carbon/icons-react'

type Variable = {
  name: string
  type: 'String' | 'Boolean' | 'Long' | 'Double' | 'JSON'
  value: string
}

type Props = {
  decisionKey?: string
  onEvaluate?: (variables: Record<string, { value: any; type: string }>) => void
  result?: any
  error?: string
  isEvaluating?: boolean
}

export default function DMNEvaluatePanel({ decisionKey, onEvaluate, result, error, isEvaluating }: Props) {
  const [variables, setVariables] = React.useState<Variable[]>([
    { name: '', type: 'String', value: '' }
  ])

  const addVariable = () => {
    setVariables([...variables, { name: '', type: 'String', value: '' }])
  }

  const removeVariable = (index: number) => {
    setVariables(variables.filter((_, i) => i !== index))
  }

  const updateVariable = (index: number, field: keyof Variable, value: any) => {
    const updated = [...variables]
    updated[index] = { ...updated[index], [field]: value }
    setVariables(updated)
  }

  const handleEvaluate = () => {
    if (!onEvaluate) return
    
    const vars: Record<string, { value: any; type: string }> = {}
    for (const v of variables) {
      if (!v.name.trim()) continue
      
      let parsedValue: any = v.value
      if (v.type === 'Boolean') {
        parsedValue = v.value.toLowerCase() === 'true'
      } else if (v.type === 'Long' || v.type === 'Double') {
        const num = Number(v.value)
        if (!isNaN(num)) parsedValue = num
      } else if (v.type === 'JSON') {
        try {
          parsedValue = JSON.parse(v.value)
        } catch {
          // Keep as string if parse fails
        }
      }
      
      vars[v.name] = { value: parsedValue, type: v.type }
    }
    
    onEvaluate(vars)
  }

  const typeOptions = [
    { id: 'String', label: 'String' },
    { id: 'Boolean', label: 'Boolean' },
    { id: 'Long', label: 'Long' },
    { id: 'Double', label: 'Double' },
    { id: 'JSON', label: 'JSON' },
  ]

  return (
    <div style={{ padding: 'var(--spacing-4)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', height: '100%', overflow: 'auto' }}>
      <div>
        <h4 style={{ fontSize: 'var(--text-14)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>
          Evaluate Decision
        </h4>
        {decisionKey && (
          <p style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
            Decision: <strong>{decisionKey}</strong>
          </p>
        )}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-2)' }}>
          <label style={{ fontSize: 'var(--text-12)', fontWeight: 'var(--font-weight-semibold)' }}>
            Input Variables
          </label>
          <Button kind="ghost" size="sm" onClick={addVariable}>
            Add Variable
          </Button>
        </div>

        {variables.map((variable, index) => (
          <div key={index} style={{ display: 'flex', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <TextInput
                id={`var-name-${index}`}
                labelText="Name"
                placeholder="variableName"
                value={variable.name}
                onChange={(e) => updateVariable(index, 'name', e.target.value)}
                size="sm"
              />
            </div>
            <div style={{ width: 120 }}>
              <Dropdown
                id={`var-type-${index}`}
                titleText="Type"
                label="Select type"
                items={typeOptions}
                selectedItem={typeOptions.find(t => t.id === variable.type)}
                itemToString={(item) => item?.label || ''}
                onChange={({ selectedItem }) => updateVariable(index, 'type', selectedItem?.id || 'String')}
                size="sm"
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput
                id={`var-value-${index}`}
                labelText="Value"
                placeholder="value"
                value={variable.value}
                onChange={(e) => updateVariable(index, 'value', e.target.value)}
                size="sm"
              />
            </div>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => removeVariable(index)}
              hasIconOnly
              iconDescription="Remove"
              style={{ marginBottom: 2 }}
            >
              ×
            </Button>
          </div>
        ))}
      </div>

      <Button
        kind="primary"
        size="sm"
        renderIcon={Play}
        onClick={handleEvaluate}
        disabled={!decisionKey || isEvaluating || variables.every(v => !v.name.trim())}
      >
        {isEvaluating ? 'Evaluating...' : 'Evaluate'}
      </Button>

      {error && (
        <InlineNotification
          kind="error"
          title="Evaluation failed"
          subtitle={error}
          lowContrast
          hideCloseButton
        />
      )}

      {result && (
        <div>
          <h5 style={{ fontSize: 'var(--text-12)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>
            Result
          </h5>
          <pre style={{
            background: 'var(--color-bg-secondary)',
            padding: 'var(--spacing-3)',
            borderRadius: 'var(--border-radius-md)',
            fontSize: 'var(--text-12)',
            overflow: 'auto',
            maxHeight: 300
          }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
