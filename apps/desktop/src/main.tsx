import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import { initializeDesktopSettings } from '@/lib/ui/desktop-settings'

import { AppRoutes } from './routes.tsx'
import './index.css'

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
            <AppRoutes />
          </Suspense>
        </BrowserRouter>
      </StrictMode>,
    )
  })
