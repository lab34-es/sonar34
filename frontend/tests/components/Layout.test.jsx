import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from '../../src/components/Layout.jsx'

function renderLayout(initialRoute = '/repos') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Layout />
    </MemoryRouter>
  )
}

describe('Layout', () => {
  it('renders all navigation items', () => {
    renderLayout()
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Jobs')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders the Sonar34 logo in the sidebar', () => {
    renderLayout()
    const logo = screen.getByLabelText('Sonar34 logo')
    expect(logo).toBeInTheDocument()
  })

  it('renders navigation links with correct paths', () => {
    renderLayout()
    const reposLink = screen.getByText('Repos').closest('a')
    expect(reposLink).toHaveAttribute('href', '/repos')

    const searchLink = screen.getByText('Search').closest('a')
    expect(searchLink).toHaveAttribute('href', '/search')

    const jobsLink = screen.getByText('Jobs').closest('a')
    expect(jobsLink).toHaveAttribute('href', '/admin/jobs')

    const settingsLink = screen.getByText('Settings').closest('a')
    expect(settingsLink).toHaveAttribute('href', '/admin/settings')
  })

  it('hides the sidebar on /commit/ paths (full-screen mode)', () => {
    renderLayout('/commit/workspace/repo/abc123')
    // Sidebar should not be rendered
    expect(screen.queryByText('Repos')).not.toBeInTheDocument()
    expect(screen.queryByText('Search')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sonar34 logo')).not.toBeInTheDocument()
  })

  it('shows the sidebar on non-commit paths', () => {
    renderLayout('/search')
    expect(screen.getByText('Repos')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
  })

  it('renders the main content area (Outlet)', () => {
    renderLayout()
    // The main element should exist
    const main = document.querySelector('main')
    expect(main).toBeInTheDocument()
  })
})
