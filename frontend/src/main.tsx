import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './diagnostics/AppErrorBoundary.tsx'
import { getBrowserDiagnosticLog } from './diagnostics/diagnostic-log.ts'

const diagnostics = getBrowserDiagnosticLog()

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary diagnostics={diagnostics}>
    <App diagnostics={diagnostics} />
  </AppErrorBoundary>,
)
