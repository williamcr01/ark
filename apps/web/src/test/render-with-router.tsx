import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'

type RouterRenderOptions = Omit<RenderOptions, 'wrapper'> & {
  initialEntry?: string
  path?: string
}

export function renderWithRouter(
  ui: ReactElement,
  { initialEntry = '/decks/deck-1', path = '/decks/:deckId', ...options }: RouterRenderOptions = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={children} path={path} />
          <Route element={<div data-testid="decks-dashboard" />} path="/decks" />
          <Route element={children} path="/decks/new" />
        </Routes>
      </MemoryRouter>
    )
  }

  return render(ui, { wrapper: Wrapper, ...options })
}
