export interface JiraProjectRef {
  key: string
  name: string
}

export type StatusIntent = 'shipped' | 'wont-do' | 'planned' | 'in-progress' | 'any'

const PRODUCT_ALIASES: Array<{ name: string; aliases: string[]; keys?: string[] }> = [
  { name: 'Varbi', aliases: ['varbi'], keys: ['GV', 'GVD', 'VDR'] },
  { name: 'Reachmee', aliases: ['reachmee'], keys: ['REAC'] },
  { name: 'Refensa', aliases: ['refensa'], keys: ['RF', 'REF'] },
  { name: 'Onecruiter', aliases: ['onecruiter', 'one cruiter'], keys: ['OC', 'OD'] },
  { name: 'Realcruit', aliases: ['realcruit'], keys: ['RC', 'RD'] },
  { name: 'TalentRekry', aliases: ['talentrekry', 'talent rekry'], keys: ['THRDEV', 'TRD', 'THRPM', 'TTT', 'THRTEST'] },
  { name: 'Kuntarekry', aliases: ['kuntarekry'], keys: ['KRDEV', 'KRMGM', 'KMA'] },
  { name: 'Grade Talent', aliases: ['grade talent'], keys: ['GT', 'GTD', 'GDO', 'GTP'] },
  { name: 'Grade Learning', aliases: ['grade learning'], keys: ['GL'] },
  { name: 'Jobadmin', aliases: ['jobadmin'], keys: ['JPD'] },
  { name: 'Jobbnorge', aliases: ['jobbnorge'], keys: ['JTS'] },
  { name: 'Hesu', aliases: ['hesu'], keys: ['HESUDEV', 'HESUPM'] },
  { name: 'Diip', aliases: ['diip'], keys: ['DDEV', 'DIMA', 'DD', 'DIIPTEST'] },
  { name: 'Intro', aliases: ['intro development', 'intro discovery', 'intro testing'], keys: ['INTRODEV', 'INTROPLAN', 'IT'] },
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasPhrase(text: string, phrase: string): boolean {
  const pattern = escapeRegex(phrase.trim()).replace(/\s+/g, '\\s+')
  return new RegExp(`\\b${pattern}\\b`, 'i').test(text)
}

export function detectSystems(text: string, projects: JiraProjectRef[] = []): string[] {
  const found: string[] = []

  for (const product of PRODUCT_ALIASES) {
    if (product.aliases.some((alias) => hasPhrase(text, alias))) {
      found.push(product.name)
    }
  }

  const sorted = [...projects].sort((a, b) => b.name.trim().length - a.name.trim().length)
  for (const project of sorted) {
    const name = project.name.trim()
    if (name.length < 5) continue
    if (hasPhrase(text, name)) found.push(name)
  }

  return [...new Set(found)]
}

export function projectsForSystems(
  systems: string[],
  projects: JiraProjectRef[],
): JiraProjectRef[] {
  if (systems.length === 0) return []

  const extraKeys = new Set<string>()
  for (const system of systems) {
    const product = PRODUCT_ALIASES.find(
      (item) => item.name.toLowerCase() === system.toLowerCase(),
    )
    for (const key of product?.keys ?? []) extraKeys.add(key.toUpperCase())
  }

  return projects.filter((project) => {
    if (extraKeys.has(project.key.toUpperCase())) return true
    const name = project.name.toLowerCase()
    return systems.some((system) => name.includes(system.toLowerCase()))
  })
}

export function featureTerms(query: string, systems: string[]): string[] {
  const skip = new Set([
    ...systems.map((system) => system.toLowerCase()),
    'change',
    'changes',
    'changed',
    'update',
    'updates',
    'updated',
    'made',
    'make',
    'any',
    'last',
    'past',
    'recent',
    'week',
    'weeks',
    'month',
    'months',
    'year',
    'years',
    'day',
    'days',
    'three',
    'two',
    'one',
    'have',
    'has',
    'did',
    'done',
    'work',
    'ändring',
    'ändringar',
    'andring',
    'andringar',
    'ändrat',
    'senaste',
    'vecka',
    'veckor',
    'månad',
    'manad',
    'tre',
    'två',
    'tva',
  ])
  return query
    .split(/\s+/)
    .map((term) => term.replace(/[?!.,:;()[\]{}]/g, '').trim())
    .filter((term) => term.length > 1 && !skip.has(term.toLowerCase()))
}

export function detectStatusIntent(question: string): StatusIntent {
  const q = question.toLowerCase()

  if (
    /\b(won'?t\s*do|wont\s*do|wont\s*fix|ei toteuteta|rejected|avvisad|avböjd|avbojd)\b/i.test(
      q,
    )
  ) {
    return 'wont-do'
  }

  if (
    /\b(planerat|planerade|planned|planning|backlog|roadmap|upcoming|kommande|att göra|todo|to[- ]do)\b/i.test(
      q,
    )
  ) {
    return 'planned'
  }

  if (/\b(pågående|pagaende|in progress|ongoing|currently working)\b/i.test(q)) {
    return 'in-progress'
  }

  if (
    /\b(change|changes|changed|update|updated|fix|fixed|deploy|released|shipped|done|klart|klara|ändr|andring|andrat|genomfört|genomfort)\b/i.test(
      q,
    )
  ) {
    return 'shipped'
  }

  return 'any'
}
