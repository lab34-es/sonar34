import { useState, useEffect, useCallback } from 'react'
import { useParams, Link as RouterLink } from 'react-router-dom'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Sheet from '@mui/joy/Sheet'
import Chip from '@mui/joy/Chip'
import CircularProgress from '@mui/joy/CircularProgress'
import Alert from '@mui/joy/Alert'
import List from '@mui/joy/List'
import ListItem from '@mui/joy/ListItem'
import ListItemButton from '@mui/joy/ListItemButton'
import Button from '@mui/joy/Button'
import { DiffEditor } from '@monaco-editor/react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const mono = { fontFamily: 'ui-monospace, Consolas, "Liberation Mono", monospace' }

/**
 * Build the "original" and "modified" text for Monaco DiffEditor from a file's hunks.
 */
function buildDiffTexts(file) {
  if (!file.hunks || file.hunks.length === 0) {
    return { original: '', modified: file.raw || '' }
  }

  const originalLines = []
  const modifiedLines = []

  for (const hunk of file.hunks) {
    const match = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    const oldStart = match ? parseInt(match[1], 10) : 1
    const newStart = match ? parseInt(match[2], 10) : 1

    originalLines.push(`\u200B`)
    modifiedLines.push(`\u200B`)

    let oldLine = oldStart
    let newLine = newStart

    for (const line of hunk.lines) {
      if (line.startsWith('-')) {
        originalLines.push(line.slice(1))
        oldLine++
      } else if (line.startsWith('+')) {
        modifiedLines.push(line.slice(1))
        newLine++
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" — skip
      } else {
        const content = line.startsWith(' ') ? line.slice(1) : line
        originalLines.push(content)
        modifiedLines.push(content)
        oldLine++
        newLine++
      }
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n'),
  }
}

function langFromPath(filePath) {
  if (!filePath) return 'plaintext'
  const ext = filePath.split('.').pop().toLowerCase()
  const map = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', java: 'java', kt: 'kotlin',
    cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', go: 'go',
    rs: 'rust', php: 'php', swift: 'swift', sh: 'shell', bash: 'shell',
    yml: 'yaml', yaml: 'yaml', json: 'json', xml: 'xml', html: 'html',
    css: 'css', scss: 'scss', less: 'less', md: 'markdown',
    sql: 'sql', dockerfile: 'dockerfile', tf: 'hcl',
  }
  return map[ext] || 'plaintext'
}

function statusColor(status) {
  if (status === 'added') return 'success'
  if (status === 'deleted') return 'danger'
  if (status === 'renamed') return 'warning'
  return 'neutral'
}

function statusLabel(status) {
  if (status === 'added') return 'A'
  if (status === 'deleted') return 'D'
  if (status === 'renamed') return 'R'
  return 'M'
}

export default function CommitDiffPage() {
  const { '*': wildcard } = useParams()
  // URL pattern: /commit/workspace/slug/sha
  // The last segment is the SHA, everything before is the repo name
  const parts = (wildcard || '').split('/')
  const sha = parts.pop()
  const repoName = parts.join('/')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [diffData, setDiffData] = useState(null)
  const [selectedFileIdx, setSelectedFileIdx] = useState(0)

  const fetchDiff = useCallback(async () => {
    if (!repoName || !sha) return
    setLoading(true)
    setError(null)
    setDiffData(null)
    setSelectedFileIdx(0)

    try {
      const [workspace, slug] = repoName.split('/')
      const res = await fetch(
        `${API_URL}/api/admin/repos/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/commits/${sha}/diff`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setDiffData(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [repoName, sha])

  useEffect(() => {
    fetchDiff()
  }, [fetchDiff])

  const selectedFile = diffData?.files?.[selectedFileIdx] ?? null
  const { original, modified } = selectedFile ? buildDiffTexts(selectedFile) : { original: '', modified: '' }
  const language = langFromPath(selectedFile?.newPath || selectedFile?.oldPath)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)', minHeight: 400 }}>
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 2,
          flexShrink: 0,
          bgcolor: 'background.level1',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Button
              component={RouterLink}
              to={`/repos/${repoName}`}
              variant="plain"
              size="sm"
              sx={{ minHeight: 0, px: 1, py: 0.25, fontSize: '0.75rem' }}
            >
              &larr; {repoName}
            </Button>
          </Box>
          <Typography level="title-md" sx={mono}>
            {sha?.substring(0, 10)}
          </Typography>
          {diffData?.meta?.subject && (
            <Typography level="body-sm" sx={{ color: 'text.secondary', mt: 0.25 }}>
              {diffData.meta.subject}
            </Typography>
          )}
          {diffData?.meta && (
            <Typography level="body-xs" sx={{ color: 'text.tertiary', mt: 0.25 }}>
              {diffData.meta.authorName}
              {diffData.meta.date ? ` · ${new Date(diffData.meta.date).toLocaleString()}` : ''}
              {repoName ? ` · ${repoName}` : ''}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {loading && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size="md" />
          </Box>
        )}

        {error && (
          <Box sx={{ p: 2, flex: 1 }}>
            <Alert color="danger" variant="soft">{error}</Alert>
          </Box>
        )}

        {!loading && !error && diffData && diffData.files.length > 0 && (
          <>
            {/* File list sidebar */}
            <Sheet
              variant="outlined"
              sx={{
                width: 280,
                flexShrink: 0,
                borderRadius: 0,
                borderTop: 0,
                borderBottom: 0,
                borderLeft: 0,
                overflow: 'auto',
                bgcolor: 'background.level1',
              }}
            >
              <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography level="body-xs" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  {diffData.files.length} file{diffData.files.length !== 1 ? 's' : ''} changed
                </Typography>
              </Box>
              <List size="sm" sx={{ py: 0 }}>
                {diffData.files.map((f, i) => (
                  <ListItem key={i} sx={{ py: 0, px: 0 }}>
                    <ListItemButton
                      selected={i === selectedFileIdx}
                      onClick={() => setSelectedFileIdx(i)}
                      sx={{
                        px: 1.5,
                        py: 0.75,
                        borderRadius: 0,
                        gap: 1,
                        alignItems: 'flex-start',
                        '&.Mui-selected': {
                          bgcolor: 'primary.softBg',
                        },
                      }}
                    >
                      <Chip
                        size="sm"
                        color={statusColor(f.status)}
                        variant="soft"
                        sx={{ ...mono, fontSize: '0.65rem', minWidth: 18, height: 18, px: 0.5, flexShrink: 0, mt: 0.1 }}
                      >
                        {statusLabel(f.status)}
                      </Chip>
                      <Typography
                        level="body-xs"
                        sx={{
                          ...mono,
                          wordBreak: 'break-all',
                          lineHeight: 1.4,
                          color: i === selectedFileIdx ? 'primary.700' : 'text.primary',
                        }}
                      >
                        {f.newPath || f.oldPath}
                      </Typography>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Sheet>

            {/* Diff editor */}
            <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {selectedFile && (
                <Box
                  sx={{
                    px: 2,
                    py: 0.75,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.level1',
                    flexShrink: 0,
                  }}
                >
                  <Typography level="body-xs" sx={{ ...mono, color: 'text.secondary' }}>
                    {selectedFile.oldPath !== selectedFile.newPath && selectedFile.oldPath
                      ? `${selectedFile.oldPath} → ${selectedFile.newPath}`
                      : selectedFile.newPath || selectedFile.oldPath}
                  </Typography>
                </Box>
              )}
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <DiffEditor
                  original={original}
                  modified={modified}
                  language={language}
                  theme="vs"
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    fontFamily: 'ui-monospace, Consolas, "Liberation Mono", monospace',
                    lineNumbers: 'on',
                    wordWrap: 'off',
                    diffWordWrap: 'off',
                    renderOverviewRuler: false,
                    ignoreTrimWhitespace: false,
                    enableSplitViewResizing: true,
                    originalEditable: false,
                  }}
                  height="100%"
                  width="100%"
                />
              </Box>
            </Box>
          </>
        )}

        {!loading && !error && diffData && diffData.files.length === 0 && (
          <Box sx={{ p: 2, flex: 1 }}>
            <Alert color="neutral" variant="soft">No file changes found for this commit.</Alert>
          </Box>
        )}
      </Box>
    </Box>
  )
}
