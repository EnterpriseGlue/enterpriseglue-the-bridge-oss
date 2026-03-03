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
}

export function useProcessesModalData({
  detailsModalInstanceId,
  detailsModalOpen,
  retryModalInstanceId,
  engineId,
}: UseProcessesModalDataProps) {
  // Fetch variables for instance details modal
  const varsQ = useQuery({
    queryKey: ['mission-control', 'vars', detailsModalInstanceId],
    queryFn: () => fetchInstanceVariables(detailsModalInstanceId!, engineId),
    enabled: !!detailsModalInstanceId && detailsModalOpen,
  })

  // Fetch activity history for instance details modal
  const histQ = useQuery({
    queryKey: ['mission-control', 'hist', detailsModalInstanceId],
    queryFn: () => listInstanceActivityHistory(detailsModalInstanceId!, engineId),
    enabled: !!detailsModalInstanceId && detailsModalOpen,
  })

  // Fetch failed jobs for retry modal
  const retryJobsQ = useQuery({
    queryKey: ['mission-control', 'jobs', retryModalInstanceId],
    queryFn: () => listInstanceJobs(retryModalInstanceId!, engineId),
    enabled: !!retryModalInstanceId,
  })

  // Fetch failed external tasks for retry modal
  const retryExtTasksQ = useQuery({
    queryKey: ['mission-control', 'external-tasks', retryModalInstanceId],
    queryFn: () => listInstanceExternalTasks(retryModalInstanceId!, engineId),
    enabled: !!retryModalInstanceId,
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
