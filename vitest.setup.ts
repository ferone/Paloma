import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// findBy*/waitFor default to 1 s. Page tests lazy-load whole feature modules,
// which can take longer when the full suite runs in parallel.
// Heavy chart pages render in jsdom while the whole suite runs in parallel; under load a
// first render can take several seconds, so waits get headroom (a real failure still fails).
configure({ asyncUtilTimeout: 10_000 })
