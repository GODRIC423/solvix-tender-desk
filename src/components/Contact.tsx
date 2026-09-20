import type { MouseEvent } from 'react'

const stop = (e: MouseEvent) => e.stopPropagation()

/** A phone number on a record should dial. Safe inside a clickable row. */
export function PhoneLink({
  phone,
  className = '',
}: {
  phone: string | null | undefined
  className?: string
}) {
  if (!phone) return null
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, '')}`}
      className={`hover:text-accent hover:underline ${className}`}
      onClick={stop}
    >
      {phone}
    </a>
  )
}

export function EmailLink({
  email,
  className = '',
}: {
  email: string | null | undefined
  className?: string
}) {
  if (!email) return null
  return (
    <a href={`mailto:${email}`} className={`hover:text-accent hover:underline ${className}`} onClick={stop}>
      {email}
    </a>
  )
}

/** The people line under a record's name: who to call, and how. */
export function ContactChips({
  role,
  name,
  phone,
  email,
}: {
  role?: string
  name: string | null | undefined
  phone: string | null | undefined
  email: string | null | undefined
}) {
  if (!name && !phone && !email) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
      {role && (
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{role}</span>
      )}
      {name && <span className="text-slate-200">{name}</span>}
      <PhoneLink phone={phone} />
      <EmailLink email={email} />
    </div>
  )
}
