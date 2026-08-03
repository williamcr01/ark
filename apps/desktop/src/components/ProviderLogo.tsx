import claudeLogo from '@/assets/providers/claude-color.svg'
import geminiLogo from '@/assets/providers/gemini-color.svg'
import openaiLogo from '@/assets/providers/openai.svg'
import { cn } from '@/lib/utils'
import type { ProviderId } from '@ark/contracts'

const PROVIDER_LOGOS: Record<ProviderId, string> = {
  anthropic: claudeLogo,
  google: geminiLogo,
  openai: openaiLogo,
}

export function ProviderLogo({
  className,
  provider,
}: {
  className?: string
  provider: ProviderId
}) {
  return (
    <img
      alt=""
      aria-hidden
      className={cn('shrink-0 object-contain', provider === 'openai' && 'dark:invert', className)}
      data-provider-logo={provider}
      src={PROVIDER_LOGOS[provider]}
    />
  )
}
