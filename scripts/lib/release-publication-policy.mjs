const semanticVersion = /^\d+\.\d+\.\d+$/
const commitSha = /^[0-9a-f]{40}$/
export const detailedNotesMarker = '<!-- enterpriseglue-detailed-release-notes -->'

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function compareVersions(left, right) {
  requireValue(semanticVersion.test(left) && semanticVersion.test(right), 'Release versions must be semantic versions.')
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index])
  }
  return 0
}

export function resolveReleasePublication({ eventName, ref, sha, commitMessage, manifestVersion, latestTag, inputs = {} }) {
  requireValue(ref === 'refs/heads/main', 'Release preparation and publication must run from protected main.')
  requireValue(commitSha.test(sha), 'Release workflow source must be an exact commit SHA.')
  requireValue(/^v\d+\.\d+\.\d+$/.test(latestTag), 'A stable release baseline is required.')
  const comparison = compareVersions(manifestVersion, latestTag.slice(1))
  requireValue(comparison >= 0, 'Release manifest is behind the latest stable tag.')
  const requested = inputs.publish_release
  requireValue([undefined, '', false, true, 'false', 'true'].includes(requested), 'publish_release must be a boolean.')
  const publish = requested === true || requested === 'true'
  const releaseVersion = String(commitMessage).match(/^chore\(main\)!?: release (\d+\.\d+\.\d+)\s*$/m)?.[1]
  if (!publish) {
    requireValue(!inputs.source_ref && !inputs.release_tag && !inputs.release_pr && !inputs.required_prs,
      'Publication identity requires publish_release=true on an explicitly authorized dispatch.')
    const mode = comparison > 0 ? 'await-publication' : releaseVersion ? 'published' : 'prepare'
    return { mode, shouldPrepare: mode === 'prepare', shouldPublish: false, releaseTag: `v${manifestVersion}` }
  }

  requireValue(eventName === 'workflow_dispatch', 'Automatic events cannot authorize release publication.')
  requireValue(commitSha.test(inputs.source_ref ?? '') && inputs.source_ref === sha,
    'Approved source_ref must equal the exact protected-main workflow commit; refresh approval after source drift.')
  requireValue(inputs.release_tag === `v${manifestVersion}` && releaseVersion === manifestVersion,
    'Approved tag, release merge commit, and version manifest must agree.')
  const releasePR = Number(inputs.release_pr)
  requireValue(Number.isSafeInteger(releasePR) && releasePR > 0, 'An approved Release Please PR number is required.')
  let requiredPRs
  try { requiredPRs = JSON.parse(inputs.required_prs ?? '') } catch { throw new Error('required_prs must be a JSON array of code PR numbers.') }
  requireValue(Array.isArray(requiredPRs) && requiredPRs.length > 0 && requiredPRs.every(number => Number.isSafeInteger(number) && number > 0),
    'A non-empty approved code-PR batch is required.')
  requireValue(new Set(requiredPRs).size === requiredPRs.length && !requiredPRs.includes(releasePR),
    'Approved code PR numbers must be unique and exclude the release PR.')
  return { mode: 'publish', shouldPrepare: false, shouldPublish: true, sourceRef: sha,
    releaseTag: inputs.release_tag, releasePR, requiredPRs }
}

export function validateReleasePublicationApproval({ approval, repository, releasePR, codePRs, includedPRs, releaseDocument, managedComments }) {
  requireValue(approval.shouldPublish === true, 'Only an explicit publication dispatch can validate approval.')
  requireValue(releasePR.number === approval.releasePR && releasePR.merged === true && releasePR.state === 'closed',
    'The approved Release Please PR must be merged.')
  requireValue(releasePR.merge_commit_sha === approval.sourceRef, 'Release PR merge identity differs from the approved source.')
  requireValue(releasePR.base?.repo?.full_name === repository && releasePR.base?.ref === 'main' &&
    releasePR.head?.repo?.full_name === repository && releasePR.head?.ref?.startsWith('release-please--branches--'),
  'The release PR must be a repository-owned Release Please PR against main.')
  requireValue(String(releasePR.title).match(/release (\d+\.\d+\.\d+)\b/i)?.[1] === approval.releaseTag.slice(1),
    'Release PR title differs from the approved version.')
  requireValue(releaseDocument.includes(`# EnterpriseGlue ${approval.releaseTag} Release Notes`) &&
    releaseDocument.startsWith('---\ndoc_class: technical\n'), 'The versioned technical release document is missing or has the wrong identity.')
  const comments = managedComments.filter(body => typeof body === 'string' && body.startsWith(detailedNotesMarker))
  requireValue(comments.length === 1 && comments[0].slice(detailedNotesMarker.length).trim() === releaseDocument.trim(),
    'The managed release PR comment must match the complete generated document exactly.')
  const byNumber = new Map(codePRs.map(pr => [pr.number, pr]))
  for (const number of approval.requiredPRs) {
    const pr = byNumber.get(number)
    requireValue(pr?.merged === true && pr.state === 'closed' && pr.base?.repo?.full_name === repository && pr.base?.ref === 'main',
      `Required code PR #${number} is not merged into this repository's main.`)
    requireValue(commitSha.test(pr.merge_commit_sha ?? '') && includedPRs.has(number),
      `Required code PR #${number} is absent from the approved source.`)
  }
  return approval
}
