import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/test/fixtures',
)
const plainCssDeck = path.join(fixtureDir, 'plain-css-deck.html')
const hostileScriptsDeck = path.join(fixtureDir, 'hostile-scripts-deck.html')

test.describe('Ark smoke tests', () => {
  test('uploads a deck, navigates slides, and enters present mode', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('New deck')).toBeVisible()

    const fileInput = page.locator('input[type="file"][accept*=".html"]')
    await fileInput.setInputFiles(plainCssDeck)

    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Slide 1 of 3')).toBeVisible()

    await page.getByRole('button', { name: 'Present fullscreen' }).click()

    const presentDialog = page.getByRole('dialog', { name: 'Presentation mode' })
    await expect(presentDialog).toBeVisible()
    await expect(presentDialog.getByText('1 / 3')).toBeVisible()

    await presentDialog.getByRole('button', { name: 'Next slide' }).click()
    await expect(presentDialog.getByText('2 / 3')).toBeVisible()

    await presentDialog.getByRole('button', { name: 'Exit' }).click()
    await expect(presentDialog).not.toBeVisible()
    await expect(page.getByText('Slide 2 of 3')).toBeVisible()
  })

  test('keeps hostile deck scripts out of the preview iframe', async ({ page }) => {
    await page.goto('/')

    const fileInput = page.locator('input[type="file"][accept*=".html"]')
    await fileInput.setInputFiles(hostileScriptsDeck)

    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Slide 1 of 2')).toBeVisible()
    await expect(page.getByText('Scripts running')).not.toBeVisible()

    const previewFrame = page.getByTitle('Generated Ark presentation preview')
    await expect(previewFrame).toHaveAttribute('sandbox', 'allow-scripts')

    const srcDoc = await previewFrame.getAttribute('srcdoc')
    expect(srcDoc).toBeTruthy()
    expect(srcDoc).toContain('data-ark-preview-nav')
    expect(srcDoc).not.toContain('data-ark-preview-bridge')
    expect(srcDoc).not.toContain('window.evilHead')
    expect(srcDoc).not.toContain('window.evilModule')
    expect(srcDoc).not.toContain('onload=')
    expect(srcDoc).not.toContain('onclick=')
    expect(srcDoc).not.toContain('onerror=')
  })
})
