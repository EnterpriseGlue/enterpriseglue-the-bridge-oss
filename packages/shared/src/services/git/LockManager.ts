import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitLock } from '@enterpriseglue/shared/db/entities/GitLock.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { MoreThan, LessThan, In } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

export type LockVisibilityState = 'visible' | 'hidden';
export type LockSessionStatus = 'active' | 'idle' | 'hidden';

export interface AcquireLockOptions {
  force?: boolean;
  visibilityState?: LockVisibilityState;
  hasInteraction?: boolean;
}

export interface TouchLockOptions {
  visibilityState?: LockVisibilityState;
  hasInteraction?: boolean;
}

export interface FileLock {
  id: string;
  fileId: string;
  userId: string;
  acquiredAt: number;
  lastInteractionAt: number;
  expiresAt: number;
  heartbeatAt: number;
  visibilityState: LockVisibilityState;
  visibilityChangedAt: number;
  sessionStatus: LockSessionStatus;
}

export interface FileLockWithUser extends FileLock {
  userName: string;
}

export interface LockHolder {
  userId: string;
  name: string;
  acquiredAt: number;
  heartbeatAt: number;
  lastInteractionAt: number;
  visibilityState: LockVisibilityState;
  visibilityChangedAt: number;
  sessionStatus: LockSessionStatus;
}

export class LockManager {
  private lockTimeout: number; // milliseconds
  private idleTimeout: number; // milliseconds
  private hiddenTakeoverDelay: number; // milliseconds

  constructor() {
    this.lockTimeout = parseInt(process.env.LOCK_TIMEOUT_MS || '45000');
    this.idleTimeout = parseInt(process.env.LOCK_IDLE_TIMEOUT_MS || '120000');
    this.hiddenTakeoverDelay = parseInt(process.env.LOCK_HIDDEN_TAKEOVER_MS || '30000');

    // Clean up expired locks periodically
    this.startExpirationCleanup();
  }

  /**
   * Acquire a lock on a file
   */
  async acquireLock(fileId: string, userId: string, options: AcquireLockOptions = {}): Promise<FileLock | null> {
    try {
      // Check for existing active lock
      const existingLock = await this.getActiveLock(fileId);

      if (existingLock) {
        // Lock exists and not expired
        if (existingLock.userId === userId) {
          // User already has the lock, extend it
          return await this.extendLock(existingLock.id, options);
        }
        if (options.force) {
          await this.releaseLock(existingLock.id);
        } else {
          logger.warn('File already locked by another user', { fileId, userId, holder: existingLock.userId });
          return null;
        }
      }

      // Create new lock
      const now = Date.now();
      const lockId = generateId();
      const visibilityState: LockVisibilityState = options.visibilityState === 'hidden' ? 'hidden' : 'visible';
      const lastInteractionAt = options.hasInteraction === false ? now : now;

      const lock: FileLock = {
        id: lockId,
        fileId,
        userId,
        acquiredAt: now,
        lastInteractionAt,
        expiresAt: now + this.lockTimeout,
        heartbeatAt: now,
        visibilityState,
        visibilityChangedAt: now,
        sessionStatus: 'active',
      };

      const dataSource = await getDataSource();
      const lockRepo = dataSource.getRepository(GitLock);
      await lockRepo.insert({
        id: lock.id,
        fileId: lock.fileId,
        userId: lock.userId,
        acquiredAt: lock.acquiredAt,
        lastInteractionAt: lock.lastInteractionAt,
        expiresAt: lock.expiresAt,
        heartbeatAt: lock.heartbeatAt,
        visibilityState: lock.visibilityState,
        visibilityChangedAt: lock.visibilityChangedAt,
        released: false,
        releasedAt: null,
      });

      // Guard against TOCTOU race: two concurrent acquires can both pass the
      // getActiveLock check above. After inserting, verify we are the only
      // active lock for this file. Earliest acquiredAt (then lowest id) wins.
      const rivals = await lockRepo.find({
        where: { fileId, released: false, expiresAt: MoreThan(Date.now()) },
        order: { acquiredAt: 'ASC', id: 'ASC' },
      });
      if (rivals.length > 1 && rivals[0].id !== lock.id) {
        // We lost the race — release our lock and report conflict
        await lockRepo.update({ id: lock.id }, { released: true, releasedAt: Date.now() });
        logger.warn('Lock race lost, released duplicate', { lockId, fileId, userId, winnerId: rivals[0].id });
        return null;
      }

      logger.info('Lock acquired', { lockId, fileId, userId });

      return lock;
    } catch (error) {
      logger.error('Failed to acquire lock', { fileId, userId, error });
      throw error;
    }
  }

  /**
   * Release a lock
   */
  async releaseLock(lockId: string): Promise<void> {
    try {
      // Mark lock as released
      const dataSource = await getDataSource();
      const lockRepo = dataSource.getRepository(GitLock);
      await lockRepo.update({ id: lockId }, { 
        released: true,
        releasedAt: Date.now(),
      });

      logger.info('Lock released', { lockId });
    } catch (error) {
      logger.error('Failed to release lock', { lockId, error });
      throw error;
    }
  }

  /**
   * Get active lock for a file
   */
  async getActiveLock(fileId: string): Promise<FileLock | null> {
    const now = Date.now();

    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    const lock = await lockRepo.findOne({
      where: {
        fileId,
        released: false,
        expiresAt: MoreThan(now),
      },
    });

    if (!lock) {
      return null;
    }

    return this.mapLock(lock);
  }

  /**
   * Get lock holder information with user name
   */
  async getLockHolder(fileId: string): Promise<LockHolder | null> {
    const lock = await this.getActiveLock(fileId);
    if (!lock) {
      return null;
    }

    // Fetch user name from users table
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: lock.userId },
      select: ['firstName', 'lastName', 'email'],
    });

    let name = `User ${lock.userId.substring(0, 8)}`;
    if (user) {
      if (user.firstName || user.lastName) {
        name = [user.firstName, user.lastName].filter(Boolean).join(' ');
      } else if (user.email) {
        name = user.email.split('@')[0];
      }
    }

    return {
      userId: lock.userId,
      name,
      acquiredAt: lock.acquiredAt,
      heartbeatAt: lock.heartbeatAt,
      lastInteractionAt: lock.lastInteractionAt,
      visibilityState: lock.visibilityState,
      visibilityChangedAt: lock.visibilityChangedAt,
      sessionStatus: lock.sessionStatus,
    };
  }

  /**
   * Get all active locks for a project with user names (batch optimized)
   */
  async getProjectLocks(projectId: string): Promise<FileLockWithUser[]> {
    const now = Date.now();
    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    const userRepo = dataSource.getRepository(User);

    // Query locks with join to files for project filtering
    const locks = await lockRepo.createQueryBuilder('l')
      .innerJoin(File, 'f', 'l.fileId = f.id')
      .where('l.released = :released', { released: false })
      .andWhere('l.expiresAt > :now', { now })
      .andWhere('f.projectId = :projectId', { projectId })
      .select(['l.id', 'l.fileId', 'l.userId', 'l.acquiredAt', 'l.lastInteractionAt', 'l.expiresAt', 'l.heartbeatAt', 'l.visibilityState', 'l.visibilityChangedAt'])
      .getMany();

    if (locks.length === 0) {
      return [];
    }

    // Batch fetch user names to avoid N+1
    const userIds = [...new Set(locks.map((l) => l.userId))];
    const userRows = await userRepo.find({
      where: { id: In(userIds) },
      select: ['id', 'firstName', 'lastName', 'email'],
    });

    const userNameMap = new Map<string, string>();
    for (const u of userRows) {
      let name = `User ${u.id.substring(0, 8)}`;
      if (u.firstName || u.lastName) {
        name = [u.firstName, u.lastName].filter(Boolean).join(' ');
      } else if (u.email) {
        name = u.email.split('@')[0];
      }
      userNameMap.set(u.id, name);
    }

    return locks.map((lock) => ({
      ...this.mapLock(lock),
      userName: userNameMap.get(lock.userId) || `User ${lock.userId.substring(0, 8)}`,
    }));
  }

  async getLockRecord(lockId: string) {
    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    return lockRepo.findOneBy({ id: lockId });
  }

  async touchLock(lockId: string, options: TouchLockOptions = {}): Promise<FileLock | null> {
    await this.updateHeartbeat(lockId, options);
    const lock = await this.getLockRecord(lockId);
    return lock ? this.mapLock(lock) : null;
  }

  /**
   * Force release all locks for a user (on logout/disconnect)
   */
  async releaseAllUserLocks(userId: string): Promise<void> {
    try {
      const dataSource = await getDataSource();
      const lockRepo = dataSource.getRepository(GitLock);
      const locks = await lockRepo.findBy({ userId, released: false });

      for (const lock of locks) {
        await this.releaseLock(lock.id);
      }

      logger.info('All user locks released', { userId, count: locks.length });
    } catch (error) {
      logger.error('Failed to release user locks', { userId, error });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async extendLock(lockId: string, options: TouchLockOptions = {}): Promise<FileLock> {
    const now = Date.now();

    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    const existing = await lockRepo.findOneByOrFail({ id: lockId });
    const visibilityState: LockVisibilityState = options.visibilityState ?? this.normalizeVisibilityState(existing.visibilityState);
    const visibilityChangedAt = visibilityState !== this.normalizeVisibilityState(existing.visibilityState)
      ? now
      : Number(existing.visibilityChangedAt || existing.heartbeatAt || existing.acquiredAt || now);
    await lockRepo.update({ id: lockId }, {
      lastInteractionAt: options.hasInteraction ? now : Number(existing.lastInteractionAt || existing.heartbeatAt || existing.acquiredAt || now),
      expiresAt: now + this.lockTimeout,
      heartbeatAt: now,
      visibilityState,
      visibilityChangedAt,
    });

    const lock = await lockRepo.findOneByOrFail({ id: lockId });
    return this.mapLock(lock);
  }

  private async updateHeartbeat(lockId: string, options: TouchLockOptions = {}): Promise<void> {
    const now = Date.now();

    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    const existing = await lockRepo.findOneBy({ id: lockId, released: false });
    if (!existing) return;
    const nextVisibility = options.visibilityState ?? this.normalizeVisibilityState(existing.visibilityState);
    const previousVisibility = this.normalizeVisibilityState(existing.visibilityState);
    await lockRepo.update({ id: lockId, released: false }, {
      lastInteractionAt: options.hasInteraction ? now : Number(existing.lastInteractionAt || existing.heartbeatAt || existing.acquiredAt || now),
      heartbeatAt: now,
      expiresAt: now + this.lockTimeout, // Extend expiration
      visibilityState: nextVisibility,
      visibilityChangedAt: nextVisibility !== previousVisibility
        ? now
        : Number(existing.visibilityChangedAt || existing.heartbeatAt || existing.acquiredAt || now),
    });
  }

  private normalizeVisibilityState(value: string | null | undefined): LockVisibilityState {
    return value === 'hidden' ? 'hidden' : 'visible';
  }

  private getSessionStatus(lock: Pick<GitLock, 'lastInteractionAt' | 'heartbeatAt' | 'acquiredAt' | 'visibilityState' | 'visibilityChangedAt'>): LockSessionStatus {
    const now = Date.now();
    const lastInteractionAt = Number(lock.lastInteractionAt || lock.heartbeatAt || lock.acquiredAt || now);
    const visibilityState = this.normalizeVisibilityState(lock.visibilityState);
    const visibilityChangedAt = Number(lock.visibilityChangedAt || lock.heartbeatAt || lock.acquiredAt || now);

    if (visibilityState === 'hidden') {
      if (now - visibilityChangedAt < this.hiddenTakeoverDelay && now - lastInteractionAt < this.idleTimeout) {
        return 'active';
      }
      return 'hidden';
    }

    if (now - lastInteractionAt >= this.idleTimeout) {
      return 'idle';
    }

    return 'active';
  }

  private mapLock(lock: GitLock): FileLock {
    const acquiredAt = Number(lock.acquiredAt);
    const heartbeatAt = Number(lock.heartbeatAt);
    const lastInteractionAt = Number(lock.lastInteractionAt || heartbeatAt || acquiredAt);
    const visibilityChangedAt = Number(lock.visibilityChangedAt || heartbeatAt || acquiredAt);
    const visibilityState = this.normalizeVisibilityState(lock.visibilityState);
    return {
      id: lock.id,
      fileId: lock.fileId,
      userId: lock.userId,
      acquiredAt,
      lastInteractionAt,
      expiresAt: Number(lock.expiresAt),
      heartbeatAt,
      visibilityState,
      visibilityChangedAt,
      sessionStatus: this.getSessionStatus({
        acquiredAt,
        heartbeatAt,
        lastInteractionAt,
        visibilityState,
        visibilityChangedAt,
      } as any),
    };
  }

  private startExpirationCleanup(): void {
    // Clean up expired locks every 5 minutes
    setInterval(async () => {
      try {
        const now = Date.now();

        // Find expired locks
        const dataSource = await getDataSource();
        const lockRepo = dataSource.getRepository(GitLock);
        const expiredLocks = await lockRepo.findBy({
          released: false,
          expiresAt: LessThan(now),
        });

        // Release expired locks
        for (const lock of expiredLocks) {
          await this.releaseLock(lock.id);
          logger.info('Expired lock released', { lockId: lock.id, fileId: lock.fileId });
        }

        if (expiredLocks.length > 0) {
          logger.info('Expired locks cleaned up', { count: expiredLocks.length });
        }
      } catch (error) {
        logger.error('Lock cleanup failed', { error });
      }
    }, 300000); // 5 minutes
  }
}
