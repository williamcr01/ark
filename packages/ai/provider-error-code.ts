import { z } from 'zod'

/**
 * Failure codes this package can produce. `@ark/contracts` widens these with the
 * storage/workspace codes to form the HTTP-wide `apiErrorCodeSchema`.
 */
export const providerErrorCodeSchema = z.enum([
  'missing_api_key',
  'invalid_api_key',
  'provider_error',
])

export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>

export type ProviderErrorPayload = {
  error: string
  code: ProviderErrorCode
}
