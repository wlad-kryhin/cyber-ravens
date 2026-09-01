export type TaskStatus = 'done' | 'open' | 'in-progress'

export interface BugTask {
  id: string
  title: string
  product: string
  status: TaskStatus
}

export const statusLabels: Record<TaskStatus, string> = {
  done: 'Done',
  open: 'Open',
  'in-progress': 'In progress',
}
