import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildActivityGroups, buildHistoryContext, formatDurationMs } from '@src/features/mission-control/process-instance-detail/components/activityDetailUtils';

describe('activityDetailUtils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds history context from grouped activity', () => {
    const context = buildHistoryContext({
      activityId: 'act-1',
      activityName: 'Task',
      totalExecCount: 2,
      statusLabel: 'ACTIVE',
      _summary: { startTs: 1000, endTs: 2000, durationMs: 1000 },
    });

    expect(context).toMatchObject({
      activityId: 'act-1',
      activityName: 'Task',
      executions: 2,
      statusLabel: 'ACTIVE',
    });
  });

  it('returns null history context when group is missing', () => {
    expect(buildHistoryContext(null)).toBeNull();
  });

  it('handles missing summary timestamps', () => {
    const context = buildHistoryContext({
      activityId: 'act-2',
      activityName: 'No Times',
      totalExecCount: 1,
      statusLabel: 'COMPLETED',
      _summary: { startTs: null, endTs: null, durationMs: null },
    });

    expect(context).toMatchObject({
      activityId: 'act-2',
      startTime: null,
      endTime: null,
      durationMs: null,
      executions: 1,
    });
  });

  it('formats durations across the supported unit ranges', () => {
    expect(formatDurationMs(500)).toBe('500 ms');
    expect(formatDurationMs(45_000)).toBe('45 sec');
    expect(formatDurationMs(125_000)).toBe('2 min 5 sec');
    expect(formatDurationMs(3_660_000)).toBe('1 hr 01 min');
    expect(formatDurationMs(90_000_000)).toBe('1 day 1 hr');
  });

  it('computes active duration when an execution has no end time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:10Z'));

    expect(formatDurationMs(null, '2024-01-01T00:00:00Z', null)).toBe('10 sec');
  });

  it('groups repeated same-step executions under one expandable group', () => {
    const groups = buildActivityGroups({
      sortedActs: [
        {
          id: 'hist-1',
          activityInstanceId: 'act-inst-1',
          activityId: 'approveTask',
          activityName: 'Approve request',
          activityType: 'userTask',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:00:05Z',
        },
        {
          id: 'hist-2',
          activityInstanceId: 'act-inst-2',
          activityId: 'approveTask',
          activityName: 'Approve request',
          activityType: 'userTask',
          startTime: '2024-01-01T00:00:06Z',
          endTime: '2024-01-01T00:00:09Z',
        },
      ],
      incidentActivityIds: new Set(),
      clickableActivityIds: new Set(['approveTask']),
      selectedActivityId: null,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      activityId: 'approveTask',
      totalExecCount: 2,
      isExpandable: true,
      isClickable: true,
    });
    expect(groups[0].instances.map((instance) => instance.activityInstanceId)).toEqual(['act-inst-1', 'act-inst-2']);
  });

  it('keeps same-step executions under different parents separated', () => {
    const groups = buildActivityGroups({
      sortedActs: [
        {
          id: 'branch-1',
          activityInstanceId: 'branch-inst-1',
          activityId: 'parallelGatewayA',
          activityName: 'Branch A',
          activityType: 'parallelGateway',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:00:01Z',
        },
        {
          id: 'branch-2',
          activityInstanceId: 'branch-inst-2',
          activityId: 'parallelGatewayB',
          activityName: 'Branch B',
          activityType: 'parallelGateway',
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-01T00:00:01Z',
        },
        {
          id: 'child-1',
          activityInstanceId: 'child-inst-1',
          parentActivityInstanceId: 'branch-inst-1',
          activityId: 'reviewTask',
          activityName: 'Review',
          activityType: 'userTask',
          startTime: '2024-01-01T00:00:02Z',
          endTime: '2024-01-01T00:00:05Z',
        },
        {
          id: 'child-2',
          activityInstanceId: 'child-inst-2',
          parentActivityInstanceId: 'branch-inst-2',
          activityId: 'reviewTask',
          activityName: 'Review',
          activityType: 'userTask',
          startTime: '2024-01-01T00:00:02Z',
          endTime: '2024-01-01T00:00:06Z',
        },
      ],
      incidentActivityIds: new Set(),
      clickableActivityIds: new Set(),
      selectedActivityId: null,
    });

    expect(groups).toHaveLength(2);
    expect(groups[0].instances[0].children[0].activityId).toBe('reviewTask');
    expect(groups[1].instances[0].children[0].activityId).toBe('reviewTask');
    expect(groups[0].instances[0].children[0].groupKey).not.toBe(groups[1].instances[0].children[0].groupKey);
  });

  it('marks incident and active status correctly for execution groups', () => {
    const groups = buildActivityGroups({
      sortedActs: [{ id: 'active-1', activityInstanceId: 'active-inst', activityId: 'act-1', activityName: 'Task', endTime: null, activityType: 'userTask' }],
      incidentActivityIds: new Set(['act-1']),
      clickableActivityIds: new Set(['act-1']),
      selectedActivityId: 'act-1',
    });

    expect(groups[0]).toMatchObject({
      hasIncident: true,
      statusLabel: 'INCIDENT',
      isClickable: true,
      isSelected: true,
      active: true,
    });
  });

  it('returns empty array when no activities', () => {
    const groups = buildActivityGroups({
      sortedActs: [],
      incidentActivityIds: new Set(),
      clickableActivityIds: new Set(),
      selectedActivityId: null,
    });

    expect(groups).toEqual([]);
  });
});
