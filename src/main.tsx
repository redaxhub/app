// REDAX app entry. Mounts the product shell in React StrictMode, and does exactly
// that: this module itself reads no environment, opens no connection, touches no
// wallet and starts no network activity of its own.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('REDAX shell: #root element missing from index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
