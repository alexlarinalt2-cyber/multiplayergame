// PolyRacer — time-trial mode. Modular track pieces, checkpoints, instant
// respawn, ghost replay. Physics is the Phase-7 velocity-bending system with
// two additions: downforce along car-local down (loops) and airborne pitch control.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as CANNON from 'cannon-es'
import { MAPS } from './maps.js'
import { CELL, ROAD_W, ROAD_T, walkTrack, pieceSegments } from './track-pieces.js'

// ── Map selection / menu ──────────────────────────────────────────────────────
const params = new URLSearchParams(location.search)
const mapDef = MAPS.find(m => m.id === params.get('map')) || null

const bestKey   = id => `ptBest_${id}`
const splitsKey = id => `ptSplits_${id}`
const ghostKey  = id => `ptGhost_${id}`

function formatTime(ms) {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

const menuEl = document.getElementById('menu')
const mapListEl = document.getElementById('map-list')
MAPS.forEach(m => {
  const best = parseInt(localStorage.getItem(bestKey(m.id)) || '0', 10)
  const btn = document.createElement('button')
  btn.className = 'map-btn'
  btn.innerHTML =
    `<span class="mbest">${best ? formatTime(best) : '—'}</span>` +
    `<div class="mname">${m.name}</div><div class="mdesc">${m.desc}</div>`
  btn.onclick = () => { location.search = `?map=${m.id}` }
  mapListEl.appendChild(btn)
})

if (mapDef) {
  menuEl.classList.remove('visible')
  startGame(mapDef)
}

function startGame(MAP) {

// ── Renderer / scene — flat low-poly look ─────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
// gradient sky: deep blue at zenith → pale at horizon
const _skyC = document.createElement('canvas')
_skyC.width = 2; _skyC.height = 512
const _skyCtx = _skyC.getContext('2d')
const _skyG = _skyCtx.createLinearGradient(0, 0, 0, 512)
_skyG.addColorStop(0,   '#3a7baa')
_skyG.addColorStop(0.5, '#87c5eb')
_skyG.addColorStop(1,   '#c9e8f5')
_skyCtx.fillStyle = _skyG; _skyCtx.fillRect(0, 0, 2, 512)
scene.background = new THREE.CanvasTexture(_skyC)
scene.fog = new THREE.Fog(0xc9e8f5, 220, 650)

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 900)

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})

scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x90a4ae, 1.15))
const sun = new THREE.DirectionalLight(0xfff4e0, 1.7)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)

// ── Physics world (no ground — falling off is part of the game) ───────────────
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) })
world.broadphase = new CANNON.SAPBroadphase(world)
world.solver.iterations = 8
world.defaultContactMaterial.friction = 0.4
world.defaultContactMaterial.restitution = 0.1

// ── Build track from pieces ───────────────────────────────────────────────────
const walk = walkTrack(MAP.pieces)

// Bounding box of the course — used to aim the sun + shadow frustum
const bbox = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, maxY: 0 }
walk.forEach(w => {
  bbox.minX = Math.min(bbox.minX, w.center[0]); bbox.maxX = Math.max(bbox.maxX, w.center[0])
  bbox.minZ = Math.min(bbox.minZ, w.center[2]); bbox.maxZ = Math.max(bbox.maxZ, w.center[2])
  bbox.maxY = Math.max(bbox.maxY, w.center[1])
})
const midX = (bbox.minX + bbox.maxX) / 2
const midZ = (bbox.minZ + bbox.maxZ) / 2
const span = Math.max(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ) / 2 + 60
sun.position.set(midX + 80, 120 + bbox.maxY, midZ + 60)
sun.target.position.set(midX, 0, midZ)
scene.add(sun, sun.target)
sun.shadow.camera.near = 1
sun.shadow.camera.far  = 500
sun.shadow.camera.left = -span; sun.shadow.camera.right  = span
sun.shadow.camera.top  =  span; sun.shadow.camera.bottom = -span

// "Sea" far below — visual depth reference when falling
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshLambertMaterial({ color: 0x1e88e5, flatShading: true })
)
sea.rotation.x = -Math.PI / 2
sea.position.set(midX, MAP.killY - 28, midZ)
scene.add(sea)

// Decorative low-poly hills ringing the course
;(function addHills() {
  const mats = [0x4caf50, 0x388e3c, 0x66bb6a, 0x2e7d32, 0x43a047].map(
    c => new THREE.MeshLambertMaterial({ color: c, flatShading: true })
  )
  for (let i = 0; i < 22; i++) {
    const a  = (i / 22) * Math.PI * 2 + 0.25
    const d  = 165 + (i % 4) * 32
    const hx = midX + Math.cos(a) * d
    const hz = midZ + Math.sin(a) * d
    const h  = 24 + (i % 5) * 14
    const rx = 22 + (i % 4) * 9
    const sides = 5 + (i % 3)
    const geo = (i % 3 === 0)
      ? new THREE.ConeGeometry(rx, h, sides)
      : new THREE.CylinderGeometry(rx * 0.25, rx, h * 0.75, sides)
    const mesh = new THREE.Mesh(geo, mats[i % mats.length])
    mesh.position.set(hx, h / 2 - 4, hz)
    scene.add(mesh)
  }
})()

// Collect all segments → one static physics body + instanced visuals
const allSegs = []
MAP.pieces.forEach(p => pieceSegments(p).forEach(s => allSegs.push(s)))

const trackBody = new CANNON.Body({ mass: 0 })
const _segRight = new THREE.Vector3(), _segUp = new THREE.Vector3()
const _segQuat = new THREE.Quaternion(), _segPos = new THREE.Vector3()
const _segScale = new THREE.Vector3(), _segM = new THREE.Matrix4()

const roadInst = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: 0x90a4ae, flatShading: true }),
  allSegs.length
)
roadInst.receiveShadow = true
const edgeInst = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
  allSegs.length * 2
)

allSegs.forEach((s, i) => {
  const w = s.w ?? ROAD_W
  _segQuat.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3])
  _segUp.set(0, 1, 0).applyQuaternion(_segQuat)
  _segRight.set(1, 0, 0).applyQuaternion(_segQuat)

  // box center sits half a thickness below the surface point
  const cx = s.pos[0] - _segUp.x * ROAD_T / 2
  const cy = s.pos[1] - _segUp.y * ROAD_T / 2
  const cz = s.pos[2] - _segUp.z * ROAD_T / 2

  trackBody.addShape(
    new CANNON.Box(new CANNON.Vec3(w / 2, ROAD_T / 2, s.len / 2)),
    new CANNON.Vec3(cx, cy, cz),
    new CANNON.Quaternion(s.quat[0], s.quat[1], s.quat[2], s.quat[3])
  )

  _segM.compose(_segPos.set(cx, cy, cz), _segQuat, _segScale.set(w, ROAD_T, s.len))
  roadInst.setMatrixAt(i, _segM)

  // white edge strips
  for (const side of [-1, 1]) {
    const off = side * (w / 2 - 0.28)
    _segM.compose(
      _segPos.set(cx + _segRight.x * off, cy + _segUp.y * 0.06 + _segRight.y * off, cz + _segRight.z * off),
      _segQuat, _segScale.set(0.55, ROAD_T + 0.1, s.len)
    )
    edgeInst.setMatrixAt(i * 2 + (side + 1) / 2, _segM)
  }
})
world.addBody(trackBody)
scene.add(roadInst, edgeInst)

// ── Gates, boost pads, logic regions ──────────────────────────────────────────
// region: car is "on" a piece when inside its local cell bounds
const regions = []   // { type, cx, cy, cz, yaw, cpIndex }
const cpGateMats = []
let checkpointCount = 0

function buildGate(w, color) {
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true })
  const g = new THREE.Group()
  const postGeo = new THREE.BoxGeometry(0.6, 6.5, 0.6)
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, mat)
    post.position.set(side * (ROAD_W / 2 + 0.8), 3.25, 0)
    post.castShadow = true
    g.add(post)
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 2.2, 0.7, 0.7), mat)
  bar.position.y = 6.1
  g.add(bar)
  g.position.set(w.center[0], w.center[1], w.center[2])
  g.rotation.y = w.yawAngle
  scene.add(g)
  return mat
}

walk.forEach(w => {
  const t = w.piece.t
  if (t === 'start')  buildGate(w, 0x66bb6a)
  if (t === 'finish') {
    buildGate(w, 0xf5f5f5)
    regions.push({ type: 'finish', cx: w.center[0], cy: w.center[1], cz: w.center[2], yaw: w.yawAngle })
  }
  if (t === 'checkpoint') {
    cpGateMats.push(buildGate(w, 0x29b6f6))
    regions.push({ type: 'checkpoint', cx: w.center[0], cy: w.center[1], cz: w.center[2], yaw: w.yawAngle, cpIndex: checkpointCount++ })
  }
  if (t === 'boost') {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W - 2.5, 13),
      new THREE.MeshLambertMaterial({ color: 0xff9100, emissive: 0xb35900, flatShading: true })
    )
    pad.rotation.x = -Math.PI / 2
    pad.position.set(w.center[0], w.center[1] + 0.04, w.center[2])
    pad.rotation.z = w.yawAngle
    scene.add(pad)
    regions.push({ type: 'boost', cx: w.center[0], cy: w.center[1], cz: w.center[2], yaw: w.yawAngle,
                   dirX: w.out.dir[0], dirZ: w.out.dir[2] })
  }
})

function inRegion(r, px, py, pz) {
  const dx = px - r.cx, dz = pz - r.cz
  const c = Math.cos(-r.yaw), s = Math.sin(-r.yaw)
  const lx = dx * c + dz * s
  const lz = -dx * s + dz * c
  return Math.abs(lx) < ROAD_W / 2 + 1.5 && Math.abs(lz) < 8 && py - r.cy > -2 && py - r.cy < 5
}

// ── Loop rail-assist ──────────────────────────────────────────────────────────
// A raycast car gets no yaw torque from the road surface, so it can't follow
// the loop's helix on its own. While the car is on a loop ring (wheels in
// contact), blend its velocity toward the helix tangent, rotate its heading to
// match, and spring it toward the road centerline. Verified headlessly: clean
// completion from 26–50 m/s entry, falls off below that (skill preserved).
const loops = walk
  .filter(w => w.piece.t === 'loop')
  .map(w => ({ cx: w.center[0], cy: w.center[1], cz: w.center[2], yaw: w.piece.r * Math.PI / 2 }))

const LOOP_R = 12, LOOP_ZC = 8, LOOP_SHIFT = CELL
const LP0 = 0.6, LP1 = Math.PI * 2 - 0.6
const _laFwd = new CANNON.Vec3()
const _laQ = new CANNON.Vec3()
const _laRot = new CANNON.Quaternion()
const _laFwdLocal = new CANNON.Vec3(0, 0, -1)

function applyLoopAssist(body, vehicle) {
  if (!loops.length) return
  if (!vehicle.wheelInfos.some(w => w.isInContact)) return
  const p = body.position
  for (const L of loops) {
    const dy = p.y - L.cy
    if (dy < 1.2 || dy > 2 * LOOP_R + 5) continue
    const c = Math.cos(L.yaw), s = Math.sin(L.yaw)
    const dx = p.x - L.cx, dz = p.z - L.cz
    const lx = dx * c - dz * s          // piece-local coords (rotY by -yaw)
    const lz = dx * s + dz * c
    if (Math.abs(lz - LOOP_ZC) > LOOP_R + 5) continue
    if (lx < -10 || lx > LOOP_SHIFT + 10) continue

    const sinp = (lz - LOOP_ZC) / LOOP_R
    const cosp = 1 - dy / LOOP_R
    let phi = Math.atan2(sinp, cosp)
    if (phi < 0) phi += Math.PI * 2
    const lin = Math.min(1, Math.max(0, (phi - LP0) / (LP1 - LP0)))
    const rate = (phi > LP0 && phi < LP1) ? LOOP_SHIFT / (LP1 - LP0) : 0

    // helix tangent in piece-local frame → world
    let tx = rate, ty = LOOP_R * sinp, tz = LOOP_R * Math.cos(phi)
    const tl = Math.hypot(tx, ty, tz)
    tx /= tl; ty /= tl; tz /= tl
    const wtx = tx * c + tz * s
    const wtz = -tx * s + tz * c

    // 1) blend velocity direction toward the tangent (preserves speed)
    const v = body.velocity
    const spd = v.length()
    if (spd > 4) {
      const k = 0.12
      let nx = v.x / spd * (1 - k) + wtx * k
      let ny = v.y / spd * (1 - k) + ty * k
      let nz = v.z / spd * (1 - k) + wtz * k
      const nl = Math.hypot(nx, ny, nz)
      v.set(nx / nl * spd, ny / nl * spd, nz / nl * spd)
    }

    // 2) rotate heading toward the tangent (capped per step)
    body.quaternion.vmult(_laFwdLocal, _laFwd)
    const dot = Math.max(-1, Math.min(1, _laFwd.x * wtx + _laFwd.y * ty + _laFwd.z * wtz))
    const ang = Math.acos(dot)
    if (ang > 0.005) {
      const ax = _laFwd.y * wtz - _laFwd.z * ty
      const ay = _laFwd.z * wtx - _laFwd.x * wtz
      const az = _laFwd.x * ty - _laFwd.y * wtx
      const al = Math.hypot(ax, ay, az)
      if (al > 1e-6) {
        _laQ.set(ax / al, ay / al, az / al)
        _laRot.setFromAxisAngle(_laQ, Math.min(ang, 0.10))
        _laRot.mult(body.quaternion, body.quaternion)   // world-axis premultiply
      }
    }

    // 3) spring toward the helix centerline (local +X direction in world)
    const err = LOOP_SHIFT * lin - lx
    const f = Math.max(-1800, Math.min(1800, err * body.mass * 6))
    body.force.x += f * c
    body.force.z += -f * s
    return
  }
}

// ── Car physics (Phase 7 system + loop downforce + air control) ───────────────
function createCarPhysics(spawn) {
  const chassisBody = new CANNON.Body({ mass: 90 })
  chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.26, 2.0)), new CANNON.Vec3(0, 0.10, 0.25))
  chassisBody.position.set(spawn.x, spawn.y, spawn.z)
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawn.yaw)
  chassisBody.linearDamping  = 0.02
  chassisBody.angularDamping = 0.7
  world.addBody(chassisBody)

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2
  })

  // Suspension much stiffer than the circuit racer: loop valleys pull up to
  // ~6g and the soft setup bottoms out → chassis slams the road and stalls.
  // Verified headlessly: flat-track feel (top speed, handbrake retention,
  // corner radius) is unchanged vs the soft setup.
  const frontWheel = {
    radius: 0.33,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 350,
    suspensionRestLength: 0.26,
    frictionSlip: 0.8,
    dampingRelaxation: 5.0,
    dampingCompression: 9.0,
    maxSuspensionForce: 260000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    maxSuspensionTravel: 0.30,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true
  }
  const rearWheel = {
    ...frontWheel,
    suspensionStiffness: 300,
    suspensionRestLength: 0.28,
    frictionSlip: 1.0,
    dampingRelaxation: 4.0,
    dampingCompression: 7.5,
    rollInfluence: 0.006,
    maxSuspensionTravel: 0.32,
  }
  ;[
    { pos: new CANNON.Vec3(-0.8, 0,  1.55), opts: frontWheel },
    { pos: new CANNON.Vec3( 0.8, 0,  1.55), opts: frontWheel },
    { pos: new CANNON.Vec3(-0.8, 0, -1.45), opts: rearWheel  },
    { pos: new CANNON.Vec3( 0.8, 0, -1.45), opts: rearWheel  },
  ].forEach(({ pos, opts }) => vehicle.addWheel({ ...opts, chassisConnectionPointLocal: pos }))

  vehicle.addToWorld(world)
  return { body: chassisBody, vehicle }
}

const driftState = { drifting: false, driftTimer: 0, noContactTimer: 0, peakSlip: 0, fromHandbrake: false }

// NOTE: cannon-es RaycastVehicle thrust convention — positive engine force
// propels the chassis toward local −Z. So "travel forward" is chassis −Z
// (this is also why the GLB model gets rotated 180° and the chase camera
// offset is +Z). All spawn yaws add π to face the track direction.
const _vbFwdLocal   = new CANNON.Vec3(0, 0, -1)
const _vbRightLocal = new CANNON.Vec3(1, 0, 0)
const _vbUpLocal    = new CANNON.Vec3(0, 1, 0)
const _vbFwd   = new CANNON.Vec3()
const _vbRight = new CANNON.Vec3()
const _vbUp    = new CANNON.Vec3()
const _vbImp   = new CANNON.Vec3()

function applyCarGrip(body, vehicle, forceHandbrake = false) {
  const inContact = vehicle.wheelInfos.some(w => w.isInContact)

  body.quaternion.vmult(_vbFwdLocal, _vbFwd)
  body.quaternion.vmult(_vbRightLocal, _vbRight)
  body.quaternion.vmult(_vbUpLocal, _vbUp)

  const vel      = body.velocity
  const latSpeed = vel.x * _vbRight.x + vel.y * _vbRight.y + vel.z * _vbRight.z
  const slipMag  = Math.abs(latSpeed)
  const spd      = vel.length()

  const ds = driftState
  if (!inContact) {
    ds.noContactTimer += 1 / 60
    if (ds.noContactTimer > 0.5) ds.drifting = false
  } else {
    ds.noContactTimer = 0
  }

  if (!ds.drifting && spd > 6 && (forceHandbrake || slipMag > 5.0)) {
    ds.drifting = true
    ds.driftTimer = 0
    ds.peakSlip = slipMag
    ds.fromHandbrake = forceHandbrake
  }
  if (ds.drifting) {
    ds.driftTimer += 1 / 60
    ds.peakSlip = Math.max(ds.peakSlip, slipMag)
  }

  const driftShouldExit = ds.drifting && (
    ds.fromHandbrake ? !forceHandbrake : (!forceHandbrake && slipMag < 2.2)
  )
  if (driftShouldExit) {
    ds.drifting = false
    if (inContact) {
      const boostMs = Math.min(ds.peakSlip * 0.16, 2.5)
      body.velocity.x += _vbFwd.x * boostMs
      body.velocity.y += _vbFwd.y * boostMs
      body.velocity.z += _vbFwd.z * boostMs
    }
  }

  if (!inContact) return

  // Full-3D lateral correction (unlike the flat-track version we keep the y
  // component — on loop walls "lateral" has a vertical part)
  const gripStrength = ds.drifting ? 0.08 : 0.82
  const corrMag = -latSpeed * body.mass * gripStrength
  _vbImp.set(_vbRight.x * corrMag, _vbRight.y * corrMag, _vbRight.z * corrMag)
  body.applyImpulse(_vbImp)

  if (!ds.drifting) {
    // Kinematic yaw: cornering rate comes from steering geometry, capped at
    // 30 m/s² lateral. The grid's tight corners (r=8 m) are undrivable on
    // friction alone — wheel side-impulses can't yaw the chassis fast enough.
    // This gives the deterministic point-and-go cornering the mode needs.
    const steer = body._steer ?? 0
    const fwdSpd = vel.x * _vbFwd.x + vel.y * _vbFwd.y + vel.z * _vbFwd.z
    if (Math.abs(fwdSpd) > 1) {
      let target = -Math.tan(steer) * fwdSpd / 3.0
      const cap = 30 / Math.abs(fwdSpd)
      target = Math.max(-cap, Math.min(cap, target))
      body.angularVelocity.y += (target - body.angularVelocity.y) * 0.25
    }
  } else {
    body.angularVelocity.y *= 0.96
  }

  // Downforce along car-local DOWN (not world down) — this is what lets the
  // car hold the inside of a loop at speed
  const maxDownforce = body.mass * 20 * 0.9
  const df = Math.min(spd * spd * 0.55, maxDownforce)
  body.force.x -= _vbUp.x * df
  body.force.y -= _vbUp.y * df
  body.force.z -= _vbUp.z * df
}

// ── Car visual ────────────────────────────────────────────────────────────────
const gltfLoader = new GLTFLoader()

function makePrimitiveCar(color, ghost = false) {
  const g = new THREE.Group()
  const mat = ghost
    ? new THREE.MeshLambertMaterial({ color: 0x66ccff, transparent: true, opacity: 0.35, depthWrite: false, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true })
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.48, 4.0), mat)
  body.position.y = 0.3
  body.castShadow = !ghost
  g.add(body)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.42, 1.85), mat)
  cabin.position.set(0, 0.75, -0.25)
  g.add(cabin)
  if (!ghost) {
    const wGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.28, 12)
    const wMat = new THREE.MeshLambertMaterial({ color: 0x212121, flatShading: true })
    ;[[-0.96, 1.5], [0.96, 1.5], [-0.96, -1.4], [0.96, -1.4]].forEach(([x, z]) => {
      const w = new THREE.Mesh(wGeo, wMat)
      w.rotation.z = Math.PI / 2
      w.position.set(x, 0, z)
      g.add(w)
    })
  }
  scene.add(g)
  return g
}

let playerGroup = makePrimitiveCar(0xe53935)
let ghostGroup  = null

;(async () => {
  const gltf = await new Promise(res => gltfLoader.load('/assets/models/cars/race.glb', g => res(g), undefined, () => res(null)))
  if (!gltf) return
  const model = gltf.scene
  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3(); box.getSize(size)
  const scale = 3.8 / Math.max(size.x, size.z)
  model.scale.setScalar(scale)
  const center = new THREE.Vector3(); box.getCenter(center)
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  model.traverse(c => {
    if (!c.isMesh) return
    c.castShadow = true
    if (c.material) { c.material.roughness = 1; c.material.metalness = 0 }
  })
  model.rotation.y = Math.PI

  const wrapper = new THREE.Group()
  wrapper.add(model)
  scene.add(wrapper)
  scene.remove(playerGroup)
  playerGroup = wrapper

  // Ghost = translucent clone of the same model
  if (ghostGroup) {
    const gModel = model.clone()
    const gMat = new THREE.MeshLambertMaterial({ color: 0x66ccff, transparent: true, opacity: 0.32, depthWrite: false, flatShading: true })
    gModel.traverse(c => { if (c.isMesh) { c.material = gMat; c.castShadow = false } })
    const gWrap = new THREE.Group()
    gWrap.add(gModel)
    scene.add(gWrap)
    scene.remove(ghostGroup)
    ghostGroup = gWrap
  }
})()

// ── Spawn / respawn ───────────────────────────────────────────────────────────
const startW = walk[0]
// +π: chassis −Z (travel forward) must face the track direction
const startSpawn = { x: startW.center[0], y: startW.center[1] + 1.0, z: startW.center[2], yaw: startW.yawAngle + Math.PI }

const car = createCarPhysics(startSpawn)

let respawnTarget = { ...startSpawn }

function respawn(target) {
  car.body.velocity.set(0, 0, 0)
  car.body.angularVelocity.set(0, 0, 0)
  car.body.position.set(target.x, target.y, target.z)
  car.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), target.yaw)
  driftState.drifting = false
  driftState.noContactTimer = 0
  driftState.peakSlip = 0
  upsideDownTimer = 0
}

// ── Race state ────────────────────────────────────────────────────────────────
let state = 'countdown'        // countdown | racing | finished
let countdownEnd = performance.now() + 3200
let raceStartMs = 0
let elapsedMs = 0
const cpHit = new Array(checkpointCount).fill(false)
let cpHitCount = 0
const cpTimes = new Array(checkpointCount).fill(0)
let upsideDownTimer = 0
let boostFovKick = 0

const bestMs     = parseInt(localStorage.getItem(bestKey(MAP.id)) || '0', 10) || Infinity
const bestSplits = JSON.parse(localStorage.getItem(splitsKey(MAP.id)) || 'null')

// Ghost data — flat array stride 8: [t, x, y, z, qx, qy, qz, qw]
const ghostData = JSON.parse(localStorage.getItem(ghostKey(MAP.id)) || 'null')
let ghostIdx = 0
if (ghostData && ghostData.length >= 16) ghostGroup = makePrimitiveCar(0, true)

const recording = []
let recFrame = 0

function fullRestart() {
  state = 'racing'
  raceStartMs = performance.now()
  elapsedMs = 0
  cpHit.fill(false)
  cpHitCount = 0
  cpTimes.fill(0)
  recording.length = 0
  recFrame = 0
  ghostIdx = 0
  respawnTarget = { ...startSpawn }
  respawn(startSpawn)
  cpGateMats.forEach(m => m.color.setHex(0x29b6f6))
  hudMsg('GO!', 600)
  finishEl.classList.remove('visible')
}

// ── HUD ───────────────────────────────────────────────────────────────────────
const hudTimer = document.getElementById('hud-timer')
const hudCp    = document.getElementById('hud-cp')
const hudBest  = document.getElementById('hud-best')
const hudSpeed = document.getElementById('hud-speed')
const hudMsgEl = document.getElementById('hud-msg')
const hudSplit = document.getElementById('hud-split')
const vignetteEl = document.getElementById('vignette')
const finishEl  = document.getElementById('finish')

hudBest.textContent = bestMs < Infinity ? `BEST ${formatTime(bestMs)}` : ''

let msgTimeout = null
function hudMsg(text, ms = 900) {
  hudMsgEl.textContent = text
  hudMsgEl.style.opacity = '1'
  clearTimeout(msgTimeout)
  msgTimeout = setTimeout(() => { hudMsgEl.style.opacity = '0' }, ms)
}

let splitTimeout = null
function showSplit(deltaMs) {
  const ahead = deltaMs <= 0
  hudSplit.textContent = `${ahead ? '−' : '+'}${(Math.abs(deltaMs) / 1000).toFixed(2)}`
  hudSplit.style.color = ahead ? '#69f0ae' : '#ff8a80'
  hudSplit.style.opacity = '1'
  clearTimeout(splitTimeout)
  splitTimeout = setTimeout(() => { hudSplit.style.opacity = '0' }, 1600)
}

// ── Finish ────────────────────────────────────────────────────────────────────
function medalFor(ms) {
  if (ms <= MAP.medals.gold)   return ['🥇 GOLD',   '#ffd54f']
  if (ms <= MAP.medals.silver) return ['🥈 SILVER', '#cfd8dc']
  if (ms <= MAP.medals.bronze) return ['🥉 BRONZE', '#bcaaa4']
  return ['', '']
}

function onFinish() {
  state = 'finished'
  const ms = elapsedMs
  const isNewBest = ms < bestMs
  if (isNewBest) {
    localStorage.setItem(bestKey(MAP.id), String(Math.round(ms)))
    localStorage.setItem(splitsKey(MAP.id), JSON.stringify(cpTimes.map(Math.round)))
    localStorage.setItem(ghostKey(MAP.id), JSON.stringify(recording.map(n => Math.round(n * 100) / 100)))
  }
  document.getElementById('fin-time').textContent = formatTime(ms)
  const [medal, mcolor] = medalFor(ms)
  const medalEl = document.getElementById('fin-medal')
  medalEl.textContent = medal
  medalEl.style.color = mcolor
  document.getElementById('fin-pb').textContent = isNewBest
    ? '🏆 NEW PERSONAL BEST!'
    : (bestMs < Infinity ? `PB ${formatTime(bestMs)}` : '')
  finishEl.classList.add('visible')
}

document.getElementById('fin-retry').onclick = () => location.reload()
document.getElementById('fin-menu').onclick  = () => { location.href = 'polytrack.html' }

// ── Audio (synth engine + screech) ────────────────────────────────────────────
let audioCtx = null, engineOsc = null, engineGain = null, screechGain = null
const GEAR_SPDS = [0, 8, 18, 30, 44, 58]
let prevGear = -1, gearPitch = 0

function initAudio() {
  if (audioCtx) return
  audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  engineOsc = audioCtx.createOscillator()
  engineOsc.type = 'sawtooth'
  engineOsc.frequency.value = 80
  const dist = audioCtx.createWaveShaper()
  const n = 256, curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = (Math.PI + 60) * x / (Math.PI + 60 * Math.abs(x))
  }
  dist.curve = curve; dist.oversample = '2x'
  const eq = audioCtx.createBiquadFilter()
  eq.type = 'bandpass'; eq.frequency.value = 600; eq.Q.value = 0.7
  engineGain = audioCtx.createGain(); engineGain.gain.value = 0
  engineOsc.connect(dist); dist.connect(eq); eq.connect(engineGain)
  engineGain.connect(audioCtx.destination)
  engineOsc.start()

  const bufLen = audioCtx.sampleRate * 2
  const noiseBuf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate)
  const nd = noiseBuf.getChannelData(0)
  for (let i = 0; i < bufLen; i++) nd[i] = Math.random() * 2 - 1
  const src = audioCtx.createBufferSource()
  src.buffer = noiseBuf; src.loop = true
  const sf = audioCtx.createBiquadFilter()
  sf.type = 'bandpass'; sf.frequency.value = 950; sf.Q.value = 6
  screechGain = audioCtx.createGain(); screechGain.gain.value = 0
  src.connect(sf); sf.connect(screechGain); screechGain.connect(audioCtx.destination)
  src.start()
}

function updateAudio(speed, latSlip, braking) {
  if (!audioCtx) return
  const t = audioCtx.currentTime
  let g = 0
  for (let i = GEAR_SPDS.length - 1; i >= 0; i--) { if (speed >= GEAR_SPDS[i]) { g = i; break } }
  if (prevGear >= 0 && g !== prevGear) gearPitch = g > prevGear ? -28 : 22
  prevGear = g
  gearPitch *= 0.87
  engineOsc.frequency.setTargetAtTime(80 + speed * 1.9 + gearPitch, t, 0.06)
  engineGain.gain.setTargetAtTime(state === 'racing' ? 0.07 : 0, t, 0.12)
  const vol = Math.min(0.28, Math.max(0, latSlip - 3.0) * 0.05 + (braking && speed > 6 ? 0.1 : 0))
  screechGain.gain.setTargetAtTime(vol, t, 0.04)
}

// ── Smoke ─────────────────────────────────────────────────────────────────────
const _smokeMat = new THREE.SpriteMaterial({ color: 0xcccccc, transparent: true, depthWrite: false })
const _smokePool = Array.from({ length: 20 }, () => {
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

// ── Input ─────────────────────────────────────────────────────────────────────
const keys = {}
window.addEventListener('keydown', e => {
  keys[e.code] = true
  initAudio()
  if (e.code === 'KeyR' && state === 'racing') {
    respawn(respawnTarget)
    hudMsg('RESPAWN', 500)
  }
  if (e.code === 'Enter' && state !== 'countdown') fullRestart()
  if (e.code === 'Escape') location.href = 'polytrack.html'
})
window.addEventListener('keyup', e => { keys[e.code] = false })
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false })

// ── Ackermann steering ────────────────────────────────────────────────────────
const WHEELBASE = 3.0, TRACK_W = 1.6
function ackermannAngles(steer) {
  if (Math.abs(steer) < 0.001) return [0, 0]
  const R = WHEELBASE / Math.tan(Math.abs(steer))
  const inner = Math.atan(WHEELBASE / (R - TRACK_W * 0.5)) * Math.sign(steer)
  const outer = Math.atan(WHEELBASE / (R + TRACK_W * 0.5)) * Math.sign(steer)
  return steer < 0 ? [inner, outer] : [outer, inner]
}

// ── Per-frame player update ───────────────────────────────────────────────────
const _q = new THREE.Quaternion()
const _vec = new THREE.Vector3()
const _upVec = new CANNON.Vec3()
const _upLocal = new CANNON.Vec3(0, 1, 0)

function updatePlayer(dt) {
  const v = car.vehicle
  const body = car.body
  const speed = body.velocity.length()
  const racing = state === 'racing'
  const inContact = v.wheelInfos.some(w => w.isInContact)

  // lateral slip for audio/smoke
  const bq = body.quaternion
  _q.set(bq.x, bq.y, bq.z, bq.w)
  _vec.set(1, 0, 0).applyQuaternion(_q)
  const bv = body.velocity
  const latSlip = Math.abs(bv.x * _vec.x + bv.y * _vec.y + bv.z * _vec.z)

  // quadratic aero drag along velocity (3D so jumps/loops behave)
  if (speed > 0.5) {
    const drag = speed * speed * 0.14
    body.force.x -= (bv.x / speed) * drag
    body.force.y -= (bv.y / speed) * drag * 0.3   // weaker vertically — keeps jump arcs floaty
    body.force.z -= (bv.z / speed) * drag
  }

  const steerMax = 0.48 / (1 + speed * 0.030)
  let forceMax = 3300 * Math.max(0, 1 - speed / 57)
  const brakeF = 95

  let engine = 0, brake = 0, steer = 0, handbrake = false
  if (racing) {
    if (keys['KeyW'] || keys['ArrowUp'])    engine = forceMax
    if (keys['KeyS'] || keys['ArrowDown']) { brake = brakeF; if (speed < 1.0) engine = -forceMax * 0.35 }
    if (keys['KeyA'] || keys['ArrowLeft'])  steer = -steerMax
    if (keys['KeyD'] || keys['ArrowRight']) steer = steerMax
    if (keys['Space']) handbrake = true
  }

  const [steerFL, steerFR] = ackermannAngles(steer)
  v.setSteeringValue(steerFL, 0)
  v.setSteeringValue(steerFR, 1)
  body._steer = steer   // read by applyCarGrip for kinematic yaw
  v.applyEngineForce(engine, 2); v.applyEngineForce(engine, 3)
  v.setBrake(brake, 0); v.setBrake(brake, 1)
  v.setBrake(brake * 0.6, 2); v.setBrake(brake * 0.6, 3)
  if (handbrake) {
    v.applyEngineForce(0, 2); v.applyEngineForce(0, 3)
    v.setBrake(8, 2); v.setBrake(8, 3)
  }

  // Airborne pitch control — W noses down, S noses up (land jumps cleanly).
  // Travel forward is chassis −Z, so nose-down is a NEGATIVE rotation about
  // the local X (right) axis.
  if (racing && !inContact) {
    const pitchIn = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0)
    if (pitchIn !== 0) {
      _vec.set(1, 0, 0).applyQuaternion(_q)
      body.angularVelocity.x -= _vec.x * pitchIn * 2.4 * dt
      body.angularVelocity.y -= _vec.y * pitchIn * 2.4 * dt
      body.angularVelocity.z -= _vec.z * pitchIn * 2.4 * dt
    }
    // gentle stabilization so flips don't run away
    body.angularVelocity.x *= 1 - 0.4 * dt
    body.angularVelocity.z *= 1 - 0.4 * dt
  }

  // Upside down on the ground (NOT in a loop — loops keep wheel contact) → auto respawn
  bq.vmult(_upLocal, _upVec)
  if (_upVec.y < 0.1 && !inContact) {
    upsideDownTimer += dt
    if (upsideDownTimer > 2.0 && racing) { respawn(respawnTarget); hudMsg('RESPAWN', 500) }
  } else if (_upVec.y >= 0.1) {
    upsideDownTimer = 0
  }

  // Fell off the track
  if (racing && body.position.y < MAP.killY) {
    respawn(respawnTarget)
    hudMsg('RESPAWN', 500)
  }

  // ── Regions: checkpoints / finish / boost ──
  if (racing) {
    const p = body.position
    for (const r of regions) {
      if (!inRegion(r, p.x, p.y, p.z)) continue
      if (r.type === 'checkpoint' && !cpHit[r.cpIndex]) {
        cpHit[r.cpIndex] = true
        cpHitCount++
        cpTimes[r.cpIndex] = elapsedMs
        cpGateMats[r.cpIndex].color.setHex(0x66bb6a)
        respawnTarget = { x: r.cx, y: r.cy + 1.0, z: r.cz, yaw: r.yaw + Math.PI }
        if (bestSplits && bestSplits[r.cpIndex]) showSplit(elapsedMs - bestSplits[r.cpIndex])
        hudMsg('CHECKPOINT', 500)
      } else if (r.type === 'finish') {
        if (cpHitCount >= checkpointCount) onFinish()
        else hudMsg('MISSED CHECKPOINT', 900)
      } else if (r.type === 'boost') {
        const fwdBoost = 30 * dt
        const horiz = Math.sqrt(bv.x * bv.x + bv.z * bv.z)
        if (horiz < 55) {
          bv.x += r.dirX * fwdBoost
          bv.z += r.dirZ * fwdBoost
          boostFovKick = 0.4
        }
      }
    }
  }

  // smoke on handbrake/brake — chassis +Z is the rear in travel direction
  if ((handbrake || brake > 0) && speed > 4 && inContact) {
    _vec.set(-0.8, 0, 1.55).applyQuaternion(_q)
    emitSmoke(body.position.x + _vec.x, body.position.y + _vec.y, body.position.z + _vec.z)
    _vec.set(0.8, 0, 1.55).applyQuaternion(_q)
    emitSmoke(body.position.x + _vec.x, body.position.y + _vec.y, body.position.z + _vec.z)
  }

  updatePlayer._speed = speed
  updatePlayer._latSlip = latSlip
  updatePlayer._braking = brake > 0 || handbrake
  updatePlayer._handbrake = handbrake
}

// ── Visual sync ───────────────────────────────────────────────────────────────
const _leanQ = new THREE.Quaternion()
const _leanAxis = new THREE.Vector3(0, 0, 1)
let leanZ = 0

function syncMesh() {
  const p = car.body.position
  const q = car.body.quaternion
  playerGroup.position.set(p.x, p.y - 0.32, p.z)
  playerGroup.quaternion.set(q.x, q.y, q.z, q.w)

  const steer = car.vehicle.wheelInfos[0]?.steering ?? 0
  const leanTarget = driftState.drifting ? steer * 0.22 : steer * 0.07
  leanZ = THREE.MathUtils.lerp(leanZ, leanTarget, 0.14)
  _leanQ.setFromAxisAngle(_leanAxis, leanZ)
  playerGroup.quaternion.multiply(_leanQ)
}

// ── Ghost record + replay ─────────────────────────────────────────────────────
function updateGhost() {
  if (state === 'racing') {
    recFrame++
    if (recFrame % 3 === 0) {
      const p = car.body.position, q = car.body.quaternion
      recording.push(elapsedMs, p.x, p.y, p.z, q.x, q.y, q.z, q.w)
    }
  }
  if (!ghostGroup || !ghostData) return
  if (state !== 'racing') { ghostGroup.visible = false; return }
  ghostGroup.visible = true
  const n = ghostData.length / 8
  while (ghostIdx < n - 2 && ghostData[(ghostIdx + 1) * 8] < elapsedMs) ghostIdx++
  const i0 = ghostIdx * 8, i1 = Math.min(ghostIdx + 1, n - 1) * 8
  const t0 = ghostData[i0], t1 = ghostData[i1]
  const f = t1 > t0 ? Math.min(1, Math.max(0, (elapsedMs - t0) / (t1 - t0))) : 0
  ghostGroup.position.set(
    ghostData[i0 + 1] + (ghostData[i1 + 1] - ghostData[i0 + 1]) * f,
    ghostData[i0 + 2] + (ghostData[i1 + 2] - ghostData[i0 + 2]) * f - 0.32,
    ghostData[i0 + 3] + (ghostData[i1 + 3] - ghostData[i0 + 3]) * f
  )
  _q.set(ghostData[i0 + 4], ghostData[i0 + 5], ghostData[i0 + 6], ghostData[i0 + 7])
  _leanQ.set(ghostData[i1 + 4], ghostData[i1 + 5], ghostData[i1 + 6], ghostData[i1 + 7])
  _q.slerp(_leanQ, f)
  ghostGroup.quaternion.copy(_q)
}

// ── Camera ────────────────────────────────────────────────────────────────────
const _chaseOffset = new THREE.Vector3(0, 4.5, 10)
const _chaseLook   = new THREE.Vector3(0, 1.0, -5)
const _camTarget   = new THREE.Vector3()
const _lookTarget  = new THREE.Vector3()
camera.position.set(startSpawn.x, startSpawn.y + 6, startSpawn.z - 12)

function updateCamera() {
  const p = car.body.position
  const q = car.body.quaternion
  const vel = car.body.velocity
  _q.set(q.x, q.y, q.z, q.w)

  const horizSpd = Math.sqrt(vel.x * vel.x + vel.z * vel.z)
  const velNormX = horizSpd > 0.5 ? vel.x / horizSpd : 0
  const velNormZ = horizSpd > 0.5 ? vel.z / horizSpd : 0

  const lookahead = Math.min(horizSpd / 18, 1) * 0.4
  _camTarget.copy(_chaseOffset).applyQuaternion(_q).add(_vec.set(p.x, p.y, p.z))
  _camTarget.x += velNormX * lookahead * 7
  _camTarget.z += velNormZ * lookahead * 7

  _lookTarget.copy(_chaseLook).applyQuaternion(_q).add(_vec.set(p.x, p.y, p.z))
  _lookTarget.x += velNormX * Math.min(horizSpd / 12, 1) * 5
  _lookTarget.z += velNormZ * Math.min(horizSpd / 12, 1) * 5

  const followLerp = THREE.MathUtils.lerp(0.08, 0.16, Math.min(horizSpd / 28, 1))
  camera.position.lerp(_camTarget, followLerp)
  camera.lookAt(_lookTarget)

  const braking = updatePlayer._braking ?? false
  let targetFov = 72 + horizSpd * 0.36
  if (driftState.drifting) targetFov += 5
  if (boostFovKick > 0)    targetFov += boostFovKick * 20
  if (braking && horizSpd > 8) targetFov = Math.min(targetFov, 68)
  targetFov = Math.min(targetFov, 96)
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, braking ? 0.22 : 0.07)
  camera.updateProjectionMatrix()

  vignetteEl.style.opacity = (0.15 + Math.min(horizSpd / 50, 0.4)).toFixed(2)
}

// ── Game loop ─────────────────────────────────────────────────────────────────
let prevTime = performance.now()

function animate(now) {
  requestAnimationFrame(animate)
  const dt = Math.min((now - prevTime) / 1000, 0.05)
  prevTime = now

  if (state === 'countdown') {
    const remain = countdownEnd - now
    if (remain <= 0) {
      state = 'racing'
      raceStartMs = now
      hudMsg('GO!', 600)
    } else {
      const num = Math.ceil(remain / 1000)
      if (hudMsgEl.textContent !== String(num)) hudMsg(String(num), 1100)
    }
  }
  if (state === 'racing') elapsedMs = now - raceStartMs
  if (boostFovKick > 0) boostFovKick = Math.max(0, boostFovKick - dt)

  // fixed-step physics with grip applied per step (framerate independence)
  const numSteps = Math.max(1, Math.min(3, Math.round(dt * 60)))
  const hb = updatePlayer._handbrake ?? false
  for (let s = 0; s < numSteps; s++) {
    applyCarGrip(car.body, car.vehicle, hb)
    applyLoopAssist(car.body, car.vehicle)
    world.step(1 / 60, 1 / 60, 1)
  }

  updatePlayer(dt)
  syncMesh()
  updateGhost()
  updateCamera()
  updateSmoke(dt)
  updateAudio(updatePlayer._speed ?? 0, updatePlayer._latSlip ?? 0, updatePlayer._braking ?? false)

  // HUD
  hudTimer.textContent = formatTime(state === 'countdown' ? 0 : elapsedMs)
  hudCp.textContent = checkpointCount ? `CP ${cpHitCount} / ${checkpointCount}` : ''
  const kmh = Math.round((updatePlayer._speed ?? 0) * 3.6)
  hudSpeed.innerHTML = `${kmh} <span>km/h</span>`

  renderer.render(scene, camera)
}

animate(performance.now())

}
