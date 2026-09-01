import type { BugTask } from '../data/bugTasks'

interface JiraSearchResponse {
  tasks?: BugTask[]
  error?: string
}

export async function fetchJiraTasks(query: string): Promise<BugTask[]> {
  const params = new URLSearchParams({ q: query })
  const response = await fetch(`/api/jira/search?${params}`)

  const data = (await response.json()) as JiraSearchResponse

  if (!response.ok) {
    throw new Error(data.error ?? `Jira search failed (${response.status})`)
  }

  return data.tasks ?? []
}
