import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { safeStorage } from 'electron'
import { ALL_PROVIDERS, type ProviderId } from '@ark/contracts'

type CredentialFile = {
  version: 1
  providers: Partial<Record<ProviderId, string>>
}

async function assertSecureStorage() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error(
      process.platform === 'linux'
        ? 'A Secret Service keyring (such as GNOME Keyring, KWallet, or KeePassXC) must be running and unlocked to save provider keys.'
        : 'Operating-system secure storage is unavailable.',
    )
  }
}

export class SecureCredentialStore {
  private readonly keys = new Map<ProviderId, string>()
  private readonly sessionKeys = new Map<ProviderId, string>()
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load() {
    let file: CredentialFile
    let rawFile: string

    try {
      rawFile = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
      throw error
    }

    try {
      file = JSON.parse(rawFile) as CredentialFile
    } catch {
      // Keep a corrupt file untouched; a later successful save can replace it.
      return
    }

    if (file.version !== 1 || !file.providers) return

    try {
      await assertSecureStorage()
    } catch {
      return
    }

    const decryptedProviders = await Promise.all(
      ALL_PROVIDERS.map(async (provider) => {
        const encrypted = file.providers[provider]
        if (!encrypted) return null

        try {
          return {
            provider,
            ...(await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))),
          }
        } catch {
          // Ignore credentials that the current OS account can no longer decrypt.
          return null
        }
      }),
    )
    let shouldReEncrypt = false
    for (const decrypted of decryptedProviders) {
      if (!decrypted) continue
      this.keys.set(decrypted.provider, decrypted.result)
      shouldReEncrypt ||= decrypted.shouldReEncrypt
    }

    if (shouldReEncrypt) await this.persist()
  }

  getApiKey(provider: ProviderId) {
    return this.sessionKeys.get(provider) ?? this.keys.get(provider) ?? null
  }

  getStatus() {
    return Object.fromEntries(
      ALL_PROVIDERS.map((provider) => [
        provider,
        {
          configured: this.sessionKeys.has(provider) || this.keys.has(provider),
          storage: this.sessionKeys.has(provider)
            ? 'session'
            : this.keys.has(provider)
              ? 'persistent'
              : null,
        },
      ]),
    ) as Record<ProviderId, { configured: boolean; storage: 'persistent' | 'session' | null }>
  }

  async set(provider: ProviderId, apiKey: string) {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API key is required.')

    const previous = this.keys.get(provider)
    const previousSession = this.sessionKeys.get(provider)
    this.keys.set(provider, trimmed)
    try {
      await this.persist()
      this.sessionKeys.delete(provider)
    } catch (error) {
      if (previous === undefined) this.keys.delete(provider)
      else this.keys.set(provider, previous)
      if (previousSession !== undefined) this.sessionKeys.set(provider, previousSession)
      throw error
    }
  }

  setSession(provider: ProviderId, apiKey: string) {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API key is required.')
    this.sessionKeys.set(provider, trimmed)
  }

  async remove(provider: ProviderId) {
    const previous = this.keys.get(provider)
    const previousSession = this.sessionKeys.get(provider)
    this.keys.delete(provider)
    this.sessionKeys.delete(provider)

    if (previous === undefined) return

    try {
      await this.persist()
    } catch (error) {
      this.keys.set(provider, previous)
      if (previousSession !== undefined) this.sessionKeys.set(provider, previousSession)
      throw error
    }
  }

  private async persist() {
    await assertSecureStorage()
    const encryptedProviders = await Promise.all(
      [...this.keys].map(async ([provider, apiKey]) => [
        provider,
        (await safeStorage.encryptStringAsync(apiKey)).toString('base64'),
      ]),
    )
    const providers = Object.fromEntries(encryptedProviders) as CredentialFile['providers']

    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    await writeFile(
      temporaryPath,
      JSON.stringify({ version: 1, providers } satisfies CredentialFile, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
    await rename(temporaryPath, this.filePath)
  }
}
