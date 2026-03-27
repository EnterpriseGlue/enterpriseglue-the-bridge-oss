/**
 * In-memory pub/sub for lock events (SSE).
 * Each fileId maps to a set of SSE response objects.
 * When a lock event occurs (e.g. force-takeover), all subscribers
 * for that fileId are notified instantly.
 */
import type { Response } from 'express';

export interface LockEvent {
  type: 'lock-revoked' | 'lock-released' | 'file-updated';
  fileId: string;
  newOwnerId?: string;
  newOwnerName?: string;
  previousLockId?: string;
}

const subscribers = new Map<string, Set<Response>>();

export function subscribeLockEvents(fileId: string, res: Response): void {
  if (!subscribers.has(fileId)) {
    subscribers.set(fileId, new Set());
  }
  subscribers.get(fileId)!.add(res);

  // Clean up on disconnect
  res.on('close', () => {
    const subs = subscribers.get(fileId);
    if (subs) {
      subs.delete(res);
      if (subs.size === 0) {
        subscribers.delete(fileId);
      }
    }
  });
}

export function emitLockEvent(fileId: string, event: LockEvent, excludeRes?: Response): void {
  const subs = subscribers.get(fileId);
  if (!subs || subs.size === 0) return;

  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const res of subs) {
    if (res === excludeRes) continue;
    try {
      res.write(data);
      // Force flush through any proxy/compression buffering
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    } catch {
      // Connection already closed — clean up
      subs.delete(res);
    }
  }
}

export function getSubscriberCount(fileId: string): number {
  return subscribers.get(fileId)?.size ?? 0;
}
