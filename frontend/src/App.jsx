import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import TosModal from './components/TosModal.jsx'
import SearchPage from './pages/SearchPage.jsx'
import AdminJobsPage from './pages/AdminJobsPage.jsx'
import AdminReposPage from './pages/AdminReposPage.jsx'
import AdminRepoDetailPage from './pages/AdminRepoDetailPage.jsx'
import AdminSettingsPage from './pages/AdminSettingsPage.jsx'
import CommitDiffPage from './pages/CommitDiffPage.jsx'

export default function App() {
  return (
    <>
      <TosModal />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/repos" element={<AdminReposPage />} />
          <Route path="/repos/*" element={<AdminRepoDetailPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/admin/jobs" element={<AdminJobsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/commit/*" element={<CommitDiffPage />} />
          <Route path="*" element={<Navigate to="/repos" replace />} />
        </Route>
      </Routes>
    </>
  )
}
