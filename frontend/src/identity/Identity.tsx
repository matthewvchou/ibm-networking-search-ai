import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/** Who this browser says it is. Self-declared and unverified: there is no login. */
export interface Identity {
  id: string
  // Display name, kept so the header can show it without a request.
  name: string
}

export const IDENTITY_STORAGE_KEY = 'ibm-directory-me'
const GATE_SKIPPED_KEY = 'ibm-directory-gate-skipped'

/** Storage access throws outright in some privacy modes, so every read/write is guarded. */
function storedIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { id, name } = value as Record<string, unknown>
    return typeof id === 'string' && id && typeof name === 'string' ? { id, name } : null
  } catch {
    return null
  }
}

function storedGateSkipped(): boolean {
  try {
    return sessionStorage.getItem(GATE_SKIPPED_KEY) === '1'
  } catch {
    return false
  }
}

type IdentityValue = {
  identity: Identity | null
  // Whether the startup gate was dismissed for this browser session without picking anyone.
  isGateSkipped: boolean
  setIdentity: (identity: Identity) => void
  // Forgets who this browser is and brings the startup gate back.
  clearIdentity: () => void
  skipGate: () => void
}

const IdentityContext = createContext<IdentityValue | null>(null)

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentityState] = useState<Identity | null>(storedIdentity)
  const [isGateSkipped, setIsGateSkipped] = useState<boolean>(storedGateSkipped)

  const setIdentity = useCallback((next: Identity) => {
    setIdentityState(next)
    try {
      localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Not remembered across visits; it still holds for this one.
    }
  }, [])

  const clearIdentity = useCallback(() => {
    setIdentityState(null)
    setIsGateSkipped(false)
    try {
      localStorage.removeItem(IDENTITY_STORAGE_KEY)
      sessionStorage.removeItem(GATE_SKIPPED_KEY)
    } catch {
      // Nothing stored that could be left behind.
    }
  }, [])

  const skipGate = useCallback(() => {
    setIsGateSkipped(true)
    try {
      sessionStorage.setItem(GATE_SKIPPED_KEY, '1')
    } catch {
      // The gate just comes back on reload.
    }
  }, [])

  const value = useMemo(
    () => ({ identity, isGateSkipped, setIdentity, clearIdentity, skipGate }),
    [identity, isGateSkipped, setIdentity, clearIdentity, skipGate],
  )

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

export function useIdentity(): IdentityValue {
  const value = useContext(IdentityContext)
  if (!value) throw new Error('useIdentity must be used inside an IdentityProvider')
  return value
}
