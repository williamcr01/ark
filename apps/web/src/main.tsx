import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import App from './App.tsx'
import { DecksDashboard } from './pages/DecksDashboard.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate replace to="/decks" />} />
        <Route path="/decks" element={<DecksDashboard />} />
        <Route path="/decks/:deckId" element={<App />} />
        <Route path="*" element={<Navigate replace to="/decks" />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
