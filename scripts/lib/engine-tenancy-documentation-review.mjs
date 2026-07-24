import path from 'node:path';

export const DOCUMENTATION_REVIEW_ROLES = [
  'engineering',
  'security',
  'independentOperator',
];

export const DOCUMENTATION_REVIEW_MODES = [
  'human',
  'delegated-agent',
];

const SAFE_EVIDENCE_PREFIX = 'test/results/engine-tenancy-review/';
const SANITIZATION_FIELDS = [
  'containsCredentials',
  'containsTokens',
  'containsPrivateEndpoints',
  'containsRawIdentityClaims',
  'containsCustomerIdentifiers',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeDocumentationReviewRole(value) {
  if (value === 'independent-operator') return 'independentOperator';
  if (DOCUMENTATION_REVIEW_ROLES.includes(value)) return value;
  throw new Error(
    `Unknown review role "${value}". Expected engineering, security, or independent-operator.`,
  );
}

export function normalizeDocumentationReviewMode(value) {
  if (DOCUMENTATION_REVIEW_MODES.includes(value)) return value;
  throw new Error(
    `Unknown review mode "${value}". Expected human or delegated-agent.`,
  );
}

export function isSafeDocumentationReviewEvidencePath(value) {
  if (!isNonEmptyString(value) || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  return normalized.startsWith(SAFE_EVIDENCE_PREFIX)
    && !normalized.includes('/../')
    && normalized !== SAFE_EVIDENCE_PREFIX;
}

export function pendingDocumentationReview() {
  return {
    status: 'pending',
    approvedCommit: null,
    reviewer: null,
    reviewMode: null,
    reviewedAt: null,
    evidenceLocation: null,
  };
}

export function documentationReviewApprovalPasses(
  review,
  commit,
  evidenceExists = () => true,
) {
  if (
    review?.status !== 'approved'
    || review.approvedCommit !== commit
    || !isNonEmptyString(review.reviewer)
    || !DOCUMENTATION_REVIEW_MODES.includes(review.reviewMode)
    || !isNonEmptyString(review.reviewedAt)
    || Number.isNaN(Date.parse(review.reviewedAt))
    || !isSafeDocumentationReviewEvidencePath(review.evidenceLocation)
  ) {
    return false;
  }
  return evidenceExists(review.evidenceLocation);
}

export function preserveDocumentationReviews(
  existingEvidence,
  commit,
  evidenceExists = () => true,
) {
  return Object.fromEntries(
    DOCUMENTATION_REVIEW_ROLES.map((role) => {
      const review = existingEvidence?.commit === commit
        ? existingEvidence.reviews?.[role]
        : null;
      return [
        role,
        documentationReviewApprovalPasses(review, commit, evidenceExists)
          ? { ...review }
          : pendingDocumentationReview(),
      ];
    }),
  );
}

export function documentationReviewEvidencePasses(
  evidence,
  commit,
  evidenceExists = () => true,
) {
  return documentationReviewAutomationPasses(evidence, commit)
    && DOCUMENTATION_REVIEW_ROLES.every((role) =>
      documentationReviewApprovalPasses(
        evidence.reviews?.[role],
        commit,
        evidenceExists,
      ));
}

export function documentationReviewAutomationPasses(evidence, commit) {
  return evidence?.commit === commit
    && evidence.sourceState === 'clean'
    && evidence.automatedChecksPassed === true
    && evidence.unresolvedHighRiskFindings === 0
    && Number(evidence.executableExamples?.total) > 0
    && evidence.executableExamples.passed === evidence.executableExamples.total
    && Number(evidence.markdownLinks?.total) > 0
    && evidence.markdownLinks.passed === evidence.markdownLinks.total
    && SANITIZATION_FIELDS.every((field) => evidence.sanitization?.[field] === false);
}

export function documentationReviewEvidencePending(
  evidence,
  commit,
  evidenceExists = () => true,
) {
  if (!documentationReviewAutomationPasses(evidence, commit)) return false;
  const reviews = DOCUMENTATION_REVIEW_ROLES.map((role) => evidence.reviews?.[role]);
  return reviews.some((review) => review?.status === 'pending')
    && reviews.every((review) => review?.status === 'pending'
      || documentationReviewApprovalPasses(review, commit, evidenceExists));
}

export function finalizeDocumentationReviewEvidence(
  evidence,
  evidenceExists = () => true,
) {
  const passed = documentationReviewEvidencePasses(
    evidence,
    evidence.commit,
    evidenceExists,
  );
  return {
    ...evidence,
    status: passed ? 'passed' : 'incomplete',
    releaseCommitQualified: passed,
  };
}
