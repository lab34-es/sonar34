import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SearchPage from '../../src/pages/SearchPage.jsx'

// Mock socket.io-client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
}
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>
  )
}

describe('SearchPage', () => {
  let fetchMock

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch')
    // Default: recent and favourites return empty
    fetchMock.mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/api/search/recent')) {
        return { ok: true, json: async () => [] }
      }
      if (urlStr.includes('/api/search/favourites')) {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => [] }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page title', () => {
    renderPage()
    // "Search" appears both as h3 title and button text
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
  })

  it('renders the search form with command selector', () => {
    renderPage()
    // The select button shows "Author" by default; there may also be a hidden option element
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    const authorElements = screen.getAllByText('Author')
    expect(authorElements.length).toBeGreaterThanOrEqual(1)
  })

  it('renders pattern input field', () => {
    renderPage()
    expect(screen.getByPlaceholderText('Search pattern...')).toBeInTheDocument()
  })

  it('renders repo filter input', () => {
    renderPage()
    expect(screen.getByPlaceholderText('Filter repos...')).toBeInTheDocument()
  })

  it('renders date from/to inputs', () => {
    renderPage()
    expect(screen.getByText('From')).toBeInTheDocument()
    expect(screen.getByText('To')).toBeInTheDocument()
  })

  it('renders the Search button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })

  it('fetches recent searches on mount', async () => {
    renderPage()

    await waitFor(() => {
      const recentCalls = fetchMock.mock.calls.filter(
        (c) => c[0].includes('/api/search/recent')
      )
      expect(recentCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('fetches favourite searches on mount', async () => {
    renderPage()

    await waitFor(() => {
      const favCalls = fetchMock.mock.calls.filter(
        (c) => c[0].includes('/api/search/favourites')
      )
      expect(favCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('emits search:start via socket when form is submitted', async () => {
    const user = userEvent.setup()
    renderPage()

    const patternInput = screen.getByPlaceholderText('Search pattern...')
    await user.type(patternInput, 'john doe')

    const searchBtn = screen.getByRole('button', { name: /search/i })
    await user.click(searchBtn)

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'search:start',
      expect.objectContaining({
        command: 'author',
        pattern: 'john doe',
      })
    )
  })

  it('does not emit search when pattern is empty', async () => {
    const user = userEvent.setup()
    renderPage()

    const searchBtn = screen.getByRole('button', { name: /search/i })
    await user.click(searchBtn)

    expect(mockSocket.emit).not.toHaveBeenCalled()
  })

  it('shows "No results found" when search completes with no results', async () => {
    const user = userEvent.setup()
    renderPage()

    const patternInput = screen.getByPlaceholderText('Search pattern...')
    await user.type(patternInput, 'nonexistent')

    // Capture the socket event handlers
    const searchBtn = screen.getByRole('button', { name: /search/i })
    await user.click(searchBtn)

    // Find the search:done handler and call it
    const doneHandler = mockSocket.on.mock.calls.find(
      (c) => c[0] === 'search:done'
    )
    expect(doneHandler).toBeTruthy()
    doneHandler[1]() // trigger search:done

    await waitFor(() => {
      expect(screen.getByText('No results found.')).toBeInTheDocument()
    })
  })

  it('displays search progress when searching', async () => {
    const user = userEvent.setup()
    renderPage()

    const patternInput = screen.getByPlaceholderText('Search pattern...')
    await user.type(patternInput, 'test')

    const searchBtn = screen.getByRole('button', { name: /search/i })
    await user.click(searchBtn)

    // Find and trigger the started handler
    const startedHandler = mockSocket.on.mock.calls.find(
      (c) => c[0] === 'search:started'
    )
    expect(startedHandler).toBeTruthy()
    startedHandler[1]({ total: 10 })

    // Find and trigger progress handler
    const progressHandler = mockSocket.on.mock.calls.find(
      (c) => c[0] === 'search:progress'
    )
    expect(progressHandler).toBeTruthy()
    progressHandler[1]({ searched: 5, total: 10, repoName: 'workspace/repo' })

    await waitFor(() => {
      expect(screen.getByText(/5 \/ 10 repos/)).toBeInTheDocument()
    })
  })

  it('displays error when search:error fires', async () => {
    const user = userEvent.setup()
    renderPage()

    const patternInput = screen.getByPlaceholderText('Search pattern...')
    await user.type(patternInput, 'test')

    const searchBtn = screen.getByRole('button', { name: /search/i })
    await user.click(searchBtn)

    // Find and trigger the error handler
    const errorHandler = mockSocket.on.mock.calls.find(
      (c) => c[0] === 'search:error'
    )
    expect(errorHandler).toBeTruthy()
    errorHandler[1]({ error: 'Git process failed' })

    await waitFor(() => {
      expect(screen.getByText('Git process failed')).toBeInTheDocument()
    })
  })

  it('displays favourite searches when they exist', async () => {
    fetchMock.mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/api/search/recent')) {
        return { ok: true, json: async () => [] }
      }
      if (urlStr.includes('/api/search/favourites')) {
        return {
          ok: true,
          json: async () => [
            { id: 1, term: 'author', search_pattern: 'alice', repos_filter: '' },
            { id: 2, term: 'content', search_pattern: 'TODO', repos_filter: 'myrepo' },
          ],
        }
      }
      return { ok: true, json: async () => [] }
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Favourite searches (2)')).toBeInTheDocument()
      expect(screen.getByText('alice')).toBeInTheDocument()
      expect(screen.getByText('TODO')).toBeInTheDocument()
    })
  })

  it('shows result count chip after receiving results', async () => {
    const user = userEvent.setup()
    renderPage()

    const patternInput = screen.getByPlaceholderText('Search pattern...')
    await user.type(patternInput, 'test')

    const searchBtn = screen.getByRole('button', { name: /search/i })
    await user.click(searchBtn)

    // Find and trigger the results handler
    const resultsHandler = mockSocket.on.mock.calls.find(
      (c) => c[0] === 'search:results'
    )
    expect(resultsHandler).toBeTruthy()
    resultsHandler[1]([
      { repo: 'workspace/repo1', commit: 'abc123', authorName: 'John', date: '2026-01-01', subject: 'Fix bug' },
      { repo: 'workspace/repo2', commit: 'def456', authorName: 'Jane', date: '2026-01-02', subject: 'Add feature' },
    ])

    await waitFor(() => {
      expect(screen.getByText('2 results (so far)')).toBeInTheDocument()
    })
  })

  it('creates persistent socket connection and disconnects on unmount', () => {
    const { unmount } = renderPage()
    // socket.io mock is created via io() which is called on mount
    unmount()
    expect(mockSocket.disconnect).toHaveBeenCalled()
  })
})
