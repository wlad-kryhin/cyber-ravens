import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import {
  assertJiraAccess,
  fetchRecentChanges,
  searchJiraByJql,
  searchJiraIssuesDetailed,
  type BugTask,
  type JiraIssueDetail,
} from './jira.js'

const MAX_QUERIES = 4
const MAX_ISSUES = 12
const RESULTS_PER_QUERY = 8

export interface AskResult {
  answer: string
  queries: string[]
  timeLabel: string | null
  tasks: BugTask[]
}

export interface ConversationTurn {
  question: string
  answer: string
}

interface SearchPlan {
  queries: string[]
  updatedJql: string | null
  timeLabel: string | null
  timeDays: number | null
  changeIntent: boolean
}

interface TimeWindow {
  label: string
  jql: string
  days: number
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'what', 'whats', "what's", 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'i', 'we', 'you', 'me', 'my', 'our', 'your',
  'about', 'with', 'from', 'into', 'for', 'of', 'on', 'in', 'to', 'at', 'by',
  'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'any', 'some', 'all', 'there', 'their', 'have', 'has', 'had',
  'please', 'tell', 'show', 'find', 'search', 'look', 'related', 'regarding',
  'issue', 'issues', 'ticket', 'tickets', 'jira', 'status',
  'just', 'now', 'currently', 'current', 'recent', 'lately', 'recently',
  'change', 'changes', 'changed', 'update', 'updates', 'updated', 'done',
  'last', 'past', 'latest', 'month', 'months', 'week', 'weeks', 'year', 'years',
  'day', 'days', 'today',
  'vad', 'hur', 'varför', 'varfor', 'när', 'nar', 'var', 'vilken', 'vilket', 'vilka',
  'är', 'ar', 'finns', 'har', 'kan', 'ska', 'skulle', 'vill',
  'en', 'ett', 'den', 'det', 'de', 'dem', 'och', 'eller', 'men',
  'om', 'att', 'som', 'på', 'pa', 'av', 'för', 'till', 'med', 'från', 'fran',
  'jag', 'vi', 'du', 'mig', 'oss', 'gällande', 'gallande', 'angående', 'angaende',
  'relaterat', 'statusen', 'ärendet', 'arendet', 'ärenden', 'arenden',
  'nu', 'senaste', 'just', 'ändring', 'ändringar', 'andring', 'andringar', 'ändrat',
  'månad', 'manad', 'månaden', 'manaden', 'månader', 'vecka', 'veckan', 'veckor',
  'år', 'ar', 'året', 'aret', 'dag', 'dagar', 'idag',
])

const SYNONYMS: Record<string, string[]> = {
  bugg: ['bug'],
  buggar: ['bugs'],
  inloggning: ['login'],
  inloggningen: ['login'],
  mobil: ['mobile'],
  mobilen: ['mobile'],
  öppna: ['open'],
  oppna: ['open'],
  pågående: ['progress'],
  pagaende: ['progress'],
  klara: ['done'],
}

const UNIT_DAYS: Record<string, number> = {
  day: 1,
  days: 1,
  dag: 1,
  dagar: 1,
  week: 7,
  weeks: 7,
  vecka: 7,
  veckan: 7,
  veckor: 7,
  month: 30,
  months: 30,
  månad: 30,
  manad: 30,
  månaden: 30,
  manaden: 30,
  månader: 30,
  manader: 30,
  year: 365,
  years: 365,
  år: 365,
  ar: 365,
  året: 365,
  aret: 365,
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value.trim())
  }

  return result
}

function extractIssueKeys(text: string): string[] {
  return [...text.toUpperCase().matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((match) => match[0])
}

function extractQuoted(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"|'([^']+)'/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter(Boolean)
}

function keywords(text: string): string[] {
  return text
    .replace(/[A-Z][A-Z0-9]+-\d+/gi, ' ')
    .replace(/["']/g, ' ')
    .replace(/[?!.,:;()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token.toLowerCase()))
}

function expandSynonyms(tokens: string[]): string[] {
  const extra: string[] = []
  for (const token of tokens) {
    extra.push(...(SYNONYMS[token.toLowerCase()] ?? []))
  }
  return extra
}

function parseTimeWindow(question: string): TimeWindow | null {
  const q = question.toLowerCase()
  const numbered = q.match(
    /\b(?:last|past|senaste)\s+(\d+)\s+(day|days|week|weeks|month|months|year|years|dag|dagar|vecka|veckor|månad|manad|månader|manader|år|ar)\b/,
  )
  if (numbered) {
    const amount = Number(numbered[1])
    const unit = numbered[2]
    const days = amount * (UNIT_DAYS[unit] ?? 1)
    return {
      label: `the last ${amount} ${unit}`,
      jql: `updated >= -${days}d`,
      days,
    }
  }

  if (/\b(today|idag)\b/.test(q)) {
    return { label: 'today', jql: 'updated >= startOfDay()', days: 1 }
  }
  if (/\b(this week|denna vecka)\b/.test(q)) {
    return { label: 'this week', jql: 'updated >= startOfWeek()', days: 7 }
  }
  if (/\b(this month|denna månad|denna manad)\b/.test(q)) {
    return { label: 'this month', jql: 'updated >= startOfMonth()', days: 30 }
  }
  if (/\b(last|past|senaste)\s+(week|vecka|veckan)\b/.test(q)) {
    return { label: 'the last week', jql: 'updated >= -7d', days: 7 }
  }
  if (/\b(last|past|senaste)\s+(month|månad|manad|månaden|manaden)\b/.test(q)) {
    return { label: 'the last month', jql: 'updated >= -30d', days: 30 }
  }
  if (/\b(last|past|senaste)\s+(year|år|året|aret)\b/.test(q)) {
    return { label: 'the last year', jql: 'updated >= -365d', days: 365 }
  }

  return null
}

function hasChangeIntent(question: string): boolean {
  return /\b(change|changes|changed|update|updated|updates|fix|fixed|deploy|released|ändr|andring|andrat)\b/i.test(
    question,
  )
}

function inferFallbackJql(question: string, updatedJql: string | null): string | null {
  const q = question.toLowerCase()
  const isListing = /\b(vilka|alla|show|list|öppna|oppna|open|recent|senaste|currently|just nu)\b/.test(
    q,
  )
  if (!isListing && !updatedJql) return null

  const parts = [updatedJql ?? 'updated >= -365d']
  if (/\b(open|öppna|oppna|unresolved)\b/.test(q)) {
    parts.push('statusCategory != Done')
  } else if (/\b(done|klara|closed|resolved)\b/.test(q) && !hasChangeIntent(question)) {
    parts.push('statusCategory = Done')
  }

  return `${parts.join(' AND ')} ORDER BY updated DESC`
}

function decomposeHeuristic(question: string): string[] {
  const queries = [...extractIssueKeys(question), ...extractQuoted(question)]
  const tokens = keywords(question)
  const expanded = unique([...tokens, ...expandSynonyms(tokens)])

  if (expanded.length > 0) {
    queries.push(expanded.slice(0, 6).join(' '))
  }

  if (expanded.length >= 2) {
    queries.push(expanded.slice(0, 2).join(' '))
  }

  const clauses = question.split(/\s+(?:and|och|samt|plus)\s+/i)
  if (clauses.length > 1) {
    for (const clause of clauses) {
      const clauseTokens = keywords(clause)
      if (clauseTokens.length >= 2) {
        queries.push(clauseTokens.slice(0, 5).join(' '))
      }
    }
  }

  const result = unique(queries).slice(0, MAX_QUERIES)
  return result.length > 0 ? result : [question.trim()]
}

function isSwedish(text: string): boolean {
  return /\b(vad|hur|varför|varfor|finns|gäller|galler|vilka|vilken|ärendet|arendet|öppen|oppna|pågående|pagaende|klara|ändr|senaste)\b/i.test(
    text,
  )
}

function dateLabel(iso?: string): string {
  return iso ? iso.slice(0, 10) : ''
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

function toTask(issue: JiraIssueDetail): BugTask {
  return {
    id: issue.id,
    title: issue.title,
    product: issue.product,
    status: issue.status,
    url: issue.url,
    created: issue.created,
    updated: issue.updated,
    resolved: issue.resolved,
  }
}

function synthesizeHeuristic(
  question: string,
  issues: JiraIssueDetail[],
  timeLabel: string | null,
  outsideWindow: boolean,
): string {
  const sv = isSwedish(question)
  const primary = issues[0]
  const when = dateLabel(primary?.updated)
  const resolved = dateLabel(primary?.resolved)
  const changeLine = primary?.changes[0]

  if (issues.length === 0) {
    if (timeLabel) {
      return sv
        ? `Jag hittade inga Jira-ärenden om detta ${timeLabel.replace('the last', 'den senaste')}. Prova ett ärendenummer eller bredare termer.`
        : `I could not find Jira issues for this in ${timeLabel}. Try an issue key or broader terms.`
    }
    return sv
      ? 'Jag hittade inga Jira-ärenden som svarar på frågan. Prova ett ärendenummer eller mer specifika termer.'
      : 'I could not find Jira issues that answer this question. Try an issue key or more specific terms.'
  }

  if (sv) {
    const lines: string[] = []
    if (outsideWindow && timeLabel) {
      lines.push(
        `Inget matchade ${timeLabel.replace('the last', 'den senaste')}, men relaterade ärenden finns i listan nedan.`,
      )
    } else {
      lines.push(
        `Ja — jag hittade ${issues.length} relaterat${issues.length === 1 ? '' : 'e'} ärende${issues.length === 1 ? '' : 'n'} i Jira. De listas nedan.`,
      )
    }
    if (when) lines.push(`Det närmaste ärendet ändrades senast ${when}.`)
    if (resolved) lines.push(`Det markerades klart ${resolved}.`)
    if (changeLine) lines.push(`Senaste ändring: ${changeLine}.`)
    return lines.join(' ')
  }

  const lines: string[] = []
  if (outsideWindow && timeLabel) {
    lines.push(`Nothing matched in ${timeLabel}. Related issues are listed below.`)
  } else {
    lines.push(
      `Yes — I found ${issues.length} related issue${issues.length === 1 ? '' : 's'} in Jira. They are listed below.`,
    )
  }
  if (when) lines.push(`The closest match was last updated ${when}.`)
  if (resolved) lines.push(`It was resolved ${resolved}.`)
  if (changeLine) lines.push(`Latest change: ${changeLine}.`)
  return lines.join(' ')
}

function historyText(history: ConversationTurn[]): string {
  return history
    .map((turn, index) => `Q${index + 1}: ${turn.question}\nA${index + 1}: ${turn.answer}`)
    .join('\n\n')
}

function normalizeHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is ConversationTurn => {
      return (
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as ConversationTurn).question === 'string' &&
        typeof (item as ConversationTurn).answer === 'string'
      )
    })
    .map((item) => ({
      question: item.question.trim(),
      answer: item.answer.trim(),
    }))
    .filter((item) => item.question.length > 0)
    .slice(-12)
}

function issueContext(issue: JiraIssueDetail): string {
  const parts = [
    `${issue.id} [${issue.type}/${issue.priority}] ${issue.title}`,
    `Product: ${issue.product}. Status: ${issue.statusName} (${issue.status}).`,
  ]
  if (issue.created) parts.push(`Created: ${dateLabel(issue.created)}.`)
  if (issue.updated) parts.push(`Updated: ${dateLabel(issue.updated)}.`)
  if (issue.resolved) parts.push(`Resolved: ${dateLabel(issue.resolved)}.`)
  if (issue.description) parts.push(`Description: ${truncate(issue.description, 500)}`)
  if (issue.comments.length > 0) {
    parts.push(`Recent comments: ${truncate(issue.comments.join(' | '), 360)}`)
  }
  if (issue.changes.length > 0) {
    parts.push(`Changelog: ${issue.changes.join('; ')}`)
  }
  return parts.join(' ')
}

async function chatJson(
  env: Record<string, string>,
  system: string,
  user: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = env.OPENAI_MODEL || 'gpt-4o-mini'
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI request failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) return null

  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

async function decomposeQuestion(
  question: string,
  env: Record<string, string>,
  history: ConversationTurn[],
): Promise<SearchPlan> {
  const priorQuestions = history.map((turn) => turn.question).join(' ')
  const time = parseTimeWindow(question) ?? parseTimeWindow(priorQuestions)
  const currentKeywords = keywords(question)
  const searchText =
    currentKeywords.length >= 2 || history.length === 0
      ? question
      : `${priorQuestions} ${question}`.trim()
  const fallback = unique([
    ...decomposeHeuristic(searchText),
    ...extractIssueKeys(`${priorQuestions} ${question}`),
  ]).slice(0, MAX_QUERIES)
  const changeIntent = hasChangeIntent(`${priorQuestions} ${question}`)

  try {
    const parsed = await chatJson(
      env,
      [
        'Extract 1-4 short Jira text-search queries from the latest user question.',
        'Use the previous questions for product names and context if the latest question is a follow-up.',
        'Return JSON: { "queries": string[] }.',
        'Queries must be keywords or phrases, not full sentences.',
        'Keep product names (e.g. Varbi) and feature words (e.g. login).',
        'Do not include time words like last month, or verbs like changes/done.',
        'If any message contains an issue key like ABC-123, include it as its own query.',
      ].join(' '),
      history.length > 0
        ? `Previous questions:\n${history.map((turn) => turn.question).join('\n')}\n\nLatest question:\n${question}`
        : question,
    )

    const queries = Array.isArray(parsed?.queries)
      ? parsed.queries.filter((item): item is string => typeof item === 'string')
      : []

    const merged = unique([
      ...extractIssueKeys(`${priorQuestions} ${question}`),
      ...queries,
      ...fallback,
    ])
    return {
      queries: (merged.length > 0 ? merged : [searchText.trim()]).slice(0, MAX_QUERIES),
      updatedJql: time?.jql ?? null,
      timeLabel: time?.label ?? null,
      timeDays: time?.days ?? null,
      changeIntent,
    }
  } catch {
    return {
      queries: fallback,
      updatedJql: time?.jql ?? null,
      timeLabel: time?.label ?? null,
      timeDays: time?.days ?? null,
      changeIntent,
    }
  }
}

async function synthesizeAnswer(
  question: string,
  issues: JiraIssueDetail[],
  env: Record<string, string>,
  timeLabel: string | null,
  outsideWindow: boolean,
  history: ConversationTurn[],
): Promise<string> {
  const fallback = synthesizeHeuristic(question, issues, timeLabel, outsideWindow)

  if (issues.length === 0) return fallback

  try {
    const parsed = await chatJson(
      env,
      [
        'Answer the user using only the Jira issues provided and the prior conversation.',
        'Return JSON: { "answer": string }.',
        'Write 2-5 short sentences in the same language as the question.',
        'Do not list issue keys or dump several tickets into one sentence.',
        'The UI already shows a clickable list of issues under your answer.',
        'You may mention dates and what changed. Refer to "the issues below" instead of enumerating keys.',
        'If the issues are outside the requested time window, say that clearly.',
        'Do not invent facts that are not in the issues.',
      ].join(' '),
      [
        history.length > 0 ? `Previous conversation:\n${historyText(history)}` : '',
        `Question:\n${question}`,
        timeLabel ? `Requested time window: ${timeLabel}` : '',
        outsideWindow ? 'Note: no matches inside the time window; issues below are older.' : '',
        `Jira issues:\n${issues.map(issueContext).join('\n\n')}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    )

    const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim() : ''
    return answer || fallback
  } catch {
    return fallback
  }
}

async function searchTextQuery(
  query: string,
  env: Record<string, string>,
  updatedJql?: string | null,
): Promise<JiraIssueDetail[]> {
  try {
    return await searchJiraIssuesDetailed(query, env, RESULTS_PER_QUERY, updatedJql)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('not configured') || message.includes('rejected the API token')) {
      throw error
    }
    return []
  }
}

async function searchMerged(
  queries: string[],
  env: Record<string, string>,
  updatedJql?: string | null,
): Promise<JiraIssueDetail[]> {
  const batches = await Promise.all(
    queries.map((query) => searchTextQuery(query, env, updatedJql)),
  )

  const seen = new Set<string>()
  const merged: JiraIssueDetail[] = []

  for (const batch of batches) {
    for (const issue of batch) {
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      merged.push(issue)
      if (merged.length >= MAX_ISSUES) return merged
    }
  }

  return merged
}

async function attachChangelogs(
  issues: JiraIssueDetail[],
  env: Record<string, string>,
  sinceDays: number | null,
  changeIntent: boolean,
): Promise<JiraIssueDetail[]> {
  if (!changeIntent || issues.length === 0) return issues

  const detailed = await Promise.all(
    issues.slice(0, 3).map(async (issue) => ({
      ...issue,
      changes: await fetchRecentChanges(issue.id, env, sinceDays ?? undefined),
    })),
  )

  return [...detailed, ...issues.slice(3)]
}

export async function askJiraQuestion(
  question: string,
  env: Record<string, string>,
  history: ConversationTurn[] = [],
): Promise<AskResult> {
  await assertJiraAccess(env)

  const plan = await decomposeQuestion(question, env, history)
  let issues = plan.queries.length > 0 ? await searchMerged(plan.queries, env, plan.updatedJql) : []
  let outsideWindow = false

  if (issues.length === 0 && plan.updatedJql) {
    const older = await searchMerged(plan.queries, env)
    if (older.length > 0) {
      issues = older
      outsideWindow = true
    }
  }

  if (issues.length === 0) {
    const fallbackJql = inferFallbackJql(question, plan.updatedJql)
    if (fallbackJql) {
      try {
        issues = await searchJiraByJql(fallbackJql, env, MAX_ISSUES)
      } catch {
        issues = []
      }
    }
  }

  issues = await attachChangelogs(issues, env, plan.timeDays, plan.changeIntent)
  const answer = await synthesizeAnswer(
    question,
    issues,
    env,
    plan.timeLabel,
    outsideWindow,
    history,
  )

  return {
    answer,
    queries: plan.queries,
    timeLabel: plan.timeLabel,
    tasks: issues.map(toTask),
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

export function askApiPlugin(): Plugin {
  return {
    name: 'jira-ask-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/jira/ask')) {
          next()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          const env = loadEnv(server.config.mode, process.cwd(), '')
          const parsed = JSON.parse(await readBody(req)) as {
            question?: string
            history?: unknown
          }
          const question = parsed.question?.trim() ?? ''
          const history = normalizeHistory(parsed.history)

          if (question.length < 2) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Ask a slightly longer question.' }))
            return
          }

          const result = await askJiraQuestion(question, env, history)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown ask error'
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}
