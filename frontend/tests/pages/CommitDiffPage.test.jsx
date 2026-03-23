import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CommitDiffPage from '../../src/pages/CommitDiffPage.jsx'

// Mock Monaco DiffEditor
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified, language }) => (
    <div data-testid="mock-diff-editor" data-language={language}>
      <div data-testid="diff-original">{original}</div>
      <div data-testid="diff-modified">{modified}</div>
    </div>
  ),
}))

const mockDiffData = {
  meta: {
    subject: 'Add new API endpoint',
    authorName: 'Bob Smith',
    date: '2026-03-15T14:30:00Z',
  },
  files: [
    {
      oldPath: 'server.js',
      newPath: 'server.js',
      status: 'modified',
      hunks: [
        {
          header: '@@ -5,3 +5,5 @@',
          lines: [
            ' app.get("/health", (req, res) => {',
            '+  console.log("health check")',
            '   res.json({ ok: true })',
            ' })',
            '+app.get("/status", (req, res) => res.json({ status: "up" }))',
          ],
        },
      ],
    },
    {
      oldPath: null,
      newPath: 'README.md',
      status: 'added',
      hunks: [
        {
          header: '@@ -0,0 +1,2 @@',
          lines: ['+# My Project', '+Hello world'],
        },
      ],
    },
  ],
}

function renderPage(path = '/commit/workspace/myrepo/abc123def') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/commit/*" element={<CommitDiffPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('CommitDiffPage', () => {
  let fetchMock

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches diff data based on URL params', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage('/commit/workspace/myrepo/abc123def')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/repos/workspace/myrepo/commits/abc123def/diff')
      )
    })
  })

  it('shows loading spinner initially', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('displays commit SHA (truncated to 10 chars)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage('/commit/workspace/myrepo/abc123def456')

    await waitFor(() => {
      expect(screen.getByText('abc123def4')).toBeInTheDocument()
    })
  })

  it('displays commit subject and author', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Add new API endpoint')).toBeInTheDocument()
      expect(screen.getByText(/Bob Smith/)).toBeInTheDocument()
    })
  })

  it('displays back link to the repo detail page', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage('/commit/workspace/myrepo/abc123')

    await waitFor(() => {
      const backLink = screen.getByText(/workspace\/myrepo/)
      expect(backLink.closest('a')).toHaveAttribute('href', '/repos/workspace/myrepo')
    })
  })

  it('displays file list in sidebar', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('2 files changed')).toBeInTheDocument()
      // server.js appears both in the sidebar file list and in the selected file header
      const serverMatches = screen.getAllByText('server.js')
      expect(serverMatches.length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
  })

  it('shows status chips for each file', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('M')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })
  })

  it('renders the Monaco DiffEditor with correct language', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage()

    await waitFor(() => {
      const editor = screen.getByTestId('mock-diff-editor')
      expect(editor).toBeInTheDocument()
      expect(editor.getAttribute('data-language')).toBe('javascript')
    })
  })

  it('shows error alert when fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument()
    })
  })

  it('shows empty state when no files changed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ meta: mockDiffData.meta, files: [] }),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No file changes found for this commit.')).toBeInTheDocument()
    })
  })

  it('allows selecting a different file from the sidebar', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('README.md'))

    const editor = screen.getByTestId('mock-diff-editor')
    expect(editor.getAttribute('data-language')).toBe('markdown')
  })
})
