import path from 'node:path'
import { packageVitestConfig } from '../../vitest.shared.ts'

export default packageVitestConfig(import.meta.dirname, {
  setupFiles: [path.resolve(import.meta.dirname, './vitest.setup.ts')],
})
