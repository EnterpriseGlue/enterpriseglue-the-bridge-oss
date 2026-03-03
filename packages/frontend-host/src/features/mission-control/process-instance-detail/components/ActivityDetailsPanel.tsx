import React from 'react'
import { Button, Tile, Tabs, TabList, Tab, TabPanels, TabPanel } from '@carbon/react'
import {
  LocalVariablesTable,
  GlobalVariablesTable,
  InputMappingsTable,
  OutputMappingsTable,
  DecisionInputsTable,
  DecisionOutputsTable,
} from './TableComponents'
import type { HistoricDecisionInstanceLite, DecisionIo } from './types'

export interface ActivityDetailsPanelProps {
  rightTab: 'variables' | 'io'
  setRightTab: (tab: 'variables' | 'io') => void
  varsQ: { isLoading: boolean; data?: Record<string, { value: any; type: string }> }
  selectedActivityId: string | null
  selectedActivityName: string
  selectedNodeVariables: any[] | null
  shouldShowDecisionPanel: boolean
  status: string
  openVariableEditor: (name: string, value: any) => void
  showAlert: (message: string, kind?: 'info' | 'warning' | 'error', title?: string) => void
  onAddVariable?: () => void
  onBulkUploadVariables?: () => void
  selectedDecisionInstance: HistoricDecisionInstanceLite | null
  decisionInputs: DecisionIo[]
  decisionOutputs: DecisionIo[]
  selectedNodeInputMappings: any[] | undefined
  selectedNodeOutputMappings: any[] | undefined
  formatMappingType: (val: any) => string
  formatMappingValue: (val: any) => string
  isModMode: boolean
}

export function ActivityDetailsPanel({
  rightTab,
  setRightTab,
  varsQ,
  selectedActivityId,
  selectedActivityName,
  selectedNodeVariables,
  shouldShowDecisionPanel,
  status,
  openVariableEditor,
  showAlert,
  onAddVariable,
  onBulkUploadVariables,
  selectedDecisionInstance,
  decisionInputs,
  decisionOutputs,
  selectedNodeInputMappings,
  selectedNodeOutputMappings,
  formatMappingType,
  formatMappingValue,
  isModMode,
}: ActivityDetailsPanelProps) {
  return (
    <section key="right-panel" style={{ background: 'var(--color-bg-primary)', padding: 'var(--spacing-2)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, height: '100%' }}>
      <Tabs
        selectedIndex={rightTab === 'variables' ? 0 : 1}
        onChange={({ selectedIndex }) => setRightTab(selectedIndex === 0 ? 'variables' : 'io')}
      >
        <TabList aria-label="Process instance detail tabs">
          <Tab>Variables</Tab>
          <Tab>I/O mappings</Tab>
        </TabList>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <TabPanels>
            <TabPanel>
              {varsQ.isLoading ? <p>Loading...</p> : null}
              {!selectedActivityId && (
                <div style={{ marginBottom: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
                  Select a flow node to see local variables or decision inputs.
                </div>
              )}

              <div style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingRight: 'var(--spacing-1)' }}>
                {selectedActivityId && !shouldShowDecisionPanel && (
                  <div style={{ display: 'flex', gap: 'var(--spacing-3)', flex: 1, minHeight: 0 }}>
                    <Tile style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                      <div style={{ marginBottom: 'var(--spacing-2)' }}>
                        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Local variables</div>
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Values captured specifically for {selectedActivityName || selectedActivityId}. These are historic snapshots and cannot be edited.</div>
                      </div>
                      {(selectedNodeVariables && selectedNodeVariables.length > 0) ? (
                        <div style={{ overflow: 'auto', flex: 1 }}>
                          <LocalVariablesTable data={selectedNodeVariables || []} status={status} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>The selected node has no local variables.</div>
                      )}
                    </Tile>

                    <Tile style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                      <div style={{ marginBottom: 'var(--spacing-2)' }}>
                        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Global variables</div>
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Process-scope variables available throughout the instance.</div>
                      </div>
                      {varsQ.data && Object.keys(varsQ.data).length > 0 ? (
                        <div style={{ overflow: 'auto', flex: 1 }}>
                          <GlobalVariablesTable data={varsQ.data} status={status} openVariableEditor={openVariableEditor} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No global variables are present.</div>
                      )}
                      {(status === 'ACTIVE' || status === 'SUSPENDED') && (
                        <div style={{ paddingTop: 'var(--spacing-2)', display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                          <Button
                            size="sm"
                            kind="ghost"
                            onClick={() => (onAddVariable ? onAddVariable() : showAlert('This feature is coming soon.', 'info'))}
                          >
                            Add variable +
                          </Button>
                          <Button
                            size="sm"
                            kind="ghost"
                            onClick={() => (onBulkUploadVariables ? onBulkUploadVariables() : showAlert('This feature is coming soon.', 'info'))}
                          >
                            Bulk upload variables
                          </Button>
                        </div>
                      )}
                    </Tile>
                  </div>
                )}

                {selectedActivityId && shouldShowDecisionPanel && selectedDecisionInstance && (
                  <div style={{ display: 'flex', gap: 'var(--spacing-3)', flex: 1, minHeight: 0 }}>
                    <Tile style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                      <div style={{ marginBottom: 'var(--spacing-2)' }}>
                        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Decision Inputs</div>
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
                          Inputs to decision evaluation
                        </div>
                      </div>
                      {decisionInputs.length > 0 ? (
                        <div style={{ overflow: 'auto', flex: 1 }}>
                          <DecisionInputsTable data={decisionInputs} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No decision inputs.</div>
                      )}
                    </Tile>

                    <Tile style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                      <div style={{ marginBottom: 'var(--spacing-2)' }}>
                        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Decision Outputs</div>
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
                          Result of decision evaluation
                        </div>
                      </div>
                      {decisionOutputs.length > 0 ? (
                        <div style={{ overflow: 'auto', flex: 1 }}>
                          <DecisionOutputsTable data={decisionOutputs} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No decision outputs.</div>
                      )}
                    </Tile>
                  </div>
                )}

                {!selectedActivityId && (
                  <Tile style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ marginBottom: 'var(--spacing-2)' }}>
                      <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Global variables</div>
                      <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Process-scope variables available throughout the instance.</div>
                    </div>
                    {varsQ.data && Object.keys(varsQ.data).length > 0 ? (
                      <div style={{ overflow: 'auto', flex: 1 }}>
                        <GlobalVariablesTable data={varsQ.data} status={status} openVariableEditor={openVariableEditor} />
                      </div>
                    ) : (
                      <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No global variables are present.</div>
                    )}
                    {(status === 'ACTIVE' || status === 'SUSPENDED') && (
                      <div style={{ paddingTop: 'var(--spacing-2)', display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
                        <Button
                          size="sm"
                          kind="ghost"
                          onClick={() => (onAddVariable ? onAddVariable() : showAlert('This feature is coming soon.', 'info'))}
                        >
                          Add variable +
                        </Button>
                        <Button
                          size="sm"
                          kind="ghost"
                          onClick={() => (onBulkUploadVariables ? onBulkUploadVariables() : showAlert('This feature is coming soon.', 'info'))}
                        >
                          Bulk upload variables
                        </Button>
                      </div>
                    )}
                  </Tile>
                )}
              </div>
            </TabPanel>

            <TabPanel>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-2)' }}>
                <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>
                  {selectedActivityId ? `I/O Mappings — ${selectedActivityName}` : 'I/O Mappings'}
                </div>
                {!selectedActivityId && (
                  <span style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Select a flow node to see input/output mappings.</span>
                )}
              </div>

              <div style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', paddingRight: 'var(--spacing-1)' }}>
                {selectedActivityId && (
                  <div style={{ display: 'flex', gap: 'var(--spacing-3)', flex: 1, minHeight: 0 }}>
                    <Tile style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                      <div style={{ marginBottom: 'var(--spacing-2)' }}>
                        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Input mappings</div>
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Data passed into {selectedActivityName || selectedActivityId}.</div>
                      </div>
                      {selectedNodeInputMappings && selectedNodeInputMappings.length > 0 ? (
                        <div style={{ overflow: 'auto', flex: 1 }}>
                          <InputMappingsTable data={selectedNodeInputMappings} formatMappingType={formatMappingType} formatMappingValue={formatMappingValue} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No input mappings.</div>
                      )}
                    </Tile>

                    <Tile style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
                      <div style={{ marginBottom: 'var(--spacing-2)' }}>
                        <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Output mappings</div>
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>Data returned from {selectedActivityName || selectedActivityId}.</div>
                      </div>
                      {selectedNodeOutputMappings && selectedNodeOutputMappings.length > 0 ? (
                        <div style={{ overflow: 'auto', flex: 1 }}>
                          <OutputMappingsTable data={selectedNodeOutputMappings} formatMappingType={formatMappingType} formatMappingValue={formatMappingValue} />
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No output mappings.</div>
                      )}
                    </Tile>
                  </div>
                )}

                {!selectedActivityId && (
                  <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: 'var(--spacing-6)' }}>
                    Select a flow node from the Instance History to view its I/O mappings.
                  </div>
                )}
              </div>
            </TabPanel>
          </TabPanels>
        </div>
      </Tabs>
    </section>
  )
}
