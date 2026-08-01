import { test, expect, type Page } from '@playwright/test'
import { getE2ECredentials, getE2EEngineId, hasE2ECredentials } from './utils/credentials'
import { getMockExecutionPatternFixture } from './utils/mockCamundaFixture'

const shouldSkip = !hasE2ECredentials()
const requireMock = process.env.E2E_REQUIRE_MISSION_CONTROL_MOCK === 'true'

async function login(page: Page) {
  const { email, password } = getE2ECredentials()
  if (!email || !password) throw new Error('Missing E2E credentials')

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible()
}

async function setSelectedEngine(page: Page) {
  const engineId = getE2EEngineId()
  if (!engineId) throw new Error('Missing E2E engine ID')
  await page.evaluate((selectedEngineId) => {
    window.localStorage.setItem('engine-selector', JSON.stringify({ state: { selectedEngineId }, version: 0 }))
    window.localStorage.setItem('mission-control-show-instance-counts', '1')
  }, engineId)
}

async function assertExecutionPattern(page: Page, options: {
  instanceId: string
  expectedMarkerTitle: RegExp
  expandGroupLabel?: string
  expandNestedLabel?: string
  expectIncident?: boolean
}) {
  await page.goto(`/mission-control/processes/instances/${options.instanceId}`)

  await expect(page.getByRole('heading', { name: 'Execution Trail' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/Failed to load|Error loading XML|No diagram XML/i)
  if (options.expectIncident) {
    await expect(page.getByRole('button', { name: /view incidents/i })).toBeVisible()
  }
  if (options.expandGroupLabel) {
    await page.getByRole('button', { name: options.expandGroupLabel }).click()
  }
  if (options.expandNestedLabel) {
    await page.getByRole('button', { name: options.expandNestedLabel }).click()
  }
  await expect(page.getByTitle(options.expectedMarkerTitle)).toBeVisible()
}

test.describe('Mission Control execution patterns via mock engine', () => {
  test.skip(shouldSkip, 'E2E_USER/E2E_PASSWORD not set')
  test.skip(!requireMock, 'Requires Mission Control mock data')

  test('renders sequential, parallel, and loop execution markers from mock data @mission-control', async ({ page }) => {
    const fixture = await getMockExecutionPatternFixture()
    await login(page)
    await setSelectedEngine(page)

    await assertExecutionPattern(page, {
      instanceId: fixture.sequentialInstanceId,
      expectedMarkerTitle: /Sequential multi-instance/i,
    })

    await assertExecutionPattern(page, {
      instanceId: fixture.parallelInstanceId,
      expectedMarkerTitle: /Parallel multi-instance/i,
      expandGroupLabel: 'Expand Parallel Approval',
      expandNestedLabel: 'Expand nested trail for Parallel Approval',
      expectIncident: true,
    })

    await assertExecutionPattern(page, {
      instanceId: fixture.loopInstanceId,
      expectedMarkerTitle: /^Loop$/i,
    })
  })
})
