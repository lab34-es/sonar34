import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminSettingsPage from '../../src/pages/AdminSettingsPage.jsx'

// Sample settings data returned by the API
const mockSettings = [
  { key: 'bitbucket_email', label: 'Bitbucket Email', value: 'user@example.com', secret: false, isSet: true },
  { key: 'bitbucket_api_token', label: 'Bitbucket API Token', value: '', secret: true, isSet: true },
  { key: 'bitbucket_workspace', label: 'Bitbucket Workspace', value: 'myworkspace', secret: false, isSet: true },
  { key: 'repos_dir', label: 'Repos Directory', value: '/tmp/repos', secret: false, isSet: true },
  { key: 'not_set_secret', label: 'Unset Secret', value: '', secret: true, isSet: false },
]

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a loading spinner while fetching settings', () => {
    // Never resolves — keeps loading state
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    render(<AdminSettingsPage />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('fetches and displays settings on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })

    // Check labels are rendered
    expect(screen.getByText('Bitbucket Email')).toBeInTheDocument()
    expect(screen.getByText('Bitbucket API Token')).toBeInTheDocument()
    expect(screen.getByText('Bitbucket Workspace')).toBeInTheDocument()
    expect(screen.getByText('Repos Directory')).toBeInTheDocument()

    // Check non-secret values are populated
    const emailInput = screen.getByDisplayValue('user@example.com')
    expect(emailInput).toBeInTheDocument()

    // Check keys are shown in helper text
    expect(screen.getByText('bitbucket_email')).toBeInTheDocument()
    expect(screen.getByText('repos_dir')).toBeInTheDocument()
  })

  it('shows "configured" chip for secret fields that are set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('configured')).toBeInTheDocument()
    })
  })

  it('shows "not set" chip for secret fields that are not set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('not set')).toBeInTheDocument()
    })
  })

  it('renders password inputs for secret fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Bitbucket API Token')).toBeInTheDocument()
    })

    // Find password type inputs
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    expect(passwordInputs.length).toBe(2) // bitbucket_api_token and not_set_secret
  })

  it('shows an error alert when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load settings/)).toBeInTheDocument()
    })
  })

  it('shows an error when API returns non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText(/Failed to load settings: HTTP 500/)).toBeInTheDocument()
    })
  })

  it('shows "No settings available" when API returns empty array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('No settings available.')).toBeInTheDocument()
    })
  })

  it('submits settings via PUT and shows success message', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    // Initial GET
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Save settings')).toBeInTheDocument()
    })

    // Mock the PUT response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    })

    await user.click(screen.getByText('Save settings'))

    await waitFor(() => {
      expect(screen.getByText('Settings saved.')).toBeInTheDocument()
    })

    // Verify PUT was called
    const putCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === 'PUT'
    )
    expect(putCall).toBeTruthy()
    expect(putCall[0]).toContain('/api/admin/settings')
  })

  it('shows error message when save fails', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    // Initial GET
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSettings,
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Save settings')).toBeInTheDocument()
    })

    // Mock a failed PUT
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid token' }),
    })

    await user.click(screen.getByText('Save settings'))

    await waitFor(() => {
      expect(screen.getByText('Invalid token')).toBeInTheDocument()
    })
  })

  it('allows editing input values', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { key: 'repos_dir', label: 'Repos Directory', value: '/tmp/repos', secret: false, isSet: true },
      ],
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('/tmp/repos')).toBeInTheDocument()
    })

    const input = screen.getByDisplayValue('/tmp/repos')
    await user.clear(input)
    await user.type(input, '/new/path')

    expect(screen.getByDisplayValue('/new/path')).toBeInTheDocument()
  })
})
