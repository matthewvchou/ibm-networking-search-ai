import { InlineNotification } from '@carbon/react'

export function NotFoundPage() {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <InlineNotification kind="error" title="Not found" subtitle="That page doesn't exist." hideCloseButton />
    </div>
  )
}
