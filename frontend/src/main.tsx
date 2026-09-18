import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './diagnostics/AppErrorBoundary.tsx'
import { getBrowserDiagnosticLog } from './diagnostics/diagnostic-log.ts'
import { ProfileProvider } from './settings/ProfileProvider.tsx'

const diagnostics = getBrowserDiagnosticLog()
const showEndgameFixture = import.meta.env.VITE_E2E_FIXTURES === '1'
  && new URLSearchParams(globalThis.location.search).has('end-summary-fixture')
const root = createRoot(document.getElementById('root')!)

if (showEndgameFixture) {
  void import('./test-fixtures/EndgameSummaryFixture.tsx').then(
    ({ EndgameSummaryFixture }) => {
      root.render(
        <AppErrorBoundary diagnostics={diagnostics}>
          <EndgameSummaryFixture />
        </AppErrorBoundary>,
      )
    },
  )
} else {
  root.render(
    <AppErrorBoundary diagnostics={diagnostics}>
      <ProfileProvider>
        <App diagnostics={diagnostics} />
      </ProfileProvider>
    </AppErrorBoundary>,
  )
}
