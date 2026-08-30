import { memo } from 'react'

import { DeckPreview } from '@/components/DeckPreview'

/** The preview re-renders on every shell state change otherwise; it is the most expensive child. */
export const MemoizedDeckPreview = memo(DeckPreview)
