import React from 'react'
import { Tabs, TabList, Tab, TabPanels, TabPanel, Dropdown } from '@carbon/react'

export type SelectionInfo = { id: string; type: string; name?: string } | null

const TARGET_VERSIONS = [
  '8.6.0',
  '8.5.0',
  '8.4.0',
]

export default function Inspectors({ selection }: { selection: SelectionInfo }) {
  const [target, setTarget] = React.useState<string | null>(TARGET_VERSIONS[0])
  return (
    <div>
      <Tabs>
        <TabList aria-label="Inspectors">
          <Tab>Details</Tab>
          <Tab>Problems</Tab>
          <Tab>Variables</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            {!selection && <p>No element selected.</p>}
            {selection && (
              <div>
                <p><strong>ID:</strong> {selection.id}</p>
                <p><strong>Type:</strong> {selection.type}</p>
                <p><strong>Name:</strong> {selection.name || '-'}</p>
              </div>
            )}
          </TabPanel>
          <TabPanel>
            <div style={{ marginBottom: 'var(--spacing-3)' }}>
              <label className="cds--label" htmlFor="problems-target">Check problems against</label>
              <Dropdown
                id="problems-target"
                label="Select version"
                items={TARGET_VERSIONS}
                selectedItem={target}
                titleText="Check problems against"
                itemToString={(it) => (it ?? '') as string}
                onChange={(e) => setTarget(e.selectedItem ?? null)}
              />
            </div>
            <p>No problems found (read-only stub).</p>
          </TabPanel>
          <TabPanel>
            <p>Variables inspector (read-only stub).</p>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  )
}
