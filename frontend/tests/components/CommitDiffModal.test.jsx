import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommitDiffModal from '../../src/components/CommitDiffModal.jsx'

// Mock Monaco DiffEditor — it requires a real browser environment
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
    subject: 'Fix login validation',
    authorName: 'Jane Dev',
    date: '2026-03-20T10:00:00Z',
  },
  files: [
    {
      oldPath: 'src/auth.js',
      newPath: 'src/auth.js',
      status: 'modified',
      hunks: [
        {
          header: '@@ -10,4 +10,5 @@',
          lines: [
            ' const validate = (user) => {',
            '-  return user.name',
            '+  return user.name && user.email',
            '+  // added email check',
            ' }',
          ],
        },
      ],
    },
    {
      oldPath: null,
      newPath: 'src/utils.js',
      status: 'added',
      hunks: [
        {
          header: '@@ -0,0 +1,3 @@',
          lines: ['+export function helper() {', '+  return true', '+}'],
        },
      ],
    },
  ],
}

describe('CommitDiffModal', () => {
  let fetchMock

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render when open is false', () => {
    render(
      <CommitDiffModal open={false} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )
    expect(screen.queryByText('abc123')).not.toBeInTheDocument()
  })

  it('fetches diff data when opened', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123def" />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/repos/workspace/repo/commits/abc123def/diff')
      )
    })
  })

  it('shows loading spinner while fetching', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('displays commit metadata after loading', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123def456" />
    )

    await waitFor(() => {
      expect(screen.getByText('abc123def4')).toBeInTheDocument()
      expect(screen.getByText('Fix login validation')).toBeInTheDocument()
    })
  })

  it('displays file list in sidebar', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )

    await waitFor(() => {
      expect(screen.getByText('2 files changed')).toBeInTheDocument()
      // src/auth.js appears both in the sidebar file list and in the selected file header
      const authMatches = screen.getAllByText('src/auth.js')
      expect(authMatches.length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('src/utils.js')).toBeInTheDocument()
    })
  })

  it('shows status chips (M for modified, A for added)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )

    await waitFor(() => {
      expect(screen.getByText('M')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })
  })

  it('renders the Monaco DiffEditor', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )

    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-editor')).toBeInTheDocument()
    })
  })

  it('shows error alert when fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Commit not found' }),
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )

    await waitFor(() => {
      expect(screen.getByText('Commit not found')).toBeInTheDocument()
    })
  })

  it('shows empty state when commit has no file changes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ meta: mockDiffData.meta, files: [] }),
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )

    await waitFor(() => {
      expect(screen.getByText('No file changes found for this commit.')).toBeInTheDocument()
    })
  })

  it('selects a different file when clicked', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffData,
    })

    render(
      <CommitDiffModal open={true} onClose={vi.fn()} repo="workspace/repo" sha="abc123" />
    )

    await waitFor(() => {
      expect(screen.getByText('src/utils.js')).toBeInTheDocument()
    })

    // Click the second file
    await user.click(screen.getByText('src/utils.js'))

    // The diff editor should now show the content for the new file
    const editor = screen.getByTestId('mock-diff-editor')
    expect(editor.getAttribute('data-language')).toBe('javascript')
  })
})
