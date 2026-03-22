import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { io } from 'socket.io-client'
import Box from '@mui/joy/Box'
import Button from '@mui/joy/Button'
import Checkbox from '@mui/joy/Checkbox'
import Chip from '@mui/joy/Chip'
import AccordionGroup from '@mui/joy/AccordionGroup'
import Accordion from '@mui/joy/Accordion'
import AccordionSummary from '@mui/joy/AccordionSummary'
import AccordionDetails from '@mui/joy/AccordionDetails'
import IconButton from '@mui/joy/IconButton'
import Input from '@mui/joy/Input'
import LinearProgress from '@mui/joy/LinearProgress'
import List from '@mui/joy/List'
import ListItem from '@mui/joy/ListItem'
import ListItemButton from '@mui/joy/ListItemButton'
import ListSubheader from '@mui/joy/ListSubheader'
import Option from '@mui/joy/Option'
import Select from '@mui/joy/Select'
import Sheet from '@mui/joy/Sheet'
import Stack from '@mui/joy/Stack'
import Table from '@mui/joy/Table'
import Typography from '@mui/joy/Typography'
import Alert from '@mui/joy/Alert'
import Link from '@mui/joy/Link'

const SOCKET_URL = 'http://localhost:3001'
const API_URL = 'http://localhost:3001'

const COMMANDS = [
  { value: 'author', label: 'Author' },
  { value: 'message', label: 'Message' },
  { value: 'filepath', label: 'File Path' },
  { value: 'content', label: 'Content' },
]

const COMMAND_LABELS = Object.fromEntries(COMMANDS.map((c) => [c.value, c.label]))

const mono = { fontFamily: 'ui-monospace, Consolas, "Liberation Mono", monospace' }

function defaultDateFrom() {
  const d = new Date()
  d.setMonth(d.getMonth() - 3)
  return d.toISOString().slice(0, 10)
}

function defaultDateTo() {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Result renderers
// ---------------------------------------------------------------------------

function AuthorMessageTable({ results }) {
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [filterRepo, setFilterRepo] = useState('')
  const [filterAuthor, setFilterAuthor] = useState('')
  const [filterSubject, setFilterSubject] = useState('')

  const handleSort = (col) => {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(col); setSortDir('asc') }
  }
  const si = (col) => sortKey === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const filtered = useMemo(() => {
    let r = results
    if (filterRepo) r = r.filter((x) => x.repo?.toLowerCase().includes(filterRepo.toLowerCase()))
    if (filterAuthor) r = r.filter((x) => x.authorName?.toLowerCase().includes(filterAuthor.toLowerCase()))
    if (filterSubject) r = r.filter((x) => x.subject?.toLowerCase().includes(filterSubject.toLowerCase()))
    return [...r].sort((a, b) => {
      const av = a[sortKey] || ''
      const bv = b[sortKey] || ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [results, filterRepo, filterAuthor, filterSubject, sortKey, sortDir])

  return (
    <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto' }}>
      <Table
        variant="plain"
        color="neutral"
        size="md"
        stickyHeader
        sx={{ '& th[data-sortable]': { cursor: 'pointer', userSelect: 'none' } }}
      >
        <thead>
          <tr>
            <th data-sortable style={{ width: '18%' }} onClick={() => handleSort('repo')}>Repo{si('repo')}</th>
            <th style={{ width: '12%' }}>Commit</th>
            <th data-sortable style={{ width: '20%' }} onClick={() => handleSort('authorName')}>Author{si('authorName')}</th>
            <th data-sortable style={{ width: '15%' }} onClick={() => handleSort('date')}>Date{si('date')}</th>
            <th data-sortable onClick={() => handleSort('subject')}>Subject{si('subject')}</th>
          </tr>
          <tr>
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterRepo} onChange={(e) => setFilterRepo(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
            <th />
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterAuthor} onChange={(e) => setFilterAuthor(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
            <th />
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => (
            <tr key={i}>
              <td><Link component={RouterLink} to={`/repos/${r.repo}`} level="body-xs" sx={mono}>{r.repo}</Link></td>
              <td>
                <Link
                  component={RouterLink}
                  to={`/commit/${r.repo}/${r.commit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  level="body-xs"
                  sx={mono}
                >
                  {r.commit?.substring(0, 10)}
                </Link>
              </td>
              <td><Typography level="body-xs">{r.authorName}</Typography></td>
              <td><Typography level="body-xs">{r.date ? new Date(r.date).toLocaleDateString() : ''}</Typography></td>
              <td><Typography level="body-xs">{r.subject}</Typography></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Sheet>
  )
}

function FilepathTable({ results }) {
  const [sortKey, setSortKey] = useState('repo')
  const [sortDir, setSortDir] = useState('asc')
  const [filterRepo, setFilterRepo] = useState('')
  const [filterFilepath, setFilterFilepath] = useState('')
  const [filterScope, setFilterScope] = useState('')

  const handleSort = (col) => {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(col); setSortDir('asc') }
  }
  const si = (col) => sortKey === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const filtered = useMemo(() => {
    let r = results
    if (filterRepo) r = r.filter((x) => x.repo?.toLowerCase().includes(filterRepo.toLowerCase()))
    if (filterFilepath) r = r.filter((x) => x.filepath?.toLowerCase().includes(filterFilepath.toLowerCase()))
    if (filterScope) r = r.filter((x) => x.scope?.toLowerCase().includes(filterScope.toLowerCase()))
    return [...r].sort((a, b) => {
      const av = a[sortKey] || ''
      const bv = b[sortKey] || ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [results, filterRepo, filterFilepath, filterScope, sortKey, sortDir])

  return (
    <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto' }}>
      <Table
        variant="plain"
        color="neutral"
        size="md"
        stickyHeader
        sx={{ '& th[data-sortable]': { cursor: 'pointer', userSelect: 'none' } }}
      >
        <thead>
          <tr>
            <th data-sortable style={{ width: '25%' }} onClick={() => handleSort('repo')}>Repo{si('repo')}</th>
            <th data-sortable onClick={() => handleSort('filepath')}>File Path{si('filepath')}</th>
            <th data-sortable style={{ width: '12%' }} onClick={() => handleSort('scope')}>Scope{si('scope')}</th>
          </tr>
          <tr>
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterRepo} onChange={(e) => setFilterRepo(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterFilepath} onChange={(e) => setFilterFilepath(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterScope} onChange={(e) => setFilterScope(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => (
            <tr key={i}>
              <td><Link component={RouterLink} to={`/repos/${r.repo}`} level="body-xs" sx={mono}>{r.repo}</Link></td>
              <td><Typography level="body-xs" sx={mono}>{r.filepath}</Typography></td>
              <td><Typography level="body-xs">{r.scope}</Typography></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Sheet>
  )
}

function ContentHeadList({ results }) {
  // Group by repo, then by file
  const grouped = {}
  for (const r of results) {
    if (!grouped[r.repo]) grouped[r.repo] = {}
    if (!grouped[r.repo][r.file]) grouped[r.repo][r.file] = []
    grouped[r.repo][r.file].push(r)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {Object.entries(grouped).map(([repo, files]) => (
        <Sheet key={repo} variant="outlined" sx={{ borderRadius: 'sm', overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 1, bgcolor: 'background.level1' }}>
            <Link component={RouterLink} to={`/repos/${repo}`} level="title-sm" sx={mono}>{repo}</Link>
          </Box>
          <List size="sm">
            {Object.entries(files).map(([file, lines]) => (
              <ListItem key={file} nested>
                <ListSubheader sx={{ ...mono, fontSize: '0.75rem', color: 'primary.300' }}>
                  {file}
                </ListSubheader>
                <List>
                  {lines.map((l, i) => (
                    <ListItem key={i} sx={{ py: 0.25, minHeight: 0 }}>
                      <Typography
                        level="body-xs"
                        sx={{
                          ...mono,
                          whiteSpace: 'pre',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <Typography component="span" sx={{ ...mono, color: 'neutral.400', mr: 1, display: 'inline', fontSize: 'inherit' }}>
                          {l.line}:
                        </Typography>
                        {l.content}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              </ListItem>
            ))}
          </List>
        </Sheet>
      ))}
    </Box>
  )
}

function ContentAllCommitsTable({ results }) {
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [filterRepo, setFilterRepo] = useState('')
  const [filterAuthor, setFilterAuthor] = useState('')
  const [filterSubject, setFilterSubject] = useState('')

  const handleSort = (col) => {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(col); setSortDir('asc') }
  }
  const si = (col) => sortKey === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const filtered = useMemo(() => {
    let r = results
    if (filterRepo) r = r.filter((x) => x.repo?.toLowerCase().includes(filterRepo.toLowerCase()))
    if (filterAuthor) r = r.filter((x) => x.author?.toLowerCase().includes(filterAuthor.toLowerCase()))
    if (filterSubject) r = r.filter((x) => x.subject?.toLowerCase().includes(filterSubject.toLowerCase()))
    return [...r].sort((a, b) => {
      const av = a[sortKey] || ''
      const bv = b[sortKey] || ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [results, filterRepo, filterAuthor, filterSubject, sortKey, sortDir])

  return (
    <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto' }}>
      <Table
        variant="plain"
        color="neutral"
        size="md"
        stickyHeader
        sx={{ '& th[data-sortable]': { cursor: 'pointer', userSelect: 'none' } }}
      >
        <thead>
          <tr>
            <th data-sortable style={{ width: '15%' }} onClick={() => handleSort('repo')}>Repo{si('repo')}</th>
            <th style={{ width: '12%' }}>Commit</th>
            <th data-sortable style={{ width: '15%' }} onClick={() => handleSort('author')}>Author{si('author')}</th>
            <th data-sortable style={{ width: '12%' }} onClick={() => handleSort('date')}>Date{si('date')}</th>
            <th data-sortable style={{ width: '22%' }} onClick={() => handleSort('subject')}>Subject{si('subject')}</th>
            <th>Files Changed</th>
          </tr>
          <tr>
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterRepo} onChange={(e) => setFilterRepo(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
            <th />
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterAuthor} onChange={(e) => setFilterAuthor(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
            <th />
            <th style={{ padding: '4px 8px' }}>
              <Input size="sm" placeholder="Filter..." value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)} sx={{ fontSize: '0.75rem' }} />
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => (
            <tr key={i}>
              <td><Link component={RouterLink} to={`/repos/${r.repo}`} level="body-xs" sx={mono}>{r.repo}</Link></td>
              <td>
                <Link
                  component={RouterLink}
                  to={`/commit/${r.repo}/${r.commit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  level="body-xs"
                  sx={mono}
                >
                  {r.commit?.substring(0, 10)}
                </Link>
              </td>
              <td><Typography level="body-xs">{r.author}</Typography></td>
              <td><Typography level="body-xs">{r.date ? new Date(r.date).toLocaleDateString() : ''}</Typography></td>
              <td><Typography level="body-xs">{r.subject}</Typography></td>
              <td>
                <Typography level="body-xs" sx={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {r.filesChanged?.replaceAll('|', '\n')}
                </Typography>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Sheet>
  )
}

function Results({ command, results, allCommits }) {
  if (!results || results.length === 0) return null

  if (command === 'author' || command === 'message') {
    return <AuthorMessageTable results={results} />
  }
  if (command === 'filepath') {
    return <FilepathTable results={results} />
  }
  if (command === 'content') {
    if (allCommits) return <ContentAllCommitsTable results={results} />
    return <ContentHeadList results={results} />
  }
  return null
}

// ---------------------------------------------------------------------------
// SearchPage
// ---------------------------------------------------------------------------

export default function SearchPage() {
  const [command, setCommand] = useState('author')
  const [pattern, setPattern] = useState('')
  const [repo, setRepo] = useState('')
  const [allCommits, setAllCommits] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [lastCommand, setLastCommand] = useState(null)
  const [lastAllCommits, setLastAllCommits] = useState(false)
  const [progress, setProgress] = useState(null) // { searched, total, repoName }
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  // Recent & favourite searches
  const [recentSearches, setRecentSearches] = useState([])
  const [favouriteSearches, setFavouriteSearches] = useState([])
  const [showRecent, setShowRecent] = useState(false)
  const [hasSearched, setHasSearched] = useState(false) // tracks whether a search was performed (to show star)

  const socketRef = useRef(null)
  const resultsRef = useRef([])
  const patternInputRef = useRef(null)
  const recentDropdownRef = useRef(null)

  const showAllCommits = command === 'filepath' || command === 'content'

  // Fetch recent searches
  const fetchRecent = useCallback(() => {
    fetch(`${API_URL}/api/search/recent?limit=20`)
      .then((r) => r.json())
      .then(setRecentSearches)
      .catch(() => {})
  }, [])

  // Fetch favourite searches
  const fetchFavourites = useCallback(() => {
    fetch(`${API_URL}/api/search/favourites`)
      .then((r) => r.json())
      .then(setFavouriteSearches)
      .catch(() => {})
  }, [])

  // Load on mount
  useEffect(() => {
    fetchRecent()
    fetchFavourites()
  }, [fetchRecent, fetchFavourites])

  // Close recent dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        recentDropdownRef.current &&
        !recentDropdownRef.current.contains(e.target) &&
        patternInputRef.current &&
        !patternInputRef.current.contains(e.target)
      ) {
        setShowRecent(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Check if current search is already a favourite
  const isFavourite = useMemo(() => {
    if (!pattern.trim() || !hasSearched) return false
    return favouriteSearches.some(
      (f) =>
        f.term === command &&
        f.search_pattern === pattern.trim() &&
        (f.repos_filter || '') === (repo.trim() || '')
    )
  }, [favouriteSearches, command, pattern, repo, hasSearched])

  const currentFavouriteId = useMemo(() => {
    if (!isFavourite) return null
    const match = favouriteSearches.find(
      (f) =>
        f.term === command &&
        f.search_pattern === pattern.trim() &&
        (f.repos_filter || '') === (repo.trim() || '')
    )
    return match?.id || null
  }, [isFavourite, favouriteSearches, command, pattern, repo])

  // Toggle favourite
  const handleToggleFavourite = useCallback(async () => {
    if (isFavourite && currentFavouriteId) {
      // Remove
      await fetch(`${API_URL}/api/search/favourites/${currentFavouriteId}`, { method: 'DELETE' })
    } else {
      // Add
      await fetch(`${API_URL}/api/search/favourites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: command,
          search_pattern: pattern.trim(),
          repos_filter: repo.trim() || null,
        }),
      })
    }
    fetchFavourites()
  }, [isFavourite, currentFavouriteId, command, pattern, repo, fetchFavourites])

  // Remove a favourite by id
  const handleRemoveFavourite = useCallback(async (id) => {
    await fetch(`${API_URL}/api/search/favourites/${id}`, { method: 'DELETE' })
    fetchFavourites()
  }, [fetchFavourites])

  // Apply a saved search (from recent or favourite)
  const applySearch = useCallback((term, searchPattern, reposFilter) => {
    setCommand(term)
    setPattern(searchPattern)
    setRepo(reposFilter || '')
    setShowRecent(false)
  }, [])

  // Maintain a persistent socket connection
  useEffect(() => {
    const socket = io(SOCKET_URL)
    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [])

  const handleSearch = useCallback((e) => {
    e.preventDefault()
    if (!pattern.trim()) return

    const socket = socketRef.current
    if (!socket) return

    // Reset state
    setLoading(true)
    setError(null)
    setResults([])
    setProgress({ searched: 0, total: 0, repoName: '' })
    setLastCommand(command)
    setLastAllCommits(allCommits)
    setHasSearched(true)
    resultsRef.current = []

    // Remove any previous listeners to avoid duplicates
    socket.off('search:started')
    socket.off('search:progress')
    socket.off('search:results')
    socket.off('search:done')
    socket.off('search:error')

    socket.on('search:started', ({ total }) => {
      setProgress({ searched: 0, total, repoName: '' })
    })

    socket.on('search:progress', ({ searched, total, repoName }) => {
      setProgress({ searched, total, repoName })
    })

    socket.on('search:results', (newResults) => {
      resultsRef.current = [...resultsRef.current, ...newResults]
      setResults([...resultsRef.current])
    })

    socket.on('search:done', () => {
      setLoading(false)
      setProgress(null)
      fetchRecent() // refresh recent list after search completes
      // Clean up listeners
      socket.off('search:started')
      socket.off('search:progress')
      socket.off('search:results')
      socket.off('search:done')
      socket.off('search:error')
    })

    socket.on('search:error', ({ error: errMsg }) => {
      setError(errMsg)
      setLoading(false)
      setProgress(null)
      socket.off('search:started')
      socket.off('search:progress')
      socket.off('search:results')
      socket.off('search:done')
      socket.off('search:error')
    })

    // Emit the search request
    socket.emit('search:start', {
      command,
      pattern: pattern.trim(),
      repo: repo.trim() || undefined,
      allCommits: showAllCommits && allCommits,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
  }, [command, pattern, repo, allCommits, showAllCommits, dateFrom, dateTo, fetchRecent])

  const progressPct = progress && progress.total > 0
    ? Math.round((progress.searched / progress.total) * 100)
    : 0

  // Deduplicated recent searches (by term + pattern + filter)
  const dedupedRecent = useMemo(() => {
    const seen = new Set()
    return recentSearches.filter((s) => {
      const key = `${s.term}|${s.search_pattern}|${s.repos_filter || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [recentSearches])

  return (
    <Box>
      <Typography level="h3" sx={{ mb: 2 }} className="no-print">
        Search
      </Typography>

      <form onSubmit={handleSearch} className="no-print">
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', gap: 1, mb: 2, alignItems: 'flex-end' }}
        >
          <Select
            value={command}
            onChange={(_, val) => { if (val) setCommand(val) }}
            size="sm"
            sx={{ minWidth: 130 }}
          >
            {COMMANDS.map((c) => (
              <Option key={c.value} value={c.value}>{c.label}</Option>
            ))}
          </Select>

          {/* Pattern input with recent searches dropdown */}
          <Box sx={{ position: 'relative', flexGrow: 1, minWidth: 200 }}>
            <Input
              ref={patternInputRef}
              size="sm"
              placeholder="Search pattern..."
              required
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onFocus={() => { if (dedupedRecent.length > 0) setShowRecent(true) }}
              sx={{ width: '100%' }}
              startDecorator={
                <Typography level="body-xs" sx={{ color: 'neutral.400' }}>
                  &#128269;
                </Typography>
              }
            />
            {showRecent && dedupedRecent.length > 0 && (
              <Sheet
                ref={recentDropdownRef}
                variant="outlined"
                sx={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 1000,
                  maxHeight: 280,
                  overflow: 'auto',
                  borderRadius: 'sm',
                  mt: 0.5,
                  boxShadow: 'md',
                }}
              >
                <List size="sm" sx={{ py: 0.5 }}>
                  <ListSubheader sx={{ fontSize: '0.7rem' }}>Recent searches</ListSubheader>
                  {dedupedRecent.map((s) => (
                    <ListItem key={s.id} sx={{ py: 0 }}>
                      <ListItemButton
                        sx={{ py: 0.5, gap: 1 }}
                        onClick={() => applySearch(s.term, s.search_pattern, s.repos_filter)}
                      >
                        <Chip size="sm" variant="soft" color="neutral" sx={{ fontSize: '0.65rem', minHeight: 18 }}>
                          {COMMAND_LABELS[s.term] || s.term}
                        </Chip>
                        <Typography level="body-xs" sx={{ ...mono, flex: 1 }}>
                          {s.search_pattern}
                        </Typography>
                        {s.repos_filter && (
                          <Chip size="sm" variant="outlined" color="primary" sx={{ fontSize: '0.6rem', minHeight: 16 }}>
                            {s.repos_filter}
                          </Chip>
                        )}
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              </Sheet>
            )}
          </Box>

          <Input
            size="sm"
            placeholder="Filter repos..."
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            sx={{ minWidth: 150 }}
          />

          <Input
            size="sm"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            sx={{ minWidth: 140 }}
            startDecorator={
              <Typography level="body-xs" sx={{ color: 'neutral.400' }}>
                From
              </Typography>
            }
          />

          <Input
            size="sm"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            sx={{ minWidth: 140 }}
            startDecorator={
              <Typography level="body-xs" sx={{ color: 'neutral.400' }}>
                To
              </Typography>
            }
          />

          {showAllCommits && (
            <Checkbox
              size="sm"
              label="All commits"
              checked={allCommits}
              onChange={(e) => setAllCommits(e.target.checked)}
            />
          )}

          <Button type="submit" size="sm" loading={loading}>
            Search
          </Button>

          {/* Star button to save/unsave current search as favourite */}
          {hasSearched && pattern.trim() && (
            <IconButton
              size="sm"
              variant={isFavourite ? 'solid' : 'outlined'}
              color={isFavourite ? 'warning' : 'neutral'}
              onClick={handleToggleFavourite}
              title={isFavourite ? 'Remove from favourites' : 'Save as favourite'}
            >
              {isFavourite ? '\u2605' : '\u2606'}
            </IconButton>
          )}
        </Stack>
      </form>

      {/* Favourite searches — collapsible list */}
      {favouriteSearches.length > 0 && (
        <AccordionGroup size="sm" sx={{ mb: 2 }} className="no-print">
          <Accordion defaultExpanded>
            <AccordionSummary>
              <Typography level="title-sm">
                Favourite searches ({favouriteSearches.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <List size="sm" sx={{ py: 0 }}>
                {favouriteSearches.map((f) => (
                  <ListItem
                    key={f.id}
                    endAction={
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="danger"
                        onClick={() => handleRemoveFavourite(f.id)}
                        title="Remove from favourites"
                        sx={{ minWidth: 24, minHeight: 24 }}
                      >
                        &#10005;
                      </IconButton>
                    }
                    sx={{ py: 0.25 }}
                  >
                    <ListItemButton
                      sx={{ py: 0.5, gap: 1, borderRadius: 'sm' }}
                      onClick={() => applySearch(f.term, f.search_pattern, f.repos_filter)}
                    >
                      <Chip size="sm" variant="soft" color="neutral" sx={{ fontSize: '0.65rem', minHeight: 18 }}>
                        {COMMAND_LABELS[f.term] || f.term}
                      </Chip>
                      <Typography level="body-sm" sx={mono}>
                        {f.search_pattern}
                      </Typography>
                      {f.repos_filter && (
                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                          repos: {f.repos_filter}
                        </Typography>
                      )}
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </AccordionDetails>
          </Accordion>
        </AccordionGroup>
      )}

      {loading && progress && (
        <Box sx={{ mb: 2 }} className="no-print">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography level="body-xs" sx={{ color: 'neutral.400' }}>
              Searching: {progress.repoName || '...'}
            </Typography>
            <Typography level="body-xs" sx={{ color: 'neutral.400' }}>
              {progress.searched} / {progress.total} repos ({progressPct}%)
            </Typography>
          </Box>
          <LinearProgress
            determinate
            value={progressPct}
            size="sm"
            sx={{
              '--LinearProgress-thickness': '8px',
            }}
          />
        </Box>
      )}

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }} className="no-print">
          {error}
        </Alert>
      )}

      {results && results.length > 0 && (
        <Box>
          <Chip size="sm" variant="soft" color="neutral" sx={{ mb: 1.5 }} className="no-print">
            {results.length} result{results.length !== 1 ? 's' : ''}{loading ? ' (so far)' : ''}
          </Chip>
          <Results command={lastCommand} results={results} allCommits={lastAllCommits} />
        </Box>
      )}

      {results && results.length === 0 && !loading && (
        <Alert color="neutral" variant="soft" className="no-print">
          No results found.
        </Alert>
      )}

    </Box>
  )
}
