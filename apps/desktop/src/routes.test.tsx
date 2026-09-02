import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, useParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AppRoutes } from './routes.tsx'

vi.mock('./App.tsx', () => ({
  default: function MockApp() {
    const { deckId } = useParams()
    return <div>{deckId ? `Editor ${deckId}` : 'Creation workspace'}</div>
  },
}))

vi.mock('./pages/DecksDashboard.tsx', () => ({
  DecksDashboard: () => <div>Slides library</div>,
}))

function renderRoutes(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Suspense fallback={<div>Loading</div>}>
        <AppRoutes />
      </Suspense>
    </MemoryRouter>,
  )
}

describe('AppRoutes', () => {
  it('opens the creation workspace at /', async () => {
    renderRoutes('/')
    expect(await screen.findByText('Creation workspace')).toBeInTheDocument()
  })

  it('opens the slides library at /decks', async () => {
    renderRoutes('/decks')
    expect(await screen.findByText('Slides library')).toBeInTheDocument()
  })

  it('redirects /decks/new to the creation workspace', async () => {
    renderRoutes('/decks/new')
    expect(await screen.findByText('Creation workspace')).toBeInTheDocument()
  })

  it('passes the deck id from /decks/:deckId into the workspace', async () => {
    renderRoutes('/decks/deck-42')
    expect(await screen.findByText('Editor deck-42')).toBeInTheDocument()
  })
})
