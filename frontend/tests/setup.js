import '@testing-library/jest-dom'

// Provide a minimal import.meta.env stub for components that read VITE_API_URL
// (Vitest already populates import.meta.env, but we ensure VITE_API_URL is set)
if (!import.meta.env.VITE_API_URL) {
  import.meta.env.VITE_API_URL = 'http://localhost:3001'
}
