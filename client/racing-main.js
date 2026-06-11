import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as CANNON from 'cannon-es'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import * as UI from './ui.js'
const gltfLoader = new GLTFLoader()

// Load a GLB, resolve with scene or null on failure
function loadGLB(path) {
  return new Promise(resolve => {
    gltfLoader.load(path, gltf => resolve(gltf.scene), undefined, () => resolve(null))
  })
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TOTAL_LAPS = 3
const TRACK_WIDTH = 14
const NUM_WAYPOINTS = 100
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
scene.fog = new THREE.Fog(0xc9e8ff, 160, 540)  // linear fog — less aggressive than exponential

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 650)

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
sun.shadow.camera.left = -140; sun.shadow.camera.right  = 140
sun.shadow.camera.top  =  140; sun.shadow.camera.bottom = -140
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
// Racing circuit — main straight + sweeping T1 + long right side + hairpin + back left + sweeper
const trackControlPts = [
  new THREE.Vector3(   0, 0,  95),  // S/F line (start of main straight)
  new THREE.Vector3(  62, 0,  88),  // Turn 1 entry
  new THREE.Vector3( 108, 0,  52),  // Turn 1 apex (right)
  new THREE.Vector3( 114, 0,   6),  // T1 exit — long right straight begins
  new THREE.Vector3(  96, 0, -64),  // hairpin entry
  new THREE.Vector3(  38, 0, -98),  // hairpin left
  new THREE.Vector3(  -2, 0, -108), // hairpin apex
  new THREE.Vector3( -40, 0, -98),  // hairpin right
  new THREE.Vector3( -96, 0, -64),  // hairpin exit — back section
  new THREE.Vector3(-114, 0,   6),  // back left straight
  new THREE.Vector3(-108, 0,  52),  // left sweeper apex
  new THREE.Vector3( -62, 0,  88),  // sweeper exit, approaching S/F
]

const trackCurve = new THREE.CatmullRomCurve3(trackControlPts, true, 'catmullrom', 0.5)
const waypoints = trackCurve.getPoints(NUM_WAYPOINTS)
UI.initMinimapWaypoints(waypoints)

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

  // Canvas asphalt texture — random noise gives subtle grain
  const atCanvas = document.createElement('canvas')
  atCanvas.width = atCanvas.height = 256
  const atCtx = atCanvas.getContext('2d')
  atCtx.fillStyle = '#2a2a2a'
  atCtx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 4000; i++) {
    const g = 30 + Math.floor(Math.random() * 28)
    atCtx.fillStyle = `rgb(${g},${g},${g})`
    atCtx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1)
  }
  const atTex = new THREE.CanvasTexture(atCanvas)
  atTex.wrapS = atTex.wrapT = THREE.RepeatWrapping
  atTex.repeat.set(3, 30)

  const mat = new THREE.MeshStandardMaterial({ map: atTex, roughness: 0.93, metalness: 0 })
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
  const startPt = trackCurve.getPoint(0)
  const startTan = trackCurve.getTangentAt(0)
  const geo = new THREE.PlaneGeometry(TRACK_WIDTH + 4, 2.2)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.rotation.z = -Math.atan2(startTan.x, startTan.z)
  mesh.position.set(startPt.x, 0.04, startPt.z)
  return mesh
}

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(900, 900),
  new THREE.MeshStandardMaterial({ color: 0x3d8b3d, roughness: 1 })
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// Track barriers — InstancedMesh so barriers = 1 draw call
function buildBarriers() {
  const pts   = trackCurve.getPoints(180)
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
  const leafGeo  = new THREE.ConeGeometry(1.2, 2.5, 7)
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4037 })
  const leafMat  = new THREE.MeshLambertMaterial({ color: 0x2e7d32 })
  const treePositions = []
  // Outer perimeter — ring well outside the new 230m-wide circuit
  for (let a = 0; a < Math.PI * 2; a += 0.42) {
    const rx = 148 + Math.sin(a * 2) * 16
    const rz = 136 + Math.sin(a * 3) * 10
    treePositions.push([Math.cos(a) * rx, Math.sin(a) * rz])
  }
  // Infield cluster — inside the hairpin (roughly centered at 0, -20)
  for (let a = 0; a < Math.PI * 2; a += 0.7) {
    const r = 38 + Math.sin(a * 4) * 8
    treePositions.push([Math.cos(a) * r, -20 + Math.sin(a) * r * 0.8])
  }
  treePositions.forEach(([x, z]) => {
    const t = new THREE.Group()
    const trunk  = new THREE.Mesh(trunkGeo, trunkMat)
    const leaves = new THREE.Mesh(leafGeo, leafMat)
    leaves.position.y = 2.2
    t.add(trunk, leaves)
    t.position.set(x, 0.75, z)
    t.rotation.y = Math.random() * Math.PI
    scene.add(t)
  })
}

// Grandstands along the start/finish straight (outside = +Z from track)
function buildGrandstands() {
  const seatColors = [0x1a237e, 0xb71c1c, 0x1a237e, 0x006064, 0xb71c1c, 0x1a237e, 0x006064, 0xb71c1c]
  const concreteM = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.95 })
  const darkM     = new THREE.MeshStandardMaterial({ color: 0x424242, roughness: 0.8, metalness: 0.3 })

  // 8 tiered rows — each tier steps back and up
  for (let r = 0; r < 8; r++) {
    const tierZ = 109 + r * 2.8
    const tierY = r * 1.85

    // Concrete step
    const step = new THREE.Mesh(new THREE.BoxGeometry(88, 0.5, 2.8), concreteM)
    step.position.set(0, tierY + 0.25, tierZ)
    step.receiveShadow = true
    scene.add(step)

    // Colored seats
    const seatM = new THREE.MeshStandardMaterial({ color: seatColors[r], roughness: 0.55 })
    const seat  = new THREE.Mesh(new THREE.BoxGeometry(88, 0.9, 1.6), seatM)
    seat.position.set(0, tierY + 1.05, tierZ)
    scene.add(seat)
  }

  // Back concrete wall
  const wall = new THREE.Mesh(new THREE.BoxGeometry(90, 16, 2.5), concreteM)
  wall.position.set(0, 8, 134)
  wall.castShadow = true
  scene.add(wall)

  // Roof canopy
  const roof = new THREE.Mesh(new THREE.BoxGeometry(90, 0.9, 22), darkM)
  roof.position.set(0, 16.2, 123)
  roof.castShadow = true
  scene.add(roof)

  // Support columns
  const colM = new THREE.MeshStandardMaterial({ color: 0x757575, roughness: 0.85 })
  for (let x = -40; x <= 40; x += 20) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), colM)
    col.position.set(x, 8, 134)
    col.castShadow = true
    scene.add(col)
  }
}

// Pit-lane building on the inside of the start straight (−Z side)
function buildPitBuilding() {
  const whiteM  = new THREE.MeshStandardMaterial({ color: 0xeceff1, roughness: 0.8 })
  const darkM   = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.7 })
  const accentM = new THREE.MeshStandardMaterial({ color: 0x1565c0, roughness: 0.6 })

  // Main building block
  const body = new THREE.Mesh(new THREE.BoxGeometry(100, 7, 10), whiteM)
  body.position.set(0, 3.5, 80)
  body.castShadow = true
  scene.add(body)

  // Blue accent stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(100, 1.2, 0.2), accentM)
  stripe.position.set(0, 5.5, 74.9)
  scene.add(stripe)

  // Garage doors (9 bays)
  for (let i = -4; i <= 4; i++) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(8, 4.5, 0.2), darkM)
    door.position.set(i * 10, 2.5, 74.9)
    scene.add(door)
  }

  // Pit lane tarmac (slightly different color from track)
  const pit = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 5),
    new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.88 })
  )
  pit.rotation.x = -Math.PI / 2
  pit.position.set(0, 0.015, 83)
  scene.add(pit)

  // Overhead pit-lane speed limit sign gantry
  for (const x of [-35, 35]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), darkM)
    post.position.set(x, 2.5, 82)
    scene.add(post)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(72, 0.5, 0.5), darkM)
  beam.position.set(0, 5.2, 82)
  scene.add(beam)
}

scene.add(buildTrackMesh())
scene.add(buildEdgeStripes('left'))
scene.add(buildEdgeStripes('right'))
scene.add(buildCenterDash())
scene.add(buildStartLine())
buildBarriers()
addTrees()
buildGrandstands()
buildPitBuilding()

// ── Car Builder ───────────────────────────────────────────────────────────────
function createCarPhysics(spawnPos, spawnAngle) {
  const chassisBody = new CANNON.Body({ mass: 90 })
  chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.26, 2.0)), new CANNON.Vec3(0, 0.10, 0.25))
  chassisBody.position.set(spawnPos.x, 1.0, spawnPos.z)
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawnAngle)
  chassisBody.linearDamping  = 0.02   // momentum is king — coasting holds speed
  chassisBody.angularDamping = 0.7    // snappy yaw response
  world.addBody(chassisBody)

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2
  })

  // Front: very stiff — ground-hugging, no bounce, instant turn-in
  // frictionSlip is LOW because our velocity-bending handles lateral grip —
  // keeping it high causes double-grip and kills speed through corners
  const frontWheel = {
    radius: 0.33,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 90,
    suspensionRestLength: 0.26,
    frictionSlip: 0.8,
    dampingRelaxation: 4.0,
    dampingCompression: 7.0,
    maxSuspensionForce: 260000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    maxSuspensionTravel: 0.14,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true
  }

  // Rear: slightly softer — planted under power, drift-friendly
  const rearWheel = {
    ...frontWheel,
    suspensionStiffness: 72,
    suspensionRestLength: 0.28,
    frictionSlip: 1.0,
    dampingRelaxation: 3.2,
    dampingCompression: 5.8,
    rollInfluence: 0.006,
    maxSuspensionTravel: 0.16,
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

// ── Velocity-bending grip (PolyTrack-style) ───────────────────────────────────
// Decompose velocity into forward/lateral each frame. In GRIP mode kill ~82% of
// lateral velocity → car goes exactly where it's pointed. In DRIFT mode kill only
// ~22% → clean predictable slide arc. On clean drift exit, reward with a forward
// speed boost (the "extra speed out of a drift" feel).
const _driftState = new Map()  // body.id → { drifting, driftTimer }

function getDriftState(body) {
  if (!_driftState.has(body.id)) _driftState.set(body.id, { drifting: false, driftTimer: 0, noContactTimer: 0, peakSlip: 0 })
  return _driftState.get(body.id)
}

const _vbFwdLocal   = new CANNON.Vec3(0, 0, 1)
const _vbRightLocal = new CANNON.Vec3(1, 0, 0)
const _vbFwd        = new CANNON.Vec3()
const _vbRight      = new CANNON.Vec3()
const _vbImp        = new CANNON.Vec3()

function applyCarGrip(body, vehicle, forceHandbrake = false) {
  const inContact = vehicle.wheelInfos.some(w => w.isInContact)

  body.quaternion.vmult(_vbFwdLocal, _vbFwd)
  body.quaternion.vmult(_vbRightLocal, _vbRight)

  const vel      = body.velocity
  const latSpeed = vel.x * _vbRight.x + vel.y * _vbRight.y + vel.z * _vbRight.z
  const slipMag  = Math.abs(latSpeed)
  const horizSpd = Math.sqrt(vel.x * vel.x + vel.z * vel.z)

  const ds = getDriftState(body)

  // Track airborne time — auto-clear drift if wheels lose contact too long (flip/launch recovery)
  if (!inContact) {
    ds.noContactTimer += 1 / 60
    if (ds.noContactTimer > 0.5) ds.drifting = false
  } else {
    ds.noContactTimer = 0
  }

  // Enter drift: both paths require minimum speed (fixes handbrake-at-standstill)
  if (!ds.drifting && horizSpd > 6 && (forceHandbrake || slipMag > 5.0)) {
    ds.drifting = true
    ds.driftTimer = 0
    ds.peakSlip = slipMag
    ds.fromHandbrake = forceHandbrake
  }

  if (ds.drifting) {
    ds.driftTimer += 1 / 60
    ds.peakSlip = Math.max(ds.peakSlip, slipMag)
  }

  // Exit drift:
  //   handbrake-initiated → exit immediately on release (snap back to grip)
  //   natural oversteer   → exit when slip settles below threshold
  // Both paths checked even when airborne so a flip can't permanently lock 8% grip.
  const driftShouldExit = ds.drifting && (
    ds.fromHandbrake ? !forceHandbrake : (!forceHandbrake && slipMag < 2.2)
  )
  if (driftShouldExit) {
    ds.drifting = false
    if (inContact) {
      const boostMs = Math.min(ds.peakSlip * 0.16, 2.5)   // up to +2.5 m/s (~9 km/h)
      body.velocity.x += _vbFwd.x * boostMs
      body.velocity.z += _vbFwd.z * boostMs
    }
  }

  if (!inContact) return   // no grip forces when airborne

  // Grip strength: near-full in grip (goes where pointed), gentle in drift (preserves speed)
  const gripStrength = ds.drifting ? 0.08 : 0.82
  const corrMag = -latSpeed * body.mass * gripStrength
  _vbImp.x = _vbRight.x * corrMag
  _vbImp.y = 0
  _vbImp.z = _vbRight.z * corrMag
  body.applyImpulse(_vbImp)

  // Yaw damping — snappy in grip, looser in drift for natural rotation
  body.angularVelocity.y *= ds.drifting ? 0.96 : Math.max(0.82, 1.0 - slipMag * 0.04)

  // Downforce: horizontal speed only, capped at 0.9× car weight so suspension
  // never bottoms out at high speed (prevents the bounce-tumble crash)
  const maxDownforce = body.mass * 20 * 0.9
  body.force.y -= Math.min(horizSpd * horizSpd * 0.5, maxDownforce)
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

// ── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx = null, engineOsc = null, engineGain = null
let screechSrc = null, screechGain = null

function _distortionCurve(amount) {
  const n = 256, c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    c[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x))
  }
  return c
}

function initAudio() {
  if (audioCtx) return
  audioCtx = new (window.AudioContext || window.webkitAudioContext)()

  // Engine: sawtooth → soft clip distortion → bandpass → gain
  engineOsc = audioCtx.createOscillator()
  engineOsc.type = 'sawtooth'
  engineOsc.frequency.value = 80

  const dist = audioCtx.createWaveShaper()
  dist.curve = _distortionCurve(60)
  dist.oversample = '2x'

  const eqFilt = audioCtx.createBiquadFilter()
  eqFilt.type = 'bandpass'
  eqFilt.frequency.value = 600
  eqFilt.Q.value = 0.7

  engineGain = audioCtx.createGain()
  engineGain.gain.value = 0

  engineOsc.connect(dist); dist.connect(eqFilt); eqFilt.connect(engineGain)
  engineGain.connect(audioCtx.destination)
  engineOsc.start()

  // Tire screech: looped white noise → bandpass → gain
  const bufLen = audioCtx.sampleRate * 2
  const noiseBuf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate)
  const nd = noiseBuf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) nd[i] = Math.random() * 2 - 1

  screechSrc = audioCtx.createBufferSource()
  screechSrc.buffer = noiseBuf; screechSrc.loop = true

  const sf = audioCtx.createBiquadFilter()
  sf.type = 'bandpass'; sf.frequency.value = 950; sf.Q.value = 6

  screechGain = audioCtx.createGain(); screechGain.gain.value = 0
  screechSrc.connect(sf); sf.connect(screechGain); screechGain.connect(audioCtx.destination)
  screechSrc.start()
}

function updateAudio(speed, latSlip, braking) {
  if (!audioCtx) return
  const t = audioCtx.currentTime

  // Gear shift: detect gear change, apply pitch blip then decay
  let g = 0
  for (let i = GEAR_SPDS.length - 1; i >= 0; i--) { if (speed >= GEAR_SPDS[i]) { g = i; break } }
  if (_prevGear >= 0 && g !== _prevGear) _gearPitch = g > _prevGear ? -28 : 22
  _prevGear = g
  _gearPitch *= 0.87

  engineOsc.frequency.setTargetAtTime(80 + speed * 1.9 + _gearPitch, t, 0.06)
  engineGain.gain.setTargetAtTime(raceStarted ? 0.07 : 0, t, 0.12)
  const screechVol = Math.min(0.28, Math.max(0, latSlip - 3.0) * 0.05 + (braking && speed > 6 ? 0.1 : 0))
  screechGain.gain.setTargetAtTime(screechVol, t, 0.04)
}

// ── Smoke Particles ────────────────────────────────────────────────────────────
const _smokeMat = new THREE.SpriteMaterial({ color: 0xcccccc, transparent: true, depthWrite: false })
const _smokePool = Array.from({ length: 24 }, () => {
  const sp = new THREE.Sprite(_smokeMat.clone())
  sp.visible = false
  scene.add(sp)
  return { sp, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 }
})

function emitSmoke(wx, wy, wz) {
  const p = _smokePool.find(p => p.life <= 0)
  if (!p) return
  p.sp.position.set(wx + (Math.random() - .5) * .5, wy + .12, wz + (Math.random() - .5) * .5)
  p.vx = (Math.random() - .5) * .7; p.vy = .35 + Math.random() * .25; p.vz = (Math.random() - .5) * .7
  p.maxLife = .5 + Math.random() * .3; p.life = p.maxLife
  p.sp.visible = true
}

function updateSmoke(dt) {
  _smokePool.forEach(p => {
    if (p.life <= 0) return
    p.life -= dt
    if (p.life <= 0) { p.sp.visible = false; return }
    p.sp.position.x += p.vx * dt; p.sp.position.y += p.vy * dt; p.sp.position.z += p.vz * dt
    const t = p.life / p.maxLife
    p.sp.scale.setScalar(.2 + (1 - t) * 1.4)
    p.sp.material.opacity = t * .38
  })
}

// ── Skid Marks ─────────────────────────────────────────────────────────────────
// Ring-buffer InstancedMesh — bakes the flat-on-ground rotation into the geometry
// so each instance only needs position + Y-heading → 1 draw call for all marks
const SKID_MAX = 500
const _skidGeo = new THREE.PlaneGeometry(0.25, 0.48)
_skidGeo.rotateX(-Math.PI / 2)
const _skidInst = new THREE.InstancedMesh(
  _skidGeo,
  new THREE.MeshBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.55, depthWrite: false }),
  SKID_MAX
)
_skidInst.frustumCulled = false
scene.add(_skidInst)
let _skidCursor = 0
const _skidDummy = new THREE.Object3D()
let _skidTimer = 0

function stampSkid(x, z, angle) {
  _skidDummy.position.set(x, 0.022, z)
  _skidDummy.rotation.set(0, angle, 0)
  _skidDummy.updateMatrix()
  _skidInst.setMatrixAt(_skidCursor % SKID_MAX, _skidDummy.matrix)
  _skidInst.instanceMatrix.needsUpdate = true
  _skidCursor++
}

// ── Collision sparks (AdditiveBlending → bright embers that glow on overlap) ──
const _spkMat = new THREE.SpriteMaterial({
  color: 0xffee44, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
})
const _spkPool = Array.from({ length: 20 }, () => {
  const sp = new THREE.Sprite(_spkMat.clone()); sp.visible = false; scene.add(sp)
  return { sp, life: 0, maxLife: 0, vx: 0, vy: 0, vz: 0 }
})
const _spkLight = new THREE.PointLight(0xffcc44, 0, 12)
scene.add(_spkLight)
let _spkLightLife = 0

// Camera shake — exponential decay each frame, no dt needed
let _shakeMag = 0
function triggerShake(strength) { _shakeMag = Math.min(0.55, strength * 0.04) }

// Gear shift pitch — jumps on gear change, decays each updateAudio call
const GEAR_SPDS = [0, 8, 18, 30, 44, 58]
let _prevGear = -1, _gearPitch = 0

function emitSparks(x, y, z, nx, nz, count = 6) {
  for (let i = 0; i < count; i++) {
    const p = _spkPool.find(p => p.life <= 0); if (!p) return
    p.vx = nx * 2.5 + (Math.random() - .5) * 4
    p.vy = 1.2 + Math.random() * 3.5
    p.vz = nz * 2.5 + (Math.random() - .5) * 4
    p.maxLife = .18 + Math.random() * .16; p.life = p.maxLife
    p.sp.position.set(x, y, z)
    p.sp.scale.setScalar(.07 + Math.random() * .07)
    p.sp.visible = true
  }
  _spkLight.position.set(x, y + .5, z); _spkLight.intensity = 8; _spkLightLife = .15
}

function updateSparks(dt) {
  _spkPool.forEach(p => {
    if (p.life <= 0) return
    p.life -= dt; if (p.life <= 0) { p.sp.visible = false; return }
    p.vy -= 9.8 * dt
    p.sp.position.x += p.vx * dt
    p.sp.position.y += p.vy * dt
    p.sp.position.z += p.vz * dt
    p.sp.material.opacity = (p.life / p.maxLife) * 0.95
  })
  if (_spkLightLife > 0) {
    _spkLightLife -= dt
    _spkLight.intensity = Math.max(0, _spkLightLife / .15 * 8)
  }
}

// Register collision listener — fires sparks + shake on hard impacts
playerPhysics.body.addEventListener('collide', e => {
  const ov  = e.body.velocity
  const ni  = e.contact.ni
  const impact = Math.abs(
    (playerPhysics.body.velocity.x - ov.x) * ni.x +
    (playerPhysics.body.velocity.y - ov.y) * ni.y +
    (playerPhysics.body.velocity.z - ov.z) * ni.z
  )
  if (impact < 3.5) return
  const bpos = playerPhysics.body.position
  emitSparks(bpos.x, bpos.y + .3, bpos.z, ni.x, ni.z, Math.min(10, Math.floor(impact)))
  triggerShake(impact)
})

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {}
window.addEventListener('keydown', e => { keys[e.code] = true; initAudio() })
window.addEventListener('keyup',   e => { keys[e.code] = false })

// ── Car recovery — R-key reset + auto-recover after 2s upside down ────────────
let _upsideDownTimer = 0

function resetCarToTrack() {
  const p = playerPhysics.body.position
  const wpIdx = nearestWaypoint(p.x, p.z)
  const wp  = waypoints[wpIdx]
  const wpN = waypoints[(wpIdx + 1) % NUM_WAYPOINTS]
  const angle = Math.atan2(wpN.x - wp.x, wpN.z - wp.z)

  playerPhysics.body.velocity.set(0, 0, 0)
  playerPhysics.body.angularVelocity.set(0, 0, 0)
  playerPhysics.body.position.set(wp.x, 1.0, wp.z)
  playerPhysics.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle)

  // Clear drift state so grip returns immediately after reset
  const ds = getDriftState(playerPhysics.body)
  ds.drifting = false; ds.driftTimer = 0; ds.noContactTimer = 0; ds.peakSlip = 0
  _upsideDownTimer = 0
}

window.addEventListener('keydown', e => {
  if (e.code === 'KeyR') resetCarToTrack()
})

// ── Race state ────────────────────────────────────────────────────────────────
let raceStarted = false
let raceOver    = false
let playerLap   = 0
let playerWpIdx = 0
let playerPrevWpIdx = 0
let raceStartTime = 0
let lapStartTime  = 0
let lastLapTime   = 0
let bestLapTime   = Infinity
let nitroCurrent  = 1.0   // 0–1 fuel level

// ── DOM refs (only results overlay + CSS effects remain in HTML) ──────────────
const resultsEl     = document.getElementById('race-results')
const resultsPosEl  = document.getElementById('results-pos')
const resultsTimeEl = document.getElementById('results-time')
const resultsPbEl   = document.getElementById('results-pb')
const nitroGlowEl   = document.getElementById('nitro-glow')

// ── Personal best (localStorage) ─────────────────────────────────────────────
const PB_KEY = 'cRacerPB'
let _personalBest = parseInt(localStorage.getItem(PB_KEY) || '0', 10) || Infinity

function _checkSavePB(ms) {
  if (ms < _personalBest) { _personalBest = ms; localStorage.setItem(PB_KEY, ms); return true }
  return false
}

function showResults(pos, timeMs) {
  const isNewPB = _checkSavePB(timeMs)
  resultsPosEl.textContent = `P${pos}`
  resultsTimeEl.textContent = formatTime(timeMs)
  if (isNewPB) {
    resultsPbEl.textContent  = '🏆 NEW PERSONAL BEST!'
    resultsPbEl.style.color  = '#f9c74f'
  } else if (_personalBest < Infinity) {
    resultsPbEl.textContent = `PB: ${formatTime(_personalBest)}`
    resultsPbEl.style.color = '#888'
  }
  resultsEl.classList.add('visible')
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
const _smokeQ    = new THREE.Quaternion()
const _smokeVL   = new THREE.Vector3()
const _smokeVR   = new THREE.Vector3()

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
function updatePlayer(dt) {
  const v = playerPhysics.vehicle
  const speed = playerPhysics.body.velocity.length()   // m/s

  // Lateral slip — component of velocity perpendicular to car heading
  const bq = playerPhysics.body.quaternion
  _smokeQ.set(bq.x, bq.y, bq.z, bq.w)
  _smokeVL.set(1, 0, 0).applyQuaternion(_smokeQ)
  const bv = playerPhysics.body.velocity
  const latSlip = Math.abs(bv.x * _smokeVL.x + bv.y * _smokeVL.y + bv.z * _smokeVL.z)

  // Nitro boost (Shift) — drains 1/3s, recharges 1/9s
  const nitroActive = (keys['ShiftLeft'] || keys['ShiftRight']) && nitroCurrent > 0.05
  if (nitroActive) {
    nitroCurrent = Math.max(0, nitroCurrent - dt / 3.0)
  } else {
    nitroCurrent = Math.min(1, nitroCurrent + dt / 9.0)
  }

  // Speed-sensitive steering
  const steerMax = 0.48 / (1 + speed * 0.030)

  // Engine: truly zero at 57 m/s so top speed is governed
  // Quadratic aero drag keeps the car from drifting past top speed after bumps
  const bv2 = playerPhysics.body.velocity
  const hs2 = Math.sqrt(bv2.x * bv2.x + bv2.z * bv2.z)
  if (hs2 > 0.5) {
    const drag = hs2 * hs2 * 0.14
    playerPhysics.body.force.x -= (bv2.x / hs2) * drag
    playerPhysics.body.force.z -= (bv2.z / hs2) * drag
  }

  let forceMax = 3300 * Math.max(0, 1 - speed / 57)
  if (nitroActive) forceMax *= 1.55
  const brakeF = 95

  let engine = 0, brake = 0, steer = 0, handbrake = false
  if (keys['KeyW'] || keys['ArrowUp'])    engine =  forceMax
  if (keys['KeyS'] || keys['ArrowDown']) { brake = brakeF; if (speed < 1.0) engine = -forceMax * 0.35 }
  if (keys['KeyA'] || keys['ArrowLeft'])  steer = -steerMax
  if (keys['KeyD'] || keys['ArrowRight']) steer =  steerMax
  if (keys['Space']) handbrake = true

  const [steerFL, steerFR] = ackermannAngles(steer)
  v.setSteeringValue(steerFL, 0)
  v.setSteeringValue(steerFR, 1)

  v.applyEngineForce(engine, 2); v.applyEngineForce(engine, 3)  // rear-wheel drive
  v.setBrake(brake, 0); v.setBrake(brake, 1)
  v.setBrake(brake * 0.6, 2); v.setBrake(brake * 0.6, 3)

  // Handbrake: near-zero brake force — the rear frictionSlip (1.0) handles
  // the slide physics. Big brake values on a 90kg car are way too strong.
  if (handbrake) {
    v.applyEngineForce(0, 2); v.applyEngineForce(0, 3)
    v.setBrake(8, 2); v.setBrake(8, 3)
  }

  // Auto-recover: if upside down (up vector Y < 0) for 2 continuous seconds, reset
  const _upVec = new CANNON.Vec3()
  playerPhysics.body.quaternion.vmult(new CANNON.Vec3(0, 1, 0), _upVec)
  if (_upVec.y < 0.1) {
    _upsideDownTimer += dt
    if (_upsideDownTimer > 2.0) resetCarToTrack()
  } else {
    _upsideDownTimer = 0
  }

  const p = playerPhysics.body.position
  const cur = nearestWaypoint(p.x, p.z)
  if (detectLap(playerPrevWpIdx, cur)) {
    playerLap++
    // Record split time
    const now = Date.now()
    if (lapStartTime > 0) {
      lastLapTime = now - lapStartTime
      UI.setLastLap(formatTime(lastLapTime))
      if (lastLapTime < bestLapTime) {
        bestLapTime = lastLapTime
        UI.setBestLap(formatTime(bestLapTime))
        if (playerLap > 1) UI.showAnn('BEST LAP!', 1300)
      }
    }
    lapStartTime = now
    if (playerLap > TOTAL_LAPS && !raceOver) {
      raceOver = true
      showResults(getPosition(), Date.now() - raceStartTime)
    }
  }
  playerPrevWpIdx = cur
  playerWpIdx = cur

  // Rear-wheel world offset (shared _smokeQ already set above)
  _smokeVL.set(-0.8, 0, -1.45).applyQuaternion(_smokeQ)
  _smokeVR.set( 0.8, 0, -1.45).applyQuaternion(_smokeQ)
  const bx = p.x, by = p.y, bz = p.z

  // Smoke on braking/handbrake
  if ((handbrake || brake > 0) && speed > 4) {
    emitSmoke(bx + _smokeVL.x, by + _smokeVL.y, bz + _smokeVL.z)
    emitSmoke(bx + _smokeVR.x, by + _smokeVR.y, bz + _smokeVR.z)
  }

  // Skid marks when sliding or braking hard
  _skidTimer -= dt
  if (_skidTimer <= 0 && speed > 5 && (brake > 0 || handbrake || latSlip > 3.0)) {
    const heading = Math.atan2(2 * (bq.w * bq.y + bq.x * bq.z), 1 - 2 * (bq.y * bq.y + bq.z * bq.z))
    stampSkid(bx + _smokeVL.x, bz + _smokeVL.z, heading)
    stampSkid(bx + _smokeVR.x, bz + _smokeVR.z, heading)
    _skidTimer = 0.055
  }

  // Expose state for animate loop (audio + nitro bar + grip system)
  updatePlayer._speed       = speed
  updatePlayer._braking     = brake > 0 || handbrake
  updatePlayer._latSlip     = latSlip
  updatePlayer._nitroActive = nitroActive
  updatePlayer._handbrake   = handbrake
}

function updateBot(bot) {
  const wp = waypoints[bot.wpIdx]   // nearest — used for lap detection
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

  // Aim 4 waypoints ahead for smoother, more realistic racing lines
  const lookIdx = (bot.wpIdx + 4) % NUM_WAYPOINTS
  const lookWp  = waypoints[lookIdx]
  const ldx = lookWp.x - pos.x, ldz = lookWp.z - pos.z

  const quat = bot.physics.body.quaternion
  _botFwd.set(0, 0, 1).applyQuaternion(_botQ.set(quat.x, quat.y, quat.z, quat.w))
  _botTarget.set(ldx, 0, ldz).normalize()
  const fwd = _botFwd, toTarget = _botTarget
  const cross = fwd.x * toTarget.z - fwd.z * toTarget.x
  const steer = Math.max(-0.5, Math.min(0.5, -cross * 1.8))

  const v = bot.physics.vehicle
  const botSpeed  = bot.physics.body.velocity.length()
  const botForce  = 3900 * bot.speed * Math.max(0.3, 1 - botSpeed / 58)
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

  // Body lean: roll visually into turns — exaggerated in drift for feel
  const ds = getDriftState(physics.body)
  const leanTarget = (ds?.drifting ? steer * 0.22 : steer * 0.07)
  visual.group._leanZ = THREE.MathUtils.lerp(visual.group._leanZ ?? 0, leanTarget, 0.14)
  const leanQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), visual.group._leanZ)
  visual.group.quaternion.multiply(leanQuat)

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
  const p   = playerPhysics.body.position
  const q   = playerPhysics.body.quaternion
  const vel = playerPhysics.body.velocity
  const tq  = new THREE.Quaternion(q.x, q.y, q.z, q.w)

  const horizSpd = Math.sqrt(vel.x * vel.x + vel.z * vel.z)
  const velNormX = horizSpd > 0.5 ? vel.x / horizSpd : 0
  const velNormZ = horizSpd > 0.5 ? vel.z / horizSpd : 0

  // Velocity lookahead: at speed, camera drifts ahead along actual travel direction
  // so you always see where you're going, not just where the car is pointing
  const lookahead = Math.min(horizSpd / 18, 1) * 0.4
  _camTarget.copy(_chaseOffset).applyQuaternion(tq).add({ x: p.x, y: p.y, z: p.z })
  _camTarget.x += velNormX * lookahead * 7
  _camTarget.z += velNormZ * lookahead * 7

  _lookTarget.copy(_chaseLook).applyQuaternion(tq).add({ x: p.x, y: p.y, z: p.z })
  _lookTarget.x += velNormX * Math.min(horizSpd / 12, 1) * 5
  _lookTarget.z += velNormZ * Math.min(horizSpd / 12, 1) * 5

  // Tighter follow at high speed — camera catches up faster
  const followLerp = THREE.MathUtils.lerp(0.08, 0.15, Math.min(horizSpd / 28, 1))
  camera.position.lerp(_camTarget, followLerp)
  camera.lookAt(_lookTarget)

  // Camera shake
  if (_shakeMag > 0.002) {
    camera.position.x += (Math.random() - .5) * _shakeMag
    camera.position.y += (Math.random() - .5) * _shakeMag * .4
    _shakeMag *= 0.80
  }

  // FOV breathing:
  //   base + speed ramp → 90° max
  //   hard braking → snaps to 68° (tunnel-vision commitment)
  //   drifting → +5° bloom
  const ds      = getDriftState(playerPhysics.body)
  const braking = updatePlayer._braking ?? false
  let targetFov = 72 + horizSpd * 0.36
  if (ds?.drifting)          targetFov += 5
  if (braking && horizSpd > 8) targetFov = Math.min(targetFov, 68)
  targetFov = Math.min(targetFov, 92)

  const fovLerp = braking ? 0.22 : 0.06
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, fovLerp)
  camera.updateProjectionMatrix()

  vignetteEl.style.opacity = (0.25 + Math.min(horizSpd / 45, 0.45)).toFixed(2)
}

// ── Start sequence via Pixi UI ─────────────────────────────────────────────────
UI.runTrafficLights(() => {
  UI.showAnn('GO!', 700)
  raceStarted = true
  raceStartTime = Date.now()
  lapStartTime  = raceStartTime
})

// ── Game loop ─────────────────────────────────────────────────────────────────
let prevTime = performance.now()

function animate(now) {
  requestAnimationFrame(animate)

  const dt = Math.min((now - prevTime) / 1000, 0.05)
  prevTime = now

  // Physics substep loop: grip applied once per 1/60s step so behavior is
  // identical at 30, 60, or 144 fps (fixes framerate-dependent cornering radius)
  const numSteps = Math.max(1, Math.min(3, Math.round(dt * 60)))
  const hb = updatePlayer._handbrake ?? false
  for (let _s = 0; _s < numSteps; _s++) {
    applyCarGrip(playerPhysics.body, playerPhysics.vehicle, hb)
    bots.forEach(b => applyCarGrip(b.physics.body, b.physics.vehicle, false))
    world.step(1 / 60, 1 / 60, 1)
  }

  if (raceStarted && !raceOver) {
    updatePlayer(dt)
    bots.forEach(updateBot)
  }

  syncMesh(playerPhysics, playerVisual)
  bots.forEach(bot => syncMesh(bot.physics, bot.visual))

  updateCamera()
  updateSmoke(dt)
  updateSparks(dt)

  // Audio
  const _spd = updatePlayer._speed     ?? 0
  const _lat = updatePlayer._latSlip   ?? 0
  const _brk = updatePlayer._braking   ?? false
  const _na  = updatePlayer._nitroActive ?? false
  updateAudio(_spd, _lat, _brk)

  // Nitro glow overlay (HTML CSS effect)
  nitroGlowEl.style.opacity = _na ? '1' : '0'

  // Pixi HUD update
  const vel = playerPhysics.body.velocity
  const kmh = Math.round(Math.sqrt(vel.x ** 2 + vel.z ** 2) * 3.6)
  UI.updateHUD({
    speedKmh:    kmh,
    lapText:     `${Math.min(playerLap + 1, TOTAL_LAPS)} / ${TOTAL_LAPS}`,
    posText:     `P${getPosition()}`,
    timerText:   (raceStarted && !raceOver) ? formatTime(Date.now() - raceStartTime) : '0:00.00',
    nitroLevel:  nitroCurrent,
    nitroActive: _na,
  })

  // Pixi minimap
  UI.updateMinimap(
    playerPhysics.body.position,
    bots.map(b => b.physics.body.position)
  )

  composer.render()
}

animate(performance.now())
