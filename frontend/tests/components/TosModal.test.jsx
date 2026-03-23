import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TosModal from '../../src/components/TosModal.jsx'

// TosModal doesn't use routing, but it does use MUI Joy which needs a provider-less render
// It reads/writes localStorage and redirects on decline

describe('TosModal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the modal when TOS has not been accepted', () => {
    render(<TosModal />)
    expect(screen.getByText('License & Safety Notices')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument()
  })

  it('does not render the modal when TOS has already been accepted', () => {
    localStorage.setItem('sonar34_tos_accepted', Date.now().toString())
    render(<TosModal />)
    expect(screen.queryByText('License & Safety Notices')).not.toBeInTheDocument()
  })

  it('displays the MIT license text', () => {
    render(<TosModal />)
    // The TOS_TEXT is rendered inside a Sheet; use getAllByText since "MIT License"
    // also appears in the disclaimer below
    const matches = screen.getAllByText(/MIT License/)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Copyright \(c\) 2026 lab34/)).toBeInTheDocument()
  })

  it('displays safety notices', () => {
    render(<TosModal />)
    expect(screen.getByText(/IMPORTANT SAFETY NOTICES/)).toBeInTheDocument()
    expect(screen.getByText(/LOCAL DATA STORAGE/)).toBeInTheDocument()
    expect(screen.getByText(/REPOSITORY CLONING METHOD/)).toBeInTheDocument()
  })

  it('writes to localStorage and hides modal on Accept click', async () => {
    const user = userEvent.setup()
    render(<TosModal />)

    expect(screen.getByText('License & Safety Notices')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /accept/i }))

    // Modal should be gone
    expect(screen.queryByText('License & Safety Notices')).not.toBeInTheDocument()

    // localStorage should have the key set
    const stored = localStorage.getItem('sonar34_tos_accepted')
    expect(stored).toBeTruthy()
    expect(Number(stored)).toBeGreaterThan(0)
  })

  it('redirects to lab34.es on Decline click', async () => {
    const user = userEvent.setup()
    // Mock window.location.href setter
    const originalLocation = window.location
    delete window.location
    window.location = { ...originalLocation, href: '' }

    render(<TosModal />)

    await user.click(screen.getByRole('button', { name: /decline/i }))

    expect(window.location.href).toBe('http://lab34.es')

    // Restore
    window.location = originalLocation
  })

  it('shows the Sonar34 logo', () => {
    render(<TosModal />)
    // The SVG contains the text "Sonar" and "34"
    expect(screen.getByText('Sonar')).toBeInTheDocument()
  })

  it('shows the acceptance disclaimer text', () => {
    render(<TosModal />)
    expect(
      screen.getByText(/By clicking "Accept" you acknowledge/)
    ).toBeInTheDocument()
  })
})
