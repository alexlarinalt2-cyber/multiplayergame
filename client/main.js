import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { io } from 'socket.io-client'

// ── Scene setup ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0a0000)
scene.fog = new THREE.Fog(0x0a0000, 20, 60)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200)
camera.position.set(0, 18, 18)
camera.lookAt(0, 0, 0)

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})

// ── Lighting ─────────────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x331100, 1.5)
scene.add(ambientLight)

const sunLight = new THREE.DirectionalLight(0xffaa44, 2)
sunLight.position.set(10, 20, 10)
sunLight.castShadow = true
sunLight.shadow.mapSize.set(2048, 2048)
sunLight.shadow.camera.near = 0.5
sunLight.shadow.camera.far = 60
sunLight.shadow.camera.left = -20
sunLight.shadow.camera.right = 20
sunLight.shadow.camera.top = 20
sunLight.shadow.camera.bottom = -20
scene.add(sunLight)

// Lava glow light from below
const lavaLight = new THREE.PointLight(0xff4400, 3, 30)
lavaLight.position.set(0, -3, 0)
scene.add(lavaLight)

// ── Lava plane ────────────────────────────────────────────────────────────────
const lavaGeo = new THREE.PlaneGeometry(80, 80, 32, 32)
const lavaMat = new THREE.MeshStandardMaterial({
  color: 0xff2200,
  emissive: 0xff1100,
  emissiveIntensity: 0.6,
  roughness: 0.8,
  metalness: 0
})
const lavaPlane = new THREE.Mesh(lavaGeo, lavaMat)
lavaPlane.rotation.x = -Math.PI / 2
lavaPlane.position.y = -4
scene.add(lavaPlane)

// Lava particle system
const particleCount = 200
const particleGeo = new THREE.BufferGeometry()
const positions = new Float32Array(particleCount * 3)
const particleVelocities = []
for (let i = 0; i < particleCount; i++) {
  positions[i * 3] = (Math.random() - 0.5) * 24
  positions[i * 3 + 1] = -4 + Math.random() * 2
  positions[i * 3 + 2] = (Math.random() - 0.5) * 24
  particleVelocities.push({ vy: 0.02 + Math.random() * 0.04, life: Math.random() })
}
particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
const particleMat = new THREE.PointsMaterial({ color: 0xff6600, size: 0.15, transparent: true, opacity: 0.8 })
const particles = new THREE.Points(particleGeo, particleMat)
scene.add(particles)

// ── Tile grid ─────────────────────────────────────────────────────────────────
const GRID_SIZE = 6
const TILE_SPACING = 2
const TILE_HEIGHT = 0.3

const tileObjects = {} // tileId -> THREE.Mesh
const tileLoader = new GLTFLoader()

// Tile colors by state
const TILE_COLORS = {
  safe: 0x4a9eff,
  warning: 0xff8800,
  gone: null
}

let tileModel = null

function createTile(tileData) {
  const { id, row, col } = tileData
  const x = (col - GRID_SIZE / 2 + 0.5) * TILE_SPACING
  const z = (row - GRID_SIZE / 2 + 0.5) * TILE_SPACING

  let mesh
  if (tileModel) {
    mesh = tileModel.clone()
    mesh.scale.set(0.9, 0.5, 0.9)
  } else {
    // fallback primitive
    const geo = new THREE.BoxGeometry(1.8, TILE_HEIGHT, 1.8)
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a9eff, emissive: 0x112244, roughness: 0.6 })
    mesh = new THREE.Mesh(geo, mat)
  }

  mesh.position.set(x, 0, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
      child.userData.tileId = id
    }
  })
  mesh.userData.tileId = id
  mesh.userData.baseY = 0
  scene.add(mesh)
  tileObjects[id] = mesh
}

// Try to load block model, fall back gracefully
tileLoader.load(
  '/assets/models/tiles/block.glb',
  (gltf) => { tileModel = gltf.scene },
  undefined,
  () => { console.log('No block.glb found, using primitive tiles') }
)

// ── Character models ──────────────────────────────────────────────────────────
const CHAR_LETTERS = 'abcdefghijklmnopqr'.split('')
const charModels = {}   // letter -> THREE.Group (cached)
const charLoader = new GLTFLoader()

const playerMeshes = {}  // socketId -> THREE.Group
const playerLabels = {}  // socketId -> THREE.Sprite

function loadCharacter(index, callback) {
  const letter = CHAR_LETTERS[index % CHAR_LETTERS.length]
  if (charModels[letter]) { callback(charModels[letter].clone()); return }

  charLoader.load(
    `/assets/models/characters/character-${letter}.glb`,
    (gltf) => {
      charModels[letter] = gltf.scene
      gltf.scene.traverse(c => { if (c.isMesh) { c.castShadow = true } })
      callback(gltf.scene.clone())
    },
    undefined,
    () => {
      // fallback: colored capsule
      const group = new THREE.Group()
      const colors = [0x4af, 0xf44, 0x4f4, 0xff4, 0xf4f, 0x4ff, 0xfa4, 0xaaf]
      const mat = new THREE.MeshStandardMaterial({ color: colors[index % colors.length] })
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 4, 8), mat)
      body.position.y = 0.8
      body.castShadow = true
      group.add(body)
      callback(group)
    }
  )
}

function makeLabel(name) {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.roundRect(4, 4, 248, 56, 8)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px Segoe UI'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name.slice(0, 14), 128, 32)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(2, 0.5, 1)
  sprite.position.y = 2.6
  return sprite
}

function spawnPlayer(playerData) {
  if (playerMeshes[playerData.id]) return
  loadCharacter(playerData.charIndex, (group) => {
    group.position.set(playerData.x || 0, 0.5, playerData.z || 0)
    group.scale.set(0.9, 0.9, 0.9)

    const label = makeLabel(playerData.name)
    group.add(label)
    playerLabels[playerData.id] = label

    scene.add(group)
    playerMeshes[playerData.id] = group
  })
}

function removePlayer(id) {
  if (playerMeshes[id]) {
    scene.remove(playerMeshes[id])
    delete playerMeshes[id]
    delete playerLabels[id]
  }
}

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {}
window.addEventListener('keydown', e => { keys[e.code] = true })
window.addEventListener('keyup', e => { keys[e.code] = false })

let myId = null
let myVelY = 0
let myY = 0
let isGrounded = true
const GRAVITY = -0.018
const JUMP_FORCE = 0.25
const MOVE_SPEED = 0.08

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io()
let gameState = 'lobby'
let myName = ''

// DOM refs
const lobbyEl = document.getElementById('lobby')
const scoreboardEl = document.getElementById('scoreboard')
const scoreListEl = document.getElementById('scoreList')
const announcementEl = document.getElementById('announcement')
const playerCountEl = document.getElementById('playercount')
const controlsEl = document.getElementById('controls')
const nameInput = document.getElementById('nameInput')
const joinBtn = document.getElementById('joinBtn')

joinBtn.addEventListener('click', () => {
  myName = nameInput.value.trim() || 'Player'
  socket.emit('join', { name: myName })
  lobbyEl.style.display = 'none'
  scoreboardEl.style.display = 'block'
  playerCountEl.style.display = 'block'
  controlsEl.style.display = 'block'
})
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click() })

function showAnnouncement(text, duration = 2500) {
  announcementEl.textContent = text
  announcementEl.style.display = 'block'
  setTimeout(() => { announcementEl.style.display = 'none' }, duration)
}

function updateScoreboard(scores) {
  if (!scores) return
  scoreListEl.innerHTML = scores
    .sort((a, b) => b.score - a.score)
    .map(s => `<div class="entry"><span>${s.name}</span><span>${s.score}</span></div>`)
    .join('')
}

function clearTiles() {
  Object.values(tileObjects).forEach(m => scene.remove(m))
  Object.keys(tileObjects).forEach(k => delete tileObjects[k])
}

socket.on('joined', ({ id, players, gameState: gs, tiles }) => {
  myId = id
  gameState = gs
  players.forEach(spawnPlayer)
  if (tiles && tiles.length) tiles.forEach(createTile)
  updatePlayerCount(players.length)
  if (gameState === 'lobby') showAnnouncement('Waiting for players...', 99999)
})

socket.on('playerJoined', (p) => {
  spawnPlayer(p)
  updatePlayerCount(Object.values(playerMeshes).length)
})

socket.on('playerLeft', ({ id }) => {
  removePlayer(id)
  updatePlayerCount(Object.values(playerMeshes).length)
})

socket.on('playerMoved', ({ id, x, z, y }) => {
  const mesh = playerMeshes[id]
  if (!mesh) return
  mesh.position.set(x, y + 0.5, z)
  const dx = mesh.position.x - mesh.userData.prevX
  if (Math.abs(dx) > 0.01) mesh.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2
  mesh.userData.prevX = mesh.position.x
})

socket.on('roundStart', ({ tiles, players }) => {
  gameState = 'playing'
  clearTiles()
  tiles.forEach(createTile)
  players.forEach(p => {
    if (playerMeshes[p.id]) {
      playerMeshes[p.id].position.set(p.x, 0.5, p.z)
      playerMeshes[p.id].visible = true
    } else {
      spawnPlayer(p)
    }
    if (p.id === myId) { myY = 0; myVelY = 0 }
  })
  showAnnouncement('GO!', 1500)
  announcementEl.style.display = 'none'
})

socket.on('tileWarning', ({ tileId }) => {
  const tile = tileObjects[tileId]
  if (!tile) return
  tile.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone()
      child.material.color.setHex(0xff6600)
      child.material.emissive.setHex(0xff2200)
      child.material.emissiveIntensity = 0.5
    }
  })
})

socket.on('tileFall', ({ tileId }) => {
  const tile = tileObjects[tileId]
  if (!tile) return
  // animate tile falling
  const fallAnim = { start: tile.position.y, target: -10, t: 0 }
  tile.userData.falling = fallAnim
})

socket.on('playerDied', ({ id }) => {
  const mesh = playerMeshes[id]
  if (!mesh) return
  if (id === myId) {
    showAnnouncement('YOU FELL IN THE LAVA!', 3000)
    myVelY = 0
  }
  // death drop animation
  mesh.userData.dying = true
})

socket.on('roundEnd', ({ winnerId, scores }) => {
  gameState = 'roundEnd'
  updateScoreboard(scores)
  if (winnerId === myId) showAnnouncement('YOU WIN!', 4000)
  else if (winnerId) {
    const winnerMesh = playerMeshes[winnerId]
    showAnnouncement('Round Over!', 4000)
  } else {
    showAnnouncement('DRAW!', 4000)
  }
})

function updatePlayerCount(n) {
  playerCountEl.textContent = `Players: ${n}`
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let lastEmit = 0

function getTileUnderPlayer(x, z) {
  let closest = -1
  let bestDist = 1.2
  Object.values(tileObjects).forEach(tile => {
    if (tile.userData.falling) return
    const dx = tile.position.x - x
    const dz = tile.position.z - z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < bestDist) { bestDist = dist; closest = tile.userData.tileId }
  })
  return closest
}

function animate(time) {
  requestAnimationFrame(animate)

  // Animate lava particles
  const pos = particles.geometry.attributes.position.array
  for (let i = 0; i < particleCount; i++) {
    pos[i * 3 + 1] += particleVelocities[i].vy
    if (pos[i * 3 + 1] > 0) {
      pos[i * 3 + 1] = -4
      pos[i * 3] = (Math.random() - 0.5) * 24
      pos[i * 3 + 2] = (Math.random() - 0.5) * 24
    }
  }
  particles.geometry.attributes.position.needsUpdate = true

  // Pulse lava light
  lavaLight.intensity = 2.5 + Math.sin(time * 0.002) * 0.8

  // Animate falling tiles
  Object.values(tileObjects).forEach(tile => {
    if (tile.userData.falling) {
      tile.userData.falling.t += 0.03
      tile.position.y = THREE.MathUtils.lerp(
        tile.userData.falling.start,
        tile.userData.falling.target,
        tile.userData.falling.t
      )
      tile.rotation.z += 0.04
      if (tile.userData.falling.t >= 1) {
        scene.remove(tile)
        delete tileObjects[tile.userData.tileId]
      }
    }
  })

  // Animate dying players
  Object.values(playerMeshes).forEach(mesh => {
    if (mesh.userData.dying) {
      mesh.position.y -= 0.08
      mesh.rotation.z += 0.05
      if (mesh.position.y < -6) mesh.userData.dying = false
    }
  })

  // Move local player
  if (myId && gameState === 'playing') {
    const mesh = playerMeshes[myId]
    if (mesh && !mesh.userData.dying) {
      let moved = false
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      forward.y = 0; forward.normalize()
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

      const dir = new THREE.Vector3()
      if (keys['KeyW'] || keys['ArrowUp']) dir.add(forward)
      if (keys['KeyS'] || keys['ArrowDown']) dir.sub(forward)
      if (keys['KeyA'] || keys['ArrowLeft']) dir.sub(right)
      if (keys['KeyD'] || keys['ArrowRight']) dir.add(right)

      if (dir.lengthSq() > 0) {
        dir.normalize()
        mesh.position.x += dir.x * MOVE_SPEED
        mesh.position.z += dir.z * MOVE_SPEED
        mesh.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI
        moved = true
      }

      if ((keys['Space'] || keys['ArrowUp'] && false) && isGrounded) {
        myVelY = JUMP_FORCE
        isGrounded = false
      }
      if (keys['Space'] && isGrounded) {
        myVelY = JUMP_FORCE
        isGrounded = false
      }

      myVelY += GRAVITY
      myY += myVelY

      if (myY <= 0) { myY = 0; myVelY = 0; isGrounded = true }
      mesh.position.y = myY + 0.5

      // fall into lava
      if (myY < -3) {
        socket.emit('move', { x: mesh.position.x, z: mesh.position.z, y: myY, tileId: -1 })
      }

      // camera follows player
      const camTarget = new THREE.Vector3(mesh.position.x, mesh.position.y + 14, mesh.position.z + 14)
      camera.position.lerp(camTarget, 0.05)
      camera.lookAt(mesh.position.x, mesh.position.y, mesh.position.z)

      if (time - lastEmit > 50) {
        const tileId = getTileUnderPlayer(mesh.position.x, mesh.position.z)
        socket.emit('move', { x: mesh.position.x, z: mesh.position.z, y: myY, tileId })
        lastEmit = time
      }
    }
  }

  renderer.render(scene, camera)
}

animate(0)
