import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)

app.use(express.static(join(__dirname, '../client')))

// --- Game state ---
const GRID_SIZE = 6          // 6x6 grid of tiles
const TILE_COUNT = GRID_SIZE * GRID_SIZE
const ROUND_DURATION = 90000 // 90 seconds
const FALL_INTERVAL = 2500   // a tile falls every 2.5s to start

let players = {}             // { socketId: { id, name, charIndex, x, z, alive, score } }
let tiles = []               // [{ id, row, col, state }]  state: 'safe'|'warning'|'falling'|'gone'
let gameState = 'lobby'      // lobby | playing | roundEnd
let roundTimer = null
let fallTimer = null
let tilePool = []            // shuffled list of tile ids to fall

function buildTileGrid() {
  tiles = []
  tilePool = []
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const id = row * GRID_SIZE + col
      tiles.push({ id, row, col, state: 'safe' })
      tilePool.push(id)
    }
  }
  // shuffle
  for (let i = tilePool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[tilePool[i], tilePool[j]] = [tilePool[j], tilePool[i]]
  }
}

function getAlivePlayers() {
  return Object.values(players).filter(p => p.alive)
}

function checkWinCondition() {
  const alive = getAlivePlayers()
  if (alive.length <= 1) {
    endRound(alive[0] || null)
  }
}

function startFallCycle() {
  let interval = FALL_INTERVAL
  fallTimer = setInterval(() => {
    if (tilePool.length === 0) {
      endRound(getAlivePlayers()[0] || null)
      return
    }
    const tileId = tilePool.pop()
    const tile = tiles[tileId]
    tile.state = 'warning'
    io.emit('tileWarning', { tileId })

    setTimeout(() => {
      if (tile.state === 'warning') {
        tile.state = 'gone'
        io.emit('tileFall', { tileId })

        // kill players on this tile
        Object.values(players).forEach(p => {
          if (p.alive && p.tileId === tileId) {
            p.alive = false
            io.emit('playerDied', { id: p.id })
            checkWinCondition()
          }
        })
      }
    }, 1500)

    // speed up over time
    interval = Math.max(800, interval - 50)
  }, interval)
}

function endRound(winner) {
  gameState = 'roundEnd'
  clearInterval(fallTimer)
  clearTimeout(roundTimer)

  if (winner) {
    winner.score = (winner.score || 0) + 1
  }

  io.emit('roundEnd', {
    winnerId: winner ? winner.id : null,
    scores: Object.values(players).map(p => ({ id: p.id, name: p.name, score: p.score || 0 }))
  })

  // auto restart after 5s
  setTimeout(() => {
    if (Object.keys(players).length >= 2) startRound()
    else gameState = 'lobby'
  }, 5000)
}

function startRound() {
  gameState = 'playing'
  buildTileGrid()

  // respawn all players on random tiles
  const startPositions = getShuffledStartPositions()
  let i = 0
  Object.values(players).forEach(p => {
    p.alive = true
    const pos = startPositions[i++ % startPositions.length]
    p.x = pos.x
    p.z = pos.z
    p.tileId = pos.tileId
  })

  io.emit('roundStart', {
    tiles: tiles.map(t => ({ id: t.id, row: t.row, col: t.col })),
    players: Object.values(players)
  })

  startFallCycle()

  roundTimer = setTimeout(() => {
    const alive = getAlivePlayers()
    endRound(alive.length > 0 ? alive[0] : null)
  }, ROUND_DURATION)
}

function getShuffledStartPositions() {
  const positions = []
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      positions.push({
        x: (col - GRID_SIZE / 2 + 0.5) * 2,
        z: (row - GRID_SIZE / 2 + 0.5) * 2,
        tileId: row * GRID_SIZE + col
      })
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[positions[i], positions[j]] = [positions[j], positions[i]]
  }
  return positions
}

// --- Socket events ---
io.on('connection', (socket) => {
  console.log('connected:', socket.id)

  socket.on('join', ({ name }) => {
    const charIndex = Object.keys(players).length % 18
    players[socket.id] = {
      id: socket.id,
      name: name || 'Player',
      charIndex,
      x: 0,
      z: 0,
      y: 0,
      alive: false,
      score: 0,
      tileId: -1
    }

    socket.emit('joined', {
      id: socket.id,
      players: Object.values(players),
      gameState,
      tiles: tiles.map(t => ({ id: t.id, row: t.row, col: t.col, state: t.state }))
    })

    socket.broadcast.emit('playerJoined', players[socket.id])

    // start round when 2+ players
    if (gameState === 'lobby' && Object.keys(players).length >= 2) {
      setTimeout(startRound, 3000)
    }
  })

  socket.on('move', ({ x, z, y, tileId }) => {
    const p = players[socket.id]
    if (!p || !p.alive) return
    p.x = x
    p.z = z
    p.y = y ?? 0
    if (tileId !== undefined) p.tileId = tileId
    socket.broadcast.emit('playerMoved', { id: socket.id, x, z, y: p.y, tileId: p.tileId })
  })

  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id)
    delete players[socket.id]
    io.emit('playerLeft', { id: socket.id })
    if (gameState === 'playing') checkWinCondition()
  })
})

httpServer.listen(3000, () => console.log('Server running on http://localhost:3000'))
