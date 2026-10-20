import { Accordion, AccordionItem, Tag, Toggletip, ToggletipButton, ToggletipContent } from '@carbon/react'
import { Information } from '@carbon/icons-react'
import type { Verification } from '../api/client'

/** The score at or above which a summary counts as accurate; mirrors the backend's pass mark. */
export const PASS_SCORE = 80
const WARN_SCORE = 60

type ScoreBand = 'pass' | 'warn' | 'fail'

function getScoreBand(score: number): ScoreBand {
  if (score >= PASS_SCORE) return 'pass'
  return score >= WARN_SCORE ? 'warn' : 'fail'
}

// Carbon's Tag has no yellow, so the middle band is styled by hand.
const WARN_STYLE = { margin: 0, background: '#f1c21b', color: '#161616' }

interface ScoreTagProps {
  verification: Verification | null
  isVerifying: boolean
}

/** The grade tag for the panel header: green from 80, yellow from 60, red below. */
export function ScoreTag({ verification, isVerifying }: ScoreTagProps) {
  if (isVerifying) {
    return (
      <Tag type="gray" size="sm" style={{ margin: 0 }}>
        Verifying…
      </Tag>
    )
  }
  if (verification === null || verification.score === null) {
    return (
      <Tag type="gray" size="sm" style={{ margin: 0 }}>
        Not Verified
      </Tag>
    )
  }
  const band = getScoreBand(verification.score)
  return (
    <Tag
      type={band === 'pass' ? 'green' : 'red'}
      size="sm"
      style={band === 'warn' ? WARN_STYLE : { margin: 0 }}
    >
      Accuracy Check: {verification.score}%
    </Tag>
  )
}

interface VerificationDetailsProps {
  verification: Verification | null
  isVerifying: boolean
}

/**
 * Says in words what the score is, and lists the claims the grader could not support.
 * The sentence is always visible rather than a tooltip: a bare percentage reads as the
 * model's confidence in itself, which is not what it measures.
 */
export function VerificationDetails({ verification, isVerifying }: VerificationDetailsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{describe(verification, isVerifying)}</span>
        <Toggletip align="bottom-left">
          <ToggletipButton label="About this score">
            <Information size={14} />
          </ToggletipButton>
          <ToggletipContent>
            <p>
              A second AI model checked each claim in this summary against the resume text. It is that model's
              opinion, not a guarantee. Open the original resume to be sure.
            </p>
          </ToggletipContent>
        </Toggletip>
      </p>
      {verification && verification.flagged_claims.length > 0 && (
        <Accordion align="start">
          <AccordionItem title={`${verification.flagged_claims.length} claims couldn't be verified`}>
            <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {verification.flagged_claims.map((flag) => (
                <li key={`${flag.section}-${flag.claim}`} style={{ color: 'var(--text-h)' }}>
                  <span style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{flag.section}: </span>
                  {flag.claim}
                  {flag.removed && <span style={{ color: 'var(--text)' }}> (removed from the summary)</span>}
                </li>
              ))}
            </ul>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  )
}

function describe(verification: Verification | null, isVerifying: boolean): string {
  if (isVerifying) return 'An AI grader is checking how well this summary matches the actual resume.'
  if (verification === null || verification.score === null) {
    return 'The AI grader could not check this summary against the actual resume.'
  }
  const rewrites = verification.attempts > 1 ? ` after ${verification.attempts} attempts` : ''
  return (
    `An AI grader scored how well this summary matches the actual resume ` +
    `(${verification.supported_claims} of ${verification.total_claims} claims supported${rewrites}).`
  )
}
