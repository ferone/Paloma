import { PieChart, Pie, Cell } from 'recharts'
import { Card } from '../shared/Card'

interface RSIGaugeProps {
  value: number | null
}

export function RSIGauge({ value }: RSIGaugeProps) {
  const rsi = value ?? 50
  const gaugeData = [
    { value: rsi },
    { value: 100 - rsi },
  ]

  const getColor = () => {
    if (rsi <= 30) return '#22c55e'
    if (rsi >= 70) return '#ef4444'
    return '#eab308'
  }

  const getLabel = () => {
    if (rsi <= 20) return 'Strongly Oversold'
    if (rsi <= 30) return 'Oversold'
    if (rsi >= 80) return 'Strongly Overbought'
    if (rsi >= 70) return 'Overbought'
    return 'Neutral'
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-white mb-2">RSI (14)</h3>
      <div className="flex flex-col items-center">
        <div className="relative">
          <PieChart width={180} height={100}>
            <Pie
              data={gaugeData}
              cx={90}
              cy={90}
              startAngle={180}
              endAngle={0}
              innerRadius={60}
              outerRadius={80}
              dataKey="value"
              stroke="none"
            >
              <Cell fill={getColor()} />
              <Cell fill="#1f2937" />
            </Pie>
          </PieChart>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
            <span className="text-2xl font-bold text-white">{rsi.toFixed(1)}</span>
          </div>
        </div>
        <span className="text-xs font-medium mt-1" style={{ color: getColor() }}>
          {getLabel()}
        </span>
        <div className="flex justify-between w-full mt-2 text-xs text-gray-500">
          <span>0</span>
          <span>30</span>
          <span>50</span>
          <span>70</span>
          <span>100</span>
        </div>
      </div>
    </Card>
  )
}
