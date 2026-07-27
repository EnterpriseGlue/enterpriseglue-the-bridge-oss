import type {
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';

const ORACLE_CLAIM_CANDIDATE_MULTIPLIER = 4;
const ORACLE_CLAIM_CANDIDATE_MAXIMUM = 400;

/**
 * TypeORM appends a one-row FETCH/LIMIT clause for Repository.findOne. Oracle
 * rejects that query shape when it is followed by FOR UPDATE. Plugin lock
 * lookups are always primary/unique predicates, so fetch without a row limit
 * and fail closed if the schema invariant is violated.
 */
export async function findPluginRowForUpdateV1<T extends ObjectLiteral>(
  repository: Repository<T>,
  where: FindOptionsWhere<T>,
): Promise<T | null> {
  const query = repository
    .createQueryBuilder('plugin_locked_row')
    .setFindOptions({ where });
  // A read in Spanner's serializable read-write transaction already acquires
  // the lock needed to protect a dependent write. TypeORM does not recognize
  // Spanner in SelectQueryBuilder.setLock(), so adding the SQL lock expression
  // would fail before the query reaches the database.
  const rows =
    repository.manager.connection.options.type === 'spanner'
      ? await query.getMany()
      : await query.setLock('pessimistic_write').getMany();
  if (rows.length > 1) {
    throw new Error('plugin_unique_lock_invariant_violated');
  }
  return rows[0] ?? null;
}

/**
 * Oracle rejects TypeORM's FETCH/OFFSET pagination when it is combined with
 * FOR UPDATE. Claimers therefore read a bounded ordered candidate window
 * without locks, then call this helper inside the same transaction. Small ID
 * chunks are locked with SKIP LOCKED and eligibility is checked again while
 * the lock is held. At most `limit` eligible rows are returned.
 */
export async function lockOraclePluginClaimCandidatesV1<
  T extends ObjectLiteral & { id: string },
>(
  repository: Repository<T>,
  candidates: readonly T[],
  limit: number,
  isEligible: (record: T) => boolean,
): Promise<T[]> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > ORACLE_CLAIM_CANDIDATE_MAXIMUM
  ) {
    throw new Error('plugin_oracle_claim_limit_invalid');
  }
  const claimed: T[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  while (claimed.length < limit && cursor < candidates.length) {
    const remaining = limit - claimed.length;
    const chunk: T[] = [];
    while (chunk.length < remaining && cursor < candidates.length) {
      const candidate = candidates[cursor];
      cursor += 1;
      if (!candidate || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      chunk.push(candidate);
    }
    if (chunk.length === 0) continue;
    const lockedRows = await repository
      .createQueryBuilder('plugin_claim_row')
      .where('plugin_claim_row.id IN (:...plugin_claim_ids)', {
        plugin_claim_ids: chunk.map((candidate) => candidate.id),
      })
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
    const lockedById = new Map(
      lockedRows.map((record) => [record.id, record]),
    );
    for (const candidate of chunk) {
      const record = lockedById.get(candidate.id);
      if (!record || !isEligible(record)) continue;
      claimed.push(record);
      if (claimed.length === limit) break;
    }
  }
  return claimed;
}

export function oraclePluginClaimCandidateWindowV1(limit: number): number {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > ORACLE_CLAIM_CANDIDATE_MAXIMUM
  ) {
    throw new Error('plugin_oracle_claim_limit_invalid');
  }
  return Math.min(
    limit * ORACLE_CLAIM_CANDIDATE_MULTIPLIER,
    ORACLE_CLAIM_CANDIDATE_MAXIMUM,
  );
}
