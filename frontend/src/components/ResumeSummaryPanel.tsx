import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, InlineNotification, SkeletonText, Tile } from '@carbon/react'
import { Launch, Renew } from '@carbon/icons-react'
import { getSummary, getSummaryProgress, regenerateSummary, SummaryError } from '../api/client'
import type { ResumeSummary, ResumeSummaryResponse, SummaryProgress } from '../api/client'
import { AttemptProgress } from './AttemptProgress'
import { SummaryBody } from './SummaryBody'
import { ScoreTag, VerificationDetails } from './VerificationBanner'

interface ResumeSummaryPanelProps {
  employeeId: string
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: ResumeSummaryResponse }
  | { kind: 'no-resume' }
  | { kind: 'error'; message: string }

const POLL_INTERVAL_MS = 1000
const muted = { color: 'var(--text)' }
// Sets the accuracy check and Regenerate apart from the summary text above them.
const footerStyle = { borderTop: '1px solid var(--border)', paddingTop: 16 }

/**
 * The AI-generated resume summary for one employee. Fetches on its own, so the
 * profile and org chart never wait on the (slow) summary call.
 *
 * While that call runs, the first draft appears as soon as the backend has it, marked
 * "Verifying…", and each regeneration shows as its own progress row. Everything the model
 * wrote is rendered as plain text - never as HTML or Markdown - because resume text is
 * untrusted input to the model.
 */
export function ResumeSummaryPanel({ employeeId }: ResumeSummaryPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' })
  const [progress, setProgress] = useState<SummaryProgress | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const draftTextRef = useRef<string | null>(null)

  const isBusy = state.kind === 'loading' || isRegenerating
  usePolledProgress(employeeId, isBusy, setProgress)

  useEffect(() => {
    const controller = new AbortController()
    getSummary(employeeId, controller.signal)
      .then((data) => setState({ kind: 'loaded', data }))
      .catch((err) => {
        if (controller.signal.aborted) return
        if (err instanceof SummaryError && err.reason === 'no_resume') {
          setState({ kind: 'no-resume' })
          return
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' })
      })
    return () => controller.abort()
  }, [employeeId])

  // A draft whose text changes under the reader is explained, not swapped silently.
  const draft = progress?.draft ?? null
  useEffect(() => {
    if (!draft) return
    if (draftTextRef.current !== null && draftTextRef.current !== draft.summary) {
      setNotice('This summary was updated after a re-check scored higher.')
    }
    draftTextRef.current = draft.summary
  }, [draft])

  const regenerate = useCallback(async () => {
    setIsRegenerating(true)
    setNotice(null)
    try {
      const data = await regenerateSummary(employeeId)
      setState({ kind: 'loaded', data })
      if (!data.replaced) {
        setNotice(`The new attempt scored ${data.attempted_score ?? 'lower'}%, so the previous summary was kept.`)
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Regenerating failed.')
    } finally {
      setIsRegenerating(false)
    }
  }, [employeeId])

  return (
    <Tile style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Header state={state} />

      {state.kind === 'loading' && <LoadingBody progress={progress} draft={draft} />}
      {state.kind === 'no-resume' && <p style={{ ...muted, margin: 0 }}>No resume on file.</p>}
      {state.kind === 'error' && (
        <InlineNotification kind="warning" title="Summary unavailable" subtitle={state.message} hideCloseButton lowContrast />
      )}
      {state.kind === 'loaded' && (
        <>
          <SummaryBody summary={state.data.summary} />
          <div style={{ ...footerStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <ScoreTag verification={state.data.summary.verification} isVerifying={isRegenerating} />
            {!isRegenerating && (
              <Button kind="tertiary" size="xs" className="regenerate-button" renderIcon={Renew} onClick={regenerate} style={{ marginLeft: 'auto' }}>
                Regenerate
              </Button>
            )}
          </div>
          {isRegenerating && progress && <AttemptProgress progress={progress} />}
          <VerificationDetails verification={state.data.summary.verification} />
        </>
      )}
      {notice && (
        <InlineNotification kind="info" title="" subtitle={notice} hideCloseButton lowContrast onClose={() => setNotice(null)} />
      )}
    </Tile>
  )
}

function Header({ state }: { state: PanelState }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <h4 style={{ margin: 0, fontWeight: 600, color: 'var(--text-h)' }}>Resume Summary</h4>
      {state.kind === 'loaded' && (
        <a
          href={state.data.resume_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          View original resume <Launch size={14} />
        </a>
      )}
    </div>
  )
}

/** The skeleton until a draft exists, then the draft itself with the attempt rows beneath. */
function LoadingBody({ progress, draft }: { progress: SummaryProgress | null; draft: ResumeSummary | null }) {
  return (
    <>
      {draft ? (
        <>
          <SummaryBody summary={draft} />
          <div style={footerStyle}>
            <ScoreTag verification={draft.verification} isVerifying={!progress?.is_draft_verified} />
          </div>
          <VerificationDetails verification={draft.verification} />
        </>
      ) : (
        <SkeletonText paragraph lineCount={4} />
      )}
      {progress && <AttemptProgress progress={progress} />}
      {!draft && <p style={{ ...muted, margin: 0 }}>Summarizing their resume. This can take around 15 seconds.</p>}
    </>
  )
}

/** Polls the backend's progress board once a second while `isActive`, ignoring late replies. */
function usePolledProgress(
  employeeId: string,
  isActive: boolean,
  setProgress: (progress: SummaryProgress | null) => void,
) {
  useEffect(() => {
    if (!isActive) return
    const controller = new AbortController()
    const poll = () => {
      getSummaryProgress(employeeId, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setProgress(next)
        })
        .catch(() => {
          // Progress is cosmetic: a missed poll just leaves the last rows on screen.
        })
    }
    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [employeeId, isActive, setProgress])
}
