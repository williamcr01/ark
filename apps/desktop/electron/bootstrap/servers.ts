/** Port allocation and lifecycle for the two loopback servers Ark starts. */

import { createServer, type RequestListener, type Server } from 'node:http'

export type DeferredServer = {
  server: Server
  origin: string
  setHandler: (handler: RequestListener) => void
}

export function listen(port: number): Promise<DeferredServer> {
  let handler: RequestListener = (_request, response) => {
    response.statusCode = 503
    response.end('Ark is starting.')
  }
  const server = createServer((request, response) => handler(request, response))

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not resolve the Ark loopback server address.'))
        return
      }

      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
        setHandler(nextHandler) {
          handler = nextHandler
        },
      })
    })
  })
}

export function closeServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()))
}
