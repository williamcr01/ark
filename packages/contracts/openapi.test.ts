import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { generateArkOpenApiDocument } from './openapi-registry.ts'
import { serializeArkOpenApiDocument } from './openapi-serialize.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const specPath = path.join(repoRoot, 'openapi', 'ark.openapi.json')

describe('OpenAPI registry', () => {
  it('generates a document with core generation job paths', () => {
    const document = generateArkOpenApiDocument()

    expect(document.openapi).toBe('3.0.3')
    expect(document.paths?.['/api/generation-jobs']?.post).toBeTruthy()
    expect(document.paths?.['/api/generation-jobs/{id}']?.get).toBeTruthy()
    expect(document.paths?.['/api/generation-jobs/{id}/cancel']?.post).toBeTruthy()
    expect(document.paths?.['/api/generation-jobs/{id}/retry']?.post).toBeTruthy()
    expect(document.paths?.['/api/runtimes']?.get).toBeTruthy()
    expect(document.paths?.['/api/workspaces/open']?.post).toBeTruthy()
    expect(document.paths?.['/api/decks/{id}/duplicate']?.post).toBeTruthy()
    expect(document.paths?.['/api/decks/{id}/threads']?.get).toBeTruthy()
    expect(document.paths?.['/api/runtimes/{runtimeId}/{version}/{assetPath}']?.get).toBeTruthy()
    expect(document.paths?.['/api/deck-assets']?.get).toBeTruthy()
  })

  it('documents assetIds on job start but not on job responses', () => {
    const document = generateArkOpenApiDocument()
    const postOperation = document.paths?.['/api/generation-jobs']?.post
    const serialized = JSON.stringify(postOperation)

    expect(serialized).toContain('assetIds')
    expect(serialized).toContain('Job accepted (wire shape omits request messages and `assetIds`)')
  })

  it('matches the committed OpenAPI artifact', async () => {
    const generated = await serializeArkOpenApiDocument(generateArkOpenApiDocument(), {
      filepath: specPath,
    })
    const committed = readFileSync(specPath, 'utf8')

    expect(generated).toBe(committed)
  })

  it('documents theme proposal fonts as registry ids', () => {
    const document = generateArkOpenApiDocument()
    const schema = document.components?.schemas?.ThemeProposalRequest as
      | {
          properties?: {
            themes?: {
              items?: {
                properties?: {
                  fonts?: {
                    properties?: Record<string, { enum?: string[] }>
                    required?: string[]
                  }
                }
                required?: string[]
              }
            }
          }
        }
      | undefined

    const fonts = schema?.properties?.themes?.items?.properties?.fonts
    expect(schema?.properties?.themes?.items?.required).toContain('fonts')
    expect(fonts?.required).toEqual(expect.arrayContaining(['display', 'body', 'mono']))
    expect(fonts?.properties?.display?.enum).toEqual([
      'calibri',
      'arial',
      'cambria',
      'georgia',
      'times-new-roman',
      'courier-new',
    ])
    expect(fonts?.properties?.body?.enum).toEqual(fonts?.properties?.display?.enum)
    expect(fonts?.properties?.mono?.enum).toEqual(fonts?.properties?.display?.enum)
  })
})
