import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router'

export const App = lazy(() => import('./App.tsx'))
export const DecksDashboard = lazy(() =>
  import('./pages/DecksDashboard.tsx').then((module) => ({ default: module.DecksDashboard })),
)

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/decks" />} />
      <Route path="/decks" element={<DecksDashboard />} />
      <Route path="/decks/:deckId" element={<App />} />
      <Route path="/deck/:deckId" element={<App />} />
      <Route path="*" element={<Navigate replace to="/decks" />} />
    </Routes>
  )
}
