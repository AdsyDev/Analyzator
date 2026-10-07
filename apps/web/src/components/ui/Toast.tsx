import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  message: string
}

const ToastContext = createContext<{ toast: (message: string) => void } | null>(null)
const DURATION_MS = 4000

/** Confirmări scurte, `role="status"`. Sticlă, fiindcă plutesc deasupra conținutului. */
export function ToastProvider({ children, duration = DURATION_MS }: { children: ReactNode; duration?: number }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const toast = useCallback(
    (message: string) => {
      const id = nextId.current++
      setItems((list) => [...list, { id, message }])
      const t = setTimeout(() => {
        timers.current.delete(t)
        setItems((list) => list.filter((i) => i.id !== id))
      }, duration)
      timers.current.add(t)
    },
    [duration],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2">
        {items.map((i) => (
          <div key={i.id} className="glass-strong pointer-events-auto rounded-xl px-4 py-2.5 text-[13.5px] text-text">
            {i.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast se folosește în interiorul ToastProvider')
  return ctx.toast
}
