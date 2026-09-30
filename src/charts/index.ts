// Shared SVG chart library (ported from CommodityFutures components/charts).
// Colours come only from PALETTE (CSS variables via `style`), widths are
// responsive (ResizeObserver), and every chart has a hover read-out.
export { TimeSeriesChart, type TSeries, type TBand, type TRefLine } from './TimeSeriesChart'
export { SpreadChart, type BandPoint } from './SpreadChart'
export { RegimeGateChart, type GatePoint } from './RegimeGateChart'
export { EquityCurve, type EquityPoint } from './EquityCurve'
export { OutcomeHistogram, type HistBin } from './OutcomeHistogram'
export { SeasonalPattern, BandCrossingChart, type EnvelopeRow, type DoyPath, type WindowSpan } from './SeasonalPattern'
export { PerYearOverlay } from './PerYearOverlay'
export { SeasonalReturnsHeatmap, type MonthlyCell, type MonthlySummaryRow } from './SeasonalReturnsHeatmap'
export { ForwardCurveChart, type CurveNode, type CurveSeries } from './ForwardCurveChart'
export { WindowStatsTable, type WindowRow } from './WindowStatsTable'
export { ChartLegend, ChartTooltip, ChartEmpty, useChartWidth, type LegendItem, type TooltipRow } from './frame'
