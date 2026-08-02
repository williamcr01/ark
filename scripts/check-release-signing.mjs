const requiredByRunner = {
  Linux: [],
  macOS: [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ],
  Windows: ['CSC_LINK', 'CSC_KEY_PASSWORD'],
}

const runner = process.env.RUNNER_OS
const required = requiredByRunner[runner]

if (!required) throw new Error(`Unsupported release runner: ${runner || '(empty)'}.`)

const missing = required.filter((name) => !process.env[name]?.trim())
if (missing.length > 0) {
  throw new Error(`Missing ${runner} signing configuration: ${missing.join(', ')}.`)
}
