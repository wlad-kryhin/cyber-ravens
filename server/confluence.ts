import { featureTerms } from './systems.js'

export interface ConfluenceDoc {
  id: string
  title: string
  space: string
  url?: string
  excerpt?: string
  updated?: string
  updatedBy?: string
}

export interface ConfluencePageDetail extends ConfluenceDoc {
  type: string
  body: string
  spaceKey?: string
}

interface ConfluenceSearchResult {
  content?: {
    id?: string
    type?: string
    title?: string
    space?: { key?: string; name?: string }
    _links?: { webui?: string }
  }
  title?: string
  excerpt?: string
  url?: string
  lastModified?: string
  resultGlobalContainer?: { title?: string; displayUrl?: string }
}

function confluenceAuth(env: Record<string, string>) {
  const baseUrl = (env.CONFLUENCE_BASE_URL || env.JIRA_BASE_URL)?.replace(/\/$/, '')
  const email = env.CONFLUENCE_EMAIL || env.JIRA_EMAIL
  const token = env.CONFLUENCE_API_TOKEN || env.JIRA_API_TOKEN

  if (!baseUrl || !email || !token) {
    throw new Error(
      'Confluence is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN (same token works for Confluence).',
    )
  }

  return {
    baseUrl,
    wikiUrl: `${baseUrl}/wiki`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
      Accept: 'application/json',
    },
  }
}

function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildCql(
  query: string,
  modifiedCql?: string | null,
  spaceKey?: string,
  systems: string[] = [],
): string {
  const trimmed = query.trim()
  const system = systems[0]
  const rest = system ? featureTerms(trimmed, systems).join(' ') : trimmed
  const parts = ['type = page']

  if (spaceKey) {
    parts.push(`space = "${escapeCql(spaceKey)}"`)
  } else if (system) {
    parts.push(`title ~ "${escapeCql(system)}"`)
  }

  if (rest.trim().length > 1) {
    const escaped = escapeCql(rest.trim())
    parts.push(`(title ~ "${escaped}" OR text ~ "${escaped}")`)
  } else if (!system && trimmed.length > 1) {
    const escaped = escapeCql(trimmed)
    parts.push(`(title ~ "${escaped}" OR text ~ "${escaped}")`)
  }

  if (modifiedCql) parts.push(modifiedCql)
  return parts.join(' AND ')
}

export function htmlToText(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/@@@hl@@@|@@@endhl@@@/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function pageUrl(wikiUrl: string, result: ConfluenceSearchResult): string {
  const webui = result.content?._links?.webui || result.url
  if (webui) {
    return webui.startsWith('http') ? webui : `${wikiUrl}${webui}`
  }
  if (result.content?.id) {
    return `${wikiUrl}/pages/viewpage.action?pageId=${result.content.id}`
  }
  return wikiUrl
}

function mapSearchResult(
  result: ConfluenceSearchResult,
  wikiUrl: string,
): ConfluencePageDetail | null {
  const id = result.content?.id
  const title = htmlToText(result.content?.title || result.title || '')
  if (!id || !title) return null

  return {
    id,
    title,
    space: result.resultGlobalContainer?.title || result.content?.space?.name || '',
    url: pageUrl(wikiUrl, result),
    excerpt: htmlToText(result.excerpt || ''),
    updated: result.lastModified || '',
    updatedBy: '',
    type: result.content?.type === 'blogpost' ? 'Blog' : 'Page',
    body: '',
    spaceKey: result.content?.space?.key || '',
  }
}

export function toConfluenceDoc(page: ConfluencePageDetail): ConfluenceDoc {
  return {
    id: page.id,
    title: page.title,
    space: page.space,
    url: page.url,
    excerpt: page.excerpt ? `${page.excerpt.slice(0, 220).trim()}${page.excerpt.length > 220 ? '…' : ''}` : '',
    updated: page.updated,
    updatedBy: page.updatedBy,
  }
}

async function fetchPageBody(
  id: string,
  env: Record<string, string>,
): Promise<{ body: string; updatedBy: string; updated: string; space: string }> {
  const { wikiUrl, headers } = confluenceAuth(env)
  const params = new URLSearchParams({
    expand: 'body.storage,space,version,history.lastUpdated',
  })
  const response = await fetch(
    `${wikiUrl}/rest/api/content/${encodeURIComponent(id)}?${params}`,
    { headers },
  )

  if (!response.ok) {
    return { body: '', updatedBy: '', updated: '', space: '' }
  }

  const data = (await response.json()) as {
    body?: { storage?: { value?: string } }
    space?: { name?: string }
    version?: { when?: string; by?: { displayName?: string } }
    history?: { lastUpdated?: { when?: string; by?: { displayName?: string } } }
  }

  const last = data.history?.lastUpdated ?? data.version

  return {
    body: htmlToText(data.body?.storage?.value ?? ''),
    updatedBy: last?.by?.displayName ?? '',
    updated: last?.when ?? '',
    space: data.space?.name ?? '',
  }
}

export async function searchConfluenceByCql(
  cql: string,
  env: Record<string, string>,
  maxResults = 8,
): Promise<ConfluencePageDetail[]> {
  const { wikiUrl, headers } = confluenceAuth(env)
  const params = new URLSearchParams({
    cql,
    limit: String(maxResults),
    excerpt: 'highlight',
  })

  const response = await fetch(`${wikiUrl}/rest/api/search?${params}`, { headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Confluence request failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as { results?: ConfluenceSearchResult[] }
  return (data.results ?? [])
    .map((result) => mapSearchResult(result, wikiUrl))
    .filter((page): page is ConfluencePageDetail => page !== null)
}

export async function searchConfluencePages(
  query: string,
  env: Record<string, string>,
  maxResults = 8,
  modifiedCql?: string | null,
  systems: string[] = [],
): Promise<ConfluencePageDetail[]> {
  const spaceKey = env.CONFLUENCE_SPACE_KEY?.trim() || undefined
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  try {
    return await searchConfluenceByCql(
      buildCql(trimmed, modifiedCql, spaceKey, systems),
      env,
      maxResults,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('not configured')) throw error
  }

  try {
    const escaped = escapeCql(trimmed)
    const fallback = [
      'type = page',
      systems[0] ? `title ~ "${escapeCql(systems[0])}"` : '',
      `title ~ "${escaped}"`,
      spaceKey ? `space = "${escapeCql(spaceKey)}"` : '',
      modifiedCql ?? '',
    ]
      .filter(Boolean)
      .join(' AND ')
    return await searchConfluenceByCql(fallback, env, maxResults)
  } catch {
    return []
  }
}

export async function attachPageBodies(
  pages: ConfluencePageDetail[],
  env: Record<string, string>,
): Promise<ConfluencePageDetail[]> {
  if (pages.length === 0) return pages

  const detailed = await Promise.all(
    pages.slice(0, 5).map(async (page) => {
      const extra = await fetchPageBody(page.id, env)
      return {
        ...page,
        body: extra.body || page.body,
        excerpt: page.excerpt || extra.body.slice(0, 280),
        updatedBy: extra.updatedBy || page.updatedBy,
        updated: extra.updated || page.updated,
        space: extra.space || page.space,
      }
    }),
  )

  return [...detailed, ...pages.slice(5)]
}
