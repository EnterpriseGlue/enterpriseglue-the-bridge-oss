import React from 'react'
import {
  Dropdown,
  ComboBox,
  Button,
} from '@carbon/react'
import { Reset, PlayFilled, PauseFilled, Checkmark, Warning, Error as ErrorIcon } from '@carbon/icons-react'
import { STATE_COLORS, InstanceState } from '../../../shared/components/viewer/viewerConstants'
import { EngineSelector } from '../../../../components/EngineSelector'
import './Processes.module.css'

export type FlowNodeItem = { id: string; name: string; type: string; x: number }

interface ProcessesFilterBarProps {
  defItems: Array<{ id: string; label: string; key: string; version: number }>
  selectedProcess: { key: string; label: string } | null
  setSelectedProcess: (process: { key: string; label: string } | null) => void
  versions: number[]
  selectedVersion: number | null
  setSelectedVersion: (version: number | null) => void
  flowNode: string
  setFlowNode: (flowNode: string) => void
  flowNodes: FlowNodeItem[]
  selectedStates: Array<{ id: string; label: string }>
  setSelectedStates: (states: Array<{ id: string; label: string }>) => void
  advancedOpen: boolean
  setAdvancedOpen: (open: boolean) => void
  varName: string
  varValue: string
  isResetting: boolean
  setIsResetting: (resetting: boolean) => void
  clearViewports: () => void
  setVarName: (name: string) => void
  setVarType: (type: 'String' | 'Boolean' | 'Long' | 'Double' | 'JSON') => void
  setVarOp: (op: 'equals' | 'notEquals' | 'like' | 'greaterThan' | 'lessThan' | 'greaterThanOrEquals' | 'lessThanOrEquals') => void
  setVarValue: (value: string) => void
}

export function ProcessesFilterBar({
  defItems,
  selectedProcess,
  setSelectedProcess,
  versions,
  selectedVersion,
  setSelectedVersion,
  flowNode,
  setFlowNode,
  flowNodes,
  selectedStates,
  setSelectedStates,
  advancedOpen,
  setAdvancedOpen,
  varName,
  varValue,
  isResetting,
  setIsResetting,
  clearViewports,
  setVarName,
  setVarType,
  setVarOp,
  setVarValue,
}: ProcessesFilterBarProps) {
  const handleReset = () => {
    // Check if there are active filters (default is Active + Incidents)
    const isDefaultState = selectedStates.length === 2 && 
      selectedStates.some(s => s.id === 'active') && 
      selectedStates.some(s => s.id === 'incidents')
    
    const hasActiveFilters = selectedProcess || selectedVersion || flowNode || 
      !isDefaultState || varName || varValue
    
    if (hasActiveFilters) {
      setIsResetting(true)
      setTimeout(() => setIsResetting(false), 600)
    }
    
    // Clear saved diagram viewports when filters are reset
    clearViewports()
    
    setSelectedProcess(null)
    setSelectedVersion(null)
    setFlowNode('')
    setSelectedStates([
      { id: 'active', label: 'Active' },
      { id: 'incidents', label: 'Incidents' }
    ])
    setVarName('')
    setVarType('String')
    setVarOp('equals')
    setVarValue('')
  }

  const getStateBadgeColors = (stateId: string) => {
    const state = stateId as InstanceState
    if (STATE_COLORS[state]) {
      return STATE_COLORS[state]
    }
    return { bg: 'var(--cds-tag-background-white, #ffffff)', fg: 'var(--cds-text-primary, #000000)' }
  }

  const getStateIcon = (stateId: string) => {
    switch (stateId) {
      case 'active':
        return PlayFilled
      case 'incidents':
        return Warning
      case 'suspended':
        return PauseFilled
      case 'completed':
        return Checkmark
      case 'canceled':
        return ErrorIcon
      default:
        return null
    }
  }

  return (
    <div className="filter-bar-container" style={{ 
      padding: 'var(--spacing-0)', 
      background: 'var(--color-primary)', 
      borderBottom: '0px solid var(--color-border-primary)',
      display: 'flex',
      gap: 'var(--spacing-0)',
      alignItems: 'center',
      flexWrap: 'wrap'
    }}>
      <div style={{ minWidth: 140 }}>
        <EngineSelector size="sm" label="Engine" style={{ background: 'rgba(255,255,255,0.1)' }} />
      </div>
      <div style={{ minWidth: 150, flex: '1 1 auto' }}>
        <ComboBox
          id="proc-name"
          titleText=""
          placeholder="Select Process"
          items={defItems}
          selectedItem={selectedProcess as any}
          itemToString={(it: any) => (it ? it.label : '')}
          onChange={({ selectedItem }: any) => setSelectedProcess(selectedItem || null)}
          size="sm"
        />
      </div>
      <div style={{ minWidth: 80, flex: '0.5 1 auto' }}>
        <Dropdown
          id="proc-version"
          titleText=""
          label="Select Version"
          items={['All versions', ...versions] as any}
          selectedItem={selectedVersion ?? 'All versions'}
          onChange={({ selectedItem }) => setSelectedVersion(selectedItem === 'All versions' ? null : (selectedItem as any) || null)}
          size="sm"
        />
      </div>
      <div style={{ minWidth: 120, flex: '0.5 1 auto' }}>
        <Dropdown
          id="flow-node"
          titleText=""
          label="Flow Node"
          items={[{ id: '', name: 'All Nodes' }, ...flowNodes]}
          itemToString={(it: FlowNodeItem | null) => {
            if (!it) return ''
            return it.name || it.type.replace(/([a-z])([A-Z])/g, '$1 $2') || it.id
          }}
          selectedItem={flowNodes.find(n => n.id === flowNode) || (flowNode ? { 
            id: flowNode, 
            name: 'Selected Node',
            type: '',
            x: 0
          } : { id: '', name: 'All Nodes', type: '', x: 0 })}
          onChange={({ selectedItem }: any) => {
            setFlowNode(selectedItem?.id || '')
          }}
          size="sm"
        />
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {[
          { id: 'active', label: 'Active' },
          { id: 'incidents', label: 'Incidents' },
          { id: 'suspended', label: 'Suspended' },
          { id: 'completed', label: 'Completed' },
          { id: 'canceled', label: 'Canceled' }
        ].map(state => {
          const isSelected = selectedStates.some(s => s.id === state.id)
          const { bg, fg } = getStateBadgeColors(state.id)
          const Icon = getStateIcon(state.id)
          
          const handleToggle = () => {
            if (isSelected) {
              setSelectedStates(selectedStates.filter(s => s.id !== state.id))
            } else {
              setSelectedStates([...selectedStates, state])
            }
          }
          
          return (
            <button
              key={state.id}
              onClick={handleToggle}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '2px 10px',
                backgroundColor: isSelected ? bg : 'transparent',
                border: `1px solid ${isSelected ? bg : 'rgba(255,255,255,0.3)'}`,
                borderRadius: '5px',
                fontSize: 'var(--text-14)',
                color: isSelected ? fg : 'rgba(255,255,255,0.5)',
                whiteSpace: 'nowrap',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {Icon && (
                state.id === 'active' || state.id === 'completed' ? (
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={14} style={{ color: isSelected ? '#ffffff' : bg }} />
                  </span>
                ) : (
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 9999,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      background: bg,
                    }}
                  >
                    <Icon size={12} style={{ color: '#ffffff' }} />
                  </span>
                )
              )}
              {state.label}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-0)', alignItems: 'center', marginLeft: 'auto' }}>
        {false && (
          <Button size="sm" kind="ghost" onClick={() => setAdvancedOpen(!advancedOpen)}>
            {advancedOpen ? 'Hide Advanced' : 'Advanced'}
          </Button>
        )}
        <button
          title="Reset Filters"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 'var(--spacing-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 500
          }}
          onClick={handleReset}
        >
          <Reset 
            size={20} 
            style={{ 
              fill: 'white',
              transform: isResetting ? 'rotate(360deg)' : 'rotate(0deg)',
              transition: 'transform 0.6s ease-in-out'
            }} 
          />
        </button>
      </div>
    </div>
  )
}
