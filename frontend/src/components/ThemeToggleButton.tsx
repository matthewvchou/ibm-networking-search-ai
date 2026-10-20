import { IconButton } from '@carbon/react'
import { Asleep, Light } from '@carbon/icons-react'
import { useColorTheme } from '../theme/ColorTheme'

/** A light/dark toggle pinned to the bottom-right corner of the viewport on every page. */
export function ThemeToggleButton() {
  const { isDark, toggleTheme } = useColorTheme()

  return (
    <div style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 8000 }}>
      <IconButton
        label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        align="left"
        kind="secondary"
        size="lg"
        onClick={toggleTheme}
      >
        {isDark ? <Light size={20} /> : <Asleep size={20} />}
      </IconButton>
    </div>
  )
}
