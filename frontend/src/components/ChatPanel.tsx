import { Tile } from '@carbon/react'
import { Chat } from '@carbon/icons-react'

// A layout slot, not a feature: the right-hand column is reserved for the assistant, and
// until that exists this says so rather than leaving three fifths of the page blank.
// No props on purpose - nothing here is configurable yet.
export function ChatPanel() {
  return (
    <Tile
      style={{
        // Fills the row, whose height comes from the profile card beside it. The minHeight
        // carries the loading state, where the card is only a skeleton and a bare 100%
        // would collapse this tile and jolt the row when the profile lands.
        height: '100%',
        minHeight: 320,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: 'var(--text)',
      }}
    >
      <Chat size={32} />
      <p style={{ margin: 0 }}>Chat is not available yet.</p>
    </Tile>
  )
}
