export type TaskStatus = 'done' | 'open' | 'in-progress' | 'wont-do' | 'backlog'

export interface BugTask {
  id: string
  title: string
  product: string
  status: TaskStatus
  url?: string
  created?: string
  updated?: string
  resolved?: string
  updatedBy?: string
  assignee?: string
  statusName?: string
  projectKey?: string
  resolution?: string
}

export const statusLabels: Record<TaskStatus, string> = {
  done: 'Done',
  open: 'Open',
  'in-progress': 'In progress',
  'wont-do': "Won't do",
  backlog: 'Backlog',
}
