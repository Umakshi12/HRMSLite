import { useState, useEffect } from 'react'
import useStore from './lib/store'
import LoginPage from './pages/LoginPage'
import Dashboard from './pages/Dashboard'
import { Toaster } from 'sonner'

export default function App() {
  const { user, token, setAuth } = useStore()

  // Restore session from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('staffurs_token')
    const savedUser = sessionStorage.getItem('staffurs_user')
    if (saved && savedUser) {
      try {
        setAuth(JSON.parse(savedUser), saved)
      } catch { /* ignore corrupt storage */ }
    }
  }, [])

  if (!user || !token) {
    return (
      <>
        <Toaster position="top-right" richColors closeButton />
        <LoginPage />
      </>
    )
  }

  return (
    <>
      <Toaster position="top-right" richColors closeButton />
      <Dashboard />
    </>
  )
}
