import { Agent } from '@cursor/sdk'

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced?.[1] ?? text).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function cursorJson(
  env: Record<string, string>,
  prompt: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = env.CURSOR_API_KEY?.trim()
  if (!apiKey) return null

  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: env.CURSOR_MODEL?.trim() || 'composer-2.5' },
    tools: [],
    local: {
      cwd: process.cwd(),
      settingSources: [],
    },
  })

  if (result.status !== 'finished' || !result.result) return null
  return extractJsonObject(result.result)
}
