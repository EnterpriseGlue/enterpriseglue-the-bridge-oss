import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MoreThan } from 'typeorm';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockFindOne = vi.fn();
const mockFind = vi.fn();
const mockFindOneBy = vi.fn();
const mockFindOneByOrFail = vi.fn();
const mockDelete = vi.fn();

const mockLockRepo = {
  insert: mockInsert,
  update: mockUpdate,
  findOne: mockFindOne,
  find: mockFind,
  findOneBy: mockFindOneBy,
  findOneByOrFail: mockFindOneByOrFail,
  delete: mockDelete,
};

const mockGetRepository = vi.fn().mockReturnValue(mockLockRepo);

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn().mockResolvedValue({
    getRepository: (...args: unknown[]) => mockGetRepository(...args),
  }),
}));

vi.mock('@enterpriseglue/shared/utils/id.js', () => ({
  generateId: vi.fn().mockReturnValue('generated-lock-id'),
}));

vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Must import AFTER mocks are set up
import { LockManager, type FileLock } from '@enterpriseglue/shared/services/git/LockManager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildLockRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    id: 'existing-lock-id',
    fileId: 'file-1',
    userId: 'user-a',
    acquiredAt: now - 5000,
    lastInteractionAt: now - 1000,
    expiresAt: now + 40_000,
    heartbeatAt: now - 1000,
    visibilityState: 'visible',
    visibilityChangedAt: now - 5000,
    released: false,
    releasedAt: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LockManager', () => {
  let lockManager: LockManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    lockManager = new LockManager();
  });

  describe('acquireLock', () => {
    it('creates a new lock when no active lock exists', async () => {
      mockFindOne.mockResolvedValue(null); // getActiveLock → no lock
      mockInsert.mockResolvedValue(undefined);
      // TOCTOU check: only our lock exists
      mockFind.mockResolvedValue([buildLockRow({ id: 'generated-lock-id', userId: 'user-a' })]);

      const result = await lockManager.acquireLock('file-1', 'user-a');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('generated-lock-id');
      expect(result!.fileId).toBe('file-1');
      expect(result!.userId).toBe('user-a');
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it('returns null when another user holds an active lock (non-force)', async () => {
      mockFindOne.mockResolvedValue(buildLockRow({ userId: 'user-b' }));

      const result = await lockManager.acquireLock('file-1', 'user-a', { force: false });

      expect(result).toBeNull();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('extends the lock when the same user already holds it', async () => {
      const existingRow = buildLockRow({ userId: 'user-a' });
      mockFindOne.mockResolvedValue(existingRow); // getActiveLock → same user
      mockFindOneByOrFail.mockResolvedValue(existingRow);
      mockUpdate.mockResolvedValue(undefined);
      // After update, findOneByOrFail returns updated row
      mockFindOneByOrFail.mockResolvedValue({
        ...existingRow,
        expiresAt: Date.now() + 45_000,
        heartbeatAt: Date.now(),
      });

      const result = await lockManager.acquireLock('file-1', 'user-a');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-a');
      // Should call update (extend), not insert (new lock)
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('force-takes a lock held by another user', async () => {
      const otherLock = buildLockRow({ userId: 'user-b' });
      // First findOne (getActiveLock) → other user's lock
      // releaseLock calls update
      // Second findOne → null (lock released, creating new)
      mockFindOne.mockResolvedValueOnce(otherLock);
      mockUpdate.mockResolvedValue(undefined); // releaseLock
      mockInsert.mockResolvedValue(undefined);
      // TOCTOU: only our new lock
      mockFind.mockResolvedValue([buildLockRow({ id: 'generated-lock-id', userId: 'user-a' })]);

      const result = await lockManager.acquireLock('file-1', 'user-a', { force: true });

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-a');
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it('TOCTOU race: loses race when a rival lock was inserted first', async () => {
      mockFindOne.mockResolvedValue(null); // getActiveLock → no lock
      mockInsert.mockResolvedValue(undefined);
      // TOCTOU check: rival lock has earlier acquiredAt (inserted first)
      const rivalLock = buildLockRow({ id: 'rival-lock-id', userId: 'user-b', acquiredAt: Date.now() - 1 });
      const ourLock = buildLockRow({ id: 'generated-lock-id', userId: 'user-a', acquiredAt: Date.now() });
      mockFind.mockResolvedValue([rivalLock, ourLock]); // rival sorts first
      mockUpdate.mockResolvedValue(undefined); // self-release

      const result = await lockManager.acquireLock('file-1', 'user-a');

      expect(result).toBeNull();
      // Should have released our own lock
      expect(mockUpdate).toHaveBeenCalledWith(
        { id: 'generated-lock-id' },
        expect.objectContaining({ released: true }),
      );
    });

    it('TOCTOU race: wins race when our lock was inserted first', async () => {
      mockFindOne.mockResolvedValue(null);
      mockInsert.mockResolvedValue(undefined);
      // Our lock has earlier acquiredAt — we win
      const ourLock = buildLockRow({ id: 'generated-lock-id', userId: 'user-a', acquiredAt: Date.now() - 1 });
      const rivalLock = buildLockRow({ id: 'rival-lock-id', userId: 'user-b', acquiredAt: Date.now() });
      mockFind.mockResolvedValue([ourLock, rivalLock]); // our lock sorts first

      const result = await lockManager.acquireLock('file-1', 'user-a');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('generated-lock-id');
      // Should NOT release our lock
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('getActiveLock', () => {
    it('returns null when no unreleased, non-expired lock exists', async () => {
      mockFindOne.mockResolvedValue(null);

      const result = await lockManager.getActiveLock('file-1');

      expect(result).toBeNull();
      expect(mockFindOne).toHaveBeenCalledWith({
        where: {
          fileId: 'file-1',
          released: false,
          expiresAt: MoreThan(expect.any(Number)),
        },
      });
    });

    it('returns the lock when an active lock exists', async () => {
      const row = buildLockRow();
      mockFindOne.mockResolvedValue(row);

      const result = await lockManager.getActiveLock('file-1');

      expect(result).not.toBeNull();
      expect(result!.fileId).toBe('file-1');
    });
  });

  describe('releaseLock', () => {
    it('marks the lock as released', async () => {
      mockUpdate.mockResolvedValue(undefined);

      await lockManager.releaseLock('lock-1');

      expect(mockUpdate).toHaveBeenCalledWith(
        { id: 'lock-1' },
        expect.objectContaining({ released: true }),
      );
    });
  });

  describe('touchLock', () => {
    it('updates heartbeat and extends expiration', async () => {
      const row = buildLockRow();
      mockFindOneBy.mockResolvedValue(row);
      mockUpdate.mockResolvedValue(undefined);

      const result = await lockManager.touchLock('existing-lock-id');

      expect(mockUpdate).toHaveBeenCalledWith(
        { id: 'existing-lock-id', released: false },
        expect.objectContaining({
          heartbeatAt: expect.any(Number),
          expiresAt: expect.any(Number),
        }),
      );
    });
  });
});

