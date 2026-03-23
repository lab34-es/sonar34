import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AdminReposPage from '../../src/pages/AdminReposPage.jsx'

const makeRepo = (overrides = {}) => ({
  name: 'workspace/my-repo',
  default_branch: 'main',
  last_seen_at: new Date().toISOString(),
  activity: JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
  technologies: JSON.stringify(['JavaScript', 'React']),
  open_prs: JSON.stringify({ new: 3, old: 1 }),
  security: JSON.stringify({ critical: 1, high: 2, moderate: 0, low: 0 }),
  dependencies_count: 42,
  path: '/tmp/repos/workspace/my-repo',
  ...overrides,
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminReposPage />
    </MemoryRouter>
  )
}

describe('AdminReposPage', () => {
  let fetchMock

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page title', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })
    renderPage()
    expect(screen.getByText('Repositories')).toBeInTheDocument()
  })

  it('shows Refresh and Sync buttons', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })
    renderPage()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
    expect(screen.getByText('Sync all from Bitbucket')).toBeInTheDocument()
  })

  it('fetches repos on mount and displays them', async () => {
    const repos = [
      makeRepo({ name: 'workspace/repo-alpha' }),
      makeRepo({ name: 'workspace/repo-beta', technologies: JSON.stringify(['Python']) }),
    ]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('repo-alpha')).toBeInTheDocument()
      expect(screen.getByText('repo-beta')).toBeInTheDocument()
    })
  })

  it('displays repository count', async () => {
    const repos = [makeRepo(), makeRepo({ name: 'workspace/other-repo' })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('2 / 2 repositories')).toBeInTheDocument()
    })
  })

  it('displays technology chips', async () => {
    const repos = [makeRepo({ technologies: JSON.stringify(['Python', 'Django']) })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Python')).toBeInTheDocument()
      expect(screen.getByText('Django')).toBeInTheDocument()
    })
  })

  it('displays PR counts', async () => {
    const repos = [makeRepo({ open_prs: JSON.stringify({ new: 5, old: 2 }) })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('displays security vulnerability counts', async () => {
    const repos = [makeRepo({ security: JSON.stringify({ critical: 3, high: 1, moderate: 0, low: 0 }) })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('3C')).toBeInTheDocument()
      expect(screen.getByText('1H')).toBeInTheDocument()
    })
  })

  it('displays dependency count', async () => {
    const repos = [makeRepo({ dependencies_count: 99 })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('99')).toBeInTheDocument()
    })
  })

  it('displays default branch chip', async () => {
    const repos = [makeRepo({ default_branch: 'develop' })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('develop')).toBeInTheDocument()
    })
  })

  it('filters repos by name', async () => {
    const user = userEvent.setup()
    const repos = [
      makeRepo({ name: 'workspace/frontend-app' }),
      makeRepo({ name: 'workspace/backend-api' }),
    ]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('frontend-app')).toBeInTheDocument()
      expect(screen.getByText('backend-api')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText('Search...')
    await user.type(searchInput, 'frontend')

    expect(screen.getByText('frontend-app')).toBeInTheDocument()
    expect(screen.queryByText('backend-api')).not.toBeInTheDocument()
    expect(screen.getByText('1 / 2 repositories')).toBeInTheDocument()
  })

  it('triggers sync-all when Sync button is clicked', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })

    renderPage()

    // Mock the POST response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: 'job-123' }),
    })

    await user.click(screen.getByText('Sync all from Bitbucket'))

    await waitFor(() => {
      expect(screen.getByText(/Sync job created: job-123/)).toBeInTheDocument()
    })

    const postCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === 'POST'
    )
    expect(postCall).toBeTruthy()
    expect(postCall[0]).toContain('/api/admin/sync-all')
  })

  it('Sync Actions button is disabled when no repos selected', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [makeRepo()],
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument()
    })

    const syncActionsBtn = screen.getByText(/Sync Actions/)
    expect(syncActionsBtn.closest('button')).toBeDisabled()
  })

  it('renders repo names as links', async () => {
    const repos = [makeRepo({ name: 'workspace/my-repo' })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      const link = screen.getByText('my-repo')
      expect(link.closest('a')).toHaveAttribute('href', '/repos/workspace/my-repo')
    })
  })

  it('renders the sparkline SVG for repos with activity', async () => {
    const repos = [makeRepo()]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => repos,
    })

    renderPage()

    await waitFor(() => {
      // Sparkline renders as an SVG with a polyline
      const polylines = document.querySelectorAll('polyline')
      expect(polylines.length).toBeGreaterThan(0)
    })
  })
})
