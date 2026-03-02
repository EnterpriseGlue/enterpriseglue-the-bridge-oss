import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitLock } from '@enterpriseglue/shared/db/entities/GitLock.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { MoreThan, LessThan, In } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

export interface FileLock {
  id: string;
  fileId: string;
  userId: string;
  acquiredAt: number;
  expiresAt: number;
  heartbeatAt: number;
}

export interface FileLockWithUser extends FileLock {
  userName: string;
}

export interface LockHolder {
  userId: string;
  name: string;
  acquiredAt: number;
}

export class LockManager {
  private lockTimeout: number; // milliseconds
  private heartbeatInterval: number; // milliseconds
  private heartbeats: Map<string, NodeJS.Timeout>;

  constructor() {
    this.lockTimeout = parseInt(process.env.LOCK_TIMEOUT_MS || '1800000'); // 30 minutes default
    this.heartbeatInterval = parseInt(process.env.LOCK_HEARTBEAT_INTERVAL_MS || '30000'); // 30 seconds default
    this.heartbeats = new Map();

    // Clean up expired locks periodically
    this.startExpirationCleanup();
  }

  /**
   * Acquire a lock on a file
   */
  async acquireLock(fileId: string, userId: string): Promise<FileLock | null> {
    try {
      // Check for existing active lock
      const existingLock = await this.getActiveLock(fileId);

      if (existingLock) {
        // Lock exists and not expired
        if (existingLock.userId === userId) {
          // User already has the lock, extend it
          return await this.extendLock(existingLock.id);
        } else {
          // Lock held by another user
          logger.warn('File already locked by another user', { fileId, userId, holder: existingLock.userId });
          return null;
        }
      }

      // Create new lock
      const now = Date.now();
      const lockId = generateId();

      const lock: FileLock = {
        id: lockId,
        fileId,
        userId,
        acquiredAt: now,
        expiresAt: now + this.lockTimeout,
        heartbeatAt: now,
      };

      const dataSource = await getDataSource();
      const lockRepo = dataSource.getRepository(GitLock);
      await lockRepo.insert({
        id: lock.id,
        fileId: lock.fileId,
        userId: lock.userId,
        acquiredAt: lock.acquiredAt,
        expiresAt: lock.expiresAt,
        heartbeatAt: lock.heartbeatAt,
        released: false,
        releasedAt: null,
      });

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
      // Stop heartbeat if running
      this.stopHeartbeat(lockId);

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
   * Start heartbeat to keep lock alive
   */
  startHeartbeat(lockId: string): void {
    // Clear existing heartbeat if any
    this.stopHeartbeat(lockId);

    // Start new heartbeat
    const interval = setInterval(async () => {
      try {
        await this.updateHeartbeat(lockId);
      } catch (error) {
        logger.error('Heartbeat failed', { lockId, error });
        this.stopHeartbeat(lockId);
      }
    }, this.heartbeatInterval);

    this.heartbeats.set(lockId, interval);
    logger.debug('Heartbeat started', { lockId });
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(lockId: string): void {
    const interval = this.heartbeats.get(lockId);
    if (interval) {
      clearInterval(interval);
      this.heartbeats.delete(lockId);
      logger.debug('Heartbeat stopped', { lockId });
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

    return {
      id: lock.id,
      fileId: lock.fileId,
      userId: lock.userId,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      heartbeatAt: lock.heartbeatAt,
    };
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
      .select(['l.id', 'l.fileId', 'l.userId', 'l.acquiredAt', 'l.expiresAt', 'l.heartbeatAt'])
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
      id: lock.id,
      fileId: lock.fileId,
      userId: lock.userId,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      heartbeatAt: lock.heartbeatAt,
      userName: userNameMap.get(lock.userId) || `User ${lock.userId.substring(0, 8)}`,
    }));
  }

  async getLockRecord(lockId: string) {
    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    return lockRepo.findOneBy({ id: lockId });
  }

  async touchLock(lockId: string): Promise<void> {
    await this.updateHeartbeat(lockId);
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

  private async extendLock(lockId: string): Promise<FileLock> {
    const now = Date.now();

    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    await lockRepo.update({ id: lockId }, {
      expiresAt: now + this.lockTimeout,
      heartbeatAt: now,
    });

    const lock = await lockRepo.findOneByOrFail({ id: lockId });
    return {
      id: lock.id,
      fileId: lock.fileId,
      userId: lock.userId,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      heartbeatAt: lock.heartbeatAt,
    };
  }

  private async updateHeartbeat(lockId: string): Promise<void> {
    const now = Date.now();

    const dataSource = await getDataSource();
    const lockRepo = dataSource.getRepository(GitLock);
    await lockRepo.update({ id: lockId, released: false }, {
      heartbeatAt: now,
      expiresAt: now + this.lockTimeout, // Extend expiration
    });
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
