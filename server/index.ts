import 'dotenv/config'

import { createApp } from './app.ts'

const port = Number(process.env.PORT ?? 8787)
const app = createApp()

app.listen(port, () => {
  console.log(`Ark API server listening on http://localhost:${port}`)
})
