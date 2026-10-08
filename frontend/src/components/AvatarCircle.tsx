import { useState } from 'react'
import { getPhotoUrl } from '../api/photos'

interface AvatarCircleProps {
  // Employee id (CNUM); the photo URL derives from it alone.
  id: string
  // Display name, used for the initials fallback only.
  name: string
  // Rendered diameter in px.
  size: number
  // Carries the org chart's selected-card treatment onto the initials.
  isSelf?: boolean
}

function initialsOf(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (first + last).toUpperCase()
}

/** A circular profile photo, falling back to the employee's initials when there is none. */
export function AvatarCircle({ id, name, size, isSelf = false }: AvatarCircleProps) {
  const [failed, setFailed] = useState(false)
  const [failedId, setFailedId] = useState(id)

  // Rows and org-chart nodes are recycled across people, so a previous person's 404
  // must not hide the next one's photo.
  if (id !== failedId) {
    setFailedId(id)
    setFailed(false)
  }

  return (
    <div
      style={{
        position: 'relative',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.39),
        fontWeight: 600,
        color: isSelf ? '#fff' : 'var(--text-h)',
        background: isSelf ? 'var(--accent)' : 'var(--border)',
      }}
    >
      {initialsOf(name)}
      {/* Laid over the initials rather than swapped in, so nothing reflows on load.
          No crossOrigin: a plain <img> needs no CORS, and the service answers with
          allow-credentials plus a specific origin, which "anonymous" would break. */}
      {!failed && id && (
        <img
          src={getPhotoUrl(id, size * 2)}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
        />
      )}
    </div>
  )
}
