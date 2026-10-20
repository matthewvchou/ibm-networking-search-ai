import type { ReactNode } from 'react'
import { Tag, Tile } from '@carbon/react'
import type { ResumeSummary } from '../api/client'

const mutedStyle = { color: 'var(--text)' }
// Carbon's default tag margins fight a flex gap, same as on the profile card.
const tagStyle = { margin: 0 }

type Experience = ResumeSummary['experience'][number]

/**
 * The summary text and the structured facts, in reading order: what they do, then
 * skills, experience, education and certifications. Every field is rendered as plain
 * text, never HTML or Markdown, because resume text is untrusted input to the model.
 */
export function SummaryBody({ summary }: { summary: ResumeSummary }) {
  return (
    <>
      {summary.summary && <p style={{ margin: 0, color: 'var(--text-h)' }}>{summary.summary}</p>}

      {summary.skills.length > 0 && (
        <Section title="Skills">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {summary.skills.map((group) => (
              <div key={group.category}>
                <div style={{ ...mutedStyle, fontSize: 12, marginBottom: 4 }}>{group.category}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {group.items.map((item) => (
                    <Tag key={item} type="blue" size="sm" style={tagStyle}>
                      {item}
                    </Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {summary.experience.length > 0 && (
        <Section title="Experience">
          <ExperienceTimeline experience={summary.experience} />
        </Section>
      )}

      {summary.education.length > 0 && (
        <Section title="Education">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {summary.education.map((edu) => (
              <Tile key={`${edu.degree}-${edu.institution}`} style={{ border: '1px solid var(--border)', padding: 12 }}>
                <div style={{ color: 'var(--text-h)', fontWeight: 600 }}>{edu.degree}</div>
                {edu.institution && <div style={mutedStyle}>{edu.institution}</div>}
                {edu.year && <div style={{ ...mutedStyle, fontSize: 12 }}>{edu.year}</div>}
              </Tile>
            ))}
          </div>
        </Section>
      )}

      {summary.certifications.length > 0 && (
        <Section title="Certifications">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {summary.certifications.map((cert) => (
              <Tag key={cert.name} type="teal" size="md" style={tagStyle}>
                {cert.year ? `${cert.name} · ${cert.year}` : cert.name}
              </Tag>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h5 style={{ margin: '0 0 8px', color: 'var(--text-h)' }}>{title}</h5>
      {children}
    </div>
  )
}

/** Most recent first, as the backend returns them; the open role gets a "Current" tag. */
function ExperienceTimeline({ experience }: { experience: Experience[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', borderLeft: '2px solid var(--border)', marginLeft: 5 }}>
      {experience.map((job, index) => {
        const isCurrent = job.start !== null && job.end === null
        return (
          <li
            key={`${job.role}-${job.organization}-${job.start}`}
            style={{ position: 'relative', paddingLeft: 16, paddingBottom: index === experience.length - 1 ? 0 : 16 }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: -7,
                top: 4,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: isCurrent ? 'var(--accent)' : 'var(--bg)',
                border: '2px solid var(--accent)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>{job.role}</span>
              {isCurrent && (
                <Tag type="green" size="sm" style={tagStyle}>
                  Current
                </Tag>
              )}
            </div>
            {job.organization && <div style={mutedStyle}>{job.organization}</div>}
            {job.start && (
              <div style={{ ...mutedStyle, fontSize: 12 }}>
                {job.start} – {job.end ?? 'Present'}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
