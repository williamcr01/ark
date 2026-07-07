import prettier from 'prettier'

import { generateArkOpenApiDocument } from './openapi-registry.ts'

const defaultOutputPath = new URL('../../openapi/ark.openapi.json', import.meta.url)

export async function serializeArkOpenApiDocument(
  document: ReturnType<typeof generateArkOpenApiDocument> = generateArkOpenApiDocument(),
  options: { filepath?: string } = {},
) {
  const filepath = options.filepath ?? defaultOutputPath.pathname
  const config = await prettier.resolveConfig(filepath)
  return prettier.format(JSON.stringify(document), {
    ...config,
    parser: 'json',
  })
}
