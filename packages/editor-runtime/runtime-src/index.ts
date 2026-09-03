import './state.ts'
import { bootstrap } from './lifecycle.ts'
import { startPortConnection } from './port.ts'

startPortConnection()
bootstrap()
