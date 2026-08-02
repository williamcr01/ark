import { describe, expect, it } from 'vitest'

import { getRendererContentSecurityPolicy } from './renderer-security.ts'

describe('renderer security policy', () => {
  it('allows inline styles without allowing inline scripts', () => {
    const policy = getRendererContentSecurityPolicy('http://127.0.0.1:5174')
    const directives = new Map(
      policy.split(';').map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/)
        return [name, values]
      }),
    )

    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('style-src')).toContain("'unsafe-inline'")
    expect(directives.get('frame-src')).toEqual(['http://127.0.0.1:5174'])
  })
})
