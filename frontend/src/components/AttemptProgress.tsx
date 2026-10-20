import { InlineLoading } from '@carbon/react'
import { Checkmark, WarningAlt } from '@carbon/icons-react'
import type { SummaryProgress } from '../api/client'

const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontSize: 14 }

/**
 * One row per attempt as it happens - not a fixed set of steps, because most summaries
 * pass on the first or second try and a row for an attempt that never runs would mislead.
 */
export function AttemptProgress({ progress }: { progress: SummaryProgress }) {
  if (progress.status !== 'running') {
    return <InlineLoading description="Fetching their resume…" />
  }
  const attempts = Array.from({ length: progress.attempt }, (_, index) => index + 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} aria-live="polite">
      {attempts.map((attempt) => {
        const label = attempt === 1 ? 'Attempt 1 (first pass)' : `Attempt ${attempt} of up to ${progress.max_attempts}`
        const isGraded = attempt <= progress.scores.length
        if (!isGraded) {
          return <InlineLoading key={attempt} description={`${label}: ${describePhase(attempt, progress)}…`} />
        }
        const score = progress.scores[attempt - 1]
        return (
          <div key={attempt} style={rowStyle}>
            {score === null ? <WarningAlt size={16} /> : <Checkmark size={16} />}
            <span>{score === null ? `${label}: grader unavailable` : `${label}: scored ${score}%`}</span>
          </div>
        )
      })}
    </div>
  )
}

function describePhase(attempt: number, progress: SummaryProgress): string {
  if (progress.phase === 'verifying') return 'verifying'
  return attempt === 1 ? 'summarizing' : 'regenerating with feedback'
}
