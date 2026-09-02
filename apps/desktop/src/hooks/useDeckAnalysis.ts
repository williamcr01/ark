import { useEffect, useMemo, useState } from 'react'

import { analyzeDeckInBrowser } from '@/lib/deck/deck-analysis'
import {
  startRevealThumbnailStylesPreload,
  waitForRevealThumbnailStylesPreload,
} from '@ark/runtime-registry/runtime-stylesheet-content.ts'
import { resolveAppOrigin } from '@ark/runtime-registry/sandbox-origin.ts'

import { useWorkspaceRuntimeContext } from './workspace-runtime-context'

export function useDeckAnalysis() {
  const { persistence } = useWorkspaceRuntimeContext()
  const generatedHtml = persistence.html
  const deckId = persistence.deckId
  const [thumbnailStylesRevision, setThumbnailStylesRevision] = useState(0)

  useEffect(() => {
    startRevealThumbnailStylesPreload()

    let cancelled = false
    void waitForRevealThumbnailStylesPreload().then(() => {
      if (!cancelled) {
        setThumbnailStylesRevision((value) => value + 1)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => {
    void thumbnailStylesRevision
    return analyzeDeckInBrowser(generatedHtml, { assetOrigin: resolveAppOrigin(), deckId })
  }, [deckId, generatedHtml, thumbnailStylesRevision])
}
