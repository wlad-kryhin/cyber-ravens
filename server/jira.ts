import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

export type TaskStatus = 'done' | 'open' | 'in-progress'

export interface BugTask {
  id: string
  title: string
  product: string
  status: TaskStatus
}

interface JiraIssue {
  key: string
  fields: {
    summary: string
    project: { name: string }
    status: {
      name: string
      statusCategory: { key: string }
    }
  }
}

function mapStatus(statusCategoryKey: string, statusName: string): TaskStatus {
  if (statusCategoryKey === 'done') return 'done'

  const normalized = statusName.toLowerCase()
  if (
    normalized.includes('progress') ||
    normalized.includes('review') ||
    normalized.includes('development')
  ) {
    return 'in-progress'
  }

  return 'open'
}

function escapeJql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildJql(query: string): string {
  const trimmed = query.trim()
  if (/^[A-Z]+-\d+$/i.test(trimmed)) {
    return `key = "${trimmed.toUpperCase()}"`
  }

  const escaped = escapeJql(trimmed)
  return `(text ~ "${escaped}" OR summary ~ "${escaped}") ORDER BY updated DESC`
}

export async function searchJiraIssues(
  query: string,
  env: Record<string, string>,
): Promise<BugTask[]> {
  const baseUrl = env.JIRA_BASE_URL
  const email = env.JIRA_EMAIL
  const token = env.JIRA_API_TOKEN

  if (!baseUrl || !email || !token) {
    throw new Error('Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.')
  }

  const jql = buildJql(query)
  const params = new URLSearchParams({
    jql,
    maxResults: '20',
    fields: 'summary,status,project',
  })

  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const response = await fetch(`${baseUrl}/rest/api/3/search/jql?${params}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Jira request failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as { issues?: JiraIssue[] }

  return (data.issues ?? []).map((issue) => ({
    id: issue.key,
    title: issue.fields.summary,
    product: issue.fields.project.name,
    status: mapStatus(
      issue.fields.status.statusCategory.key,
      issue.fields.status.name,
    ),
  }))
}

function readQuery(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function jiraApiPlugin(): Plugin {
  return {
    name: 'jira-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/jira/search')) {
          next()
          return
        }

        if (req.method !== 'GET' && req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          const env = loadEnv(server.config.mode, process.cwd(), '')
          let query = ''

          if (req.method === 'GET') {
            const url = new URL(req.url, 'http://localhost')
            query = url.searchParams.get('q') ?? ''
          } else {
            const body = await readQuery(req)
            const parsed = JSON.parse(body) as { q?: string }
            query = parsed.q ?? ''
          }

          if (query.trim().length < 2) {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ tasks: [] }))
            return
          }

          const tasks = await searchJiraIssues(query, env)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ tasks }))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown Jira error'
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}
