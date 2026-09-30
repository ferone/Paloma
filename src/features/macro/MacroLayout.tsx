import { Outlet } from 'react-router-dom'
import { RiRefreshLine } from 'react-icons/ri'
import { Button, PageHeader, RouteTabs } from '../../ui'
import { useSettings } from '../../store/settings-context'
import { fmtAge } from '../../design/format'
import { UNIVERSE } from '@shared/universe'
import { errorMessage, useMacroDashboard, useMacroRefresh } from './api'

export function MacroLayout() {
  const { asset } = useSettings()
  const dash = useMacroDashboard(asset)
  const refresh = useMacroRefresh()
  const jobs = dash.data?.refresh
  const running = !!jobs && [jobs.all, jobs.fred, jobs.cot].some((j) => j?.state === 'running')
  const last = jobs?.all?.finishedAt ?? jobs?.fred?.finishedAt ?? jobs?.cot?.finishedAt ?? null
  const failed = jobs?.all?.state === 'failed' ? jobs.all.message : null

  return (
    <>
      <PageHeader
        eyebrow={`Research · ${UNIVERSE[asset].label}`}
        title="Macro &amp; AI"
        description="Real yields, the dollar, inflation, positioning and correlations, scored transparently for the asset in focus, plus sourced AI briefs."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-2xs text-muted" aria-live="polite">
              {running ? (jobs?.all?.message ?? 'Refreshing…') : last ? `Refreshed ${fmtAge(last)}` : null}
            </span>
            <Button size="sm" onClick={() => refresh.mutate('all')} disabled={running || refresh.isPending}>
              <RiRefreshLine size={14} className={running ? 'motion-safe:animate-spin' : ''} aria-hidden />
              {running ? 'Refreshing' : 'Refresh data'}
            </Button>
          </div>
        }
      />
      {(refresh.error || failed) && (
        <p role="alert" className="-mt-3 mb-4 text-xs text-neg-text">
          Refresh failed: {refresh.error ? errorMessage(refresh.error) : failed}
        </p>
      )}
      <RouteTabs
        items={[
          { to: '/macro', label: 'Dashboard', end: true },
          { to: '/macro/positioning', label: 'Positioning' },
          { to: '/macro/correlations', label: 'Correlations' },
          { to: '/macro/analyst', label: 'AI analyst' },
        ]}
      />
      <Outlet />
    </>
  )
}
