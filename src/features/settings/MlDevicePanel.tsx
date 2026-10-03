import { useQueryClient } from '@tanstack/react-query'
import type { GeneralSettings } from '@shared/settings'
import { Chip, Panel, Segmented } from '../../ui'
import { useMlStatus } from '../intelligence/api'
import { useGeneralSettings, useSaveGeneral } from './api'

type Mode = GeneralSettings['mlDevice']

const OPTIONS: { value: Mode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'cuda', label: 'GPU' },
  { value: 'cpu', label: 'CPU' },
]

const HELP: Record<Mode, string> = {
  auto: 'Each training run benchmarks one fold on both devices and uses the faster one per model family. Recommended.',
  cuda: 'Force the GPU for both model families. Tree models are usually slower on the GPU for data this small.',
  cpu: 'Force the CPU for everything (no GPU needed). Slower for the logistic family.',
}

/** Settings → where the ML trains and scores (needs the admin PIN to change). */
export function MlDevicePanel() {
  const general = useGeneralSettings()
  const save = useSaveGeneral()
  const qc = useQueryClient()
  const status = useMlStatus()
  const py = status.data?.python
  const mode = general.data?.mlDevice ?? 'auto'
  const lastWithDevices = Object.values(status.data?.lastRuns ?? {}).find((r) => r?.devices)

  return (
    <Panel title="ML compute" eyebrow="Machine learning">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Mode> ariaLabel="ML device" value={mode} onChange={(v) => save.mutate({ mlDevice: v }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['ml', 'status'] }) })} options={OPTIONS} size="md" />
        {py?.cuda ? <Chip tone="strong">{py.gpu ?? 'CUDA GPU'}</Chip> : <Chip tone="neutral">No CUDA GPU detected</Chip>}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{HELP[mode]}</p>
      {mode === 'cuda' && py && !py.cuda && <p className="mt-2 text-xs text-neg-text">No usable CUDA GPU was found, so runs will fall back to the CPU.</p>}
      {lastWithDevices?.devices && (
        <p className="mt-2 text-xs text-muted">
          Last run used: trees on <span className="num text-foreground">{lastWithDevices.devices.gb === 'cuda' ? 'GPU' : 'CPU'}</span>, logistic on{' '}
          <span className="num text-foreground">{lastWithDevices.devices.logit === 'cuda' ? 'GPU' : 'CPU'}</span>
          {lastWithDevices.durationSec != null && <> · {Math.round(lastWithDevices.durationSec / 60)} min</>}.
        </p>
      )}
      {save.error && <p className="mt-2 text-xs text-neg-text">Could not save the device setting.</p>}
    </Panel>
  )
}
