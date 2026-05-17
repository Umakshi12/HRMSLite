import { useEffect, useState } from 'react'
import { checkSession } from './lib/api'
import useStore from './lib/store'
import LoginPage from './pages/LoginPage'
import Dashboard from './pages/Dashboard'
import { Toaster } from 'sonner'

export default function App() {
  const { user, setAuth, clearAuth } = useStore()
  const [initializing, setInitializing] = useState(true)
  
  useEffect(() => {
    // SECURITY: Restore session from HttpOnly cookie on load
    const restoreSession = async () => {
      try {
        const res = await checkSession()
        if (res.success && res.user) {
          setAuth(res.user)
        }
      } catch (err) {
        console.log('[Auth] No active session found')
        clearAuth()
      } finally {
        setInitializing(false)
      }
    }
    
    // Check if we have a persisted user hint to avoid unnecessary calls (optional optimization)
    const userHint = sessionStorage.getItem('sheetsync_user')
    if (userHint) {
      restoreSession()
    } else {
      setInitializing(false)
    }
  }, [setAuth, clearAuth])

  if (initializing) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
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
