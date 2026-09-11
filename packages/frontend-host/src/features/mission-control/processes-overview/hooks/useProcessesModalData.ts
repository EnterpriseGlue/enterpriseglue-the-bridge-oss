import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  fetchInstanceVariables,
  listInstanceActivityHistory,
  listInstanceJobs,
  listInstanceExternalTasks,
} from '../api/processDefinitions'

interface UseProcessesModalDataProps {
  detailsModalInstanceId: string | null
  detailsModalOpen: boolean
  retryModalInstanceId: string | null
  engineId?: string
  variablesEnabled?: boolean
  activityHistoryEnabled?: boolean
  jobsEnabled?: boolean
  externalTasksEnabled?: boolean
}

export function useProcessesModalData({
  detailsModalInstanceId,
  detailsModalOpen,
  retryModalInstanceId,
  engineId,
  variablesEnabled = true,
  activityHistoryEnabled = true,
  jobsEnabled = true,
  externalTasksEnabled = true,
}: UseProcessesModalDataProps) {
  // Fetch variables for instance details modal
  const varsQ = useQuery({
    queryKey: ['mission-control', 'vars', detailsModalInstanceId, engineId],
    queryFn: () => fetchInstanceVariables(detailsModalInstanceId!, engineId),
    enabled: variablesEnabled && !!detailsModalInstanceId && detailsModalOpen && !!engineId,
  })

  // Fetch activity history for instance details modal
  const histQ = useQuery({
    queryKey: ['mission-control', 'hist', detailsModalInstanceId, engineId],
    queryFn: () => listInstanceActivityHistory(detailsModalInstanceId!, engineId),
    enabled: activityHistoryEnabled && !!detailsModalInstanceId && detailsModalOpen && !!engineId,
  })

  // Fetch failed jobs for retry modal
  const retryJobsQ = useQuery({
    queryKey: ['mission-control', 'jobs', retryModalInstanceId, engineId],
    queryFn: () => listInstanceJobs(retryModalInstanceId!, engineId),
    enabled: jobsEnabled && !!retryModalInstanceId && !!engineId,
  })

  // Fetch failed external tasks for retry modal
  const retryExtTasksQ = useQuery({
    queryKey: ['mission-control', 'external-tasks', retryModalInstanceId, engineId],
    queryFn: () => listInstanceExternalTasks(retryModalInstanceId!, engineId),
    enabled: externalTasksEnabled && !!retryModalInstanceId && !!engineId,
  })

  // Combine jobs and external tasks for retry modal
  const allRetryItems = useMemo(() => {
    const jobs = (retryJobsQ.data || []).map((j: any) => ({ ...j, itemType: 'job' }))
    const extTasks = (retryExtTasksQ.data || []).map((et: any) => ({ ...et, itemType: 'externalTask' }))
    return [...jobs, ...extTasks]
  }, [retryJobsQ.data, retryExtTasksQ.data])

  return {
    varsQ,
    histQ,
    retryJobsQ,
    retryExtTasksQ,
    allRetryItems,
  }
}
