import type { BugTask } from '../data/bugTasks'

interface JiraSearchResponse {
  tasks?: BugTask[]
  error?: string
}

export interface ConversationTurn {
  question: string
  answer: string
}

export interface AskResult {
  answer: string
  queries: string[]
  timeLabel: string | null
  tasks: BugTask[]
}

interface AskResponse extends Partial<AskResult> {
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

export async function askJira(
  question: string,
  history: ConversationTurn[] = [],
): Promise<AskResult> {
  const response = await fetch('/api/jira/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history }),
  })

  const data = (await response.json()) as AskResponse

  if (!response.ok) {
    throw new Error(data.error ?? `Ask failed (${response.status})`)
  }

  return {
    answer: data.answer ?? '',
    queries: data.queries ?? [],
    timeLabel: data.timeLabel ?? null,
    tasks: data.tasks ?? [],
  }
}
