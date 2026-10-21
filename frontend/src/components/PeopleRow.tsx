import { useRef } from 'react'
import { IconButton } from '@carbon/react'
import { ChevronLeft, ChevronRight } from '@carbon/icons-react'
import type { Employee } from '../api/client'
import { EmployeeCard } from './EmployeeCard'

const CARD_WIDTH = 260
const GAP = 16
// How far an arrow button scrolls: three cards, so each press brings new people into view.
const SCROLL_STEP = 3 * (CARD_WIDTH + GAP)

interface PeopleRowProps {
  people: Employee[]
  onSelect: (id: string) => void
}

/** One horizontally scrolling row of employee cards, with arrow buttons for mouse users. */
export function PeopleRow({ people, onSelect }: PeopleRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  function scrollBy(direction: -1 | 1) {
    scrollerRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <IconButton label="Scroll left" kind="ghost" size="md" onClick={() => scrollBy(-1)}>
        <ChevronLeft size={20} />
      </IconButton>
      {/* scroll-snap keeps a swipe or wheel flick landing on a card edge. The scroller is a
          flex row, so every slot is as tall as the tallest card; each slot is a grid so its
          one item (the card) stretches to fill it - a flex column would leave the card at its
          own content height, which is what made the tiles uneven. */}
      <div
        ref={scrollerRef}
        style={{
          display: 'flex',
          gap: GAP,
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          flex: 1,
          minWidth: 0,
          paddingBottom: 8,
        }}
      >
        {people.map((person) => (
          <div
            key={person.id}
            style={{ flex: `0 0 ${CARD_WIDTH}px`, display: 'grid', scrollSnapAlign: 'start' }}
          >
            <EmployeeCard employee={person} onClick={() => onSelect(person.id)} />
          </div>
        ))}
      </div>
      <IconButton label="Scroll right" kind="ghost" size="md" onClick={() => scrollBy(1)}>
        <ChevronRight size={20} />
      </IconButton>
    </div>
  )
}
