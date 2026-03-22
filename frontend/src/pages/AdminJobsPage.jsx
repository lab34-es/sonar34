import { useState, useEffect, useCallback, useRef } from 'react'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Table from '@mui/joy/Table'
import Sheet from '@mui/joy/Sheet'
import Chip from '@mui/joy/Chip'
import Button from '@mui/joy/Button'
import Tabs from '@mui/joy/Tabs'
import TabList from '@mui/joy/TabList'
import Tab from '@mui/joy/Tab'
import TabPanel from '@mui/joy/TabPanel'
import CircularProgress from '@mui/joy/CircularProgress'
import { io } from 'socket.io-client'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const STATUS_COLOR = {
  pending: 'neutral',
  running: 'primary',
  done: 'success',
  failed: 'danger',
}

const QUEUES = [
  { key: 'sync_jobs', label: 'Sync Jobs' },
  { key: 'enrichment_jobs', label: 'Enrichment Jobs' },
  { key: 'search_jobs', label: 'Search Jobs' },
]

const PAGE_SIZE = 50

function formatDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso + 'Z')
  return d.toLocaleString()
}

function parseSyncAction(job) {
  try {
    const p = JSON.parse(job.progress)
    return p?.action || '-'
  } catch {
    return '-'
  }
}

// ---------------------------------------------------------------------------
// Per-queue table renderers
// ---------------------------------------------------------------------------

function SyncJobsTable({ rows }) {
  if (rows.length === 0) return <Typography level="body-sm" sx={{ p: 2 }}>No jobs.</Typography>
  return (
    <Table variant="plain" color="neutral" size="md" stickyHeader>
      <thead>
        <tr>
          <th>Type</th>
          <th>ID</th>
          <th>Repository</th>
          <th>Status</th>
          <th>Action</th>
          <th>Error</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((job) => (
          <tr key={job.id}>
            <td>
              <Chip size="sm" variant="soft" color={job.type === 'sync-all' ? 'warning' : 'neutral'}>
                {job.type}
              </Chip>
            </td>
            <td>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                {job.id.slice(0, 8)}
              </Typography>
            </td>
            <td>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                {job.repo_name || '-'}
              </Typography>
            </td>
            <td>
              <Chip size="sm" variant="soft" color={STATUS_COLOR[job.status] || 'neutral'}>
                {job.status}
              </Chip>
            </td>
            <td><Typography level="body-xs">{parseSyncAction(job)}</Typography></td>
            <td>
              <Typography level="body-xs" color="danger">
                {job.error ? job.error.slice(0, 80) : '-'}
              </Typography>
            </td>
            <td><Typography level="body-xs">{formatDate(job.created_at)}</Typography></td>
            <td><Typography level="body-xs">{formatDate(job.updated_at)}</Typography></td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function EnrichmentJobsTable({ rows }) {
  if (rows.length === 0) return <Typography level="body-sm" sx={{ p: 2 }}>No jobs.</Typography>
  return (
    <Table variant="plain" color="neutral" size="md" stickyHeader>
      <thead>
        <tr>
          <th>Type</th>
          <th>ID</th>
          <th>Repository</th>
          <th>Status</th>
          <th>Error</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((job) => (
          <tr key={job.id}>
            <td>
              <Chip size="sm" variant="soft" color="neutral">
                {job.type}
              </Chip>
            </td>
            <td>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                {job.id.slice(0, 8)}
              </Typography>
            </td>
            <td>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                {job.repo_name || '-'}
              </Typography>
            </td>
            <td>
              <Chip size="sm" variant="soft" color={STATUS_COLOR[job.status] || 'neutral'}>
                {job.status}
              </Chip>
            </td>
            <td>
              <Typography level="body-xs" color="danger">
                {job.error ? job.error.slice(0, 80) : '-'}
              </Typography>
            </td>
            <td><Typography level="body-xs">{formatDate(job.created_at)}</Typography></td>
            <td><Typography level="body-xs">{formatDate(job.updated_at)}</Typography></td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function SearchJobsTable({ rows }) {
  if (rows.length === 0) return <Typography level="body-sm" sx={{ p: 2 }}>No jobs.</Typography>
  return (
    <Table variant="soft" color="neutral" size="md" stickyHeader>
      <thead>
        <tr>
          <th>ID</th>
          <th>Command</th>
          <th>Pattern</th>
          <th>Status</th>
          <th>Error</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((job) => (
          <tr key={job.id}>
            <td>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                {job.id.slice(0, 8)}
              </Typography>
            </td>
            <td>
              <Chip size="sm" variant="soft" color="neutral">
                {job.command}
              </Chip>
            </td>
            <td>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                {job.pattern}
              </Typography>
            </td>
            <td>
              <Chip size="sm" variant="soft" color={STATUS_COLOR[job.status] || 'neutral'}>
                {job.status}
              </Chip>
            </td>
            <td>
              <Typography level="body-xs" color="danger">
                {job.error ? job.error.slice(0, 80) : '-'}
              </Typography>
            </td>
            <td><Typography level="body-xs">{formatDate(job.created_at)}</Typography></td>
            <td><Typography level="body-xs">{formatDate(job.updated_at)}</Typography></td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

const TABLE_COMPONENT = {
  sync_jobs: SyncJobsTable,
  enrichment_jobs: EnrichmentJobsTable,
  search_jobs: SearchJobsTable,
}

// Map socket event names to their queue keys
const SOCKET_EVENT_TO_QUEUE = {
  'sync-job:update': 'sync_jobs',
  'enrichment-job:update': 'enrichment_jobs',
  'search-job:update': 'search_jobs',
}

// ---------------------------------------------------------------------------
// Pagination controls
// ---------------------------------------------------------------------------

function Pagination({ total, offset, pageSize, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.floor(offset / pageSize) + 1

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5 }}>
      <Typography level="body-xs">
        {total === 0 ? 'No jobs' : `${offset + 1}-${Math.min(offset + pageSize, total)} of ${total}`}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          size="sm"
          variant="outlined"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(0)}
        >
          First
        </Button>
        <Button
          size="sm"
          variant="outlined"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(offset - pageSize)}
        >
          Prev
        </Button>
        <Typography level="body-sm" sx={{ display: 'flex', alignItems: 'center', px: 1 }}>
          Page {currentPage} / {totalPages}
        </Typography>
        <Button
          size="sm"
          variant="outlined"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(offset + pageSize)}
        >
          Next
        </Button>
        <Button
          size="sm"
          variant="outlined"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange((totalPages - 1) * pageSize)}
        >
          Last
        </Button>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function AdminJobsPage() {
  const [activeQueue, setActiveQueue] = useState(QUEUES[0].key)
  const [data, setData] = useState({})  // { [queueKey]: { rows, total, offset } }
  const [loading, setLoading] = useState({})
  const activeQueueRef = useRef(activeQueue)

  useEffect(() => {
    activeQueueRef.current = activeQueue
  }, [activeQueue])

  const fetchPage = useCallback(async (queue, offset = 0) => {
    setLoading((prev) => ({ ...prev, [queue]: true }))
    try {
      const res = await fetch(
        `${API}/api/admin/all-jobs?queue=${queue}&offset=${offset}&limit=${PAGE_SIZE}`
      )
      const json = await res.json()
      setData((prev) => ({
        ...prev,
        [queue]: { rows: json.rows, total: json.total, offset: json.offset },
      }))
    } catch (err) {
      console.error(`Failed to fetch ${queue}:`, err)
    } finally {
      setLoading((prev) => ({ ...prev, [queue]: false }))
    }
  }, [])

  // Initial fetch for all queues
  useEffect(() => {
    for (const q of QUEUES) {
      fetchPage(q.key, 0)
    }
  }, [fetchPage])

  // Socket.IO live updates
  useEffect(() => {
    const socket = io(API)

    for (const [event, queueKey] of Object.entries(SOCKET_EVENT_TO_QUEUE)) {
      socket.on(event, (updatedJob) => {
        // Update in-memory rows if the job is on the current page
        setData((prev) => {
          const current = prev[queueKey]
          if (!current) return prev

          const idx = current.rows.findIndex((j) => j.id === updatedJob.id)
          if (idx >= 0) {
            const nextRows = [...current.rows]
            nextRows[idx] = { ...nextRows[idx], ...updatedJob }
            return { ...prev, [queueKey]: { ...current, rows: nextRows } }
          }
          // New job — if we're on first page, prepend it
          if (current.offset === 0) {
            const nextRows = [updatedJob, ...current.rows].slice(0, PAGE_SIZE)
            return {
              ...prev,
              [queueKey]: { ...current, rows: nextRows, total: current.total + 1 },
            }
          }
          return prev
        })
      })
    }

    return () => socket.disconnect()
  }, [])

  const handleTabChange = (_event, newValue) => {
    setActiveQueue(newValue)
  }

  const handlePageChange = (queue, newOffset) => {
    fetchPage(queue, Math.max(0, newOffset))
  }

  return (
    <Box>
      <Typography level="h3" sx={{ mb: 2 }}>Jobs</Typography>

      <Tabs value={activeQueue} onChange={handleTabChange}>
        <TabList>
          {QUEUES.map((q) => {
            const queueData = data[q.key]
            const count = queueData?.total ?? 0
            return (
              <Tab key={q.key} value={q.key}>
                {q.label}
                {count > 0 && (
                  <Chip size="sm" variant="soft" color="neutral" sx={{ ml: 1 }}>
                    {count}
                  </Chip>
                )}
              </Tab>
            )
          })}
        </TabList>

        {QUEUES.map((q) => {
          const queueData = data[q.key]
          const rows = queueData?.rows ?? []
          const total = queueData?.total ?? 0
          const offset = queueData?.offset ?? 0
          const isLoading = loading[q.key]
          const TableComponent = TABLE_COMPONENT[q.key]

          return (
            <TabPanel key={q.key} value={q.key} sx={{ p: 0, pt: 1 }}>
              {isLoading && !rows.length ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto' }}>
                  <TableComponent rows={rows} />
                  <Pagination
                    total={total}
                    offset={offset}
                    pageSize={PAGE_SIZE}
                    onPageChange={(newOffset) => handlePageChange(q.key, newOffset)}
                  />
                </Sheet>
              )}
            </TabPanel>
          )
        })}
      </Tabs>
    </Box>
  )
}
