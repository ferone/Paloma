import { expect, test } from '@playwright/test'

test.describe('ledger', () => {
  test('recording a subscription adds a row to the ledger', async ({ page }) => {
    await page.goto('/portfolio/ledger')
    const eyebrow = page.getByText(/^\d+ recorded$/)
    await expect(eyebrow).toBeVisible()
    const before = Number((await eyebrow.innerText()).split(' ')[0])

    await page.getByRole('button', { name: 'New transaction' }).click()
    const drawer = page.getByRole('dialog', { name: 'New transaction' })
    await drawer.getByLabel('Type').selectOption('subscription')
    await drawer.getByLabel('Amount (USD)').fill('1000')
    await drawer.getByLabel('Notes').fill('e2e subscription')
    await drawer.getByRole('button', { name: 'Record transaction' }).click()

    await expect(drawer).toBeHidden()
    await expect(page.getByText(`${before + 1} recorded`)).toBeVisible()
  })
})

test.describe('settings', () => {
  test('API keys are listed masked, and saving one asks for an admin PIN', async ({ page }) => {
    await page.goto('/settings')
    for (const label of ['Databento', 'OpenRouter', 'FRED', 'CFTC (Socrata)']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
    // No key material is ever rendered beyond the masked last four characters.
    await expect(page.locator('body')).not.toContainText(/sk-or-v1-[A-Za-z0-9]{8,}|db-[A-Za-z0-9]{12,}/)

    await page.getByRole('button', { name: 'Add key' }).first().click()
    await page.getByLabel(/^New .* key$/).fill('e2e-not-a-real-key-0000')
    await page.getByRole('button', { name: 'Save' }).first().click()
    const gate = page.getByRole('dialog', { name: /admin PIN/i })
    await expect(gate).toBeVisible()
    await gate.getByRole('button', { name: 'Cancel' }).click()
    await expect(gate).toBeHidden()
  })
})

test.describe('assistant', () => {
  test('Ctrl+J opens the assistant with the page context chip; answers stream in', async ({ page }) => {
    // Mock the assistant endpoints: no OpenRouter call, no spend.
    await page.route('**/api/ai/assistant/usage', (r) =>
      r.fulfill({ json: { monthSpendUsd: 0, capUsd: 5, model: 'mock/model', fallbackModel: 'mock/cheap', configured: true, state: 'ok' } }),
    )
    await page.route('**/api/ai/assistant/chat', (r) =>
      r.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body:
          'event: delta\ndata: {"text":"A butterfly is "}\n\n' +
          'event: delta\ndata: {"text":"long the wings, short 2x the body."}\n\n' +
          'event: done\ndata: {"costUsd":0.001,"tokens":42,"model":"mock/model","fallback":false,"monthSpendUsd":0.001,"capUsd":5}\n\n',
      }),
    )
    await page.goto('/quant')
    await expect(page.locator('main h1').first()).toBeVisible()
    await page.keyboard.press('Control+j')
    await expect(page.getByText(/Looking at/i).first()).toBeVisible()
    const box = page.getByPlaceholder(/Ask about this page/i)
    await box.fill('What is a butterfly?')
    await box.press('Enter')
    await expect(page.getByText('long the wings, short 2x the body.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(box).toBeHidden()
  })
})
