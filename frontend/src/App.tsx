import { Route, Routes } from 'react-router'
import { AppLayout } from './layouts/AppLayout'
import { SearchPage } from './pages/SearchPage'
import { EmployeeDetailPage } from './pages/EmployeeDetailPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ColorThemeProvider } from './theme/ColorTheme'

function App() {
  return (
    <ColorThemeProvider>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<SearchPage />} />
          <Route path="employee/:id" element={<EmployeeDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ColorThemeProvider>
  )
}

export default App
