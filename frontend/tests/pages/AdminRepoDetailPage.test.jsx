import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminRepoDetailPage from '../../src/pages/AdminRepoDetailPage.jsx'

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, language }) => (
    <div data-testid="mock-editor" data-language={language}>
      {value}
    </div>
  ),
}))

const mockRepo = {
  name: 'workspace/my-project',
  default_branch: 'main',
  last_seen_at: '2026-03-20T10:00:00Z',
  path: '/tmp/repos/workspace/my-project',
  technologies: JSON.stringify(['JavaScript', 'React', 'Node.js']),
  security: JSON.stringify({ critical: 2, high: 1, moderate: 3 }),
}

const mockBranches = [
  { name: 'main', lastCommitDate: '2026-03-20T10:00:00Z', author: 'Jane' },
  { name: 'develop', lastCommitDate: '2026-03-19T08:00:00Z', author: 'John' },
  { name: 'feature/auth', lastCommitDate: '2026-03-18T12:00:00Z', author: 'Alice' },
]

function renderPage(path = '/repos/workspace/my-project') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/repos/*" element={<AdminRepoDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminRepoDetailPage', () => {
  let fetchMock

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setupDefaultFetch() {
    fetchMock.mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/branches')) {
        return { ok: true, json: async () => mockBranches }
      }
      if (urlStr.includes('/commits')) {
        return { ok: true, json: async () => [] }
      }
      if (urlStr.includes('/dependencies')) {
        return { ok: true, json: async () => [] }
      }
      if (urlStr.includes('/security')) {
        return { ok: true, json: async () => [] }
      }
      if (urlStr.includes('/src')) {
        return { ok: true, json: async () => [] }
      }
      if (urlStr.includes('/file')) {
        return { ok: true, text: async () => '' }
      }
      // Default: repo metadata
      return { ok: true, json: async () => mockRepo }
    })
  }

  it('shows loading spinner while fetching repo', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('displays repo name and metadata after loading', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('workspace/my-project')).toBeInTheDocument()
    })

    // Default branch chip - "main" also appears in the branches tab
    const mainMatches = screen.getAllByText('main')
    expect(mainMatches.length).toBeGreaterThanOrEqual(1)

    // Technology chips
    expect(screen.getByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('Node.js')).toBeInTheDocument()
  })

  it('displays "Back to Repos" link', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      const backLink = screen.getByText(/Back to Repos/)
      expect(backLink.closest('a')).toHaveAttribute('href', '/repos')
    })
  })

  it('renders all five tabs', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Branches')).toBeInTheDocument()
      expect(screen.getByText('Contributions')).toBeInTheDocument()
      expect(screen.getByText('Dependencies')).toBeInTheDocument()
      expect(screen.getByText('Security')).toBeInTheDocument()
      expect(screen.getByText('Explore')).toBeInTheDocument()
    })
  })

  it('shows security count badge on Security tab', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      // Total security issues: 2 + 1 + 3 = 6
      expect(screen.getByText('6')).toBeInTheDocument()
    })
  })

  it('shows "Repository not found" when API returns error', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 404,
    }))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Repository not found')).toBeInTheDocument()
    })
  })

  it('loads Branches tab by default and shows branch data', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      // "main" appears in both the header chip and the branches table
      const mainMatches = screen.getAllByText('main')
      expect(mainMatches.length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('develop')).toBeInTheDocument()
      expect(screen.getByText('feature/auth')).toBeInTheDocument()
    })

    // Branch table headers
    expect(screen.getByText('Branch')).toBeInTheDocument()
    expect(screen.getByText('Last Commit')).toBeInTheDocument()
    expect(screen.getByText('Author')).toBeInTheDocument()
  })

  it('displays branch authors', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Jane')).toBeInTheDocument()
      expect(screen.getByText('John')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })
  })

  it('switches to Contributions tab on click', async () => {
    const user = userEvent.setup()
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('workspace/my-project')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Contributions'))

    await waitFor(() => {
      // Contributions tab shows time range controls
      expect(screen.getByText('Time range')).toBeInTheDocument()
    })
  })

  it('switches to Dependencies tab on click', async () => {
    const user = userEvent.setup()
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('workspace/my-project')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Dependencies'))

    await waitFor(() => {
      expect(screen.getByText('No dependencies found')).toBeInTheDocument()
    })
  })

  it('switches to Security tab and shows summary chips', async () => {
    const user = userEvent.setup()

    fetchMock.mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/branches')) {
        return { ok: true, json: async () => mockBranches }
      }
      if (urlStr.includes('/security')) {
        return {
          ok: true,
          json: async () => [
            { id: 1, severity: 'critical', dependency: 'lodash', version: '4.17.20', issue: 'Prototype pollution', url: '' },
          ],
        }
      }
      if (urlStr.includes('/commits')) {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => mockRepo }
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('workspace/my-project')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Security'))

    await waitFor(() => {
      expect(screen.getByText('2 critical')).toBeInTheDocument()
      expect(screen.getByText('1 high')).toBeInTheDocument()
      expect(screen.getByText('3 moderate')).toBeInTheDocument()
    })
  })

  it('displays Dependencies tab with dependency data', async () => {
    const user = userEvent.setup()

    fetchMock.mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/branches')) {
        return { ok: true, json: async () => mockBranches }
      }
      if (urlStr.includes('/dependencies')) {
        return {
          ok: true,
          json: async () => [
            { id: 1, dependency: 'react', version: '^19.2.4' },
            { id: 2, dependency: 'express', version: '^5.2.1' },
          ],
        }
      }
      if (urlStr.includes('/commits')) {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => mockRepo }
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('workspace/my-project')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Dependencies'))

    await waitFor(() => {
      expect(screen.getByText('react')).toBeInTheDocument()
      expect(screen.getByText('express')).toBeInTheDocument()
      expect(screen.getByText('^19.2.4')).toBeInTheDocument()
    })
  })

  it('displays last seen time', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/Last seen/)).toBeInTheDocument()
    })
  })

  it('displays the repo path', async () => {
    setupDefaultFetch()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/\/tmp\/repos\/workspace\/my-project/)).toBeInTheDocument()
    })
  })
})
