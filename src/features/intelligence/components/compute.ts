import { ML_FAMILY_LABEL, type MlDevice, type MlFamily } from '@shared/ml'
import { fmtNum } from '../../../design/format'

// Display helpers for a run's compute metadata (devices, timings, span).

/** "48 s", "6.3 min", "1.2 h"; em dash when unknown. */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  if (sec < 1) return `${fmtNum(sec, 2)} s`
  if (sec < 10) return `${fmtNum(sec, 1)} s`
  if (sec < 90) return `${fmtNum(sec, 0)} s`
  if (sec < 5400) return `${fmtNum(sec / 60, 1)} min`
  return `${fmtNum(sec / 3600, 1)} h`
}

const DEVICE_WORD: Record<MlDevice, string> = { cuda: 'GPU', cpu: 'CPU' }

/** "Trees CPU · Logistic GPU" (short), or null for runs before the GPU pipeline. */
export function devicesShort(devices: Record<MlFamily, MlDevice> | null | undefined): string | null {
  if (!devices) return null
  return `Trees ${DEVICE_WORD[devices.gb]} · Logistic ${DEVICE_WORD[devices.logit]}`
}

/** "gradient boosting on the CPU (16 threads), logistic regression on the GPU (NVIDIA …)". */
export function devicesLong(devices: Record<MlFamily, MlDevice>, gpu: string | null, workers?: number): string {
  const one = (f: MlFamily) => {
    const d = devices[f]
    const where = d === 'cuda' ? `the GPU${gpu ? ` (${gpu})` : ''}` : `the CPU${f === 'gb' && workers ? ` (${workers} threads)` : ''}`
    return `${ML_FAMILY_LABEL[f].toLowerCase()} on ${where}`
  }
  return `${one('gb')}, ${one('logit')}`
}

/** "Aug 2001 – Sep 2026" from two ISO dates. */
export function fmtSpan(from: string | null | undefined, to: string | null | undefined): string {
  const m = (iso: string | null | undefined) => {
    if (!iso) return '—'
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  return `${m(from)} – ${m(to)}`
}
