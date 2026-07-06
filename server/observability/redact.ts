const API_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bANTHROPIC_API_KEY\s*=\s*\S+/gi,
  /\bOPENAI_API_KEY\s*=\s*\S+/gi,
  /\bGOOGLE_GENERATIVE_AI_API_KEY\s*=\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
]

const HTML_PREVIEW_MAX_CHARS = 120

export function redactSecrets(value: string) {
  let redacted = value

  for (const pattern of API_KEY_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED_SECRET]')
  }

  return redacted
}

export function summarizeHtml(html: string) {
  const trimmed = html.trim()

  if (!trimmed) {
    return { length: 0, preview: '' }
  }

  const preview =
    trimmed.length <= HTML_PREVIEW_MAX_CHARS
      ? trimmed
      : `${trimmed.slice(0, HTML_PREVIEW_MAX_CHARS)}…`

  return {
    length: trimmed.length,
    preview: redactSecrets(preview),
  }
}

export function redactHtml(html: unknown) {
  if (typeof html !== 'string') {
    return html
  }

  return summarizeHtml(html)
}

const SENSITIVE_FIELD_NAMES = new Set([
  'html',
  'currenthtml',
  'messages',
  'prompt',
  'system',
  'content',
  'body',
  'authorization',
  'apikey',
  'api_key',
  'openai_api_key',
  'anthropic_api_key',
  'google_generative_ai_api_key',
])

function isSensitiveFieldName(name: string) {
  const normalized = name.toLowerCase()

  if (SENSITIVE_FIELD_NAMES.has(normalized)) {
    return true
  }

  return normalized.includes('apikey') || normalized.includes('api_key')
}

export function redactForLogging(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[REDACTED_DEPTH]'
  }

  if (typeof value === 'string') {
    if (value.includes('<html') || value.includes('<!DOCTYPE')) {
      return summarizeHtml(value)
    }

    return redactSecrets(value)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactForLogging(entry, depth + 1))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  const redacted: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(record)) {
    if (isSensitiveFieldName(key)) {
      if (key.toLowerCase() === 'html' || key.toLowerCase() === 'currenthtml') {
        redacted[key] = redactHtml(entry)
        continue
      }

      if (key.toLowerCase() === 'messages' && Array.isArray(entry)) {
        redacted[key] = {
          count: entry.length,
          roles: entry
            .map((message) =>
              message && typeof message === 'object' && 'role' in message
                ? String((message as { role?: unknown }).role ?? 'unknown')
                : 'unknown',
            )
            .slice(0, 20),
        }
        continue
      }

      redacted[key] = '[REDACTED_FIELD]'
      continue
    }

    redacted[key] = redactForLogging(entry, depth + 1)
  }

  return redacted
}

export function sanitizeRuntimeErrorText(value: unknown, maxLength = 2_000) {
  if (typeof value !== 'string') {
    return ''
  }

  const normalized = [...value]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13
    })
    .join('')
    .trim()

  if (!normalized) {
    return ''
  }

  const redacted = redactSecrets(normalized)

  if (redacted.length <= maxLength) {
    return redacted
  }

  return `${redacted.slice(0, maxLength)}…`
}
