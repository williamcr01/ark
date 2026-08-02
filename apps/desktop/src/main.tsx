import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { initializeDesktopSettings } from '@/lib/desktop-settings'

import './index.css'

export const App = lazy(() => import('./App.tsx'))
export const DecksDashboard = lazy(() =>
  import('./pages/DecksDashboard.tsx').then((module) => ({ default: module.DecksDashboard })),
)

void initializeDesktopSettings()
  .catch(() => undefined)
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
          <Suspense
            fallback={
              <div
                className="flex h-svh items-center justify-center bg-[var(--ark-canvas)] text-sm text-muted-foreground"
                role="status"
              >
                Loading Ark…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Navigate replace to="/decks" />} />
              <Route path="/decks" element={<DecksDashboard />} />
              <Route path="/decks/:deckId" element={<App />} />
              <Route path="*" element={<Navigate replace to="/decks" />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </StrictMode>,
    )
  })
