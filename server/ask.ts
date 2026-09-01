import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import {
  attachPageBodies,
  searchConfluencePages,
  toConfluenceDoc,
  type ConfluenceDoc,
  type ConfluencePageDetail,
} from './confluence.js'
import { cursorJson } from './cursor.js'
import {
  assertJiraAccess,
  fetchRecentChanges,
  searchJiraByJql,
  searchJiraIssuesDetailed,
  type BugTask,
  type JiraIssueDetail,
} from './jira.js'

const MAX_QUERIES = 6
const MAX_ISSUES = 12
const MAX_DOCS = 8
const RESULTS_PER_QUERY = 8
const RESULTS_PER_DOC_QUERY = 6

export interface AskResult {
  answer: string
  queries: string[]
  timeLabel: string | null
  tasks: BugTask[]
  docs: ConfluenceDoc[]
}

export interface ConversationTurn {
  question: string
  answer: string
  queries?: string[]
  timeLabel?: string | null
  products?: string[]
  issueKeys?: string[]
  docTitles?: string[]
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
  'documentation', 'dokumentation', 'docs', 'doc', 'wiki', 'confluence',
  'page', 'pages', 'sida', 'sidor',
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
    updatedBy: issue.updatedBy,
    assignee: issue.assignee,
  }
}

function topicLabel(history: ConversationTurn[], issues: JiraIssueDetail[]): string {
  const fromIssues = unique(
    issues
      .map((issue) => issue.product)
      .filter((product) => product && product.toLowerCase() !== 'unknown'),
  )
  if (fromIssues[0]) return fromIssues[0]
  return inheritedTopic(history)[0] ?? ''
}

function synthesizeHeuristic(
  question: string,
  issues: JiraIssueDetail[],
  pages: ConfluencePageDetail[],
  timeLabel: string | null,
  outsideWindow: boolean,
  history: ConversationTurn[] = [],
): string {
  const sv = isSwedish(`${history.map((turn) => turn.question).join(' ')} ${question}`)
  const primary = issues[0]
  const when = dateLabel(primary?.updated)
  const resolved = dateLabel(primary?.resolved)
  const who = primary?.updatedBy
  const changeLine = primary?.changes[0]
  const topic = topicLabel(history, issues)
  const docsNote = pages.length
    ? sv
      ? ` Relaterad dokumentation i Confluence listas nedan.`
      : ` Related Confluence documentation is listed below.`
    : ''

  if (issues.length === 0 && pages.length === 0) {
    if (timeLabel) {
      return sv
        ? `Jag hittade inga Jira-ärenden eller Confluence-sidor${topic ? ` om ${topic}` : ''} ${timeLabel.replace('the last', 'den senaste')}. Prova ett ärendenummer eller bredare termer.`
        : `I could not find Jira issues or Confluence pages${topic ? ` about ${topic}` : ''} in ${timeLabel}. Try an issue key or broader terms.`
    }
    return sv
      ? `Jag hittade inga Jira-ärenden eller Confluence-sidor${topic ? ` om ${topic}` : ''} som svarar på frågan. Prova ett ärendenummer eller mer specifika termer.`
      : `I could not find Jira issues or Confluence pages${topic ? ` about ${topic}` : ''} that answer this question. Try an issue key or more specific terms.`
  }

  if (issues.length === 0) {
    return sv
      ? `Jag hittade inga Jira-ärenden${topic ? ` om ${topic}` : ''}, men det finns relaterad dokumentation i Confluence.`
      : `I could not find Jira issues${topic ? ` about ${topic}` : ''}, but related Confluence documentation is listed below.`
  }

  if (sv) {
    const lines: string[] = []
    if (outsideWindow && timeLabel) {
      lines.push(
        `Inget matchade ${timeLabel.replace('the last', 'den senaste')}${topic ? ` för ${topic}` : ''}, men relaterade ärenden finns i listan nedan.`,
      )
    } else {
      lines.push(
        `Ja — jag hittade ${issues.length} relaterat${issues.length === 1 ? '' : 'e'} ärende${issues.length === 1 ? '' : 'n'} i Jira${topic ? ` om ${topic}` : ''}. De listas nedan.`,
      )
    }
    if (when && who) lines.push(`Det närmaste ärendet ändrades senast ${when} av ${who}.`)
    else if (when) lines.push(`Det närmaste ärendet ändrades senast ${when}.`)
    if (resolved) lines.push(`Det markerades klart ${resolved}.`)
    if (changeLine) lines.push(`Senaste ändring: ${changeLine}.`)
    return `${lines.join(' ')}${docsNote}`
  }

  const lines: string[] = []
  if (outsideWindow && timeLabel) {
    lines.push(
      `Nothing matched in ${timeLabel}${topic ? ` for ${topic}` : ''}. Related issues are listed below.`,
    )
  } else {
    lines.push(
      `Yes — I found ${issues.length} related issue${issues.length === 1 ? '' : 's'} in Jira${topic ? ` about ${topic}` : ''}. They are listed below.`,
    )
  }
  if (when && who) lines.push(`The closest match was last updated ${when} by ${who}.`)
  else if (when) lines.push(`The closest match was last updated ${when}.`)
  if (resolved) lines.push(`It was resolved ${resolved}.`)
  if (changeLine) lines.push(`Latest change: ${changeLine}.`)
  return `${lines.join(' ')}${docsNote}`
}

function historyText(history: ConversationTurn[]): string {
  return history
    .map((turn, index) => {
      const extras = [
        turn.queries?.length ? `Searched Jira and Confluence for: ${turn.queries.join(', ')}` : '',
        turn.products?.length ? `Products: ${turn.products.join(', ')}` : '',
        turn.issueKeys?.length ? `Issue keys: ${turn.issueKeys.join(', ')}` : '',
        turn.docTitles?.length ? `Confluence pages: ${turn.docTitles.join(', ')}` : '',
        turn.timeLabel ? `Time window: ${turn.timeLabel}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      return `Q${index + 1}: ${turn.question}\nA${index + 1}: ${turn.answer}${extras ? `\n${extras}` : ''}`
    })
    .join('\n\n')
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return unique(
    value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()),
  )
}

function conversationCorpus(history: ConversationTurn[], question: string): string {
  return [...history.map((turn) => turn.question), question].join(' ')
}

function inheritedTopic(history: ConversationTurn[]): string[] {
  const phrases: string[] = []

  for (const turn of history) {
    phrases.push(...(turn.queries ?? []))
    phrases.push(...(turn.issueKeys ?? []))
    phrases.push(
      ...(turn.products ?? []).filter((product) => product && product.toLowerCase() !== 'unknown'),
    )
    const terms = keywords(turn.question)
    if (terms.length > 0) phrases.push(terms.slice(0, 5).join(' '))
  }

  return unique(phrases)
}

function applyStickyTopic(queries: string[], topic: string[]): string[] {
  const primary = topic[0]
  if (!primary) return queries

  const topicTerms = unique(topic.flatMap((phrase) => keywords(phrase))).map((term) =>
    term.toLowerCase(),
  )

  const anchored = queries.map((query) => {
    if (/^[A-Z][A-Z0-9]+-\d+$/i.test(query)) return query
    const hasTopic = topicTerms.some((term) => query.toLowerCase().includes(term))
    return hasTopic ? query : `${primary} ${query}`.trim()
  })

  return unique([...anchored, primary])
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
      queries: asStringList(item.queries),
      timeLabel: typeof item.timeLabel === 'string' ? item.timeLabel.trim() : null,
      products: asStringList(item.products),
      issueKeys: asStringList(item.issueKeys),
      docTitles: asStringList(item.docTitles),
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
  if (issue.updated) {
    parts.push(
      issue.updatedBy
        ? `Updated: ${dateLabel(issue.updated)} by ${issue.updatedBy}.`
        : `Updated: ${dateLabel(issue.updated)}.`,
    )
  }
  if (issue.assignee) parts.push(`Assignee: ${issue.assignee}.`)
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

function pageContext(page: ConfluencePageDetail): string {
  const parts = [`${page.type} "${page.title}"${page.space ? ` in ${page.space}` : ''}`]
  if (page.updated) {
    parts.push(
      page.updatedBy
        ? `Updated: ${dateLabel(page.updated)} by ${page.updatedBy}.`
        : `Updated: ${dateLabel(page.updated)}.`,
    )
  }
  if (page.excerpt) parts.push(`Excerpt: ${truncate(page.excerpt, 280)}`)
  if (page.body) parts.push(`Content: ${truncate(page.body, 1200)}`)
  return parts.join(' ')
}

async function chatJson(
  env: Record<string, string>,
  system: string,
  user: string,
): Promise<Record<string, unknown> | null> {
  const prompt = `${system}\n\n${user}`

  try {
    const fromCursor = await cursorJson(env, prompt)
    if (fromCursor) return fromCursor
  } catch {
    // Fall through to OpenAI or heuristic.
  }

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
  const corpus = conversationCorpus(history, question)
  const time =
    parseTimeWindow(question) ??
    parseTimeWindow(history.map((turn) => turn.question).join(' ')) ??
    parseTimeWindow(history.map((turn) => turn.timeLabel ?? '').join(' '))
  const topic = inheritedTopic(history)
  const searchText = history.length > 0 ? corpus : question
  const fallback = unique([
    ...applyStickyTopic(decomposeHeuristic(question), topic),
    ...decomposeHeuristic(searchText),
    ...extractIssueKeys(corpus),
    ...topic,
  ]).slice(0, MAX_QUERIES)
  const changeIntent = hasChangeIntent(corpus)

  try {
    const parsed = await chatJson(
      env,
      [
        'Turn a natural-language support question into a Jira search plan.',
        'This is a follow-up conversation when previous questions are provided.',
        'Always keep the same product, system and feature from earlier turns unless the user clearly names a different one.',
        'Put that product/system in every query, even if the latest question is only "who?", "when?" or "what changed?".',
        'Return JSON only: { "queries": string[], "timeDays": number | null, "timeLabel": string | null, "changeIntent": boolean }.',
        'queries: 1-4 short Jira text-search phrases, not full sentences.',
        'Keep product names (e.g. Varbi) and feature words (e.g. login).',
        'Do not put time words or verbs like changes/done into queries.',
        'timeDays: 7/30/365 when the user asked for last week/month/year in this turn or an earlier turn, otherwise null.',
        'If any message contains an issue key like ABC-123, include it as its own query.',
      ].join(' '),
      history.length > 0
        ? [
            `Previous conversation:\n${historyText(history)}`,
            topic.length > 0 ? `Sticky topic to keep in every query:\n${topic.slice(0, 4).join('\n')}` : '',
            `Latest question:\n${question}`,
          ]
            .filter(Boolean)
            .join('\n\n')
        : question,
    )

    const queries = Array.isArray(parsed?.queries)
      ? parsed.queries.filter((item): item is string => typeof item === 'string')
      : []
    const cursorDays =
      typeof parsed?.timeDays === 'number' && parsed.timeDays > 0
        ? Math.round(parsed.timeDays)
        : null
    const cursorTime: TimeWindow | null = cursorDays
      ? {
          label:
            typeof parsed?.timeLabel === 'string' && parsed.timeLabel.trim()
              ? parsed.timeLabel.trim()
              : `the last ${cursorDays} days`,
          jql: `updated >= -${cursorDays}d`,
          days: cursorDays,
        }
      : null
    const window = cursorTime ?? time
    const cursorChange =
      typeof parsed?.changeIntent === 'boolean' ? parsed.changeIntent : changeIntent

    const merged = unique([
      ...extractIssueKeys(corpus),
      ...applyStickyTopic(queries, topic),
      ...fallback,
    ])
    return {
      queries: (merged.length > 0 ? merged : [searchText.trim()]).slice(0, MAX_QUERIES),
      updatedJql: window?.jql ?? null,
      timeLabel: window?.label ?? null,
      timeDays: window?.days ?? null,
      changeIntent: cursorChange,
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
  pages: ConfluencePageDetail[],
  env: Record<string, string>,
  timeLabel: string | null,
  outsideWindow: boolean,
  history: ConversationTurn[],
): Promise<string> {
  const fallback = synthesizeHeuristic(question, issues, pages, timeLabel, outsideWindow, history)

  if (issues.length === 0 && pages.length === 0) return fallback

  try {
    const parsed = await chatJson(
      env,
      [
        'Answer the user using only the Jira issues and Confluence pages provided and the prior conversation.',
        'Treat this as one ongoing thread: keep the same system/product from earlier questions unless the user switched.',
        'Return JSON: { "answer": string }.',
        'Write 2-5 short sentences in the same language as the question.',
        'Do not list issue keys or dump several tickets or page titles into one sentence.',
        'The UI already shows clickable lists of Jira issues and Confluence docs under your answer.',
        'If Confluence pages are present, say whether they document the asked topic.',
        'Mention who made the latest Jira change when that name is available.',
        'You may mention dates and what changed. Refer to "the issues below" and "the docs below" instead of enumerating titles.',
        'If the issues are outside the requested time window, say that clearly.',
        'Do not invent facts that are not in the issues or pages.',
      ].join(' '),
      [
        history.length > 0 ? `Previous conversation:\n${historyText(history)}` : '',
        `Question:\n${question}`,
        timeLabel ? `Requested time window: ${timeLabel}` : '',
        outsideWindow ? 'Note: no matches inside the time window; issues below are older.' : '',
        issues.length > 0
          ? `Jira issues:\n${issues.map(issueContext).join('\n\n')}`
          : 'Jira issues: none',
        pages.length > 0
          ? `Confluence pages:\n${pages.map(pageContext).join('\n\n')}`
          : 'Confluence pages: none',
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

function isIssueKeyQuery(query: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(query.trim())
}

async function searchConfluenceQuery(
  query: string,
  env: Record<string, string>,
): Promise<ConfluencePageDetail[]> {
  try {
    return await searchConfluencePages(query, env, RESULTS_PER_DOC_QUERY)
  } catch {
    return []
  }
}

async function searchConfluenceMerged(
  queries: string[],
  env: Record<string, string>,
): Promise<ConfluencePageDetail[]> {
  const docQueries = unique(queries.filter((query) => !isIssueKeyQuery(query)))
  const searchQueries = (docQueries.length > 0 ? docQueries : queries).slice(0, MAX_QUERIES)
  if (searchQueries.length === 0) return []

  const batches = await Promise.all(
    searchQueries.map((query) => searchConfluenceQuery(query, env)),
  )

  const seen = new Set<string>()
  const merged: ConfluencePageDetail[] = []

  for (const batch of batches) {
    for (const page of batch) {
      if (seen.has(page.id)) continue
      seen.add(page.id)
      merged.push(page)
      if (merged.length >= MAX_DOCS) return merged
    }
  }

  return merged
}

async function attachChangelogs(
  issues: JiraIssueDetail[],
  env: Record<string, string>,
  sinceDays: number | null,
): Promise<JiraIssueDetail[]> {
  if (issues.length === 0) return issues

  const detailed = await Promise.all(
    issues.slice(0, 8).map(async (issue) => {
      const info = await fetchRecentChanges(issue.id, env, sinceDays ?? undefined)
      return {
        ...issue,
        changes: info.lines,
        updatedBy: info.lastChangedBy || issue.updatedBy,
        updated: info.lastChangedAt || issue.updated,
      }
    }),
  )

  return [...detailed, ...issues.slice(8)]
}

export async function askJiraQuestion(
  question: string,
  env: Record<string, string>,
  history: ConversationTurn[] = [],
): Promise<AskResult> {
  await assertJiraAccess(env)

  const plan = await decomposeQuestion(question, env, history)
  const [jiraMatches, confluenceMatches] = await Promise.all([
    plan.queries.length > 0
      ? searchMerged(plan.queries, env, plan.updatedJql)
      : Promise.resolve([] as JiraIssueDetail[]),
    plan.queries.length > 0
      ? searchConfluenceMerged(plan.queries, env)
      : Promise.resolve([] as ConfluencePageDetail[]),
  ])

  let issues = jiraMatches
  let pages = confluenceMatches
  let outsideWindow = false

  if (issues.length === 0 && plan.updatedJql) {
    const older = await searchMerged(plan.queries, env)
    if (older.length > 0) {
      issues = older
      outsideWindow = true
    }
  }

  if (issues.length === 0) {
    const fallbackJql = inferFallbackJql(conversationCorpus(history, question), plan.updatedJql)
    if (fallbackJql) {
      try {
        issues = await searchJiraByJql(fallbackJql, env, MAX_ISSUES)
      } catch {
        issues = []
      }
    }
  }

  const [issuesWithChanges, pagesWithBodies] = await Promise.all([
    attachChangelogs(issues, env, plan.timeDays),
    attachPageBodies(pages, env).catch(() => pages),
  ])
  issues = issuesWithChanges
  pages = pagesWithBodies

  const answer = await synthesizeAnswer(
    question,
    issues,
    pages,
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
    docs: pages.map(toConfluenceDoc),
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
