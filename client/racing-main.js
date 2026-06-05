import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as CANNON from 'cannon-es'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
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
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.85
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0xc9e8ff, 120, 400)  // linear fog — less aggressive than exponential

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 500)

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})

// ── Sky ───────────────────────────────────────────────────────────────────────
const sky = new Sky()
sky.scale.setScalar(450)
scene.add(sky)
const skyUni = sky.material.uniforms
skyUni['turbidity'].value      = 2.5
skyUni['rayleigh'].value       = 1.8
skyUni['mieCoefficient'].value = 0.004
skyUni['mieDirectionalG'].value = 0.82
const _sunDir = new THREE.Vector3()
_sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(84), THREE.MathUtils.degToRad(200))
skyUni['sunPosition'].value.copy(_sunDir)

// ── Lighting ──────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xd0e8ff, 1.2))
const sun = new THREE.DirectionalLight(0xfff4e0, 2.8)
sun.position.copy(_sunDir).multiplyScalar(100)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
sun.shadow.camera.near = 1
sun.shadow.camera.far  = 250
sun.shadow.camera.left = -90; sun.shadow.camera.right  = 90
sun.shadow.camera.top  =  90; sun.shadow.camera.bottom = -90
scene.add(sun)

// ── Environment map (IBL reflections on metallic cars) ────────────────────────
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
pmrem.dispose()

// ── Post-processing ───────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
  0.45,   // strength  — subtle glow on headlights + sky horizon
  0.5,    // radius
  0.82    // threshold — only emissive/very bright surfaces bloom
)
composer.addPass(bloomPass)

// ── Physics World ─────────────────────────────────────────────────────────────
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) })
world.broadphase = new CANNON.SAPBroadphase(world)
world.solver.iterations = 8
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

// Center dashed line — single merged BufferGeometry (was 50 separate meshes = 50 draw calls)
function buildCenterDash() {
  const pts = trackCurve.getPoints(300)
  const verts = [], idx = []
  let vi = 0
  for (let i = 0; i < 300; i += 6) {
    const p  = pts[i]
    const pn = pts[(i + 1) % pts.length]
    const tan   = new THREE.Vector3().subVectors(pn, p).normalize()
    const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize()
    const hw = 0.09, hl = 1.1
    verts.push(
      p.x + (-right.x * hw - tan.x * hl), 0.035, p.z + (-right.z * hw - tan.z * hl),
      p.x + ( right.x * hw - tan.x * hl), 0.035, p.z + ( right.z * hw - tan.z * hl),
      p.x + ( right.x * hw + tan.x * hl), 0.035, p.z + ( right.z * hw + tan.z * hl),
      p.x + (-right.x * hw + tan.x * hl), 0.035, p.z + (-right.z * hw + tan.z * hl)
    )
    idx.push(vi, vi+1, vi+2,  vi, vi+2, vi+3)
    vi += 4
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }))
  mesh.receiveShadow = false
  return mesh
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

// Track barriers — InstancedMesh so 240 barriers = 1 draw call
function buildBarriers() {
  const pts   = trackCurve.getPoints(120)
  const geo   = new THREE.BoxGeometry(2.6, 0.9, 0.28)
  const mat   = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.88, metalness: 0.05 })
  const dummy = new THREE.Object3D()
  const inst  = new THREE.InstancedMesh(geo, mat, pts.length * 2)
  inst.castShadow = false; inst.receiveShadow = false
  let k = 0
  const _t = new THREE.Vector3(), _r = new THREE.Vector3()
  pts.forEach((p, i) => {
    const pn = pts[(i + 1) % pts.length]
    _t.subVectors(pn, p).normalize()
    _r.crossVectors(_t, new THREE.Vector3(0, 1, 0)).normalize()
    const angle = Math.atan2(_t.x, _t.z)
    const hw = TRACK_WIDTH / 2 + 0.6
    for (const s of [-1, 1]) {
      dummy.position.set(p.x + _r.x * hw * s, 0.45, p.z + _r.z * hw * s)
      dummy.rotation.y = angle
      dummy.updateMatrix()
      inst.setMatrixAt(k++, dummy.matrix)
    }
  })
  inst.instanceMatrix.needsUpdate = true
  scene.add(inst)
}

// Decorative trees around track
function addTrees() {
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6)
  const leafGeo = new THREE.ConeGeometry(1.2, 2.5, 7)
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 })  // Lambert = no specular, cheaper
  const leafMat  = new THREE.MeshLambertMaterial({ color: 0x2e7d32 })
  const treePositions = []
  for (let a = 0; a < Math.PI * 2; a += 0.5) {                        // fewer trees (0.35→0.5)
    const r = 72 + Math.sin(a * 3) * 5
    treePositions.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  treePositions.forEach(([x, z]) => {
    const t = new THREE.Group()
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)                   // no castShadow on trees
    const leaves = new THREE.Mesh(leafGeo, leafMat)
    leaves.position.y = 2.2
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
buildBarriers()
addTrees()

// ── Car Builder ───────────────────────────────────────────────────────────────
function createCarPhysics(spawnPos, spawnAngle) {
  const chassisBody = new CANNON.Body({ mass: 180 })
  // Low CoM, slightly forward → front-engine ~55/45 weight split
  chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.26, 2.0)), new CANNON.Vec3(0, 0.10, 0.25))
  chassisBody.position.set(spawnPos.x, 1.0, spawnPos.z)
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawnAngle)
  chassisBody.linearDamping  = 0.04   // minimal drag — coasting feels real
  chassisBody.angularDamping = 0.3    // low — lateral grip function handles stability
  world.addBody(chassisBody)

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2
  })

  // Front: stiffer — resists dive under braking, quick turn-in response
  const frontWheel = {
    radius: 0.33,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 55,
    suspensionRestLength: 0.33,
    frictionSlip: 1.9,            // slightly lower → front breaks away first = understeer at limit
    dampingRelaxation: 2.8,
    dampingCompression: 5.2,
    maxSuspensionForce: 260000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    maxSuspensionTravel: 0.22,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true
  }

  // Rear: softer — planted under power, allows controlled slides with handbrake
  const rearWheel = {
    ...frontWheel,
    suspensionStiffness: 42,
    suspensionRestLength: 0.38,
    frictionSlip: 2.3,
    dampingRelaxation: 2.2,
    dampingCompression: 4.4,
    rollInfluence: 0.008,
    maxSuspensionTravel: 0.26,
  }

  ;[
    { pos: new CANNON.Vec3(-0.8,  0,  1.55), opts: frontWheel },
    { pos: new CANNON.Vec3( 0.8,  0,  1.55), opts: frontWheel },
    { pos: new CANNON.Vec3(-0.8,  0, -1.45), opts: rearWheel  },
    { pos: new CANNON.Vec3( 0.8,  0, -1.45), opts: rearWheel  },
  ].forEach(({ pos, opts }) => vehicle.addWheel({ ...opts, chassisConnectionPointLocal: pos }))

  vehicle.addToWorld(world)
  return { body: chassisBody, vehicle }
}

// ── Tire lateral grip ─────────────────────────────────────────────────────────
// cannon-es RaycastVehicle has NO built-in lateral friction — apply a per-frame
// impulse opposing sideways slip. Pre-allocate all Vec3s to avoid GC pressure.
const _gripLocalRight = new CANNON.Vec3(1, 0, 0)
const _gripRight      = new CANNON.Vec3()
const _gripImpulse    = new CANNON.Vec3()

function applyCarGrip(body, vehicle) {
  if (!vehicle.wheelInfos.some(w => w.isInContact)) return

  body.quaternion.vmult(_gripLocalRight, _gripRight)

  const latVel  = body.velocity.dot(_gripRight)
  const slipMag = Math.abs(latVel)

  // Pacejka-style curve: grip peaks at low slip, degrades progressively
  const grip = 0.38 / (1.0 + slipMag * 0.22)
  const mag  = -latVel * body.mass * grip

  _gripImpulse.x = _gripRight.x * mag
  _gripImpulse.y = 0
  _gripImpulse.z = _gripRight.z * mag
  body.applyImpulse(_gripImpulse)   // no relativePoint = at CoM, no spurious torque

  // Self-aligning torque: damp yaw proportional to lateral slip
  body.angularVelocity.y *= Math.max(0.88, 1.0 - slipMag * 0.04)

  // Downforce: write directly to force accumulator — zero allocation
  const spd = body.velocity.length()
  body.force.y -= spd * spd * 0.5
}

// Primitive fallback car (box-based)
function makePrimitiveCar(color) {
  const g = new THREE.Group()

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.76, 0.48, 4.0),
    new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.88, envMapIntensity: 2 })
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
  ;[[-0.96, 0, 1.5], [0.96, 0, 1.5], [-0.96, 0, -1.4], [0.96, 0, -1.4]].forEach(([x, y, z], i) => {
    const steerG = new THREE.Group()  // steers (front only)
    steerG.position.set(x, y, z)
    const spinG = new THREE.Group()  // spins (all)
    spinG.rotation.z = Math.PI / 2
    spinG.add(new THREE.Mesh(wGeo, wMat))
    steerG.add(spinG)
    g.add(steerG)
    wheelMeshes.push(steerG)         // steerG.children[0] = spinG
  })

  scene.add(g)
  return { group: g, wheelMeshes }
}

// Player = race car, bots = sporty cars (no karts — karts have character heads baked in)
const CAR_GLB_NAMES = ['race', 'race-future', 'sedan-sports', 'hatchback-sports']

async function loadCarGLB(index) {
  const model = await loadGLB(`/assets/models/cars/${CAR_GLB_NAMES[index]}.glb`)
  if (!model) return null

  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = 3.8 / Math.max(size.x, size.z)
  model.scale.setScalar(scale)

  const center = new THREE.Vector3()
  box.getCenter(center)
  model.position.x -= center.x * scale
  model.position.z -= center.z * scale
  model.position.y -= box.min.y * scale

  model.traverse(c => {
    if (!c.isMesh) return
    c.castShadow = true
    if (c.material) {
      // Boost metallic car-paint look — picks up scene.environment reflections
      c.material.roughness      = Math.min(c.material.roughness,  0.28)
      c.material.metalness      = Math.max(c.material.metalness,  0.65)
      c.material.envMapIntensity = 1.8
    }
  })

  // Collect wheel nodes, then wrap them in pivot groups for steering/spin animation.
  // Kenney labels back wheels "wheel-back-*" — after our 180° rotation these are the
  // physics front wheels (the ones that actually steer).
  const wheelNodes = []
  model.traverse(c => { if (c.name.toLowerCase().includes('wheel')) wheelNodes.push(c) })

  const steerPivots = [null, null]  // [FL/left index 0, FR/right index 1]
  const spinMeshes  = []

  for (const child of wheelNodes) {
    const name = child.name.toLowerCase()
    const isSteer = name.includes('front')
    const parent = child.parent
    const savedPos = child.position.clone()
    child.position.set(0, 0, 0)
    parent.remove(child)

    const pivot = new THREE.Group()
    pivot.position.copy(savedPos)
    pivot.add(child)
    parent.add(pivot)

    spinMeshes.push(child)
    if (isSteer) {
      // Kenney front-left (x>0 in model) = physics FL = wheel index 0
      steerPivots[name.includes('left') ? 0 : 1] = pivot
    }
  }

  // Apply 180° rotation AFTER extracting wheel refs so positions are in original model space
  model.rotation.y = Math.PI

  return { model, steerPivots, spinMeshes }
}

// ── Spawn positions — computed from actual track geometry ─────────────────────
const startTangent = trackCurve.getTangentAt(0)
const startAngle = Math.atan2(startTangent.x, startTangent.z)

// Right vector perpendicular to track at start
const startRight = new THREE.Vector3()
  .crossVectors(startTangent, new THREE.Vector3(0, 1, 0))
  .normalize()

const startCenter = trackCurve.getPoint(0) // (0, 0, 55)

// 2x2 grid: staggered left/right, 2 rows back along track
function gridPos(col, row) {
  const along = startTangent.clone().multiplyScalar(-row * 8)   // 8 units between rows (was 5)
  const across = startRight.clone().multiplyScalar(col * 4.5)  // 4.5 units between cols (was 3)
  return {
    x: startCenter.x + along.x + across.x,
    z: startCenter.z + along.z + across.z
  }
}

const gridOffsets = [
  gridPos(-1, 0),
  gridPos( 1, 0),
  gridPos(-1, 1),
  gridPos( 1, 1),
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
    const result = await loadCarGLB(i)
    if (!result) continue
    const { model, steerPivots, spinMeshes } = result
    const wrapper = new THREE.Group()
    wrapper.add(model)
    scene.add(wrapper)
    const newVisual = { group: wrapper, wheelMeshes: [], steerPivots, spinMeshes }
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

// Pre-allocated objects reused every frame to avoid GC pressure
const _botFwd    = new THREE.Vector3()
const _botTarget = new THREE.Vector3()
const _botQ      = new THREE.Quaternion()

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

// ── Ackermann steering geometry ───────────────────────────────────────────────
// Returns [FL angle, FR angle] so the inner wheel cuts a tighter arc than the outer
const WHEELBASE = 3.0
const TRACK_W   = 1.6
function ackermannAngles(steer) {
  if (Math.abs(steer) < 0.001) return [0, 0]
  const R     = WHEELBASE / Math.tan(Math.abs(steer))
  const inner = Math.atan(WHEELBASE / (R - TRACK_W * 0.5)) * Math.sign(steer)
  const outer = Math.atan(WHEELBASE / (R + TRACK_W * 0.5)) * Math.sign(steer)
  // turning left (steer<0): FL=inner, FR=outer; turning right: FL=outer, FR=inner
  return steer < 0 ? [inner, outer] : [outer, inner]
}

// ── Car update ────────────────────────────────────────────────────────────────
function updatePlayer() {
  const v = playerPhysics.vehicle
  const speed = playerPhysics.body.velocity.length()   // m/s

  // Speed-sensitive steering: full lock at standstill, narrows linearly with speed
  const steerMax = 0.44 / (1 + speed * 0.045)

  // Engine force: strong off the line, tapers to ~30% at top speed (~55 m/s)
  const forceMax = 2600 * Math.max(0.3, 1 - speed / 55)
  const brakeF   = 55

  let engine = 0, brake = 0, steer = 0, handbrake = false
  if (keys['KeyW'] || keys['ArrowUp'])    engine =  forceMax
  if (keys['KeyS'] || keys['ArrowDown']) { engine = -forceMax * 0.35; brake = brakeF }
  if (keys['KeyA'] || keys['ArrowLeft'])  steer = -steerMax
  if (keys['KeyD'] || keys['ArrowRight']) steer =  steerMax
  if (keys['Space']) handbrake = true

  const [steerFL, steerFR] = ackermannAngles(steer)
  v.setSteeringValue(steerFL, 0)
  v.setSteeringValue(steerFR, 1)

  v.applyEngineForce(engine, 2); v.applyEngineForce(engine, 3)  // rear-wheel drive
  v.setBrake(brake, 0); v.setBrake(brake, 1)
  v.setBrake(brake * 0.6, 2); v.setBrake(brake * 0.6, 3)

  // Handbrake: lock rear wheels (weight transfers forward, tail can slide)
  if (handbrake) {
    v.applyEngineForce(0, 2); v.applyEngineForce(0, 3)
    v.setBrake(180, 2); v.setBrake(180, 3)
  }

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
  _botFwd.set(0, 0, 1).applyQuaternion(_botQ.set(quat.x, quat.y, quat.z, quat.w))
  _botTarget.set(dx, 0, dz).normalize()
  const fwd = _botFwd, toTarget = _botTarget
  const cross = fwd.x * toTarget.z - fwd.z * toTarget.x
  const steer = Math.max(-0.5, Math.min(0.5, -cross * 1.8))

  const v = bot.physics.vehicle
  const botSpeed  = bot.physics.body.velocity.length()
  const botForce  = 2400 * bot.speed * Math.max(0.3, 1 - botSpeed / 55)
  const [bFL, bFR] = ackermannAngles(steer)
  v.setSteeringValue(bFL, 0); v.setSteeringValue(bFR, 1)
  v.applyEngineForce(botForce, 2); v.applyEngineForce(botForce, 3)
  v.setBrake(0, 0); v.setBrake(0, 1); v.setBrake(0, 2); v.setBrake(0, 3)
}

// ── Visual sync ───────────────────────────────────────────────────────────────
function syncMesh(physics, visual) {
  const p = physics.body.position
  const q = physics.body.quaternion
  visual.group.position.set(p.x, p.y - 0.32, p.z)
  visual.group.quaternion.set(q.x, q.y, q.z, q.w)

  const speed = physics.body.velocity.length()
  const steer = physics.vehicle.wheelInfos[0]?.steering ?? 0

  // GLB car: steer pivots indexed [0=FL, 1=FR] — each reads its own physics angle
  if (visual.steerPivots) {
    visual.steerPivots.forEach((pivot, i) => {
      if (pivot) pivot.rotation.y = -(physics.vehicle.wheelInfos[i]?.steering ?? 0)
    })
  }
  if (visual.spinMeshes) {
    visual.spinMeshes.forEach(mesh => { mesh.rotation.x -= speed * 0.04 })
  }

  // Primitive fallback: steerG (index < 2 = front) + spinG inside
  if (visual.wheelMeshes && visual.wheelMeshes.length) {
    visual.wheelMeshes.forEach((steerG, i) => {
      if (i < 2) steerG.rotation.y = -steer
      steerG.children[0].rotation.x += speed * 0.04
    })
  }
}

// ── Chase camera (behind + above car so you can see it) ──────────────────────
const _chaseOffset = new THREE.Vector3(0, 4.5,  10)  // behind & up (model is rotated 180°)
const _chaseLook   = new THREE.Vector3(0, 1.0, -5)   // look slightly ahead
const _camTarget   = new THREE.Vector3()
const _lookTarget  = new THREE.Vector3()

const vignetteEl = document.getElementById('vignette')

function updateCamera() {
  const p = playerPhysics.body.position
  const q = playerPhysics.body.quaternion
  const tq = new THREE.Quaternion(q.x, q.y, q.z, q.w)

  _camTarget.copy(_chaseOffset).applyQuaternion(tq).add({ x: p.x, y: p.y, z: p.z })
  _lookTarget.copy(_chaseLook).applyQuaternion(tq).add({ x: p.x, y: p.y, z: p.z })

  camera.position.lerp(_camTarget, 0.08)
  camera.lookAt(_lookTarget)

  // Speed-based FOV: widens at high speed for a rush sensation
  const spd = playerPhysics.body.velocity.length()
  camera.fov = THREE.MathUtils.lerp(camera.fov, 72 + spd * 0.28, 0.07)
  camera.updateProjectionMatrix()

  // Vignette darkens at speed
  vignetteEl.style.opacity = (0.25 + Math.min(spd / 45, 0.45)).toFixed(2)
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

  // Apply tire lateral grip before physics step so forces integrate correctly
  applyCarGrip(playerPhysics.body, playerPhysics.vehicle)
  bots.forEach(b => applyCarGrip(b.physics.body, b.physics.vehicle))

  world.step(1 / 60, dt, 2)   // 2 substeps instead of 3 — faster, still stable

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

  composer.render()
}

animate(performance.now())
