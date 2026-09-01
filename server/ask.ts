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
  listJiraProjects,
  searchJiraIssuesDetailed,
  type BugTask,
  type JiraIssueDetail,
  type JqlOptions,
} from './jira.js'
import {
  detectStatusIntent,
  detectSystems,
  featureTerms,
  projectsForSystems,
  type StatusIntent,
} from './systems.js'

const MAX_QUERIES = 3
const MAX_ISSUES = 8
const MAX_DOCS = 4
const RESULTS_PER_QUERY = 8
const RESULTS_PER_DOC_QUERY = 5

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
  systems: string[]
  projectKeys: string[]
  updatedJql: string | null
  statusJql: string | null
  statusIntent: StatusIntent
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

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  ett: 1,
  en: 1,
  två: 2,
  tva: 2,
  tre: 3,
  fyra: 4,
  fem: 5,
  sex: 6,
  sju: 7,
  åtta: 8,
  atta: 8,
  nio: 9,
  tio: 10,
}

function parseAmount(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  return WORD_NUMBERS[value] ?? 0
}

function parseTimeWindow(question: string): TimeWindow | null {
  const q = question.toLowerCase()
  const numbered = q.match(
    /\b(?:last|past|senaste)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ett|en|två|tva|tre|fyra|fem|sex|sju|åtta|atta|nio|tio)\s+(day|days|week|weeks|month|months|year|years|dag|dagar|vecka|veckor|månad|manad|månader|manader|år|ar)\b/,
  )
  if (numbered) {
    const amount = parseAmount(numbered[1])
    const unit = numbered[2]
    const days = amount * (UNIT_DAYS[unit] ?? 1)
    if (amount > 0) {
      return {
        label: `the last ${amount} ${unit}`,
        jql: `updated >= -${days}d`,
        days,
      }
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
    statusName: issue.statusName,
    projectKey: issue.projectKey,
    resolution: issue.resolution,
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

function countByStatus(issues: JiraIssueDetail[]) {
  return {
    done: issues.filter((issue) => issue.status === 'done').length,
    wontDo: issues.filter((issue) => issue.status === 'wont-do').length,
    planned: issues.filter((issue) => issue.status === 'backlog' || issue.status === 'open').length,
    inProgress: issues.filter((issue) => issue.status === 'in-progress').length,
  }
}

function synthesizeHeuristic(
  question: string,
  issues: JiraIssueDetail[],
  pages: ConfluencePageDetail[],
  timeLabel: string | null,
  outsideWindow: boolean,
  history: ConversationTurn[] = [],
  systems: string[] = [],
  statusIntent: StatusIntent = 'any',
): string {
  const sv = isSwedish(`${history.map((turn) => turn.question).join(' ')} ${question}`)
  const topic = systems[0] || topicLabel(history, issues)
  const counts = countByStatus(issues)
  const when = dateLabel(issues.find((issue) => issue.status === 'done')?.updated ?? issues[0]?.updated)
  const who = issues.find((issue) => issue.status === 'done')?.updatedBy ?? issues[0]?.updatedBy

  if (issues.length === 0 && pages.length === 0) {
    if (sv) {
      return timeLabel
        ? `Nej — jag hittade inget i ${topic || 'Jira/Confluence'} ${timeLabel.replace('the last', 'den senaste')}.`
        : `Nej — jag hittade inga träffar${topic ? ` för ${topic}` : ''} som svarar på frågan.`
    }
    return timeLabel
      ? `No — I found nothing in ${topic || 'Jira/Confluence'} in ${timeLabel}.`
      : `No — I found nothing${topic ? ` for ${topic}` : ''} that answers this question.`
  }

  if (statusIntent === 'shipped' && counts.done > 0) {
    return sv
      ? `Ja — det finns ${counts.done} klara (Done) ärenden${topic ? ` i ${topic}` : ''}${timeLabel ? ` ${timeLabel.replace('the last', 'den senaste')}` : ''}. ${counts.wontDo ? `${counts.wontDo} är Won't do. ` : ''}${counts.inProgress || counts.planned ? `Det finns också pågående/planerat arbete. ` : ''}De listas nedan.`
      : `Yes — there are ${counts.done} completed (Done) issue${counts.done === 1 ? '' : 's'}${topic ? ` in ${topic}` : ''}${timeLabel ? ` in ${timeLabel}` : ''}. ${counts.wontDo ? `${counts.wontDo} are Won't do. ` : ''}${counts.inProgress || counts.planned ? `There is also in-progress or planned work. ` : ''}They are listed below.`
  }

  if (statusIntent === 'shipped' && counts.done === 0) {
    const extra = [
      counts.wontDo
        ? sv
          ? `Det finns ${counts.wontDo} ärende${counts.wontDo === 1 ? '' : 'n'} markerade Won't do (beslutat att inte göra).`
          : `${counts.wontDo} issue${counts.wontDo === 1 ? '' : 's'} are marked Won't do (decided against).`
        : '',
      counts.planned || counts.inProgress
        ? sv
          ? `Det finns planerat eller pågående arbete, men inget klart.`
          : `There is planned or in-progress work, but nothing completed.`
        : '',
      pages.length
        ? sv
          ? `Relaterad dokumentation listas nedan.`
          : `Related documentation is listed below.`
        : '',
    ]
      .filter(Boolean)
      .join(' ')

    return sv
      ? `Nej — inga klara (Done) ändringar${topic ? ` i ${topic}` : ''}${timeLabel ? ` ${timeLabel.replace('the last', 'den senaste')}` : ''}. ${extra}`.trim()
      : `No — no completed (Done) changes${topic ? ` in ${topic}` : ''}${timeLabel ? ` in ${timeLabel}` : ''}. ${extra}`.trim()
  }

  if (issues.length === 0) {
    return sv
      ? `Nej — inga Jira-ärenden${topic ? ` för ${topic}` : ''} som svarar på frågan. Det finns dokumentation i Confluence nedan.`
      : `No matching Jira issues${topic ? ` for ${topic}` : ''}. Related Confluence pages are listed below.`
  }

  const statusNote = sv
    ? `${counts.done} klara, ${counts.wontDo} won't do, ${counts.inProgress} pågående, ${counts.planned} planerade.`
    : `${counts.done} done, ${counts.wontDo} won't do, ${counts.inProgress} in progress, ${counts.planned} planned.`

  if (sv) {
    const lines: string[] = []
    if (outsideWindow && timeLabel) {
      lines.push(
        `Nej — inget matchade ${timeLabel.replace('the last', 'den senaste')}${topic ? ` för ${topic}` : ''}. Relaterade träffar utanför fönstret listas nedan.`,
      )
    } else {
      lines.push(
        `Jag hittade ${issues.length} ärende${issues.length === 1 ? '' : 'n'}${topic ? ` i ${topic}` : ''} som verkar svara på frågan. ${statusNote}`,
      )
    }
    if (when && who) lines.push(`Senaste klara/uppdaterade ärendet: ${when} av ${who}.`)
    else if (when) lines.push(`Senast uppdaterat ${when}.`)
    if (pages.length) lines.push('Relaterad dokumentation listas nedan.')
    return lines.join(' ')
  }

  const lines: string[] = []
  if (outsideWindow && timeLabel) {
    lines.push(
      `No — nothing matched in ${timeLabel}${topic ? ` for ${topic}` : ''}. Related hits outside that window are listed below.`,
    )
  } else {
    lines.push(
      `I found ${issues.length} issue${issues.length === 1 ? '' : 's'}${topic ? ` in ${topic}` : ''} that appear to answer the question. ${statusNote}`,
    )
  }
  if (when && who) lines.push(`Latest completed/updated issue: ${when} by ${who}.`)
  else if (when) lines.push(`Last updated ${when}.`)
  if (pages.length) lines.push('Related documentation is listed below.')
  return lines.join(' ')
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
    `Product: ${issue.product}${issue.projectKey ? ` (${issue.projectKey})` : ''}. Status: ${issue.statusName} (${issue.status})${issue.resolution ? `, resolution ${issue.resolution}` : ''}.`,
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

function statusJqlFor(intent: StatusIntent): string | null {
  if (intent === 'wont-do') {
    return 'status in ("Won\'t Do", "Won\'t do", "Wont do", "Wont be Done", "Wont fix", "Ei toteuteta", "Rejected", "Declined")'
  }
  if (intent === 'in-progress') return 'statusCategory = "In Progress"'
  if (intent === 'planned') return 'statusCategory != Done'
  return null
}

function matchesSystem(
  issue: JiraIssueDetail,
  systems: string[],
  projectKeys: string[],
): boolean {
  if (systems.length === 0 && projectKeys.length === 0) return true
  if (issue.projectKey && projectKeys.includes(issue.projectKey)) return true
  const hay = `${issue.product} ${issue.projectKey ?? ''}`.toLowerCase()
  return systems.some((system) => hay.includes(system.toLowerCase()))
}

function matchesStatusIntent(issue: JiraIssueDetail, intent: StatusIntent): boolean {
  if (intent === 'any') return true
  if (intent === 'shipped') return issue.status === 'done' || issue.status === 'wont-do'
  if (intent === 'wont-do') return issue.status === 'wont-do'
  if (intent === 'planned') return issue.status === 'backlog' || issue.status === 'open'
  if (intent === 'in-progress') return issue.status === 'in-progress'
  return true
}

function matchesAnyQuery(haystack: string, queries: string[], systems: string[]): boolean {
  const lists = queries
    .filter((query) => !/^[A-Z][A-Z0-9]+-\d+$/i.test(query.trim()))
    .map((query) => featureTerms(query, systems))
    .filter((terms) => terms.length > 0)
  if (lists.length === 0) return true
  const hay = haystack.toLowerCase()
  return lists.some((terms) => terms.every((term) => hay.includes(term.toLowerCase())))
}

function statusRank(status: JiraIssueDetail['status']): number {
  if (status === 'done') return 0
  if (status === 'in-progress') return 1
  if (status === 'wont-do') return 2
  if (status === 'open') return 3
  return 4
}

function filterIssues(
  issues: JiraIssueDetail[],
  plan: SearchPlan,
): JiraIssueDetail[] {
  const seen = new Set<string>()
  const scoped = issues.filter((issue) => {
    if (seen.has(issue.id)) return false
    seen.add(issue.id)
    return matchesSystem(issue, plan.systems, plan.projectKeys)
  })
  const byStatus =
    plan.statusIntent === 'shipped' || plan.statusIntent === 'any'
      ? scoped
      : scoped.filter((issue) => matchesStatusIntent(issue, plan.statusIntent))

  const topical = byStatus.filter((issue) =>
    matchesAnyQuery(`${issue.title} ${issue.description}`, plan.queries, plan.systems),
  )
  const chosen = topical.length > 0 ? topical : byStatus
  const terms = unique(plan.queries.flatMap((query) => featureTerms(query, plan.systems)))

  return chosen
    .sort((a, b) => {
      if (plan.statusIntent === 'shipped') {
        const byStatusRank = statusRank(a.status) - statusRank(b.status)
        if (byStatusRank !== 0) return byStatusRank
      }
      const aTitle = terms.filter((term) => a.title.toLowerCase().includes(term.toLowerCase())).length
      const bTitle = terms.filter((term) => b.title.toLowerCase().includes(term.toLowerCase())).length
      return bTitle - aTitle
    })
    .slice(0, MAX_ISSUES)
}

function filterPages(
  pages: ConfluencePageDetail[],
  plan: SearchPlan,
): ConfluencePageDetail[] {
  const scoped = pages.filter((page) => {
    if (plan.systems.length === 0) return true
    const hay = `${page.space} ${page.title}`.toLowerCase()
    return plan.systems.some((system) => hay.includes(system.toLowerCase()))
  })
  const topical = scoped.filter((page) =>
    matchesAnyQuery(`${page.title} ${page.excerpt ?? ''} ${page.body}`, plan.queries, plan.systems),
  )
  const chosen = topical.length > 0 ? topical : scoped
  const terms = unique(plan.queries.flatMap((query) => featureTerms(query, plan.systems)))

  return chosen
    .sort((a, b) => {
      const aTitle = terms.filter((term) => a.title.toLowerCase().includes(term.toLowerCase())).length
      const bTitle = terms.filter((term) => b.title.toLowerCase().includes(term.toLowerCase())).length
      return bTitle - aTitle
    })
    .slice(0, MAX_DOCS)
}

function applySystem(queries: string[], systems: string[]): string[] {
  const system = systems[0]
  if (!system) return queries

  return unique(
    queries.map((query) => {
      if (/^[A-Z][A-Z0-9]+-\d+$/i.test(query)) return query
      return query.toLowerCase().includes(system.toLowerCase()) ? query : `${system} ${query}`.trim()
    }),
  )
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
  projects: { key: string; name: string }[],
): Promise<SearchPlan> {
  const corpus = conversationCorpus(history, question)
  const time =
    parseTimeWindow(question) ??
    parseTimeWindow(history.map((turn) => turn.question).join(' ')) ??
    parseTimeWindow(history.map((turn) => turn.timeLabel ?? '').join(' '))
  const systems = detectSystems(corpus, projects)
  const projectKeys = projectsForSystems(systems, projects).map((project) => project.key)
  const searchText = history.length > 0 ? corpus : question
  const fallback = unique([
    ...applySystem(decomposeHeuristic(question), systems),
    ...extractIssueKeys(corpus),
  ]).slice(0, MAX_QUERIES)
  const changeIntent = hasChangeIntent(corpus)
  const statusIntent = detectStatusIntent(corpus)

  try {
    const parsed = await chatJson(
      env,
      [
        'Turn a natural-language support question into a Jira/Confluence search plan.',
        'This is a follow-up conversation when previous questions are provided.',
        'Keep the same product/system from earlier turns unless the user names a different one.',
        'Return JSON only: { "systems": string[], "queries": string[], "timeDays": number | null, "timeLabel": string | null, "statusIntent": "shipped"|"wont-do"|"planned"|"in-progress"|"any", "changeIntent": boolean }.',
        'systems: product names actually named (e.g. Varbi). Empty if none. Never add extra products.',
        'queries: 1-2 short feature phrases. If the user only asked whether a system changed recently, queries may be empty — do not search for the word "changes".',
        'Include the feature (e.g. login) when named. Do not put time words, "changes", "updated" or "made" into queries.',
        'statusIntent: shipped = the user asked what was changed/done; wont-do = declined work; planned = backlog; in-progress = currently being worked; any = unspecified.',
        'timeDays: 21 for last three weeks, 7/30/365 for week/month/year, otherwise null.',
        'If any message contains an issue key like ABC-123, include it as its own query.',
      ].join(' '),
      history.length > 0
        ? [
            `Previous conversation:\n${historyText(history)}`,
            systems.length > 0 ? `Detected system:\n${systems.join(', ')}` : '',
            `Latest question:\n${question}`,
          ]
            .filter(Boolean)
            .join('\n\n')
        : question,
    )

    const queries = Array.isArray(parsed?.queries)
      ? parsed.queries.filter((item): item is string => typeof item === 'string')
      : []
    const parsedSystems = Array.isArray(parsed?.systems)
      ? parsed.systems.filter((item): item is string => typeof item === 'string')
      : []
    const mergedSystems = unique([...systems, ...detectSystems(parsedSystems.join(' '), projects)])
    const mergedKeys = projectsForSystems(mergedSystems, projects).map((project) => project.key)
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
    const window = time ?? cursorTime
    const cursorChange =
      typeof parsed?.changeIntent === 'boolean' ? parsed.changeIntent : changeIntent
    const parsedIntent = parsed?.statusIntent
    const intent: StatusIntent =
      parsedIntent === 'shipped' ||
      parsedIntent === 'wont-do' ||
      parsedIntent === 'planned' ||
      parsedIntent === 'in-progress' ||
      parsedIntent === 'any'
        ? parsedIntent
        : statusIntent

    const merged = unique([
      ...extractIssueKeys(corpus),
      ...applySystem(queries, mergedSystems),
    ])
    const finalQueries = (merged.length > 0 ? merged : fallback).slice(0, MAX_QUERIES)
    return {
      queries: finalQueries.length > 0 ? finalQueries : [searchText.trim()],
      systems: mergedSystems,
      projectKeys: mergedKeys,
      updatedJql: window?.jql ?? null,
      statusJql: statusJqlFor(intent),
      statusIntent: intent,
      timeLabel: window?.label ?? null,
      timeDays: window?.days ?? null,
      changeIntent: cursorChange,
    }
  } catch {
    return {
      queries: fallback,
      systems,
      projectKeys,
      updatedJql: time?.jql ?? null,
      statusJql: statusJqlFor(statusIntent),
      statusIntent,
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
  systems: string[],
  statusIntent: StatusIntent,
): Promise<string> {
  const fallback = synthesizeHeuristic(
    question,
    issues,
    pages,
    timeLabel,
    outsideWindow,
    history,
    systems,
    statusIntent,
  )

  if (issues.length === 0 && pages.length === 0) return fallback

  try {
    const parsed = await chatJson(
      env,
      [
        'Answer using only the Jira issues and Confluence pages provided.',
        'Be strictly truthful. "No" is a good answer when the evidence does not support a yes.',
        'If a system was named, ignore anything that is not that system.',
        'If the user asked about changes in a time window, look at issues updated in that window for the named system.',
        'Done/Completed/Shipped = finished work. Won\'t Do = decided not to do, not a shipped change. Backlog/To Do = planned. In Progress = ongoing.',
        'If Done items exist in the window, the answer is yes, work was completed. Do not answer no.',
        'If there is only backlog/in-progress activity, say that tickets were updated but nothing is marked Done.',
        'Only answer no when there are no matching issues at all.',
        'Return JSON: { "answer": string }.',
        'Write 2-5 short sentences in the same language as the question.',
        'Do not enumerate issue keys or page titles; the UI lists them.',
        'Do not invent facts.',
      ].join(' '),
      [
        history.length > 0 ? `Previous conversation:\n${historyText(history)}` : '',
        `Question:\n${question}`,
        systems.length > 0 ? `Named system(s): ${systems.join(', ')}` : 'No specific system named.',
        `Status intent: ${statusIntent}`,
        timeLabel ? `Requested time window: ${timeLabel}` : '',
        outsideWindow ? 'Note: no matches inside the time window; items below are older.' : '',
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

function jiraQueryText(query: string, systems: string[]): string {
  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(query.trim())) return query.trim()
  return featureTerms(query, systems).join(' ')
}

async function searchTextQuery(
  query: string,
  env: Record<string, string>,
  options?: JqlOptions,
): Promise<JiraIssueDetail[]> {
  try {
    return await searchJiraIssuesDetailed(query, env, RESULTS_PER_QUERY, options)
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
  options?: JqlOptions,
  systems: string[] = [],
): Promise<JiraIssueDetail[]> {
  const texts = unique(queries.map((query) => jiraQueryText(query, systems)).filter(Boolean))
  const searchTexts = texts.length > 0 ? texts : ['']
  const batches = await Promise.all(
    searchTexts.map((query) => searchTextQuery(query, env, options)),
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
  systems: string[],
): Promise<ConfluencePageDetail[]> {
  try {
    return await searchConfluencePages(query, env, RESULTS_PER_DOC_QUERY, null, systems)
  } catch {
    return []
  }
}

async function searchConfluenceMerged(
  queries: string[],
  env: Record<string, string>,
  systems: string[],
): Promise<ConfluencePageDetail[]> {
  const docQueries = unique(queries.filter((query) => !isIssueKeyQuery(query)))
  const searchQueries = (docQueries.length > 0 ? docQueries : queries).slice(0, MAX_QUERIES)
  if (searchQueries.length === 0) return []

  const batches = await Promise.all(
    searchQueries.map((query) => searchConfluenceQuery(query, env, systems)),
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
  const projects = await listJiraProjects(env).catch(() => [])

  const plan = await decomposeQuestion(question, env, history, projects)
  const jqlOptions: JqlOptions = {
    updatedJql: plan.updatedJql,
    projectKeys: plan.projectKeys,
    statusJql: plan.statusJql,
  }

  const [recentMatches, doneMatches, confluenceMatches] = await Promise.all([
    plan.queries.length > 0 || plan.projectKeys.length > 0
      ? searchMerged(plan.queries, env, jqlOptions, plan.systems)
      : Promise.resolve([] as JiraIssueDetail[]),
    plan.statusIntent === 'shipped' && (plan.queries.length > 0 || plan.projectKeys.length > 0)
      ? searchMerged(
          plan.queries,
          env,
          { ...jqlOptions, statusJql: 'statusCategory = Done' },
          plan.systems,
        )
      : Promise.resolve([] as JiraIssueDetail[]),
    plan.queries.length > 0
      ? searchConfluenceMerged(plan.queries, env, plan.systems)
      : Promise.resolve([] as ConfluencePageDetail[]),
  ])

  const jiraMatches = [...doneMatches, ...recentMatches]

  let issues = filterIssues(jiraMatches, plan)
  let pages = filterPages(confluenceMatches, plan)
  let outsideWindow = false

  if (issues.length === 0 && plan.updatedJql) {
    const older = filterIssues(
      await searchMerged(
        plan.queries,
        env,
        {
          projectKeys: plan.projectKeys,
          statusJql: plan.statusJql,
        },
        plan.systems,
      ),
      plan,
    )
    if (older.length > 0) {
      issues = older
      outsideWindow = true
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
    plan.systems,
    plan.statusIntent,
  )

  const cleaned = unique(
    plan.queries
      .map((query) => jiraQueryText(query, plan.systems))
      .filter(Boolean),
  )
  const queries =
    cleaned.length > 0 ? cleaned : plan.systems.length > 0 ? plan.systems : plan.queries

  return {
    answer,
    queries,
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
