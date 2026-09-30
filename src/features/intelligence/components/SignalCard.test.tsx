// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MlPrediction } from '@shared/ml'
import { SignalCard } from './SignalCard'

const base: MlPrediction = {
  runId: 12,
  metal: 'gold',
  instrumentId: 'GC.out',
  date: '2026-09-30',
  horizonDays: 20,
  pUp: 0.5864,
  pUpLow: 0.545,
  pUpHigh: 0.57,
  expectedMove: -0.0109,
  lower: -0.078,
  upper: 0.047,
  validationStatus: 'failed',
  reasons: ['AUC 0.458 < 0.55', 'p 0.723 ≥ 0.05'],
  createdAt: '2026-10-01T00:00:00Z',
  trainedAt: '2026-10-01T00:00:00Z',
}

describe('SignalCard', () => {
  it('labels a failed model as informational only, with the gate reasons', () => {
    render(<SignalCard metal="gold" prediction={base} />)
    expect(screen.getByText('Not validated — informational only.')).toBeTruthy()
    expect(screen.getByText(/AUC 0.458 < 0.55; p 0.723/)).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    const p = screen.getByText('58.6%')
    expect(p.className).toMatch(/text-muted/)
    expect(screen.getByText(/Model run #12/)).toBeTruthy()
  })

  it('shows a passed model at full emphasis without the caveat banner', () => {
    render(<SignalCard metal="silver" prediction={{ ...base, metal: 'silver', validationStatus: 'passed', reasons: [] }} />)
    expect(screen.queryByText('Not validated — informational only.')).toBeNull()
    expect(screen.getByText('58.6%').className).toMatch(/text-foreground/)
    expect(screen.getByText(/silver rose/)).toBeTruthy()
  })

  it('renders an explicit empty state without a prediction', () => {
    render(<SignalCard metal="gold" prediction={undefined} />)
    expect(screen.getByText('No prediction yet')).toBeTruthy()
  })
})
