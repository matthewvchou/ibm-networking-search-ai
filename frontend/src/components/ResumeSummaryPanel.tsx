import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Accordion, AccordionItem, InlineNotification, SkeletonText, Tag, Tile } from '@carbon/react'
import { Launch } from '@carbon/icons-react'
import { getSummary, SummaryError } from '../api/client'
import type { ResumeSummary, ResumeSummaryResponse } from '../api/client'

interface ResumeSummaryPanelProps {
  employeeId: string
}

type PanelState =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: ResumeSummaryResponse }
  | { kind: 'no-resume' }
  | { kind: 'error'; message: string }

const muted = { color: 'var(--text)' }

/**
 * The AI-generated resume summary for one employee. Fetches on its own, so the
 * profile and org chart never wait on the (slow) summary call.
 *
 * Everything the model wrote is rendered as plain text - never as HTML or Markdown -
 * because resume text is untrusted input to the model.
 */
export function ResumeSummaryPanel({ employeeId }: ResumeSummaryPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' })

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

  return (
    <Tile style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, color: 'var(--text-h)' }}>Resume summary</h4>
        <Tag type="purple" size="sm">
          AI-generated from resume
        </Tag>
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

      {state.kind === 'loading' && (
        <div>
          <SkeletonText paragraph lineCount={4} />
          <p style={{ ...muted, margin: 0 }}>Summarizing their resume. This can take around 10 seconds.</p>
        </div>
      )}
      {state.kind === 'no-resume' && <p style={{ ...muted, margin: 0 }}>No resume on file.</p>}
      {state.kind === 'error' && (
        <InlineNotification kind="warning" title="Summary unavailable" subtitle={state.message} hideCloseButton lowContrast />
      )}
      {state.kind === 'loaded' && <SummaryBody summary={state.data.summary} />}
    </Tile>
  )
}

function SummaryBody({ summary }: { summary: ResumeSummary }) {
  const { cv } = summary
  const hasCv = cv.experience.length + cv.skills.length + cv.education.length + cv.certifications.length > 0
  return (
    <>
      {summary.headline && <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-h)' }}>{summary.headline}</p>}
      {summary.summary && <p style={{ margin: 0, color: 'var(--text-h)' }}>{summary.summary}</p>}

      {summary.specialties.length > 0 && (
        <Section title="Specialties">
          {summary.specialties.map((s) => (
            <EvidenceItem key={s.name} label={s.name} evidence={s.evidence} />
          ))}
        </Section>
      )}
      {summary.ask_them_about.length > 0 && (
        <Section title="Ask them about">
          {summary.ask_them_about.map((a) => (
            <EvidenceItem key={a.topic} label={a.topic} evidence={a.evidence} />
          ))}
        </Section>
      )}

      {hasCv && (
        <Accordion align="start">
          <AccordionItem title="Full CV">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {cv.experience.length > 0 && (
                <Section title="Experience">
                  {cv.experience.map((e) => (
                    <li key={`${e.role}-${e.organization}-${e.start}`}>
                      <span style={{ color: 'var(--text-h)' }}>{[e.role, e.organization].filter(Boolean).join(' · ')}</span>
                      {e.start && <span style={muted}> — {e.start}–{e.end ?? 'present'}</span>}
                    </li>
                  ))}
                </Section>
              )}
              {cv.skills.length > 0 && (
                <Section title="Skills">
                  {cv.skills.map((g) => (
                    <li key={g.category}>
                      <span style={{ color: 'var(--text-h)' }}>{g.category}:</span>{' '}
                      <span style={muted}>{g.items.join(', ')}</span>
                    </li>
                  ))}
                </Section>
              )}
              {cv.education.length > 0 && (
                <Section title="Education">
                  {cv.education.map((e) => (
                    <li key={`${e.degree}-${e.institution}`}>
                      <span style={{ color: 'var(--text-h)' }}>{[e.degree, e.institution].filter(Boolean).join(', ')}</span>
                      {e.year && <span style={muted}> — {e.year}</span>}
                    </li>
                  ))}
                </Section>
              )}
              {cv.certifications.length > 0 && (
                <Section title="Certifications">
                  {cv.certifications.map((c) => (
                    <li key={c.name}>
                      <span style={{ color: 'var(--text-h)' }}>{c.name}</span>
                      {c.year && <span style={muted}> — {c.year}</span>}
                    </li>
                  ))}
                </Section>
              )}
            </div>
          </AccordionItem>
        </Accordion>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h5 style={{ margin: '0 0 8px', color: 'var(--text-h)' }}>{title}</h5>
      <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
      </ul>
    </div>
  )
}

function EvidenceItem({ label, evidence }: { label: string; evidence: string }) {
  return (
    <li>
      <span style={{ color: 'var(--text-h)' }}>{label}</span>
      {evidence && <span style={{ ...muted, fontSize: 12 }}> — {evidence}</span>}
    </li>
  )
}
