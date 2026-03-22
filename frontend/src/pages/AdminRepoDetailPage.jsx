import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link as RouterLink } from 'react-router-dom'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Sheet from '@mui/joy/Sheet'
import Table from '@mui/joy/Table'
import Chip from '@mui/joy/Chip'
import CircularProgress from '@mui/joy/CircularProgress'
import Button from '@mui/joy/Button'
import Input from '@mui/joy/Input'
import Checkbox from '@mui/joy/Checkbox'
import Dropdown from '@mui/joy/Dropdown'
import Menu from '@mui/joy/Menu'
import MenuButton from '@mui/joy/MenuButton'
import Tooltip from '@mui/joy/Tooltip'
import Link from '@mui/joy/Link'
import Tabs from '@mui/joy/Tabs'
import TabList from '@mui/joy/TabList'
import Tab from '@mui/joy/Tab'
import TabPanel from '@mui/joy/TabPanel'
import Select from '@mui/joy/Select'
import Option from '@mui/joy/Option'
import Editor from '@monaco-editor/react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function safeParse(str, fallback) {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

const SEVERITY_COLOR = {
  critical: 'danger',
  high: 'warning',
  moderate: 'neutral',
  low: 'neutral',
  info: 'neutral',
  unknown: 'neutral',
}

const SEVERITY_ORDER = { critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5 }

// ---------------------------------------------------------------------------
// Calendar Heatmap (GitHub-style)
// ---------------------------------------------------------------------------

function CalendarHeatmap({ commits }) {
  const today = new Date()
  const dayMs = 86400000

  const start = new Date(today)
  start.setDate(start.getDate() - start.getDay() - 52 * 7)
  start.setHours(0, 0, 0, 0)

  const endDate = new Date(today)
  endDate.setHours(23, 59, 59, 999)

  const counts = {}
  for (const c of commits) {
    const d = c.date ? c.date.slice(0, 10) : null
    if (d) counts[d] = (counts[d] || 0) + 1
  }

  const maxCount = Math.max(...Object.values(counts), 1)

  const cellSize = 11
  const cellGap = 2
  const totalSize = cellSize + cellGap
  const weeks = []
  const cur = new Date(start)
  while (cur <= endDate) {
    const week = []
    for (let day = 0; day < 7; day++) {
      if (cur <= endDate) {
        const key = cur.toISOString().slice(0, 10)
        week.push({ date: key, count: counts[key] || 0 })
      }
      cur.setTime(cur.getTime() + dayMs)
    }
    weeks.push(week)
  }

  function getColor(count) {
    if (count === 0) return 'var(--joy-palette-background-level2, #161b22)'
    const ratio = count / maxCount
    if (ratio <= 0.25) return 'var(--joy-palette-success-100, #0e4429)'
    if (ratio <= 0.5) return 'var(--joy-palette-success-300, #006d32)'
    if (ratio <= 0.75) return 'var(--joy-palette-success-500, #26a641)'
    return 'var(--joy-palette-success-700, #39d353)'
  }

  const svgWidth = weeks.length * totalSize + 2
  const svgHeight = 7 * totalSize + 2

  const monthLabels = []
  let lastMonth = null
  weeks.forEach((week, wi) => {
    if (week.length > 0) {
      const d = new Date(week[0].date)
      const m = d.getMonth()
      if (m !== lastMonth) {
        lastMonth = m
        monthLabels.push({ x: wi * totalSize + 1, label: d.toLocaleString('default', { month: 'short' }) })
      }
    }
  })

  return (
    <Box sx={{ overflowX: 'auto', py: 1 }}>
      <svg width={svgWidth} height={14} style={{ display: 'block', marginBottom: 2 }}>
        {monthLabels.map((ml, i) => (
          <text key={i} x={ml.x} y={11} fontSize={9} fill="var(--joy-palette-text-tertiary, #8b949e)">
            {ml.label}
          </text>
        ))}
      </svg>
      <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
        {weeks.map((week, wi) =>
          week.map((day, di) => (
            <Tooltip key={`${wi}-${di}`} title={`${day.date}: ${day.count} commit${day.count !== 1 ? 's' : ''}`} size="sm">
              <rect
                x={wi * totalSize + 1}
                y={di * totalSize + 1}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={getColor(day.count)}
                style={{ cursor: 'default' }}
              />
            </Tooltip>
          ))
        )}
      </svg>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Tab: Branches
// ---------------------------------------------------------------------------

function BranchesTab({ repoName }) {
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/admin/repos/${repoName}/branches`)
        if (res.ok && !cancelled) setBranches(await res.json())
      } catch (err) {
        console.error('Failed to fetch branches:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoName])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size="sm" />
      </Box>
    )
  }

  if (branches.length === 0) {
    return <Typography level="body-sm" color="neutral">No branches found</Typography>
  }

  return (
    <Sheet variant="outlined" sx={{ borderRadius: 'sm' }}>
      <Table variant="plain" color="neutral" size="md" stickyHeader>
        <thead>
          <tr>
            <th>Branch</th>
            <th style={{ width: 180 }}>Last Commit</th>
            <th style={{ width: 180 }}>Author</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.name}>
              <td>
                <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>{b.name}</Typography>
              </td>
              <td>
                <Typography level="body-xs" title={b.lastCommitDate}>{timeAgo(b.lastCommitDate)}</Typography>
              </td>
              <td>
                <Typography level="body-xs">{b.author || '\u2014'}</Typography>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Tab: Contributions
// ---------------------------------------------------------------------------

const TIME_RANGE_OPTIONS = [
  { value: 'custom', label: 'Custom' },
  { value: '1day', label: '1 day' },
  { value: '3days', label: '3 days' },
  { value: '7days', label: '7 days' },
  { value: '2weeks', label: '2 weeks' },
  { value: '1month', label: '1 month' },
  { value: '3months', label: '3 months' },
  { value: '6months', label: '6 months' },
  { value: 'all', label: 'Since the beginning' },
]

function getDateRange(rangeValue) {
  if (rangeValue === 'all' || rangeValue === 'custom') return { since: '', until: '' }
  const now = new Date()
  const since = new Date(now)
  switch (rangeValue) {
    case '1day': since.setDate(since.getDate() - 1); break
    case '3days': since.setDate(since.getDate() - 3); break
    case '7days': since.setDate(since.getDate() - 7); break
    case '2weeks': since.setDate(since.getDate() - 14); break
    case '1month': since.setMonth(since.getMonth() - 1); break
    case '3months': since.setMonth(since.getMonth() - 3); break
    case '6months': since.setMonth(since.getMonth() - 6); break
    default: return { since: '', until: '' }
  }
  return { since: since.toISOString().slice(0, 10), until: '' }
}

function ContributionsTab({ repoName, branchNames, defaultBranch }) {
  const [commits, setCommits] = useState([])
  const [loading, setLoading] = useState(true)

  const [timeRange, setTimeRange] = useState('1month')
  const [sinceDate, setSinceDate] = useState(() => getDateRange('1month').since)
  const [untilDate, setUntilDate] = useState('')
  const [selectedBranch, setSelectedBranch] = useState(defaultBranch || '')
  const [branchSearch, setBranchSearch] = useState('')
  const [selectedAuthors, setSelectedAuthors] = useState([])
  const [authorSearch, setAuthorSearch] = useState('')

  // When timeRange preset changes, recompute dates
  const handleTimeRangeChange = useCallback((_e, val) => {
    if (!val) return
    setTimeRange(val)
    if (val !== 'custom') {
      const { since, until } = getDateRange(val)
      setSinceDate(since)
      setUntilDate(until)
    }
  }, [])

  const fetchCommits = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '3000' })
      if (sinceDate) params.set('since', sinceDate)
      if (untilDate) params.set('until', untilDate)
      if (selectedBranch) params.set('branch', selectedBranch)

      const res = await fetch(`${API}/api/admin/repos/${repoName}/commits?${params}`)
      if (res.ok) setCommits(await res.json())
    } catch (err) {
      console.error('Failed to fetch commits:', err)
    } finally {
      setLoading(false)
    }
  }, [repoName, sinceDate, untilDate, selectedBranch])

  useEffect(() => { fetchCommits() }, [fetchCommits])

  // Derive authors from current commits
  const allAuthors = useMemo(() => {
    const s = new Set(commits.map((c) => c.author).filter(Boolean))
    return [...s].sort()
  }, [commits])

  // When commits change (e.g. branch switch), prune selectedAuthors to only valid ones
  useEffect(() => {
    setSelectedAuthors((prev) => {
      const validSet = new Set(commits.map((c) => c.author).filter(Boolean))
      const pruned = prev.filter((a) => validSet.has(a))
      // Only update if something changed to avoid infinite loops
      if (pruned.length !== prev.length) return pruned
      return prev
    })
  }, [commits])

  const filteredCommits = useMemo(() => {
    let result = commits
    if (selectedAuthors.length > 0) {
      result = result.filter((c) => selectedAuthors.includes(c.author))
    }
    return result
  }, [commits, selectedAuthors])

  // Branch list filtered by search
  const filteredBranches = useMemo(() => {
    if (!branchSearch.trim()) return branchNames
    const q = branchSearch.toLowerCase()
    return branchNames.filter((b) => b.toLowerCase().includes(q))
  }, [branchNames, branchSearch])

  // Author list filtered by search
  const filteredAuthors = useMemo(() => {
    if (!authorSearch.trim()) return allAuthors
    const q = authorSearch.toLowerCase()
    return allAuthors.filter((a) => a.toLowerCase().includes(q))
  }, [allAuthors, authorSearch])

  const isFiltered = timeRange !== '1month' || selectedBranch !== (defaultBranch || '') || selectedAuthors.length > 0

  return (
    <Box>
      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Time range */}
        <Box>
          <Typography level="body-xs" sx={{ mb: 0.25 }}>Time range</Typography>
          <Select
            size="sm"
            value={timeRange}
            onChange={handleTimeRangeChange}
            sx={{ minWidth: 160, fontSize: '0.75rem' }}
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
              <Option key={opt.value} value={opt.value}>{opt.label}</Option>
            ))}
          </Select>
        </Box>

        {/* Custom date pickers — only shown when "Custom" is selected */}
        {timeRange === 'custom' && (
          <>
            <Box>
              <Typography level="body-xs" sx={{ mb: 0.25 }}>From</Typography>
              <Input type="date" size="sm" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)} sx={{ width: 150 }} />
            </Box>
            <Box>
              <Typography level="body-xs" sx={{ mb: 0.25 }}>To</Typography>
              <Input type="date" size="sm" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} sx={{ width: 150 }} />
            </Box>
          </>
        )}

        {/* Branch single-select with search */}
        <Box>
          <Typography level="body-xs" sx={{ mb: 0.25 }}>Branch</Typography>
          <Dropdown>
            <MenuButton
              size="sm"
              variant="outlined"
              color={selectedBranch ? 'primary' : 'neutral'}
              sx={{ fontSize: '0.75rem', minWidth: 160, fontFamily: 'monospace' }}
            >
              {selectedBranch || 'All branches'}
            </MenuButton>
            <Menu placement="bottom-start" sx={{ maxHeight: 300, overflow: 'hidden', minWidth: 240, p: 0 }}>
              {/* Search input */}
              <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Input
                  size="sm"
                  placeholder="Search branches..."
                  value={branchSearch}
                  onChange={(e) => setBranchSearch(e.target.value)}
                  sx={{ fontSize: '0.75rem' }}
                  autoFocus
                />
              </Box>
              <Box sx={{ maxHeight: 220, overflow: 'auto' }}>
                {/* "All branches" option */}
                <Box
                  role="menuitem"
                  sx={{
                    display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, cursor: 'pointer',
                    bgcolor: !selectedBranch ? 'primary.softBg' : 'transparent',
                    '&:hover': { bgcolor: 'background.level1' },
                  }}
                  onClick={() => { setSelectedBranch(''); setBranchSearch('') }}
                >
                  <Typography level="body-xs" sx={{ fontWeight: !selectedBranch ? 'lg' : 'md' }}>All branches</Typography>
                </Box>
                {filteredBranches.map((name) => (
                  <Box
                    key={name}
                    role="menuitem"
                    sx={{
                      display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, cursor: 'pointer',
                      bgcolor: selectedBranch === name ? 'primary.softBg' : 'transparent',
                      '&:hover': { bgcolor: 'background.level1' },
                    }}
                    onClick={() => { setSelectedBranch(name); setBranchSearch('') }}
                  >
                    <Typography level="body-xs" sx={{ fontFamily: 'monospace', fontWeight: selectedBranch === name ? 'lg' : 'md' }}>{name}</Typography>
                  </Box>
                ))}
                {filteredBranches.length === 0 && (
                  <Box sx={{ px: 1.5, py: 1 }}>
                    <Typography level="body-xs" color="neutral">No matching branches</Typography>
                  </Box>
                )}
              </Box>
            </Menu>
          </Dropdown>
        </Box>

        {/* Contributor multi-select with search */}
        <Box>
          <Typography level="body-xs" sx={{ mb: 0.25 }}>Contributor</Typography>
          <Dropdown>
            <MenuButton
              size="sm"
              variant="outlined"
              color={selectedAuthors.length > 0 ? 'primary' : 'neutral'}
              sx={{ fontSize: '0.75rem', minWidth: 130 }}
            >
              {selectedAuthors.length === 0 ? 'All' : `${selectedAuthors.length} selected`}
            </MenuButton>
            <Menu placement="bottom-start" sx={{ maxHeight: 300, overflow: 'hidden', minWidth: 220, p: 0 }}>
              {/* Search input */}
              <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Input
                  size="sm"
                  placeholder="Search contributors..."
                  value={authorSearch}
                  onChange={(e) => setAuthorSearch(e.target.value)}
                  sx={{ fontSize: '0.75rem' }}
                  autoFocus
                />
              </Box>
              <Box sx={{ maxHeight: 220, overflow: 'auto' }}>
                {filteredAuthors.map((author) => (
                  <Box
                    key={author}
                    role="menuitem"
                    sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'background.level1' } }}
                    onClick={() =>
                      setSelectedAuthors((prev) =>
                        prev.includes(author) ? prev.filter((a) => a !== author) : [...prev, author]
                      )
                    }
                  >
                    <Checkbox size="sm" checked={selectedAuthors.includes(author)} readOnly sx={{ mr: 1 }} />
                    <Typography level="body-xs">{author}</Typography>
                  </Box>
                ))}
                {filteredAuthors.length === 0 && (
                  <Box sx={{ px: 1.5, py: 1 }}>
                    <Typography level="body-xs" color="neutral">{allAuthors.length === 0 ? 'No contributors' : 'No matching contributors'}</Typography>
                  </Box>
                )}
              </Box>
            </Menu>
          </Dropdown>
        </Box>

        {isFiltered && (
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            onClick={() => {
              setTimeRange('1month')
              const { since } = getDateRange('1month')
              setSinceDate(since)
              setUntilDate('')
              setSelectedBranch(defaultBranch || '')
              setSelectedAuthors([])
              setBranchSearch('')
              setAuthorSearch('')
            }}
          >
            Clear filters
          </Button>
        )}
      </Box>

      {/* Calendar heatmap */}
      <Sheet variant="outlined" sx={{ borderRadius: 'sm', p: 2, mb: 2, overflow: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size="sm" />
          </Box>
        ) : (
          <>
            <CalendarHeatmap commits={filteredCommits} />
            <Typography level="body-xs" sx={{ mt: 1, color: 'text.tertiary' }}>
              {filteredCommits.length} commit{filteredCommits.length !== 1 ? 's' : ''} total
            </Typography>
          </>
        )}
      </Sheet>

      {/* Commit log table */}
      {filteredCommits.length > 0 && (
        <Sheet variant="outlined" sx={{ borderRadius: 'sm' }}>
          <Table variant="plain" color="neutral" size="md" stickyHeader>
            <thead>
              <tr>
                <th style={{ width: 80 }}>SHA</th>
                <th>Message</th>
                <th style={{ width: 140 }}>Author</th>
                <th style={{ width: 120 }}>Date</th>
                <th style={{ width: 100 }}>+/−</th>
                <th style={{ width: 150 }}>Refs</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredCommits.map((c) => (
                <tr key={c.sha}>
                  <td>
                    <Link
                      component={RouterLink}
                      to={`/commit/${repoName}/${c.sha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      level="body-xs"
                      sx={{ fontFamily: 'monospace' }}
                    >
                      {c.sha?.slice(0, 7)}
                    </Link>
                  </td>
                  <td>
                    <Typography level="body-xs">{c.message}</Typography>
                  </td>
                  <td>
                    <Typography level="body-xs">{c.author}</Typography>
                  </td>
                  <td>
                    <Typography level="body-xs" title={c.date}>{timeAgo(c.date)}</Typography>
                  </td>
                  <td>
                    <Box sx={{ display: 'flex', gap: 0.75 }}>
                      {c.additions > 0 && (
                        <Typography level="body-xs" sx={{ color: 'success.500', fontWeight: 'lg' }}>
                          +{c.additions}
                        </Typography>
                      )}
                      {c.deletions > 0 && (
                        <Typography level="body-xs" sx={{ color: 'danger.500', fontWeight: 'lg' }}>
                          -{c.deletions}
                        </Typography>
                      )}
                    </Box>
                  </td>
                  <td>
                    {c.refs && (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {c.refs.split(', ').filter(Boolean).map((ref) => (
                          <Chip key={ref} size="sm" variant="soft" color="neutral" sx={{ fontSize: '0.6rem', fontFamily: 'monospace' }}>
                            {ref}
                          </Chip>
                        ))}
                      </Box>
                    )}
                  </td>
                  <td>
                    {c.url && (
                      <Link href={c.url} target="_blank" rel="noopener noreferrer" title="View on Bitbucket">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Tab: Dependencies
// ---------------------------------------------------------------------------

function DependenciesTab({ repoName }) {
  const [deps, setDeps] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/admin/repos/${repoName}/dependencies`)
        if (res.ok && !cancelled) setDeps(await res.json())
      } catch (err) {
        console.error('Failed to fetch dependencies:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoName])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size="sm" />
      </Box>
    )
  }

  if (deps.length === 0) {
    return <Typography level="body-sm" color="neutral">No dependencies found</Typography>
  }

  return (
    <Sheet variant="outlined" sx={{ borderRadius: 'sm' }}>
      <Table variant="plain" color="neutral" size="md" stickyHeader>
        <thead>
          <tr>
            <th>Dependency</th>
            <th style={{ width: 180 }}>Version</th>
          </tr>
        </thead>
        <tbody>
          {deps.map((d) => (
            <tr key={d.id}>
              <td>
                <Link
                  href={`https://www.npmjs.com/package/${d.dependency}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  level="body-xs"
                  sx={{ fontFamily: 'monospace' }}
                >
                  {d.dependency}
                </Link>
              </td>
              <td>
                <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                  {d.version || '\u2014'}
                </Typography>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Tab: Security
// ---------------------------------------------------------------------------

function SecurityTab({ repoName, securitySummary }) {
  const [security, setSecurity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/admin/repos/${repoName}/security`)
        if (res.ok && !cancelled) setSecurity(await res.json())
      } catch (err) {
        console.error('Failed to fetch security:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoName])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size="sm" />
      </Box>
    )
  }

  return (
    <Box>
      {/* Summary chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {Object.entries(securitySummary)
          .sort(([a], [b]) => (SEVERITY_ORDER[a] ?? 5) - (SEVERITY_ORDER[b] ?? 5))
          .map(([sev, cnt]) =>
            cnt > 0 ? (
              <Chip key={sev} size="sm" variant="soft" color={SEVERITY_COLOR[sev] || 'neutral'}>
                {cnt} {sev}
              </Chip>
            ) : null
          )}
      </Box>

      {security.length === 0 ? (
        <Typography level="body-sm" color="neutral">No security issues found</Typography>
      ) : (
        <Sheet variant="outlined" sx={{ borderRadius: 'sm' }}>
          <Table variant="plain" color="neutral" size="md" stickyHeader>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Severity</th>
                <th>Dependency</th>
                <th style={{ width: 130 }}>Version</th>
                <th>Issue</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {security.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Chip size="sm" variant="soft" color={SEVERITY_COLOR[row.severity] || 'neutral'} sx={{ fontSize: '0.65rem' }}>
                      {row.severity}
                    </Chip>
                  </td>
                  <td>
                    <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>{row.dependency}</Typography>
                  </td>
                  <td>
                    <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>{row.version || '\u2014'}</Typography>
                  </td>
                  <td>
                    <Typography level="body-xs">{row.issue}</Typography>
                  </td>
                  <td>
                    {row.url && (
                      <Link href={row.url} target="_blank" rel="noopener noreferrer" level="body-xs" title="View advisory">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Tab: Explore (Bitbucket source browser with Monaco editor)
// ---------------------------------------------------------------------------

// Map file extensions to Monaco language identifiers
const EXT_LANG_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', json5: 'json',
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', mdx: 'markdown',
  xml: 'xml', svg: 'xml', xsl: 'xml',
  yaml: 'yaml', yml: 'yaml',
  py: 'python',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile',
  tf: 'hcl', hcl: 'hcl',
  toml: 'ini', ini: 'ini', cfg: 'ini',
  lua: 'lua',
  r: 'r',
  swift: 'swift',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  m: 'objective-c',
  pl: 'perl', pm: 'perl',
  scala: 'scala',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  dart: 'dart',
  vue: 'html',
  svelte: 'html',
}

function getLanguageFromPath(filePath) {
  if (!filePath) return 'plaintext'
  const name = filePath.split('/').pop().toLowerCase()
  // Special filenames
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile'
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile'
  if (name === '.gitignore' || name === '.dockerignore' || name === '.npmignore') return 'ignore'
  const ext = name.includes('.') ? name.split('.').pop() : ''
  return EXT_LANG_MAP[ext] || 'plaintext'
}

// Simple binary detection heuristic: check for null bytes in first chunk
function looksLikeBinary(text) {
  const sample = text.slice(0, 8192)
  // eslint-disable-next-line no-control-regex
  return /\x00/.test(sample)
}

// Folder icon (simple SVG)
function FolderIcon({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginRight: 4 }}>
      {open ? (
        <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H5.79289C6.0581 2 6.31246 2.10536 6.5 2.29289L7.70711 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V5H2.5L1.5 5V3Z M1 6L2.31063 12.5532C2.41537 13.0781 2.87497 13.4531 3.41149 13.4531H12.5885C13.125 13.4531 13.5846 13.0781 13.6894 12.5532L15 6H1Z" fill="var(--joy-palette-warning-400, #e5a50a)" />
      ) : (
        <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H5.79289C6.0581 2 6.31246 2.10536 6.5 2.29289L7.70711 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V12.5C14.5 13.0523 14.0523 13.5 13.5 13.5H2.5C1.94772 13.5 1.5 13.0523 1.5 12.5V3Z" fill="var(--joy-palette-warning-300, #f0c000)" />
      )}
    </svg>
  )
}

// File icon
function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginRight: 4 }}>
      <path d="M3 1.5C3 1.22386 3.22386 1 3.5 1H9.5L13 4.5V14.5C13 14.7761 12.7761 15 12.5 15H3.5C3.22386 15 3 14.7761 3 14.5V1.5Z" fill="var(--joy-palette-neutral-400, #9fa6b2)" />
      <path d="M9.5 1L13 4.5H10C9.72386 4.5 9.5 4.27614 9.5 4V1Z" fill="var(--joy-palette-neutral-300, #cdd7e1)" />
    </svg>
  )
}

function FileTreeNode({ entry, depth, selectedFile, onSelectFile, onToggleDir, expandedDirs, treeData, loadingDirs }) {
  const isDir = entry.type === 'dir'
  const isExpanded = expandedDirs.has(entry.path)
  const isSelected = selectedFile === entry.path
  const isLoading = loadingDirs.has(entry.path)
  const name = entry.path.split('/').pop()

  return (
    <>
      <Box
        onClick={() => isDir ? onToggleDir(entry.path) : onSelectFile(entry.path)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: 1 + depth * 1.5,
          pr: 1,
          py: 0.25,
          cursor: 'pointer',
          borderRadius: 'sm',
          bgcolor: isSelected ? 'primary.softBg' : 'transparent',
          '&:hover': { bgcolor: isSelected ? 'primary.softBg' : 'background.level1' },
          userSelect: 'none',
          minHeight: 26,
        }}
      >
        {isDir ? <FolderIcon open={isExpanded} /> : <FileIcon />}
        <Typography
          level="body-xs"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.7rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: isSelected ? 'lg' : 'md',
          }}
        >
          {name}
        </Typography>
        {isLoading && <CircularProgress size="sm" sx={{ ml: 'auto', '--CircularProgress-size': '12px' }} />}
      </Box>
      {isDir && isExpanded && treeData[entry.path] && (
        treeData[entry.path].map((child) => (
          <FileTreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            onToggleDir={onToggleDir}
            expandedDirs={expandedDirs}
            treeData={treeData}
            loadingDirs={loadingDirs}
          />
        ))
      )}
    </>
  )
}

function ExploreTab({ repoName, branchNames, defaultBranch }) {
  const [selectedRef, setSelectedRef] = useState(defaultBranch || 'HEAD')
  const [treeData, setTreeData] = useState({})       // { parentPath: [entries] }
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [loadingDirs, setLoadingDirs] = useState(new Set())
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState(null)
  const [rootLoading, setRootLoading] = useState(true)
  const [rootError, setRootError] = useState(null)

  // Fetch directory listing
  const fetchDir = useCallback(async (dirPath, ref) => {
    const params = new URLSearchParams()
    if (ref) params.set('ref', ref)
    if (dirPath) params.set('path', dirPath)
    const res = await fetch(`${API}/api/admin/repos/${repoName}/src?${params}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    return res.json()
  }, [repoName])

  // Load root on mount / branch change
  useEffect(() => {
    let cancelled = false
    setRootLoading(true)
    setRootError(null)
    setTreeData({})
    setExpandedDirs(new Set())
    setSelectedFile(null)
    setFileContent('')
    setFileError(null)

    ;(async () => {
      try {
        const entries = await fetchDir('', selectedRef)
        if (!cancelled) {
          setTreeData({ '': entries })
          setRootLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setRootError(err.message)
          setRootLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [fetchDir, selectedRef])

  // Toggle directory expand/collapse
  const handleToggleDir = useCallback(async (dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
        return next
      }
      next.add(dirPath)
      return next
    })

    // Only fetch if we haven't loaded this dir yet
    if (treeData[dirPath]) return

    setLoadingDirs((prev) => new Set(prev).add(dirPath))
    try {
      const entries = await fetchDir(dirPath, selectedRef)
      setTreeData((prev) => ({ ...prev, [dirPath]: entries }))
    } catch (err) {
      console.error('Failed to load directory:', err)
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    }
  }, [treeData, fetchDir, selectedRef])

  // Load file content
  const handleSelectFile = useCallback(async (filePath) => {
    setSelectedFile(filePath)
    setFileLoading(true)
    setFileError(null)
    setFileContent('')

    try {
      const params = new URLSearchParams({ path: filePath })
      if (selectedRef) params.set('ref', selectedRef)
      const res = await fetch(`${API}/api/admin/repos/${repoName}/file?${params}`)

      if (res.status === 413) {
        setFileError('File too large to display')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const text = await res.text()
      setFileContent(text)
    } catch (err) {
      setFileError(err.message)
    } finally {
      setFileLoading(false)
    }
  }, [repoName, selectedRef])

  const isBinary = selectedFile && fileContent && looksLikeBinary(fileContent)
  const language = getLanguageFromPath(selectedFile)

  // Filter branch names to get clean names for the selector
  const cleanBranches = useMemo(() => {
    return branchNames
      .filter((b) => !b.startsWith('origin/HEAD'))
      .map((b) => b.replace(/^origin\//, ''))
      .filter((v, i, a) => a.indexOf(v) === i) // unique
      .sort()
  }, [branchNames])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)', minHeight: 400 }}>
      {/* Branch selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>Branch:</Typography>
        <Select
          size="sm"
          value={selectedRef}
          onChange={(_e, val) => val && setSelectedRef(val)}
          sx={{ minWidth: 200, fontFamily: 'monospace', fontSize: '0.75rem' }}
        >
          {cleanBranches.length > 0 ? (
            cleanBranches.map((b) => (
              <Option key={b} value={b} sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{b}</Option>
            ))
          ) : (
            <Option value="HEAD">HEAD</Option>
          )}
        </Select>
      </Box>

      {/* Main layout: file tree + editor */}
      <Box sx={{ display: 'flex', flex: 1, border: '1px solid', borderColor: 'divider', borderRadius: 'sm', overflow: 'hidden' }}>
        {/* File tree panel */}
        <Sheet
          variant="soft"
          sx={{
            width: 260,
            minWidth: 200,
            maxWidth: 400,
            overflow: 'auto',
            borderRight: '1px solid',
            borderColor: 'divider',
            py: 0.5,
          }}
        >
          {rootLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size="sm" />
            </Box>
          ) : rootError ? (
            <Box sx={{ p: 2 }}>
              <Typography level="body-xs" color="danger">{rootError}</Typography>
            </Box>
          ) : treeData[''] ? (
            treeData[''].map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
                onToggleDir={handleToggleDir}
                expandedDirs={expandedDirs}
                treeData={treeData}
                loadingDirs={loadingDirs}
              />
            ))
          ) : (
            <Typography level="body-xs" color="neutral" sx={{ p: 2 }}>Empty repository</Typography>
          )}
        </Sheet>

        {/* Editor panel */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* File path breadcrumb */}
          {selectedFile && (
            <Box sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.level1' }}>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'text.secondary' }}>
                {selectedFile}
              </Typography>
            </Box>
          )}

          {/* Editor area */}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {!selectedFile ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography level="body-sm" color="neutral">Select a file to view its contents</Typography>
              </Box>
            ) : fileLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <CircularProgress size="sm" />
              </Box>
            ) : fileError ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography level="body-sm" color="danger">{fileError}</Typography>
              </Box>
            ) : isBinary ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography level="body-sm" color="neutral">Binary file &mdash; cannot display content</Typography>
              </Box>
            ) : (
              <Editor
                height="100%"
                language={language}
                value={fileContent}
                theme="vs"
                options={{
                  readOnly: true,
                  minimap: { enabled: true },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'off',
                  automaticLayout: true,
                  domReadOnly: true,
                }}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminRepoDetailPage() {
  const { '*': repoName } = useParams()

  const [repo, setRepo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(0)
  const [mountedTabs, setMountedTabs] = useState({ 0: true })

  // Track which tabs have been visited so we mount them lazily but keep them alive
  const handleTabChange = (_event, newValue) => {
    setActiveTab(newValue)
    setMountedTabs((prev) => ({ ...prev, [newValue]: true }))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/admin/repos/${repoName}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        if (!cancelled) setRepo(await res.json())
      } catch (err) {
        console.error('Failed to fetch repo:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoName])

  const technologies = useMemo(() => safeParse(repo?.technologies, []), [repo])
  const securitySummary = useMemo(() => safeParse(repo?.security, {}), [repo])

  // Derive branch names for the contributions filter (fetched once by BranchesTab,
  // but we also need them in ContributionsTab — fetch a lightweight list here)
  const [branchNames, setBranchNames] = useState([])
  useEffect(() => {
    if (!repoName) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API}/api/admin/repos/${repoName}/branches`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setBranchNames(data.map((b) => b.name).sort())
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [repoName])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!repo) {
    return (
      <Box>
        <Button component={RouterLink} to="/repos" variant="plain" size="sm" sx={{ mb: 2 }}>
          &larr; Back to Repos
        </Button>
        <Typography level="h4" color="danger">Repository not found</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      {/* Header */}
      <Button component={RouterLink} to="/repos" variant="plain" size="sm" sx={{ mb: 1 }}>
        &larr; Back to Repos
      </Button>

      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography level="h3" sx={{ fontFamily: 'monospace' }}>
          {repo.name}
        </Typography>
        {repo.default_branch && (
          <Chip size="sm" variant="soft" color="primary" sx={{ fontFamily: 'monospace' }}>
            {repo.default_branch}
          </Chip>
        )}
      </Box>

      <Typography level="body-sm" sx={{ color: 'text.tertiary', mb: 1 }}>
        Last seen {timeAgo(repo.last_seen_at)} &middot; {repo.path}
      </Typography>

      {/* Technologies (always visible in header area) */}
      {technologies.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
          {technologies.map((tech) => (
            <Chip key={tech} size="sm" variant="soft" color="neutral">{tech}</Chip>
          ))}
        </Box>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onChange={handleTabChange} sx={{ borderRadius: 'sm' }}>
        <TabList>
          <Tab>Branches</Tab>
          <Tab>Contributions</Tab>
          <Tab>Dependencies</Tab>
          <Tab>
            Security
            {Object.values(securitySummary).some((v) => v > 0) && (
              <Chip size="sm" variant="soft" color="danger" sx={{ ml: 1, fontSize: '0.65rem' }}>
                {Object.values(securitySummary).reduce((a, b) => a + b, 0)}
              </Chip>
            )}
          </Tab>
          <Tab>Explore</Tab>
        </TabList>

        <TabPanel value={0} sx={{ p: 0, pt: 2 }}>
          {mountedTabs[0] && <BranchesTab repoName={repoName} />}
        </TabPanel>

        <TabPanel value={1} sx={{ p: 0, pt: 2 }}>
          {mountedTabs[1] && <ContributionsTab repoName={repoName} branchNames={branchNames} defaultBranch={repo.default_branch} />}
        </TabPanel>

        <TabPanel value={2} sx={{ p: 0, pt: 2 }}>
          {mountedTabs[2] && <DependenciesTab repoName={repoName} />}
        </TabPanel>

        <TabPanel value={3} sx={{ p: 0, pt: 2 }}>
          {mountedTabs[3] && <SecurityTab repoName={repoName} securitySummary={securitySummary} />}
        </TabPanel>

        <TabPanel value={4} sx={{ p: 0, pt: 2 }}>
          {mountedTabs[4] && <ExploreTab repoName={repoName} branchNames={branchNames} defaultBranch={repo.default_branch} />}
        </TabPanel>
      </Tabs>
    </Box>
  )
}
