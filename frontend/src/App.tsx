import { Route, Routes } from 'react-router'
import { AppLayout } from './layouts/AppLayout'
import { SearchPage } from './pages/SearchPage'
import { EmployeeDetailPage } from './pages/EmployeeDetailPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProfilePage } from './pages/ProfilePage'
import { IdentityProvider } from './identity/Identity'
import { ColorThemeProvider } from './theme/ColorTheme'

function App() {
  return (
    <ColorThemeProvider>
      <IdentityProvider>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<SearchPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="employee/:id" element={<EmployeeDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </IdentityProvider>
    </ColorThemeProvider>
  )
}

export default App
