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

/**
 * The grade tag, green from 80, yellow from 60, red below, with the claim count inside it and
 * an (i) beside it that explains the score. The explanation is a popup rather than a sentence
 * on the page, but it must stay one click away: a bare percentage reads as the model's
 * confidence in itself, which is not what it measures.
 */
export function ScoreTag({ verification, isVerifying }: ScoreTagProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <ScoreBadge verification={verification} isVerifying={isVerifying} />
      {!isVerifying && verification !== null && verification.score !== null && (
        <span style={{ fontSize: 12, color: 'var(--text)' }}>
          ({verification.supported_claims} of {verification.total_claims} claims supported)
        </span>
      )}
      <Toggletip align="bottom-left">
        <ToggletipButton label="About this score">
          <Information size={14} />
        </ToggletipButton>
        <ToggletipContent>
          <p>{describe(verification, isVerifying)}</p>
        </ToggletipContent>
      </Toggletip>
    </span>
  )
}

function ScoreBadge({ verification, isVerifying }: ScoreTagProps) {
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

/** Lists the claims the grader could not support; renders nothing when there are none. */
export function VerificationDetails({ verification }: { verification: Verification | null }) {
  if (!verification || verification.flagged_claims.length === 0) return null
  return (
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
  )
}

function describe(verification: Verification | null, isVerifying: boolean): string {
  if (isVerifying) return 'An AI grader is checking how well this summary matches the actual resume.'
  if (verification === null || verification.score === null) {
    return 'The AI grader could not check this summary against the actual resume.'
  }
  const rewrites = verification.attempts > 1 ? ` The summary was rewritten until attempt ${verification.attempts}.` : ''
  return (
    `A second AI model checked each claim in this summary against the resume text.${rewrites} ` +
    `It is that model's opinion, not a guarantee. Open the original resume to be sure.`
  )
}
