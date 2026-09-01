import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

export type TaskStatus = 'done' | 'open' | 'in-progress'

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
}

export interface JiraIssueDetail extends BugTask {
  statusName: string
  type: string
  priority: string
  description: string
  comments: string[]
  changes: string[]
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
    issuetype?: { name: string }
    priority?: { name: string }
    description?: unknown
    comment?: {
      comments?: Array<{
        body?: unknown
        author?: { displayName?: string }
      }>
    }
    created?: string
    updated?: string
    resolutiondate?: string
    assignee?: { displayName?: string } | null
    reporter?: { displayName?: string } | null
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

function termClause(term: string): string {
  const escaped = escapeJql(term)
  return `(text ~ "${escaped}" OR summary ~ "${escaped}")`
}

export function buildJql(query: string, updatedJql?: string | null): string {
  const trimmed = query.trim()
  const restriction = updatedJql ? ` AND ${updatedJql}` : ''

  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(trimmed)) {
    return `key = "${trimmed.toUpperCase()}"${restriction}`
  }

  const terms = trimmed.split(/\s+/).filter((term) => term.length > 1)
  if (terms.length === 0) {
    return updatedJql ? `${updatedJql} ORDER BY updated DESC` : 'updated >= -365d ORDER BY updated DESC'
  }

  const andTerms = terms.map(termClause).join(' AND ')
  const phrase = terms.length > 1 ? ` OR ${termClause(terms.join(' '))}` : ''

  return `(${andTerms}${phrase})${restriction} ORDER BY updated DESC`
}

function jiraAuth(env: Record<string, string>) {
  const baseUrl = env.JIRA_BASE_URL?.replace(/\/$/, '')
  const email = env.JIRA_EMAIL
  const token = env.JIRA_API_TOKEN

  if (!baseUrl || !email || !token) {
    throw new Error('Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.')
  }

  return {
    baseUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
      Accept: 'application/json',
    },
  }
}

export async function assertJiraAccess(env: Record<string, string>): Promise<void> {
  const { baseUrl, headers } = jiraAuth(env)
  const response = await fetch(`${baseUrl}/rest/api/3/myself`, { headers })

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Jira rejected the API token for ${baseUrl}. Create a token at https://id.atlassian.com/manage-profile/security/api-tokens with Jira read access for this site, then set JIRA_EMAIL and JIRA_API_TOKEN.`,
    )
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Jira auth check failed (${response.status}): ${body}`)
  }
}

export function adfToText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(adfToText).filter(Boolean).join('\n')
  }
  if (typeof value !== 'object') return ''

  const node = value as { type?: string; text?: string; content?: unknown[] }
  if (typeof node.text === 'string') return node.text
  if (node.type === 'hardBreak') return '\n'

  const joined = (node.content ?? []).map(adfToText).filter(Boolean)
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') {
    return joined.join('')
  }

  return joined.join(node.type === 'doc' ? '\n' : ' ')
}

function issueUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/browse/${key}`
}

function mapIssue(issue: JiraIssue, baseUrl: string): JiraIssueDetail {
  const comments = (issue.fields.comment?.comments ?? [])
    .slice(-2)
    .map((comment) => {
      const author = comment.author?.displayName ?? 'Unknown'
      const body = adfToText(comment.body).replace(/\s+/g, ' ').trim()
      return body ? `${author}: ${body}` : ''
    })
    .filter(Boolean)

  return {
    id: issue.key,
    title: issue.fields.summary,
    product: issue.fields.project.name,
    status: mapStatus(
      issue.fields.status.statusCategory.key,
      issue.fields.status.name,
    ),
    url: issueUrl(baseUrl, issue.key),
    statusName: issue.fields.status.name,
    type: issue.fields.issuetype?.name ?? 'Issue',
    priority: issue.fields.priority?.name ?? 'None',
    description: adfToText(issue.fields.description).replace(/\s+/g, ' ').trim(),
    comments,
    changes: [],
    created: issue.fields.created ?? '',
    updated: issue.fields.updated ?? '',
    resolved: issue.fields.resolutiondate ?? '',
    assignee: issue.fields.assignee?.displayName ?? '',
    updatedBy: '',
  }
}

function toBugTask(issue: JiraIssueDetail): BugTask {
  return {
    id: issue.id,
    title: issue.title,
    product: issue.product,
    status: issue.status,
    url: issue.url,
    created: issue.created,
    updated: issue.updated,
    resolved: issue.resolved,
    updatedBy: issue.updatedBy,
    assignee: issue.assignee,
  }
}

export async function searchJiraByJql(
  jql: string,
  env: Record<string, string>,
  maxResults = 20,
): Promise<JiraIssueDetail[]> {
  const { baseUrl, headers } = jiraAuth(env)
  const params = new URLSearchParams({
    jql,
    maxResults: String(maxResults),
    fields: 'summary,status,project,issuetype,priority,description,comment,created,updated,resolutiondate,assignee,reporter',
  })

  const response = await fetch(`${baseUrl}/rest/api/3/search/jql?${params}`, {
    headers,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Jira request failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as { issues?: JiraIssue[] }
  return (data.issues ?? []).map((issue) => mapIssue(issue, baseUrl))
}

export async function searchJiraIssuesDetailed(
  query: string,
  env: Record<string, string>,
  maxResults = 20,
  updatedJql?: string | null,
): Promise<JiraIssueDetail[]> {
  return searchJiraByJql(buildJql(query, updatedJql), env, maxResults)
}

export interface IssueChangeInfo {
  lines: string[]
  lastChangedBy: string
  lastChangedAt: string
}

export async function fetchRecentChanges(
  key: string,
  env: Record<string, string>,
  sinceDays?: number,
): Promise<IssueChangeInfo> {
  const { baseUrl, headers } = jiraAuth(env)
  const response = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?expand=changelog&fields=updated,assignee`,
    { headers },
  )

  if (!response.ok) {
    return { lines: [], lastChangedBy: '', lastChangedAt: '' }
  }

  const data = (await response.json()) as {
    changelog?: {
      histories?: Array<{
        created?: string
        author?: { displayName?: string }
        items?: Array<{ field?: string; fromString?: string | null; toString?: string | null }>
      }>
    }
  }

  const since = sinceDays
    ? Date.now() - sinceDays * 24 * 60 * 60 * 1000
    : null
  const watched = new Set(['status', 'resolution', 'summary', 'assignee', 'Fix Version', 'labels'])
  const lines: string[] = []
  let lastChangedBy = ''
  let lastChangedAt = ''

  for (const history of data.changelog?.histories ?? []) {
    const created = history.created ?? ''
    const at = created ? new Date(created).getTime() : 0
    if (since && at && at < since) continue

    const author = history.author?.displayName?.trim() ?? ''
    if (author) {
      lastChangedBy = author
      lastChangedAt = created
    }

    for (const item of history.items ?? []) {
      if (!item.field || !watched.has(item.field)) continue
      const day = created ? created.slice(0, 10) : 'unknown date'
      const who = author || 'Unknown'
      const from = item.fromString?.trim() || '—'
      const to = item.toString?.trim() || '—'
      lines.push(`${day}: ${who} changed ${item.field} ${from} → ${to}`)
    }
  }

  return {
    lines: lines.slice(-6),
    lastChangedBy,
    lastChangedAt,
  }
}

export async function searchJiraIssues(
  query: string,
  env: Record<string, string>,
): Promise<BugTask[]> {
  const issues = await searchJiraIssuesDetailed(query, env)
  return issues.map(toBugTask)
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

          await assertJiraAccess(env)
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
