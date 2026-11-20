import type { Job, Queue } from 'bullmq';

/** Jobs in these states can still act on an account. */
export const PENDING_JOB_STATES = ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'] as const;

export async function findPendingAccountJobs(queue: Queue, accountId: string): Promise<Job[]> {
  const jobs = await queue.getJobs([...PENDING_JOB_STATES], 0, -1);
  return jobs.filter((job) => (job?.data as { accountId?: string } | undefined)?.accountId === accountId);
}
