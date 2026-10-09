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

export function resolveReleasePublication({ eventName, ref, sha, sourceSha = sha, commitMessage, manifestVersion, latestTag, inputs = {} }) {
  requireValue(ref === 'refs/heads/main', 'Release preparation and publication must run from protected main.')
  requireValue(commitSha.test(sha), 'Release workflow source must be an exact commit SHA.')
  requireValue(/^v\d+\.\d+\.\d+$/.test(latestTag), 'A stable release baseline is required.')
  const comparison = compareVersions(manifestVersion, latestTag.slice(1))
  requireValue(comparison >= 0, 'Release manifest is behind the latest stable tag.')
  const requested = inputs.publish_release
  requireValue([undefined, '', false, true, 'false', 'true'].includes(requested), 'publish_release must be a boolean.')
  const publish = requested === true || requested === 'true'
  const replacing = inputs.prepare_replacement === true || inputs.prepare_replacement === 'true'
  requireValue([undefined, '', false, true, 'false', 'true'].includes(inputs.prepare_replacement), 'prepare_replacement must be a boolean.')
  requireValue(!(publish && replacing), 'Replacement preparation and publication are separate operations.')
  const releaseVersion = String(commitMessage).match(/^chore\(main\)!?: release (\d+\.\d+\.\d+)\s*$/m)?.[1]
  if (replacing) {
    requireValue(eventName === 'workflow_dispatch', 'Only an explicit dispatch may prepare a replacement candidate.')
    requireValue(comparison > 0, 'Replacement requires a reserved version that has not been published.')
    requireValue(inputs.source_ref === sha && sourceSha === sha && inputs.release_tag === `v${manifestVersion}`,
      'Replacement preparation must bind the current protected source and reserved version.')
    requireValue(!inputs.recovery_prs, 'Replacement content cannot use a publication-only repair list.')
    const releasePR = Number(inputs.release_pr)
    requireValue(Number.isSafeInteger(releasePR) && releasePR > 0, 'The unpublished release PR to supersede is required.')
    return {mode:'prepare-replacement',shouldPrepare:true,shouldPublish:false,sourceRef:sha,controlRef:sha,
      releaseTag:inputs.release_tag,releasePR,prepareReplacement:true}
  }
  if (!publish) {
    requireValue(!inputs.source_ref && !inputs.release_tag && !inputs.release_pr && !inputs.required_prs && !inputs.recovery_prs,
      'Publication identity requires publish_release=true on an explicitly authorized dispatch.')
    const mode = comparison > 0 ? 'await-publication' : releaseVersion ? 'published' : 'prepare'
    return { mode, shouldPrepare: mode === 'prepare', shouldPublish: false, releaseTag: `v${manifestVersion}` }
  }

  requireValue(eventName === 'workflow_dispatch', 'Automatic events cannot authorize release publication.')
  requireValue(commitSha.test(inputs.source_ref ?? '') && inputs.source_ref === sourceSha,
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
  let recoveryPRs
  try { recoveryPRs = JSON.parse(inputs.recovery_prs || '[]') } catch { throw new Error('recovery_prs must be a JSON array of repair PR numbers.') }
  requireValue(Array.isArray(recoveryPRs) && recoveryPRs.every(number => Number.isSafeInteger(number) && number > 0),
    'Recovery PR numbers must be positive integers.')
  requireValue(new Set(recoveryPRs).size === recoveryPRs.length && recoveryPRs.every(number => !requiredPRs.includes(number) && number !== releasePR),
    'Recovery PRs must be unique and separate from the frozen release batch.')
  requireValue(sourceSha === sha ? recoveryPRs.length === 0 : recoveryPRs.length > 0,
    'A different workflow revision requires an explicit recovery_prs list; unchanged sources cannot accept repair PRs.')
  return { mode: 'publish', shouldPrepare: false, shouldPublish: true, sourceRef: sourceSha, controlRef: sha,
    releaseTag: inputs.release_tag, releasePR, requiredPRs, recoveryPRs }
}

// Deliberately excludes application sources, manifests, lockfiles, Dockerfiles,
// charts, migration/schema data and scanner policies. Unknown paths fail closed.
export function isPublicationRepairPath(path) {
  const allowed = [
    /^scripts\/(?:lib\/)?release-publication-[a-z0-9.-]+\.(?:mjs|sh|json)$/,
    /^scripts\/ci-change-classifier(?:\.test)?\.mjs$/,
    /^scripts\/release-(?:notes(?:\.test)?|canary-workflow\.test|candidate-workflow\.test|batch-integration\.test)\.mjs$/,
    /^scripts\/prepare-release-notes-pr\.sh$/,
    /^\.github\/workflows\/(?:release-please|release-publication-reconcile|release-canary|release-candidate-stage|docker-images|plugin-package-release|host-package-release|host-chart-release|plugin-toolchain-release)\.yml$/,
    /^plugins\/enterpriseglue-dev-workflows\/[^\0]+$/,
    /^docs\/(?:development\/(?:release-notes-process|codex-workflow-plugin)|runbooks\/release-artifact-promotion)\.md$/,
    /^\.release-notes\/resumable-release-publication\.json$/,
  ]
  return allowed.some(pattern => pattern.test(path))
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
