import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminJobsPage from '../../src/pages/AdminJobsPage.jsx'

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

const makeSyncJob = (overrides = {}) => ({
  id: 'sync-job-001-aaaa-bbbb-cccc-dddddddddddd',
  type: 'sync-all',
  repo_name: null,
  status: 'done',
  progress: JSON.stringify({ action: 'discovering' }),
  error: null,
  created_at: '2026-03-20T10:00:00',
  updated_at: '2026-03-20T10:05:00',
  ...overrides,
})

const makeEnrichJob = (overrides = {}) => ({
  id: 'enrich-job-002-aaaa-bbbb-cccc-dddddddddddd',
  type: 'enrich-activity',
  repo_name: 'workspace/repo1',
  status: 'running',
  error: null,
  created_at: '2026-03-20T11:00:00',
  updated_at: '2026-03-20T11:02:00',
  ...overrides,
})

const makeSearchJob = (overrides = {}) => ({
  id: 'search-job-003-aaaa-bbbb-cccc-dddddddddddd',
  command: 'author',
  pattern: 'john',
  status: 'done',
  error: null,
  created_at: '2026-03-20T12:00:00',
  updated_at: '2026-03-20T12:01:00',
  ...overrides,
})

describe('AdminJobsPage', () => {
  let fetchMock

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetchForQueues({
    sync = { rows: [], total: 0, offset: 0 },
    enrichment = { rows: [], total: 0, offset: 0 },
    search = { rows: [], total: 0, offset: 0 },
  } = {}) {
    fetchMock.mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('queue=sync_jobs')) {
        return { ok: true, json: async () => sync }
      }
      if (urlStr.includes('queue=enrichment_jobs')) {
        return { ok: true, json: async () => enrichment }
      }
      if (urlStr.includes('queue=search_jobs')) {
        return { ok: true, json: async () => search }
      }
      return { ok: true, json: async () => ({ rows: [], total: 0, offset: 0 }) }
    })
  }

  it('renders the page title', async () => {
    mockFetchForQueues()
    render(<AdminJobsPage />)
    expect(screen.getByText('Jobs')).toBeInTheDocument()
  })

  it('renders all three queue tabs', async () => {
    mockFetchForQueues()
    render(<AdminJobsPage />)
    expect(screen.getByText('Sync Jobs')).toBeInTheDocument()
    expect(screen.getByText('Enrichment Jobs')).toBeInTheDocument()
    expect(screen.getByText('Search Jobs')).toBeInTheDocument()
  })

  it('fetches all three queues on mount', async () => {
    mockFetchForQueues()
    render(<AdminJobsPage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls.some((u) => u.includes('queue=sync_jobs'))).toBe(true)
    expect(urls.some((u) => u.includes('queue=enrichment_jobs'))).toBe(true)
    expect(urls.some((u) => u.includes('queue=search_jobs'))).toBe(true)
  })

  it('displays sync job rows', async () => {
    const job = makeSyncJob()
    mockFetchForQueues({
      sync: { rows: [job], total: 1, offset: 0 },
    })

    render(<AdminJobsPage />)

    await waitFor(() => {
      expect(screen.getByText('sync-all')).toBeInTheDocument()
    })

    expect(screen.getByText('done')).toBeInTheDocument()
    expect(screen.getByText('discovering')).toBeInTheDocument()
  })

  it('shows "No jobs" when a queue is empty', async () => {
    mockFetchForQueues()
    render(<AdminJobsPage />)

    await waitFor(() => {
      expect(screen.getByText('No jobs.')).toBeInTheDocument()
    })
  })

  it('displays pagination info', async () => {
    mockFetchForQueues({
      sync: { rows: [makeSyncJob()], total: 1, offset: 0 },
    })

    render(<AdminJobsPage />)

    await waitFor(() => {
      expect(screen.getByText('1-1 of 1')).toBeInTheDocument()
    })
  })

  it('shows count badges on tabs', async () => {
    mockFetchForQueues({
      sync: { rows: [makeSyncJob()], total: 5, offset: 0 },
      enrichment: { rows: [makeEnrichJob()], total: 12, offset: 0 },
    })

    render(<AdminJobsPage />)

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('12')).toBeInTheDocument()
    })
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    mockFetchForQueues({
      sync: { rows: [makeSyncJob()], total: 1, offset: 0 },
      enrichment: { rows: [makeEnrichJob()], total: 1, offset: 0 },
      search: { rows: [makeSearchJob()], total: 1, offset: 0 },
    })

    render(<AdminJobsPage />)

    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByText('sync-all')).toBeInTheDocument()
    })

    // Switch to Search Jobs tab
    await user.click(screen.getByText('Search Jobs'))

    await waitFor(() => {
      expect(screen.getByText('author')).toBeInTheDocument()
      expect(screen.getByText('john')).toBeInTheDocument()
    })
  })

  it('displays job errors', async () => {
    const failedJob = makeSyncJob({
      status: 'failed',
      error: 'Connection timeout: could not reach Bitbucket API',
    })
    mockFetchForQueues({
      sync: { rows: [failedJob], total: 1, offset: 0 },
    })

    render(<AdminJobsPage />)

    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument()
      expect(screen.getByText(/Connection timeout/)).toBeInTheDocument()
    })
  })

  it('registers socket.io event handlers on mount', () => {
    mockFetchForQueues()
    render(<AdminJobsPage />)

    // Socket should register handlers for the three event types
    const registeredEvents = mockSocket.on.mock.calls.map((c) => c[0])
    expect(registeredEvents).toContain('sync-job:update')
    expect(registeredEvents).toContain('enrichment-job:update')
    expect(registeredEvents).toContain('search-job:update')
  })

  it('disconnects socket on unmount', () => {
    mockFetchForQueues()
    const { unmount } = render(<AdminJobsPage />)
    unmount()
    expect(mockSocket.disconnect).toHaveBeenCalled()
  })

  it('displays enrichment job details on Enrichment tab', async () => {
    const user = userEvent.setup()
    const job = makeEnrichJob()
    mockFetchForQueues({
      enrichment: { rows: [job], total: 1, offset: 0 },
    })

    render(<AdminJobsPage />)

    await user.click(screen.getByText('Enrichment Jobs'))

    await waitFor(() => {
      expect(screen.getByText('enrich-activity')).toBeInTheDocument()
      expect(screen.getByText('workspace/repo1')).toBeInTheDocument()
      expect(screen.getByText('running')).toBeInTheDocument()
    })
  })
})
