import { describe, it, expect } from 'vitest';
import {
  toNumberOrUndefined,
  normalizeBatchStatistics,
  type BatchStatisticsEntry,
} from '../../../../../packages/backend-host/src/modules/mission-control/batches/service.js';

describe('batch service utils', () => {
  describe('toNumberOrUndefined', () => {
    it('returns number for valid number', () => {
      expect(toNumberOrUndefined(42)).toBe(42);
      expect(toNumberOrUndefined(0)).toBe(0);
    });

    it('converts valid string to number', () => {
      expect(toNumberOrUndefined('123')).toBe(123);
      expect(toNumberOrUndefined('0')).toBe(0);
    });

    it('returns undefined for invalid values', () => {
      expect(toNumberOrUndefined('invalid')).toBeUndefined();
      expect(toNumberOrUndefined('')).toBeUndefined();
      expect(toNumberOrUndefined(NaN)).toBeUndefined();
      expect(toNumberOrUndefined(Infinity)).toBeUndefined();
      expect(toNumberOrUndefined(null)).toBeUndefined();
      expect(toNumberOrUndefined(undefined)).toBeUndefined();
    });
  });

  describe('normalizeBatchStatistics', () => {
    it('normalizes object statistics', () => {
      const input: BatchStatisticsEntry = {
        completedJobs: 10,
        failedJobs: 2,
        remainingJobs: 5,
      };
      const result = normalizeBatchStatistics(input);
      expect(result.completedJobs).toBe(10);
      expect(result.failedJobs).toBe(2);
      expect(result.remainingJobs).toBe(5);
    });

    it('aggregates array statistics', () => {
      const input: BatchStatisticsEntry[] = [
        { completedJobs: 10, failedJobs: 2, remainingJobs: 5 },
        { completedJobs: 5, failedJobs: 1, remainingJobs: 3 },
      ];
      const result = normalizeBatchStatistics(input);
      expect(result.completedJobs).toBe(15);
      expect(result.failedJobs).toBe(3);
      expect(result.remainingJobs).toBe(8);
    });

    it('handles null input', () => {
      const result = normalizeBatchStatistics(null);
      expect(result).toEqual({});
    });

    it('handles empty array', () => {
      const result = normalizeBatchStatistics([]);
      expect(result).toEqual({});
    });

    it('skips invalid entries in array', () => {
      const input: BatchStatisticsEntry[] = [
        { completedJobs: 10 },
        {},
        { failedJobs: 2 },
      ];
      const result = normalizeBatchStatistics(input);
      expect(result.completedJobs).toBe(10);
      expect(result.failedJobs).toBe(2);
    });
  });
});
