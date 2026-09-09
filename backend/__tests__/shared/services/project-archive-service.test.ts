import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { parseProjectArchive } from '@enterpriseglue/shared/services/starbase/project-archive-service.js'

function buildArchive(options?: {
  manifestPath?: 'starbase-manifest.json' | '.starbase/manifest.json'
  manifestContent?: string | null
  files?: Array<{ path: string; xml: string }>
}): Buffer {
  const zip: Record<string, Uint8Array> = {}

  if (options?.manifestContent !== null) {
    zip[options?.manifestPath || 'starbase-manifest.json'] = Buffer.from(
        options?.manifestContent || JSON.stringify({
          schemaVersion: 1,
          projectName: 'Imported project',
          exportedAt: 123,
          folders: [
            { folderId: 'folder-1', path: 'nested' },
          ],
          files: [
            {
              fileId: 'file-1',
              path: 'nested/child.bpmn',
              type: 'bpmn',
              name: 'child.bpmn',
              bpmnProcessId: 'Process_1',
              dmnDecisionId: null,
            },
          ],
        })
    )
  }

  for (const file of options?.files || [{ path: 'nested/child.bpmn', xml: '<definitions><process id="Process_1" /></definitions>' }]) {
    zip[file.path] = Buffer.from(file.xml)
  }

  return Buffer.from(zipSync(zip))
}

describe('project archive service', () => {
  it('parses the visible root manifest file', () => {
    const parsed = parseProjectArchive(buildArchive())

    expect(parsed.warnings).toEqual([])
    expect(parsed.manifest?.projectName).toBe('Imported project')
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]).toMatchObject({
      manifestFileId: 'file-1',
      path: 'nested/child.bpmn',
      type: 'bpmn',
      name: 'child.bpmn',
    })
  })

  it('still parses the legacy hidden manifest path', () => {
    const parsed = parseProjectArchive(buildArchive({ manifestPath: '.starbase/manifest.json' }))

    expect(parsed.warnings).toEqual([])
    expect(parsed.manifest?.files[0]?.fileId).toBe('file-1')
    expect(parsed.files[0]?.manifestFileId).toBe('file-1')
  })

  it('ignores invalid manifest shape with a validation warning', () => {
    const parsed = parseProjectArchive(buildArchive({
      manifestContent: JSON.stringify({ schemaVersion: 2, projectName: 'Bad manifest', files: [] }),
    }))

    expect(parsed.manifest).toBeNull()
    expect(parsed.warnings).toContain('Project archive manifest is invalid and was ignored.')
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]?.manifestFileId).toBeNull()
  })

  it('rejects archives without BPMN or DMN files', () => {
    const zip = Buffer.from(zipSync({ 'starbase-manifest.json': Buffer.from(JSON.stringify({ schemaVersion: 1, projectName: 'Only manifest', exportedAt: 1, folders: [], files: [] })) }))

    expect(() => parseProjectArchive(zip)).toThrowError('ZIP archive does not contain any BPMN or DMN files')
  })
})
