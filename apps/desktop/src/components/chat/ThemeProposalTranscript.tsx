import { formatThemeFontPairingLabel } from '@/lib/chat/theme-fonts'
import { cn } from '@/lib/ui/utils'
import {
  parseThemeChoiceFonts,
  parseThemeChoiceName,
  type StoredThemeProposalRequest,
} from '@ark/chat/agent-themes.ts'

export function ThemeProposalTranscript({
  request,
  choiceContent,
}: {
  request: StoredThemeProposalRequest
  choiceContent?: string | null
}) {
  const chosenName = choiceContent ? parseThemeChoiceName(request, choiceContent) : null
  const chosenFonts = choiceContent ? parseThemeChoiceFonts(choiceContent) : null
  const answered = Boolean(chosenName)

  return (
    <details className="text-xs" open={answered}>
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        {answered ? `Chose theme: ${chosenName}` : `Proposed ${request.themes.length} themes`}
      </summary>
      {answered ? (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-4">
          {request.title ? (
            <p className="text-muted-foreground/80 text-[11px]">{request.title}</p>
          ) : null}
          {chosenFonts ? (
            <p className="text-muted-foreground text-[11px]">
              {formatThemeFontPairingLabel(chosenFonts)}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            {request.themes.map((theme) => (
              <li
                className={cn(theme.name === chosenName && 'font-medium text-foreground')}
                key={theme.id}
              >
                {theme.name}
                {theme.name === chosenName ? ' (selected)' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  )
}
