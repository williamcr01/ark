import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router'

export const App = lazy(() => import('./App.tsx'))
export const DecksDashboard = lazy(() =>
  import('./pages/DecksDashboard.tsx').then((module) => ({ default: module.DecksDashboard })),
)

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/decks/new" element={<Navigate replace to="/" />} />
      <Route path="/decks" element={<DecksDashboard />} />
      <Route element={<App />}>
        <Route index element={null} />
        <Route path="decks/:deckId" element={null} />
      </Route>
      <Route path="/deck/:deckId" element={<App />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}
