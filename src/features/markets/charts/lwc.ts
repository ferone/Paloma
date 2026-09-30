import { ColorType, CrosshairMode, LineStyle, type DeepPartial, type ChartOptions, type Time, type UTCTimestamp } from 'lightweight-charts'
import type { OHLCV } from '@shared/markets'
import { fmtNum } from '../../../design/format'
import type { ChartTheme } from './chartTheme'

/** Base lightweight-charts options from the resolved theme. */
export function baseChartOptions(t: ChartTheme, intraday: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: t.muted,
      fontFamily: t.font,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: t.alpha(t.border, 0.5) },
      horzLines: { color: t.alpha(t.border, 0.8) },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: t.faint, width: 1, style: LineStyle.Dashed, labelBackgroundColor: t.surface3 },
      horzLine: { color: t.faint, width: 1, style: LineStyle.Dashed, labelBackgroundColor: t.surface3 },
    },
    rightPriceScale: { borderColor: t.border },
    timeScale: { borderColor: t.border, timeVisible: intraday, secondsVisible: false },
    localization: { priceFormatter: (p: number) => fmtNum(p, p >= 1000 ? 1 : 2) },
    handleScale: { axisPressedMouseMove: true },
    handleScroll: { vertTouchDrag: false },
  }
}

/**
 * Chart times: intraday bars as UTC timestamps, daily+ bars as business days.
 * Drops empty bars and de-duplicates (lightweight-charts rejects repeated times).
 */
export function toTimedBars(bars: OHLCV[], intraday: boolean): (OHLCV & { time: Time })[] {
  const seen = new Set<string | number>()
  const out: (OHLCV & { time: Time })[] = []
  for (const b of bars) {
    if (!(b.close > 0)) continue
    const time: Time = intraday ? (Math.floor(Date.parse(b.date) / 1000) as UTCTimestamp) : b.date.slice(0, 10)
    if (seen.has(time as string | number)) {
      out[out.length - 1] = { ...b, time }
      continue
    }
    seen.add(time as string | number)
    out.push({ ...b, time })
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}
