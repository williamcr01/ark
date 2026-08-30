import { randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const MCP_DISCOVERY_FILENAME = 'ark-mcp.json'

export const mcpDiscoverySchema = z.object({
  schemaVersion: z.literal(1),
  apiOrigin: z
    .string()
    .url()
    .refine((value) => new URL(value).hostname === '127.0.0.1'),
  pid: z.number().int().positive(),
  sessionCapability: z.string().min(32),
  startedAt: z.string(),
})

export type McpDiscovery = z.infer<typeof mcpDiscoverySchema>

export const mcpDiscoveryPath = (userDataDirectory: string) =>
  path.join(userDataDirectory, MCP_DISCOVERY_FILENAME)

export async function writeMcpDiscovery(filePath: string, discovery: McpDiscovery) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(discovery), { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, filePath)
}

export async function removeMcpDiscovery(filePath: string) {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export async function readMcpDiscovery(filePath: string) {
  const raw = await readFile(filePath, 'utf8')
  return mcpDiscoverySchema.parse(JSON.parse(raw))
}
