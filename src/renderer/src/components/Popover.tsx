import { useEffect, useRef, useState, type ReactNode } from 'react'

/** A button that toggles a small panel; closes on outside click or Escape. */
export function Popover({
  label,
  title,
  className,
  align = 'left',
  children
}: {
  label: ReactNode
  title?: string
  className?: string
  align?: 'left' | 'right'
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="popover" ref={ref}>
      <button className={`${className ?? ''}${open ? ' on' : ''}`} title={title} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && <div className={`popover-panel ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}
