import { useState, useEffect, useCallback } from 'react'
import Box from '@mui/joy/Box'
import Typography from '@mui/joy/Typography'
import Input from '@mui/joy/Input'
import Button from '@mui/joy/Button'
import FormControl from '@mui/joy/FormControl'
import FormLabel from '@mui/joy/FormLabel'
import FormHelperText from '@mui/joy/FormHelperText'
import Sheet from '@mui/joy/Sheet'
import Alert from '@mui/joy/Alert'
import CircularProgress from '@mui/joy/CircularProgress'
import Chip from '@mui/joy/Chip'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState([])
  const [values, setValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [fetchError, setFetchError] = useState(null)

  const fetchSettings = useCallback(async () => {
    setFetchError(null)
    try {
      const res = await fetch(`${API}/api/admin/settings`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Unexpected response format')
      setSettings(data)
      const initial = {}
      for (const s of data) {
        initial[s.key] = s.secret ? '' : (s.value ?? '')
      }
      setValues(initial)
    } catch (err) {
      console.error('Failed to fetch settings:', err)
      setFetchError(`Failed to load settings: ${err.message}. Make sure the backend is running with the latest code.`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleChange = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }))
  }

  const handleSave = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch(`${API}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Save failed')
      }
      const data = await res.json()
      setSettings(data)
      // Reset secret fields (they come back empty)
      const updated = {}
      for (const s of data) {
        updated[s.key] = s.secret ? '' : (s.value ?? '')
      }
      setValues(updated)
      setResult({ type: 'success', message: 'Settings saved.' })
    } catch (err) {
      setResult({ type: 'error', message: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Typography level="h3" sx={{ mb: 2 }}>Settings</Typography>

      {fetchError && (
        <Alert color="danger" sx={{ mb: 2 }}>{fetchError}</Alert>
      )}

      {settings.length === 0 && !fetchError && (
        <Typography level="body-md" color="neutral">No settings available.</Typography>
      )}

      <Sheet variant="outlined" sx={{ borderRadius: 'sm', p: 3, maxWidth: 600 }}>
        {settings.map((s) => (
          <FormControl key={s.key} sx={{ mb: 2 }}>
            <FormLabel>{s.label}</FormLabel>
            <Input
              size="sm"
              type={s.secret ? 'password' : 'text'}
              placeholder={s.secret
                ? (s.isSet ? '(set -- leave blank to keep)' : '(not set)')
                : ''
              }
              value={values[s.key] ?? ''}
              onChange={(e) => handleChange(s.key, e.target.value)}
              endDecorator={
                s.secret && s.isSet
                  ? <Chip size="sm" variant="soft" color="success">configured</Chip>
                  : s.secret && !s.isSet
                    ? <Chip size="sm" variant="soft" color="warning">not set</Chip>
                    : null
              }
            />
            <FormHelperText>
              <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>{s.key}</Typography>
            </FormHelperText>
          </FormControl>
        ))}

        <Button
          variant="solid"
          color="primary"
          onClick={handleSave}
          loading={saving}
          sx={{ mt: 1 }}
        >
          Save settings
        </Button>

        {result && (
          <Alert
            color={result.type === 'success' ? 'success' : 'danger'}
            sx={{ mt: 2 }}
          >
            {result.message}
          </Alert>
        )}
      </Sheet>
    </Box>
  )
}
