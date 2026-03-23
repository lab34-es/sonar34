import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App.jsx'

// Mock all page components to avoid their side effects (fetch calls, socket.io, etc.)
vi.mock('../src/pages/AdminReposPage.jsx', () => ({
  default: () => <div data-testid="admin-repos-page">AdminReposPage</div>,
}))
vi.mock('../src/pages/AdminRepoDetailPage.jsx', () => ({
  default: () => <div data-testid="admin-repo-detail-page">AdminRepoDetailPage</div>,
}))
vi.mock('../src/pages/SearchPage.jsx', () => ({
  default: () => <div data-testid="search-page">SearchPage</div>,
}))
vi.mock('../src/pages/AdminJobsPage.jsx', () => ({
  default: () => <div data-testid="admin-jobs-page">AdminJobsPage</div>,
}))
vi.mock('../src/pages/AdminSettingsPage.jsx', () => ({
  default: () => <div data-testid="admin-settings-page">AdminSettingsPage</div>,
}))
vi.mock('../src/pages/CommitDiffPage.jsx', () => ({
  default: () => <div data-testid="commit-diff-page">CommitDiffPage</div>,
}))
// Mock TosModal to avoid localStorage side effects in routing tests
vi.mock('../src/components/TosModal.jsx', () => ({
  default: () => null,
}))

function renderApp(route = '/repos') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>
  )
}

describe('App routing', () => {
  it('renders AdminReposPage at /repos', () => {
    renderApp('/repos')
    expect(screen.getByTestId('admin-repos-page')).toBeInTheDocument()
  })

  it('renders AdminRepoDetailPage at /repos/workspace/slug', () => {
    renderApp('/repos/myworkspace/myrepo')
    expect(screen.getByTestId('admin-repo-detail-page')).toBeInTheDocument()
  })

  it('renders SearchPage at /search', () => {
    renderApp('/search')
    expect(screen.getByTestId('search-page')).toBeInTheDocument()
  })

  it('renders AdminJobsPage at /admin/jobs', () => {
    renderApp('/admin/jobs')
    expect(screen.getByTestId('admin-jobs-page')).toBeInTheDocument()
  })

  it('renders AdminSettingsPage at /admin/settings', () => {
    renderApp('/admin/settings')
    expect(screen.getByTestId('admin-settings-page')).toBeInTheDocument()
  })

  it('renders CommitDiffPage at /commit/workspace/repo/sha', () => {
    renderApp('/commit/workspace/repo/abc123')
    expect(screen.getByTestId('commit-diff-page')).toBeInTheDocument()
  })

  it('redirects unknown paths to /repos', async () => {
    renderApp('/unknown-path')
    await waitFor(() => {
      expect(screen.getByTestId('admin-repos-page')).toBeInTheDocument()
    })
  })

  it('redirects root path to /repos', async () => {
    renderApp('/')
    await waitFor(() => {
      expect(screen.getByTestId('admin-repos-page')).toBeInTheDocument()
    })
  })

  it('renders the Layout component with navigation', () => {
    renderApp('/repos')
    // Layout renders nav items
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Jobs')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})
