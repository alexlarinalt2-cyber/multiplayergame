import express from 'express'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)

app.use(express.static(join(__dirname, '../client')))

httpServer.listen(3000, () => console.log('Server running on http://localhost:3000'))
