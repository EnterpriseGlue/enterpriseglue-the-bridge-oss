import assert from 'node:assert/strict';
import test from 'node:test';
import {
  documentationReviewApprovalPasses,
  documentationReviewAutomationPasses,
  documentationReviewEvidencePending,
  documentationReviewEvidencePasses,
  finalizeDocumentationReviewEvidence,
  isSafeDocumentationReviewEvidencePath,
  normalizeDocumentationReviewRole,
  pendingDocumentationReview,
  preserveDocumentationReviews,
} from './lib/engine-tenancy-documentation-review.mjs';

const commit = 'a'.repeat(40);
const evidencePath = 'test/results/engine-tenancy-review/engineering.md';
const approved = {
  status: 'approved',
  approvedCommit: commit,
  reviewer: 'Engineering Reviewer',
  reviewedAt: '2026-07-24T01:00:00.000Z',
  evidenceLocation: evidencePath,
};
const evidenceExists = (value) => value === evidencePath;

function completeEvidence() {
  return {
    commit,
    sourceState: 'clean',
    automatedChecksPassed: true,
    unresolvedHighRiskFindings: 0,
    executableExamples: { total: 5, passed: 5 },
    markdownLinks: { total: 119, passed: 119 },
    reviews: {
      engineering: { ...approved },
      security: { ...approved },
      independentOperator: { ...approved },
    },
    sanitization: {
      containsCredentials: false,
      containsTokens: false,
      containsPrivateEndpoints: false,
      containsRawIdentityClaims: false,
      containsCustomerIdentifiers: false,
    },
  };
}

test('normalizes only the three independent documentation review roles', () => {
  assert.equal(normalizeDocumentationReviewRole('engineering'), 'engineering');
  assert.equal(normalizeDocumentationReviewRole('security'), 'security');
  assert.equal(
    normalizeDocumentationReviewRole('independent-operator'),
    'independentOperator',
  );
  assert.throws(() => normalizeDocumentationReviewRole('implementer'));
});

test('accepts only repository-local sanitized review evidence paths', () => {
  assert.equal(isSafeDocumentationReviewEvidencePath(evidencePath), true);
  assert.equal(isSafeDocumentationReviewEvidencePath('/tmp/review.md'), false);
  assert.equal(isSafeDocumentationReviewEvidencePath('../review.md'), false);
  assert.equal(isSafeDocumentationReviewEvidencePath('https://private/review'), false);
  assert.equal(isSafeDocumentationReviewEvidencePath('docs/review.md'), false);
});

test('requires reviewer identity, exact commit, date, and retained evidence', () => {
  assert.equal(
    documentationReviewApprovalPasses(approved, commit, evidenceExists),
    true,
  );
  assert.equal(
    documentationReviewApprovalPasses(
      { ...approved, approvedCommit: 'b'.repeat(40) },
      commit,
      evidenceExists,
    ),
    false,
  );
  assert.equal(
    documentationReviewApprovalPasses(
      { ...approved, reviewer: '' },
      commit,
      evidenceExists,
    ),
    false,
  );
  assert.equal(
    documentationReviewApprovalPasses(approved, commit, () => false),
    false,
  );
});

test('preserves valid same-commit approvals and drops stale or incomplete ones', () => {
  const preserved = preserveDocumentationReviews({
    commit,
    reviews: {
      engineering: approved,
      security: { ...approved, approvedCommit: 'stale' },
      independentOperator: pendingDocumentationReview(),
    },
  }, commit, evidenceExists);
  assert.deepEqual(preserved.engineering, approved);
  assert.deepEqual(preserved.security, pendingDocumentationReview());
  assert.deepEqual(preserved.independentOperator, pendingDocumentationReview());

  const changedCommit = preserveDocumentationReviews(
    { commit: 'different', reviews: { engineering: approved } },
    commit,
    evidenceExists,
  );
  assert.deepEqual(changedCommit.engineering, pendingDocumentationReview());
});

test('qualifies documentation only after all automated and human evidence passes', () => {
  const evidence = completeEvidence();
  assert.equal(documentationReviewAutomationPasses(evidence, commit), true);
  assert.equal(
    documentationReviewEvidencePasses(evidence, commit, evidenceExists),
    true,
  );
  assert.deepEqual(
    finalizeDocumentationReviewEvidence(evidence, evidenceExists),
    { ...evidence, status: 'passed', releaseCommitQualified: true },
  );

  const missingSecurity = completeEvidence();
  missingSecurity.reviews.security = pendingDocumentationReview();
  assert.equal(
    documentationReviewEvidencePending(missingSecurity, commit, evidenceExists),
    true,
  );
  assert.equal(
    documentationReviewEvidencePasses(missingSecurity, commit, evidenceExists),
    false,
  );
  assert.equal(
    finalizeDocumentationReviewEvidence(missingSecurity, evidenceExists).status,
    'incomplete',
  );

  const unsafe = completeEvidence();
  unsafe.sanitization.containsTokens = true;
  assert.equal(
    documentationReviewEvidencePending(unsafe, commit, evidenceExists),
    false,
  );
  assert.equal(
    documentationReviewEvidencePasses(unsafe, commit, evidenceExists),
    false,
  );
});
