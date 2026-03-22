import { useState, useEffect, useCallback, useMemo, useRef, memo, useSyncExternalStore } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Button from '@mui/joy/Button'
import Table from '@mui/joy/Table'
import Sheet from '@mui/joy/Sheet'
import CircularProgress from '@mui/joy/CircularProgress'
import Alert from '@mui/joy/Alert'
import Input from '@mui/joy/Input'

import Chip from '@mui/joy/Chip'
import Checkbox from '@mui/joy/Checkbox'
import Dropdown from '@mui/joy/Dropdown'
import Menu from '@mui/joy/Menu'
import MenuButton from '@mui/joy/MenuButton'
import Link from '@mui/joy/Link'
import Modal from '@mui/joy/Modal'
import ModalDialog from '@mui/joy/ModalDialog'
import ModalClose from '@mui/joy/ModalClose'
import DialogTitle from '@mui/joy/DialogTitle'
import DialogContent from '@mui/joy/DialogContent'
import DialogActions from '@mui/joy/DialogActions'
import Radio from '@mui/joy/Radio'
import RadioGroup from '@mui/joy/RadioGroup'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import Tooltip from '@mui/joy/Tooltip'

/** Tiny inline SVG sparkline for 14 data points. */
function Sparkline({ data, width = 100, height = 24 }) {
  if (!data || data.length === 0) return null

  const max = Math.max(...data, 1) // avoid division by zero
  const step = width / (data.length - 1)
  const points = data
    .map((v, i) => `${i * step},${height - (v / max) * (height - 2) - 1}`)
    .join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke="var(--joy-palette-primary-400, #1976d2)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function timeAgo(dateString) {
  if (!dateString) return '\u2014'
  const now = new Date()
  const then = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z')
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

/**
 * Lightweight selection store compatible with useSyncExternalStore.
 * Mutating the set + calling notify() triggers re-renders only in
 * subscribers whose snapshot value actually changed.
 */
class SelectionStore {
  constructor() {
    this._set = new Set()
    this._listeners = new Set()
    // Monotonic version – used as the header / count snapshot
    this._version = 0
  }
  subscribe = (cb) => { this._listeners.add(cb); return () => this._listeners.delete(cb) }
  _notify() { this._version++; this._listeners.forEach((cb) => cb()) }
  has(name) { return this._set.has(name) }
  toggle(name) { if (this._set.has(name)) this._set.delete(name); else this._set.add(name); this._notify() }
  selectAll(names) { names.forEach((n) => this._set.add(n)); this._notify() }
  deselectAll(names) { names.forEach((n) => this._set.delete(n)); this._notify() }
  get size() { return this._set.size }
  get version() { return this._version }
  toArray() { return [...this._set] }
}

/** Parse a JSON string safely, returning fallback on failure. */
const safeParse = (str, fallback) => {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

/**
 * Header select-all checkbox – subscribes to the store for checked/indeterminate state.
 * Returns a numeric snapshot: 0 = none, 1 = indeterminate, 2 = all selected.
 */
function SelectAllCheckbox({ selectionStore, visibleRepos }) {
  const state = useSyncExternalStore(
    selectionStore.subscribe,
    useCallback(() => {
      if (visibleRepos.length === 0) return 0
      let some = false
      let all = true
      for (const r of visibleRepos) {
        if (selectionStore.has(r.name)) { some = true } else { all = false }
        if (some && !all) return 1 // indeterminate – early exit
      }
      return (all && some) ? 2 : 0
    }, [selectionStore, visibleRepos])
  )

  return (
    <Checkbox
      size="sm"
      checked={state === 2}
      indeterminate={state === 1}
      onChange={(e) => {
        const names = visibleRepos.map((r) => r.name)
        if (e.target.checked) { selectionStore.selectAll(names) } else { selectionStore.deselectAll(names) }
      }}
    />
  )
}

/**
 * Memoized table row.
 * Uses useSyncExternalStore so that only the row whose selection actually
 * changed will re-render – all other rows are untouched.
 */
const RepoRow = memo(function RepoRow({ repo, index, selectionStore }) {
  const isSelected = useSyncExternalStore(
    selectionStore.subscribe,
    useCallback(() => selectionStore.has(repo.name), [selectionStore, repo.name])
  )

  const handleToggle = useCallback(() => {
    selectionStore.toggle(repo.name)
  }, [selectionStore, repo.name])

  const activity = safeParse(repo.activity, null)
  const technologies = safeParse(repo.technologies, null)
  const prs = safeParse(repo.open_prs, null)
  const security = safeParse(repo.security, null)

  return (
    <tr>
      <td>
        <Checkbox
          size="sm"
          checked={isSelected}
          onChange={handleToggle}
        />
      </td>
      <td><Typography level="body-xs">{index + 1}</Typography></td>
      <td>
        <Link
          component={RouterLink}
          to={`/repos/${repo.name}`}
          level="body-xs"
          sx={{ fontFamily: 'monospace', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
        >
          {repo.name.split('/').pop()}
        </Link>
      </td>
      <td>
        {activity && <Sparkline data={activity} />}
      </td>
      <td>
        {technologies && technologies.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {technologies.map((tech) => (
              <Chip key={tech} size="sm" variant="soft" color="neutral" sx={{ fontSize: '0.65rem' }}>
                {tech}
              </Chip>
            ))}
          </Box>
        )}
      </td>
      <td>
        {prs && (
          <Typography level="body-xs">
            <Typography component="span" color="success" fontWeight="lg">
              {prs.new}
            </Typography>
            {' new / '}
            <Typography component="span" color="warning" fontWeight="lg">
              {prs.old}
            </Typography>
            {' old'}
          </Typography>
        )}
      </td>
      <td>
        {security && Object.keys(security).length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
            {security.critical > 0 && (
              <Typography level="body-xs" sx={{ color: '#e53935', fontWeight: 'lg' }}>
                {security.critical}C
              </Typography>
            )}
            {security.high > 0 && (
              <Typography level="body-xs" sx={{ color: '#f57c00', fontWeight: 'lg' }}>
                {security.high}H
              </Typography>
            )}
            {security.moderate > 0 && (
              <Typography level="body-xs" sx={{ color: '#fbc02d', fontWeight: 'lg' }}>
                {security.moderate}M
              </Typography>
            )}
            {((security.low || 0) + (security.info || 0)) > 0 && (
              <Typography level="body-xs" sx={{ color: 'neutral.400' }}>
                {(security.low || 0) + (security.info || 0)}L
              </Typography>
            )}
          </Box>
        )}
      </td>
      <td>
        {repo.dependencies_count > 0 && (
          <Typography level="body-xs">
            {repo.dependencies_count}
          </Typography>
        )}
      </td>
      <td>
        {repo.default_branch && (
          <Chip size="sm" variant="soft" color="neutral" sx={{ fontSize: '0.65rem', fontFamily: 'monospace' }}>
            {repo.default_branch}
          </Chip>
        )}
      </td>
      <td>
        <Typography
          level="body-xs"
          title={repo.last_seen_at}
        >
          {timeAgo(repo.last_seen_at)}
        </Typography>
      </td>
    </tr>
  )
})

export default function AdminReposPage() {
  const [repos, setRepos] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [filter, setFilter] = useState('')
  const [techFilter, setTechFilter] = useState([]) // selected technology names
  const [prFilter, setPrFilter] = useState(false) // true = show only repos with new PRs
  const [activityFilter, setActivityFilter] = useState(false) // true = show only repos with activity data
  const [securityFilter, setSecurityFilter] = useState([]) // selected severity levels e.g. ['critical', 'high']
  const [branchFilter, setBranchFilter] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [enriching, setEnriching] = useState({}) // { activity: true, technologies: true, prs: true }
  const [branchModal, setBranchModal] = useState({ open: false, type: null })
  const [selectedBranchChoice, setSelectedBranchChoice] = useState('default')
  const [syncActionsModal, setSyncActionsModal] = useState(false)
  // Stable selection store – never replaced, survives re-renders
  const [selectionStore] = useState(() => new SelectionStore())
  const pollTimerRef = useRef(null)

  const fetchRepos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/admin/repos`)
      const data = await res.json()
      setRepos(data)
    } catch (err) {
      console.error('Failed to fetch repos:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const triggerSyncAll = useCallback(async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch(`${API}/api/admin/sync-all`, { method: 'POST' })
      const data = await res.json()
      setSyncResult({ type: 'success', message: `Sync job created: ${data.jobId}`, jobId: data.jobId })
    } catch (err) {
      setSyncResult({ type: 'error', message: `Failed to trigger sync: ${err.message}` })
    } finally {
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    fetchRepos()
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current) }
  }, [fetchRepos])

  // Determine the most recent last_seen_at to identify stale repos
  const maxLastSeen = useMemo(() => {
    if (repos.length === 0) return null
    return repos.reduce((max, r) => {
      if (!r.last_seen_at) return max
      return r.last_seen_at > max ? r.last_seen_at : max
    }, '')
  }, [repos])


  // Collect all unique technologies across all repos for the dropdown
  const allTechnologies = useMemo(() => {
    const techSet = new Set()
    repos.forEach((r) => {
      const techs = safeParse(r.technologies, null)
      if (techs && Array.isArray(techs)) {
        techs.forEach((t) => techSet.add(t))
      }
    })
    return [...techSet].sort()
  }, [repos])

  // All possible security severity levels (ordered by severity)
  const allSeverityLevels = useMemo(() => {
    const severityOrder = ['critical', 'high', 'moderate', 'low', 'info']
    const found = new Set()
    repos.forEach((r) => {
      const sec = safeParse(r.security, null)
      if (sec) {
        Object.entries(sec).forEach(([key, val]) => {
          if (val > 0) found.add(key)
        })
      }
    })
    return severityOrder.filter((s) => found.has(s))
  }, [repos])

  const handleSort = (column) => {
    if (sortKey === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(column)
      setSortDir('asc')
    }
  }

  const sortIndicator = (column) => {
    if (sortKey !== column) return ''
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  const filteredAndSorted = useMemo(() => {
    let result = repos

    // Name filter
    if (filter) {
      const lc = filter.toLowerCase()
      result = result.filter((r) => r.name.toLowerCase().includes(lc))
    }

    // Technologies filter
    if (techFilter.length > 0) {
      result = result.filter((r) => {
        const techs = safeParse(r.technologies, [])
        return techFilter.every((t) => techs.includes(t))
      })
    }

    // Default branch filter
    if (branchFilter) {
      const lc = branchFilter.toLowerCase()
      result = result.filter((r) => r.default_branch && r.default_branch.toLowerCase().includes(lc))
    }

    // Activity filter – show only repos that have activity data
    if (activityFilter) {
      result = result.filter((r) => {
        const activity = safeParse(r.activity, null)
        return activity && Array.isArray(activity) && activity.some((v) => v > 0)
      })
    }

    // Security filter – show only repos that have vulnerabilities at the selected severity levels
    if (securityFilter.length > 0) {
      result = result.filter((r) => {
        const sec = safeParse(r.security, null)
        if (!sec) return false
        return securityFilter.some((level) => (sec[level] || 0) > 0)
      })
    }

    // PRs filter – show only repos that have new PRs > 0
    if (prFilter) {
      result = result.filter((r) => {
        const prs = safeParse(r.open_prs, null)
        return prs && prs.new > 0
      })
    }

    result = [...result].sort((a, b) => {
      const aVal = a[sortKey] || ''
      const bVal = b[sortKey] || ''
      const cmp = aVal.localeCompare(bVal)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [repos, filter, techFilter, activityFilter, securityFilter, prFilter, branchFilter, sortKey, sortDir])

  // Selection count – re-reads on every store notification (cheap: just .size)
  const selectedCount = useSyncExternalStore(
    selectionStore.subscribe,
    useCallback(() => selectionStore.size, [selectionStore])
  )

  // Trigger enrichment for selected repos, then poll for updates
  const triggerEnrich = useCallback(async (type, branch) => {
    const repoNames = selectionStore.toArray()
    if (repoNames.length === 0) return

    setEnriching((prev) => ({ ...prev, [type]: true }))
    setSyncActionsModal(false)
    try {
      await fetch(`${API}/api/admin/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, repoNames, branch }),
      })

      // Poll for updated data a few times
      let polls = 0
      const maxPolls = 10
      const poll = () => {
        polls++
        fetchRepos().then(() => {
          if (polls < maxPolls) {
            pollTimerRef.current = setTimeout(poll, 2000)
          } else {
            setEnriching((prev) => ({ ...prev, [type]: false }))
          }
        })
      }
      pollTimerRef.current = setTimeout(poll, 1500)
    } catch (err) {
      console.error(`Failed to trigger ${type} enrichment:`, err)
      setEnriching((prev) => ({ ...prev, [type]: false }))
    }
  }, [fetchRepos])

  // Open branch selection modal for security/dependencies enrichment
  const openBranchModal = useCallback((type) => {
    setSelectedBranchChoice('default')
    setBranchModal({ open: true, type })
  }, [])

  const handleBranchModalConfirm = useCallback(() => {
    const { type } = branchModal
    setBranchModal({ open: false, type: null })
    triggerEnrich(type, selectedBranchChoice)
  }, [branchModal, selectedBranchChoice, triggerEnrich])

  const handleBranchModalClose = useCallback(() => {
    setBranchModal({ open: false, type: null })
  }, [])

  return (
    <Box>
      <Typography level="h3" sx={{ mb: 2 }}>Repositories</Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Button
          variant="outlined"
          color="neutral"
          onClick={fetchRepos}
          loading={loading}
        >
          Refresh
        </Button>

        <Button
          variant="solid"
          color="warning"
          onClick={triggerSyncAll}
          loading={syncing}
        >
          Sync all from Bitbucket
        </Button>

        <Button
          variant="outlined"
          color="primary"
          disabled={selectedCount === 0}
          onClick={() => setSyncActionsModal(true)}
        >
          Sync Actions ({selectedCount})
        </Button>
      </Box>

      {syncResult && (
        <Alert
          color={syncResult.type === 'success' ? 'success' : 'danger'}
          sx={{ mb: 2 }}
        >
          {syncResult.message}
        </Alert>
      )}

      {repos.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Typography level="body-sm">
              {filteredAndSorted.length} / {repos.length} repositories
            </Typography>
          </Box>

          <Sheet variant="outlined" sx={{ borderRadius: 'sm', width: '100%', maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
            <Table
              variant="plain"
              color="neutral"
              size="md"
              stickyHeader

              sx={{
                width: '100%',
                '& th[data-sortable]': { cursor: 'pointer', userSelect: 'none' },
              }}
            >
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <SelectAllCheckbox
                      selectionStore={selectionStore}
                      visibleRepos={filteredAndSorted}
                    />
                  </th>
                  <th style={{ width: 60 }}>#</th>
                  <th data-sortable onClick={() => handleSort('name')}>
                    Name{sortIndicator('name')}
                  </th>
                  <th>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Activity
                      {enriching.activity && <CircularProgress size="sm" sx={{ '--CircularProgress-size': '14px' }} />}
                    </Box>
                  </th>
                  <th>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Technologies
                      {enriching.technologies && <CircularProgress size="sm" sx={{ '--CircularProgress-size': '14px' }} />}
                    </Box>
                  </th>
                  <th>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      PRs
                      {enriching.prs && <CircularProgress size="sm" sx={{ '--CircularProgress-size': '14px' }} />}
                    </Box>
                  </th>
                  <th>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Security
                      {enriching.security && <CircularProgress size="sm" sx={{ '--CircularProgress-size': '14px' }} />}
                    </Box>
                  </th>
                  <th>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      Deps
                      {enriching.dependencies && <CircularProgress size="sm" sx={{ '--CircularProgress-size': '14px' }} />}
                    </Box>
                  </th>
                  <th data-sortable onClick={() => handleSort('default_branch')} style={{ width: 110 }}>
                    Default Branch{sortIndicator('default_branch')}
                  </th>
                  <th data-sortable onClick={() => handleSort('last_seen_at')} style={{ width: 120 }}>
                    Last Seen{sortIndicator('last_seen_at')}
                  </th>
                </tr>
                {/* Per-column filter row */}
                <tr>
                  <th />
                  <th />
                  {/* Name: text search */}
                  <th style={{ padding: '4px 8px' }}>
                    <Input
                      size="sm"
                      placeholder="Search..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </th>
                  {/* Activity: "Has activity" checkbox */}
                  <th style={{ padding: '4px 8px' }}>
                    <Checkbox
                      size="sm"
                      label="Has activity"
                      checked={activityFilter}
                      onChange={(e) => setActivityFilter(e.target.checked)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </th>
                  {/* Technologies: multi-select dropdown */}
                  <th style={{ padding: '4px 8px' }}>
                    <Dropdown>
                      <MenuButton
                        size="sm"
                        variant="outlined"
                        color={techFilter.length > 0 ? 'primary' : 'neutral'}
                        sx={{ fontSize: '0.75rem', width: '100%', justifyContent: 'space-between' }}
                      >
                        {techFilter.length === 0
                          ? 'All'
                          : `${techFilter.length} selected`}
                      </MenuButton>
                      <Menu
                        placement="bottom-start"
                        sx={{ maxHeight: 300, overflow: 'auto', minWidth: 180 }}
                      >
                        {allTechnologies.map((tech) => (
                          <Box
                            key={tech}
                            role="menuitem"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              px: 1.5,
                              py: 0.5,
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'background.level1' },
                            }}
                            onClick={() => {
                              setTechFilter((prev) =>
                                prev.includes(tech)
                                  ? prev.filter((t) => t !== tech)
                                  : [...prev, tech]
                              )
                            }}
                          >
                            <Checkbox
                              size="sm"
                              checked={techFilter.includes(tech)}
                              readOnly
                              sx={{ mr: 1 }}
                            />
                            <Typography level="body-sm">{tech}</Typography>
                          </Box>
                        ))}
                        {allTechnologies.length === 0 && (
                          <Box sx={{ px: 1.5, py: 1 }}>
                            <Typography level="body-xs" color="neutral">
                              No data yet
                            </Typography>
                          </Box>
                        )}
                      </Menu>
                    </Dropdown>
                  </th>
                  {/* PRs: "Has new" checkbox */}
                  <th style={{ padding: '4px 8px' }}>
                    <Checkbox
                      size="sm"
                      label="Has new"
                      checked={prFilter}
                      onChange={(e) => setPrFilter(e.target.checked)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </th>
                  {/* Security: severity multi-select dropdown */}
                  <th style={{ padding: '4px 8px' }}>
                    <Dropdown>
                      <MenuButton
                        size="sm"
                        variant="outlined"
                        color={securityFilter.length > 0 ? 'primary' : 'neutral'}
                        sx={{ fontSize: '0.75rem', width: '100%', justifyContent: 'space-between' }}
                      >
                        {securityFilter.length === 0
                          ? 'All'
                          : `${securityFilter.length} selected`}
                      </MenuButton>
                      <Menu
                        placement="bottom-start"
                        sx={{ maxHeight: 300, overflow: 'auto', minWidth: 160 }}
                      >
                        {allSeverityLevels.map((level) => (
                          <Box
                            key={level}
                            role="menuitem"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              px: 1.5,
                              py: 0.5,
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'background.level1' },
                            }}
                            onClick={() => {
                              setSecurityFilter((prev) =>
                                prev.includes(level)
                                  ? prev.filter((l) => l !== level)
                                  : [...prev, level]
                              )
                            }}
                          >
                            <Checkbox
                              size="sm"
                              checked={securityFilter.includes(level)}
                              readOnly
                              sx={{ mr: 1 }}
                            />
                            <Typography level="body-sm" sx={{ textTransform: 'capitalize' }}>
                              {level}
                            </Typography>
                          </Box>
                        ))}
                        {allSeverityLevels.length === 0 && (
                          <Box sx={{ px: 1.5, py: 1 }}>
                            <Typography level="body-xs" color="neutral">
                              No data yet
                            </Typography>
                          </Box>
                        )}
                      </Menu>
                    </Dropdown>
                  </th>
                  {/* Dependencies: no filter */}
                  <th />
                  {/* Default Branch: text search */}
                  <th style={{ padding: '4px 8px' }}>
                    <Input
                      size="sm"
                      placeholder="e.g. main"
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </th>
                  {/* Last Seen: no filter */}
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((repo, i) => (
                  <RepoRow
                    key={repo.name}
                    repo={repo}
                    index={i}
                    selectionStore={selectionStore}
                  />
                ))}
              </tbody>
            </Table>
          </Sheet>
        </>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Sync Actions modal */}
      <Modal open={syncActionsModal} onClose={() => setSyncActionsModal(false)}>
        <ModalDialog variant="outlined" size="sm" sx={{ maxWidth: 560 }}>
          <ModalClose />
          <DialogTitle>Sync Actions</DialogTitle>
          <DialogContent>
            <Typography level="body-sm" sx={{ mb: 2 }}>
              Run an action on the {selectedCount} selected repositor{selectedCount === 1 ? 'y' : 'ies'}.
            </Typography>
            <Table size="sm" borderAxis="none" sx={{ '& td': { py: 0.75 } }}>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Action</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    key: 'activity',
                    label: 'Sync Activity',
                    description: 'Fetch commit activity (last 14 weeks) for each repository and update the sparkline data.',
                    onClick: () => triggerEnrich('activity'),
                  },
                  {
                    key: 'technologies',
                    label: 'Sync Technologies',
                    description: 'Detect programming languages and frameworks used in each repository.',
                    onClick: () => triggerEnrich('technologies'),
                  },
                  {
                    key: 'prs',
                    label: 'Sync PRs',
                    description: 'Fetch open pull request counts (new and stale) for each repository.',
                    onClick: () => triggerEnrich('prs'),
                  },
                  {
                    key: 'security',
                    label: 'Sync Security',
                    description: 'Run a security vulnerability audit on each repository. You will be prompted to choose a branch.',
                    onClick: () => {
                      setSyncActionsModal(false)
                      openBranchModal('security')
                    },
                  },
                  {
                    key: 'dependencies',
                    label: 'Sync Dependencies',
                    description: 'Analyse and catalogue the dependency tree for each repository. You will be prompted to choose a branch.',
                    onClick: () => {
                      setSyncActionsModal(false)
                      openBranchModal('dependencies')
                    },
                  },
                ].map((action) => (
                  <tr key={action.key}>
                    <td>
                      <Button
                        variant="outlined"
                        color="neutral"
                        size="sm"
                        disabled={!!enriching[action.key]}
                        loading={!!enriching[action.key]}
                        onClick={action.onClick}
                        fullWidth
                      >
                        {action.label}
                      </Button>
                    </td>
                    <td>
                      <Tooltip title={action.description} placement="right" variant="soft">
                        <Typography level="body-xs" sx={{ color: 'text.secondary', cursor: 'default' }}>
                          {action.description}
                        </Typography>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </DialogContent>
        </ModalDialog>
      </Modal>

      {/* Branch selection modal for Security / Dependencies enrichment */}
      <Modal open={branchModal.open} onClose={handleBranchModalClose}>
        <ModalDialog variant="outlined" size="sm" sx={{ maxWidth: 400 }}>
          <ModalClose />
          <DialogTitle>
            Select branch for {branchModal.type === 'security' ? 'security' : 'dependencies'} analysis
          </DialogTitle>
          <DialogContent sx={{ overflow: 'hidden' }}>
            <FormControl>
              <FormLabel>Run analysis on:</FormLabel>
              <RadioGroup
                value={selectedBranchChoice}
                onChange={(e) => setSelectedBranchChoice(e.target.value)}
              >
                <Radio value="default" label="Default branch" />
                <Radio value="last_committed" label="Last committed branch" />
              </RadioGroup>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button variant="solid" color="primary" onClick={handleBranchModalConfirm}>
              Run
            </Button>
            <Button variant="plain" color="neutral" onClick={handleBranchModalClose}>
              Cancel
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  )
}
