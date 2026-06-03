import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as CANNON from 'cannon-es'
const gltfLoader = new GLTFLoader()

// Load a GLB, resolve with scene or null on failure
function loadGLB(path) {
  return new Promise(resolve => {
    gltfLoader.load(path, gltf => resolve(gltf.scene), undefined, () => resolve(null))
  })
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TOTAL_LAPS = 3
const TRACK_WIDTH = 11
const NUM_WAYPOINTS = 80
const CAR_COLORS = [0x1565c0, 0xc62828, 0x2e7d32, 0xe65100]
const BOT_NAMES = ['BOT REX', 'BOT ZEN', 'BOT KAI']
const BOT_SPEEDS = [1.0, 0.95, 1.05]

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x6ab4e8)
scene.fog = new THREE.FogExp2(0x8ac8f0, 0.007)

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 500)

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})

// ── Lighting ──────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xc8d8f0, 0.9))
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2)
sun.position.set(60, 90, 40)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 1
sun.shadow.camera.far = 300
;[-120, 120].forEach(v => {
  sun.shadow.camera.left = v < 0 ? v : sun.shadow.camera.left
  sun.shadow.camera.right = v > 0 ? v : sun.shadow.camera.right
  sun.shadow.camera.top = v > 0 ? v : sun.shadow.camera.top
  sun.shadow.camera.bottom = v < 0 ? v : sun.shadow.camera.bottom
})
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120
scene.add(sun)

// ── Physics World ─────────────────────────────────────────────────────────────
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) })
world.broadphase = new CANNON.SAPBroadphase(world)
world.solver.iterations = 12
world.defaultContactMaterial.friction = 0.4
world.defaultContactMaterial.restitution = 0.1

const groundBody = new CANNON.Body({ mass: 0 })
groundBody.addShape(new CANNON.Plane())
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
world.addBody(groundBody)

// ── Track Definition ──────────────────────────────────────────────────────────
// Oval circuit - control points (x, z)
const trackControlPts = [
  new THREE.Vector3(0,   0,  55),   // south (start/finish)
  new THREE.Vector3(-30, 0,  48),
  new THREE.Vector3(-52, 0,  28),
  new THREE.Vector3(-58, 0,   0),   // west
  new THREE.Vector3(-52, 0, -28),
  new THREE.Vector3(-30, 0, -48),
  new THREE.Vector3(0,   0, -55),   // north
  new THREE.Vector3(30,  0, -48),
  new THREE.Vector3(52,  0, -28),
  new THREE.Vector3(58,  0,   0),   // east
  new THREE.Vector3(52,  0,  28),
  new THREE.Vector3(30,  0,  48),
]

const trackCurve = new THREE.CatmullRomCurve3(trackControlPts, true, 'catmullrom', 0.5)
const waypoints = trackCurve.getPoints(NUM_WAYPOINTS)

// Build track road mesh
function buildTrackMesh() {
  const pts = trackCurve.getPoints(300)
  const verts = [], uvs = [], idx = []

  for (let i = 0; i <= 300; i++) {
    const p = pts[i % pts.length]
    const pn = pts[(i + 1) % pts.length]
    const tan = new THREE.Vector3().subVectors(pn, p).normalize()
    const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize()

    const hw = TRACK_WIDTH / 2
    verts.push(
      p.x - right.x * hw, 0.02, p.z - right.z * hw,  // left
      p.x + right.x * hw, 0.02, p.z + right.z * hw   // right
    )
    const u = i / 300
    uvs.push(0, u * 20,  1, u * 20)

    if (i < 300) {
      const b = i * 2
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95, metalness: 0 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  return mesh
}

// Track edge stripes
function buildEdgeStripes(side) {
  const pts = trackCurve.getPoints(300)
  const stripeW = 0.5
  const verts = [], uvs = [], idx = []
  const hw = TRACK_WIDTH / 2

  for (let i = 0; i <= 300; i++) {
    const p = pts[i % pts.length]
    const pn = pts[(i + 1) % pts.length]
    const tan = new THREE.Vector3().subVectors(pn, p).normalize()
    const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize()

    const base = side === 'left' ? -hw : hw - stripeW
    verts.push(
      p.x + right.x * base,              0.03, p.z + right.z * base,
      p.x + right.x * (base + stripeW),  0.03, p.z + right.z * (base + stripeW)
    )
    const u = i / 300
    uvs.push(0, u * 10, 1, u * 10)
    if (i < 300) {
      const b = i * 2
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  // alternating red/white every 3m
  const mat = new THREE.MeshStandardMaterial({ color: side === 'left' ? 0xdd2222 : 0xdddddd, roughness: 1 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  return mesh
}

// Center dashed line
function buildCenterDash() {
  const pts = trackCurve.getPoints(300)
  const group = new THREE.Group()
  for (let i = 0; i < 300; i += 6) {
    const p = pts[i]
    const geo = new THREE.PlaneGeometry(0.18, 2.2)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(p.x, 0.03, p.z)
    const pn = pts[(i + 1) % pts.length]
    mesh.rotation.z = -Math.atan2(pn.x - p.x, pn.z - p.z)
    group.add(mesh)
  }
  return group
}

// Start/finish line
function buildStartLine() {
  const geo = new THREE.PlaneGeometry(TRACK_WIDTH, 1.5)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, 0.04, 55)
  return mesh
}

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(600, 600),
  new THREE.MeshStandardMaterial({ color: 0x3d8b3d, roughness: 1 })
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// Decorative trees around track
function addTrees() {
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6)
  const leafGeo = new THREE.ConeGeometry(1.2, 2.5, 7)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32 })
  const treePositions = []
  for (let a = 0; a < Math.PI * 2; a += 0.35) {
    const r = 72 + Math.sin(a * 3) * 5
    treePositions.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  treePositions.forEach(([x, z]) => {
    const t = new THREE.Group()
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.castShadow = true
    const leaves = new THREE.Mesh(leafGeo, leafMat)
    leaves.position.y = 2.2
    leaves.castShadow = true
    t.add(trunk, leaves)
    t.position.set(x, 0.75, z)
    t.rotation.y = Math.random() * Math.PI
    scene.add(t)
  })
}

scene.add(buildTrackMesh())
scene.add(buildEdgeStripes('left'))
scene.add(buildEdgeStripes('right'))
scene.add(buildCenterDash())
scene.add(buildStartLine())
addTrees()

// ── Car Builder ───────────────────────────────────────────────────────────────
function createCarPhysics(spawnPos, spawnAngle) {
  const chassisBody = new CANNON.Body({ mass: 180 })
  chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.38, 2.0)), new CANNON.Vec3(0, 0.28, 0))
  chassisBody.position.set(spawnPos.x, 1.0, spawnPos.z)
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawnAngle)
  chassisBody.linearDamping = 0.08
  chassisBody.angularDamping = 0.45
  world.addBody(chassisBody)

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2
  })

  const baseWheel = {
    radius: 0.33,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 40,
    suspensionRestLength: 0.38,
    frictionSlip: 2.0,
    dampingRelaxation: 2.3,
    dampingCompression: 4.5,
    maxSuspensionForce: 250000,
    rollInfluence: 0.005,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    maxSuspensionTravel: 0.28,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true
  }

  // FL, FR, RL, RR
  ;[
    new CANNON.Vec3(-0.8,  0, 1.55),
    new CANNON.Vec3( 0.8,  0, 1.55),
    new CANNON.Vec3(-0.8,  0, -1.45),
    new CANNON.Vec3( 0.8,  0, -1.45),
  ].forEach(pos => vehicle.addWheel({ ...baseWheel, chassisConnectionPointLocal: pos }))

  vehicle.addToWorld(world)
  return { body: chassisBody, vehicle }
}

// Primitive fallback car (box-based)
function makePrimitiveCar(color) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.76, 0.48, 4.0),
    new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.7 })
  )
  body.position.y = 0.3; body.castShadow = true; g.add(body)

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.42, 1.85),
    new THREE.MeshStandardMaterial({ color: 0x112244, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 })
  )
  cabin.position.set(0, 0.75, -0.25); cabin.castShadow = true; g.add(cabin)

  const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffcc, emissiveIntensity: 2 })
  ;[-0.55, 0.55].forEach(x => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.06), hlMat)
    hl.position.set(x, 0.32, 1.97); g.add(hl)
  })

  const wGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.28, 14)
  const wMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })
  const wheelMeshes = []
  ;[[-0.96, 0, 1.5], [0.96, 0, 1.5], [-0.96, 0, -1.4], [0.96, 0, -1.4]].forEach(([x, y, z]) => {
    const wg = new THREE.Group()
    wg.add(new THREE.Mesh(wGeo, wMat))
    wg.rotation.z = Math.PI / 2
    wg.position.set(x, y, z)
    g.add(wg)
    wheelMeshes.push(wg)
  })

  scene.add(g)
  return { group: g, wheelMeshes }
}

// Player = race car, bots = karts (all from Kenney Car Kit)
const CAR_GLB_NAMES = ['race', 'kart-oobi', 'kart-oodi', 'kart-ooli']

async function loadCarGLB(index) {
  const model = await loadGLB(`/assets/models/cars/${CAR_GLB_NAMES[index]}.glb`)
  if (!model) return null

  // Normalize scale so the longest axis fits ~3.8 units
  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = 3.8 / Math.max(size.x, size.z)
  model.scale.setScalar(scale)

  // Center horizontally, sit on y=0
  const center = new THREE.Vector3()
  box.getCenter(center)
  model.position.x -= center.x * scale
  model.position.z -= center.z * scale
  model.position.y -= box.min.y * scale

  model.traverse(c => { if (c.isMesh) c.castShadow = true })
  return model
}

// ── Spawn positions ───────────────────────────────────────────────────────────
const startTangent = trackCurve.getTangentAt(0)
const startAngle = Math.atan2(startTangent.x, startTangent.z)

const gridOffsets = [
  { x: -2, z: 55 },
  { x:  2, z: 55 },
  { x: -2, z: 60 },
  { x:  2, z: 60 },
]

const playerPhysics = createCarPhysics(gridOffsets[0], startAngle)
let playerVisual = makePrimitiveCar(CAR_COLORS[0])

const bots = BOT_SPEEDS.map((speed, i) => ({
  physics:  createCarPhysics(gridOffsets[i + 1], startAngle),
  visual:   makePrimitiveCar(CAR_COLORS[i + 1]),
  wpIdx:    0,
  lap:      0,
  speed,
  finished: false,
  prevWpIdx: 0
}))

// Async: swap primitives for GLB models once loaded (no blocking)
;(async () => {
  for (let i = 0; i < 4; i++) {
    const model = await loadCarGLB(i)
    if (!model) continue
    const wrapper = new THREE.Group()
    wrapper.add(model)
    scene.add(wrapper)
    const newVisual = { group: wrapper, wheelMeshes: [] }
    if (i === 0) {
      scene.remove(playerVisual.group)
      playerVisual = newVisual
    } else {
      scene.remove(bots[i - 1].visual.group)
      bots[i - 1].visual = newVisual
    }
  }
})()

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {}
window.addEventListener('keydown', e => { keys[e.code] = true })
window.addEventListener('keyup',   e => { keys[e.code] = false })

// ── Race state ────────────────────────────────────────────────────────────────
let raceStarted = false
let raceOver    = false
let playerLap   = 0
let playerWpIdx = 0
let playerPrevWpIdx = 0
let raceStartTime = 0

// ── HUD refs ──────────────────────────────────────────────────────────────────
const speedEl  = document.getElementById('speed')
const lapEl    = document.getElementById('lap')
const posEl    = document.getElementById('pos-value')
const timerEl  = document.getElementById('timer')
const annEl    = document.getElementById('announcement')

function showAnn(text, ms = 1200) {
  annEl.textContent = text
  annEl.style.display = 'block'
  annEl.style.animation = 'none'
  void annEl.offsetWidth
  annEl.style.animation = 'pop 0.2s ease-out'
  if (ms > 0) setTimeout(() => { annEl.style.display = 'none' }, ms)
}

function formatTime(ms) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`
}

// ── Waypoint helpers ──────────────────────────────────────────────────────────
function nearestWaypoint(px, pz) {
  let best = 0, bestD = Infinity
  waypoints.forEach((wp, i) => {
    const d = (wp.x - px) ** 2 + (wp.z - pz) ** 2
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

function detectLap(prevIdx, curIdx) {
  // crossing from near-end back to near-start
  return prevIdx > NUM_WAYPOINTS * 0.8 && curIdx < NUM_WAYPOINTS * 0.2
}

function raceProgress(lap, wpIdx) {
  return lap * NUM_WAYPOINTS + wpIdx
}

function getPosition() {
  const myP = raceProgress(playerLap, playerWpIdx)
  let pos = 1
  bots.forEach(b => { if (raceProgress(b.lap, b.wpIdx) > myP) pos++ })
  return pos
}

// ── Car update ────────────────────────────────────────────────────────────────
function updatePlayer() {
  const v = playerPhysics.vehicle
  const maxSteer = 0.44
  const maxForce = 2400
  const brakeF   = 50

  let engine = 0, brake = 0, steer = 0
  if (keys['KeyW'] || keys['ArrowUp'])    engine =  maxForce
  if (keys['KeyS'] || keys['ArrowDown']) { engine = -maxForce * 0.4; brake = brakeF }
  if (keys['KeyA'] || keys['ArrowLeft'])  steer =  maxSteer
  if (keys['KeyD'] || keys['ArrowRight']) steer = -maxSteer

  v.setSteeringValue(steer, 0); v.setSteeringValue(steer, 1)
  v.applyEngineForce(engine, 2); v.applyEngineForce(engine, 3)
  v.setBrake(brake, 0); v.setBrake(brake, 1)
  v.setBrake(brake * 0.5, 2); v.setBrake(brake * 0.5, 3)

  const p = playerPhysics.body.position
  const cur = nearestWaypoint(p.x, p.z)
  if (detectLap(playerPrevWpIdx, cur)) {
    playerLap++
    if (playerLap > TOTAL_LAPS && !raceOver) {
      raceOver = true
      showAnn(`FINISH!\n${formatTime(Date.now() - raceStartTime)}`, 0)
      annEl.style.fontSize = '3rem'
    }
  }
  playerPrevWpIdx = cur
  playerWpIdx = cur
}

function updateBot(bot) {
  const wp = waypoints[bot.wpIdx]
  const pos = bot.physics.body.position
  const dx = wp.x - pos.x
  const dz = wp.z - pos.z
  const dist = Math.sqrt(dx * dx + dz * dz)

  if (dist < 9) {
    bot.prevWpIdx = bot.wpIdx
    bot.wpIdx = (bot.wpIdx + 1) % NUM_WAYPOINTS
    if (detectLap(bot.prevWpIdx, bot.wpIdx)) {
      bot.lap++
      if (bot.lap > TOTAL_LAPS) bot.finished = true
    }
  }

  const quat = bot.physics.body.quaternion
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w)
  )
  const toTarget = new THREE.Vector3(dx, 0, dz).normalize()
  const cross = fwd.x * toTarget.z - fwd.z * toTarget.x
  const steer = Math.max(-0.5, Math.min(0.5, -cross * 1.8))

  const v = bot.physics.vehicle
  const force = 2200 * bot.speed
  v.setSteeringValue(steer, 0); v.setSteeringValue(steer, 1)
  v.applyEngineForce(force, 2); v.applyEngineForce(force, 3)
  v.setBrake(0, 0); v.setBrake(0, 1); v.setBrake(0, 2); v.setBrake(0, 3)
}

// ── Visual sync ───────────────────────────────────────────────────────────────
function syncMesh(physics, visual) {
  const p = physics.body.position
  const q = physics.body.quaternion
  visual.group.position.set(p.x, p.y - 0.32, p.z)
  visual.group.quaternion.set(q.x, q.y, q.z, q.w)

  if (visual.wheelMeshes.length) {
    const speed = physics.body.velocity.length()
    visual.wheelMeshes.forEach(w => { w.rotation.x += speed * 0.04 })
  }
}

// ── Chase camera (behind + above car so you can see it) ──────────────────────
const _chaseOffset = new THREE.Vector3(0, 4.5, -10)  // behind & up
const _chaseLook   = new THREE.Vector3(0, 1.0,  5)   // look slightly ahead
const _camTarget   = new THREE.Vector3()
const _lookTarget  = new THREE.Vector3()

function updateCamera() {
  const p = playerPhysics.body.position
  const q = playerPhysics.body.quaternion
  const tq = new THREE.Quaternion(q.x, q.y, q.z, q.w)

  _camTarget.copy(_chaseOffset).applyQuaternion(tq).add({ x: p.x, y: p.y, z: p.z })
  _lookTarget.copy(_chaseLook).applyQuaternion(tq).add({ x: p.x, y: p.y, z: p.z })

  // Smooth follow — lower lerp = floatier, higher = snappier
  camera.position.lerp(_camTarget, 0.08)
  camera.lookAt(_lookTarget)
}

// ── Minimap ───────────────────────────────────────────────────────────────────
const mapCanvas = document.getElementById('mapCanvas')
const mapCtx = mapCanvas.getContext('2d')
const MAP_SCALE = 0.95
const MAP_CX = 65, MAP_CY = 65

function drawMinimap() {
  mapCtx.clearRect(0, 0, 130, 130)

  // Track outline
  mapCtx.beginPath()
  waypoints.forEach((wp, i) => {
    const mx = MAP_CX + wp.x * MAP_SCALE
    const my = MAP_CY + wp.z * MAP_SCALE
    i === 0 ? mapCtx.moveTo(mx, my) : mapCtx.lineTo(mx, my)
  })
  mapCtx.closePath()
  mapCtx.strokeStyle = 'rgba(255,255,255,0.5)'
  mapCtx.lineWidth = 4
  mapCtx.stroke()

  // Bots
  bots.forEach((bot, i) => {
    const p = bot.physics.body.position
    const colors = ['#ef5350', '#66bb6a', '#ffa726']
    mapCtx.fillStyle = colors[i]
    mapCtx.beginPath()
    mapCtx.arc(MAP_CX + p.x * MAP_SCALE, MAP_CY + p.z * MAP_SCALE, 3.5, 0, Math.PI * 2)
    mapCtx.fill()
  })

  // Player
  const pp = playerPhysics.body.position
  mapCtx.fillStyle = '#42a5f5'
  mapCtx.beginPath()
  mapCtx.arc(MAP_CX + pp.x * MAP_SCALE, MAP_CY + pp.z * MAP_SCALE, 5, 0, Math.PI * 2)
  mapCtx.fill()
}

// ── Countdown & start ─────────────────────────────────────────────────────────
function startCountdown() {
  showAnn('3', 900)
  setTimeout(() => showAnn('2', 900), 1000)
  setTimeout(() => showAnn('1', 900), 2000)
  setTimeout(() => {
    showAnn('GO!', 800)
    raceStarted = true
    raceStartTime = Date.now()
  }, 3000)
}

startCountdown()

// ── Game loop ─────────────────────────────────────────────────────────────────
let prevTime = performance.now()

function animate(now) {
  requestAnimationFrame(animate)

  const dt = Math.min((now - prevTime) / 1000, 0.05)
  prevTime = now

  world.step(1 / 60, dt, 3)

  if (raceStarted && !raceOver) {
    updatePlayer()
    bots.forEach(updateBot)
  }

  syncMesh(playerPhysics, playerVisual)
  bots.forEach(bot => syncMesh(bot.physics, bot.visual))

  updateCamera()
  drawMinimap()

  // HUD
  const vel = playerPhysics.body.velocity
  const kmh = Math.round(Math.sqrt(vel.x ** 2 + vel.z ** 2) * 3.6)
  speedEl.textContent = kmh
  lapEl.textContent = `${Math.min(playerLap + 1, TOTAL_LAPS)} / ${TOTAL_LAPS}`
  posEl.textContent = `P${getPosition()}`
  if (raceStarted && !raceOver) timerEl.textContent = formatTime(Date.now() - raceStartTime)

  renderer.render(scene, camera)
}

animate(performance.now())
