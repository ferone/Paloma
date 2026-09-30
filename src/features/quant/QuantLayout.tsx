import { useEffect, useState } from 'react'
import { Outlet, useOutletContext } from 'react-router-dom'
import type { QuantMode } from '@shared/quant'
import type { Metal } from '@shared/universe'
import { useSettings } from '../../store/settings-context'
import { fmtAge, fmtDate } from '../../design/format'
import { Button, PageHeader, RouteTabs, Segmented } from '../../ui'
import { useQuantStatus, useRecompute } from './api'

export interface QuantOutletContext {
  metal: Metal
  mode: QuantMode
}

const MODE_KEY = 'gid.quant.mode'

function readMode(): QuantMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'aggressive' ? 'aggressive' : 'conservative'
  } catch {
    return 'conservative'
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function useQuantContext(): QuantOutletContext {
  return useOutletContext<QuantOutletContext>()
}

export function QuantLayout() {
  // Metal in focus comes from the global switch in the top bar.
  const { metal } = useSettings()
  const [mode, setMode] = useState<QuantMode>(readMode)
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // non-persistent is fine
    }
  }, [mode])
  const status = useQuantStatus()
  const recompute = useRecompute()
  const running = status.data?.job?.state === 'running' || recompute.isPending
  const run = status.data?.run
  const failed = status.data?.job?.state === 'failed'

  return (
    <>
      <PageHeader
        eyebrow={`Research · ${metal === 'gold' ? 'Gold' : 'Silver'}`}
        title="Quant Lab"
        description="Calendar spreads, butterflies, roll-clean seasonals and gold/silver relative value on COMEX futures, each with out-of-sample validation and an explicit verdict."
        actions={
          <>
            <Segmented<QuantMode>
              ariaLabel="Verdict mode"
              size="md"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'conservative', label: 'Conservative' },
                { value: 'aggressive', label: 'Aggressive' },
              ]}
            />
            <Button size="md" onClick={() => recompute.mutate()} disabled={running || !status.data?.hasData} title={status.data?.hasData ? 'Re-run the engine on the stored contract history' : 'No contract history stored yet'}>
              {running ? 'Computing…' : 'Recompute'}
            </Button>
          </>
        }
      />
      <p className="-mt-3 mb-4 text-2xs text-muted" aria-live="polite">
        {running
          ? `Engine running${status.data?.job?.message ? ` — ${status.data.job.message}` : ''}…`
          : run
            ? `Engine run ${fmtAge(run.generatedAt)} · ${run.instruments} instruments · data through ${fmtDate(run.dataThrough)} · Databento GLBX.MDP3`
            : 'The engine has not run yet.'}
        {failed && !running && <span className="ml-2 text-neg-text">Last run failed: {status.data?.job?.message}</span>}
      </p>
      <RouteTabs
        items={[
          { to: '/quant', label: 'Scanner', end: true },
          { to: '/quant/spreads', label: 'Spreads & flies' },
          { to: '/quant/seasonality', label: 'Seasonality' },
          { to: '/quant/relative-value', label: 'Relative value' },
          { to: '/quant/curve', label: 'Term structure' },
          { to: '/quant/backtest', label: 'Backtest' },
        ]}
      />
      <Outlet context={{ metal, mode } satisfies QuantOutletContext} />
    </>
  )
}
