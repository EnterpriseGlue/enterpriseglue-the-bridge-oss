export interface AuthorizationBehaviorSummary {
  rawTupleCount: number;
  compressedCellCount: number;
  applicableCellCount: number;
  invalidCompressedCellCount: number;
  expandedApplicableTupleCount: number;
  invalidExpandedTupleCount: number;
  equivalenceExpandedCellCount: number;
  behaviorCellHash: string;
  coverage: Record<string, Record<string, {
    classified?: number;
    supported?: number;
    invalid?: number;
    covered?: number;
    total?: number;
  }>>;
  outcomes: {
    allow: number;
    deny: number;
  };
  applicabilityRuleCounts: Record<string, number>;
  executionFamilyCounts: Record<string, number>;
}

export function independentAuthorizationExpectation(
  cell: Record<string, string>,
  contract: unknown,
): {
  decision: 'allow' | 'deny';
  filteredResult: 'included' | 'excluded';
  effectiveAccess: 'source_present' | 'no_active_source';
  audit: 'decision_observed';
  upstreamTransport: 'eligible' | 'blocked_before_transport';
};

export function generateAuthorizationBehaviorSummary(
  contract: unknown,
  options: { actionCount: number },
): AuthorizationBehaviorSummary;
