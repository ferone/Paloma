import { expect, test, type Page } from '@playwright/test'

// Every page renders its heading, logs no console errors and never scrolls
// sideways — on desktop, and (tagged @mobile) on a phone viewport.

const ROUTES = [
  '/', '/portfolio', '/portfolio/ledger', '/portfolio/performance', '/portfolio/vault', '/portfolio/scenario', '/investor',
  '/markets', '/markets/curve', '/markets/etfs', '/markets/signals', '/markets/comparison', '/markets/liquidity',
  '/quant', '/quant/spreads', '/quant/seasonality', '/quant/relative-value', '/quant/curve', '/quant/backtest',
  '/macro', '/macro/positioning', '/macro/correlations', '/macro/analyst',
  '/intelligence', '/intelligence/validation', '/intelligence/features', '/intelligence/calibration', '/intelligence/runs',
  '/data', '/data/download', '/data/databento', '/data/jobs', '/settings',
]

// Offline mode answers some live-quote endpoints with errors on purpose; the
// browser logs those as failed resources. Anything else is a real failure.
const IGNORED = [/Failed to load resource/i, /Download the React DevTools/i]

function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(m.text()))) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

for (const route of ROUTES) {
  test(`${route} renders cleanly @mobile`, async ({ page }) => {
    const errors = watchConsole(page)
    await page.goto(route)
    // Generous: the first page of a run may wait for Vite's dependency pre-bundling.
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 45_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(1)
    expect(errors, 'console errors').toEqual([])
  })
}
