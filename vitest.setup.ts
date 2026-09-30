import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// findBy*/waitFor default to 1 s. Page tests lazy-load whole feature modules,
// which can take longer when the full suite runs in parallel.
configure({ asyncUtilTimeout: 5000 })
