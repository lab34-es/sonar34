import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { CssVarsProvider, extendTheme } from '@mui/joy/styles'
import CssBaseline from '@mui/joy/CssBaseline'
import './index.css'
import App from './App.jsx'

const theme = extendTheme({
  colorSchemes: {
    dark: {
      palette: {},
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <CssVarsProvider defaultMode="light" theme={theme}>
        <CssBaseline />
        <App />
      </CssVarsProvider>
    </HashRouter>
  </StrictMode>,
)
