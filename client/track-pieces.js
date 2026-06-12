// Modular track-piece system — pure data/math, no three.js or cannon-es imports
// so it can run headlessly in Node for map validation.
//
// Conventions:
//   - Grid cell: CELL × CELL meters, piece local origin = cell center
//   - Piece local forward = +Z before rotation; r ∈ {0,1,2,3} = yaw of r·90°
//     (r=0 → +Z, r=1 → +X, r=2 → −Z, r=3 → −X)
//   - Instance y = road surface height at the piece ENTRY
//   - Segments are road slabs: { pos (surface center), yaw, pitch, roll, len }
//   - Ports: in/out = { pos, dir } in piece-local coords, dir = travel direction

export const CELL = 16
export const ROAD_W = 12
export const ROAD_T = 0.5

// ── Quaternion helpers ([x,y,z,w]) ────────────────────────────────────────────
export function qAxisAngle(ax, ay, az, t) {
  const s = Math.sin(t / 2)
  return [ax * s, ay * s, az * s, Math.cos(t / 2)]
}

export function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export function qRotate(q, v) {
  const [qx, qy, qz, qw] = q, [vx, vy, vz] = v
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}

function rotY([x, y, z], t) {
  const c = Math.cos(t), s = Math.sin(t)
  return [x * c + z * s, y, -x * s + z * c]
}

// Segment world quaternion: yaw (world Y) → pitch (local X) → local yaw
// (local Y, after pitch — used for helix segments) → roll (local Z)
export function segQuat(yaw, pitch, roll, yaw2 = 0) {
  let q = qAxisAngle(0, 1, 0, yaw)
  if (pitch) q = qMul(q, qAxisAngle(1, 0, 0, pitch))
  if (yaw2)  q = qMul(q, qAxisAngle(0, 1, 0, yaw2))
  if (roll)  q = qMul(q, qAxisAngle(0, 0, 1, roll))
  return q
}

// ── Piece definitions ─────────────────────────────────────────────────────────
function seg(pos, yaw, pitch, roll, len, w, yaw2) {
  return { pos, yaw, pitch, roll, len, w, yaw2 }
}

const H = CELL / 2  // 8

// Quarter-annulus curve: connects -Z edge to -X edge (left turn when entered
// from -Z). Pivot at local corner (-H, -H), centerline radius H.
function curveSegs(roll = 0, n = 8) {
  const out = []
  for (let i = 0; i < n; i++) {
    const phi = ((i + 0.5) / n) * (Math.PI / 2)
    const pos = [-H + H * Math.cos(phi), 0, -H + H * Math.sin(phi)]
    out.push(seg(pos, -phi, 0, roll, 2.8))
  }
  return out
}

// Mirror a piece definition across local X (left turn → right turn)
function mirrorX(def) {
  return {
    segments: def.segments.map(s =>
      seg([-s.pos[0], s.pos[1], s.pos[2]], -s.yaw, s.pitch, -s.roll, s.len)),
    ports: {
      in:  { pos: [-def.ports.in.pos[0],  def.ports.in.pos[1],  def.ports.in.pos[2]],
             dir: [-def.ports.in.dir[0],  def.ports.in.dir[1],  def.ports.in.dir[2]] },
      out: { pos: [-def.ports.out.pos[0], def.ports.out.pos[1], def.ports.out.pos[2]],
             dir: [-def.ports.out.dir[0], def.ports.out.dir[1], def.ports.out.dir[2]] },
    },
  }
}

// Full vertical loop, radius 12 (gentle enough for the 3 m wheelbase). The
// ring shifts one cell sideways (helix) so the descending half clears the
// entry road, and the ring road is extra wide (16 m) so the lateral drift is
// forgiving. Footprint: 2×2 cells — entry at this cell's -Z edge, exit one
// cell over in +X at the far +Z edge (local z = +3·H).
function loopSegs() {
  const R = 12, N = 48, SHIFT = CELL, LOOP_W = 16
  const ZC = H   // ring bottom sits on the boundary between the two cells
  const out = []
  // flat lead-in (z: -8 → ring bottom at z=+8)
  out.push(seg([0, 0, 0], 0, 0, 0, CELL + 0.5))
  // linear helix shift, clamped flat near entry/exit so the seams line up
  const PHI0 = 0.6, PHI1 = Math.PI * 2 - 0.6
  const shiftAt = phi => SHIFT * Math.min(1, Math.max(0, (phi - PHI0) / (PHI1 - PHI0)))
  const rate = SHIFT / (PHI1 - PHI0)   // dx/dφ in the linear region
  for (let i = 0; i < N; i++) {
    const phi = ((i + 0.5) / N) * Math.PI * 2
    const pos = [shiftAt(phi), R * (1 - Math.cos(phi)), ZC + R * Math.sin(phi)]
    // helix drift is a LOCAL yaw (applied after pitch) so it always points
    // toward +X regardless of where we are on the ring
    const yawAdj = (phi > PHI0 && phi < PHI1) ? Math.atan2(rate, R) : 0
    out.push(seg(pos, 0, -phi, 0, 2.0, LOOP_W, yawAdj))
  }
  // flat lead-out (ring bottom → z: +24, one cell over in +X)
  out.push(seg([SHIFT, 0, CELL], 0, 0, 0, CELL + 0.5))
  return out
}

const RAMP_RISE = 4
const RAMP_PITCH = -Math.atan2(RAMP_RISE, CELL)
const RAMP_LEN = Math.sqrt(CELL * CELL + RAMP_RISE * RAMP_RISE) + 0.4

const KICK_RISE = 3
const KICK_PITCH = -Math.atan2(KICK_RISE, CELL)
const KICK_LEN = Math.sqrt(CELL * CELL + KICK_RISE * KICK_RISE) + 0.4

const BANK_ROLL = 0.32

const straightDef = {
  segments: [seg([0, 0, 0], 0, 0, 0, CELL + 0.2)],
  ports: { in: { pos: [0, 0, -H], dir: [0, 0, 1] }, out: { pos: [0, 0, H], dir: [0, 0, 1] } },
}

const curveLDef = {
  segments: curveSegs(0),
  ports: { in: { pos: [0, 0, -H], dir: [0, 0, 1] }, out: { pos: [-H, 0, 0], dir: [-1, 0, 0] } },
}

const bankLDef = {
  segments: curveSegs(BANK_ROLL),
  ports: curveLDef.ports,
}

export const PIECES = {
  straight:   straightDef,
  start:      straightDef,
  checkpoint: straightDef,
  finish:     straightDef,
  boost:      straightDef,

  'curve-l': curveLDef,
  'curve-r': mirrorX(curveLDef),
  'bank-l':  bankLDef,
  'bank-r':  mirrorX(bankLDef),

  ramp: {
    segments: [seg([0, RAMP_RISE / 2, 0], 0, RAMP_PITCH, 0, RAMP_LEN)],
    ports: { in: { pos: [0, 0, -H], dir: [0, 0, 1] }, out: { pos: [0, RAMP_RISE, H], dir: [0, 0, 1] } },
  },
  'ramp-down': {
    segments: [seg([0, -RAMP_RISE / 2, 0], 0, -RAMP_PITCH, 0, RAMP_LEN)],
    ports: { in: { pos: [0, 0, -H], dir: [0, 0, 1] }, out: { pos: [0, -RAMP_RISE, H], dir: [0, 0, 1] } },
  },
  // Launch ramp — exits into open air; the following map piece must set gap:true
  kicker: {
    segments: [seg([0, KICK_RISE / 2, 0], 0, KICK_PITCH, 0, KICK_LEN)],
    ports: { in: { pos: [0, 0, -H], dir: [0, 0, 1] }, out: { pos: [0, KICK_RISE, H], dir: [0, 0, 1] } },
  },
  loop: {
    segments: loopSegs(),
    ports: { in: { pos: [0, 0, -H], dir: [0, 0, 1] }, out: { pos: [CELL, 0, H * 3], dir: [0, 0, 1] } },
  },
}

// ── Instance transform + track walking ───────────────────────────────────────
// Transform a local point/dir of a piece instance { x, y, z, r } to world
export function pieceToWorld(p, localPos) {
  const yaw = p.r * (Math.PI / 2)
  const [x, y, z] = rotY(localPos, yaw)
  return [p.x * CELL + x, p.y + y, p.z * CELL + z]
}

export function pieceDirToWorld(p, localDir) {
  return rotY(localDir, p.r * (Math.PI / 2))
}

// World transform for every segment of an instance: { pos, quat, len }
export function pieceSegments(p) {
  const def = PIECES[p.t]
  if (!def) throw new Error(`Unknown piece type "${p.t}"`)
  const yaw = p.r * (Math.PI / 2)
  return def.segments.map(s => ({
    pos: pieceToWorld(p, s.pos),
    quat: segQuat(yaw + s.yaw, s.pitch, s.roll, s.yaw2),
    len: s.len,
    w: s.w,
  }))
}

// Walk a map's piece list (in track order), validating that each piece's entry
// port matches the previous piece's exit port. Pieces with gap:true skip the
// check (jump landings). Returns per-piece world ports + heading.
export function walkTrack(pieces) {
  const result = []
  let prevOut = null

  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    const def = PIECES[p.t]
    if (!def) throw new Error(`Piece ${i}: unknown type "${p.t}"`)

    const inPos  = pieceToWorld(p, def.ports.in.pos)
    const inDir  = pieceDirToWorld(p, def.ports.in.dir)
    const outPos = pieceToWorld(p, def.ports.out.pos)
    const outDir = pieceDirToWorld(p, def.ports.out.dir)

    if (prevOut && !p.gap) {
      const dx = prevOut.pos[0] - inPos[0]
      const dy = prevOut.pos[1] - inPos[1]
      const dz = prevOut.pos[2] - inPos[2]
      const posErr = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const dot = prevOut.dir[0] * inDir[0] + prevOut.dir[1] * inDir[1] + prevOut.dir[2] * inDir[2]
      if (posErr > 0.5 || dot < 0.95) {
        throw new Error(
          `Piece ${i} (${p.t} @ ${p.x},${p.z} r${p.r}): entry [${inPos.map(n => n.toFixed(1))}] ` +
          `dir [${inDir.map(n => n.toFixed(1))}] does not connect to previous exit ` +
          `[${prevOut.pos.map(n => n.toFixed(1))}] dir [${prevOut.dir.map(n => n.toFixed(1))}]`
        )
      }
    }

    const center = [p.x * CELL, p.y, p.z * CELL]
    const yawAngle = Math.atan2(outDir[0], outDir[2])
    result.push({ piece: p, center, yawAngle, in: { pos: inPos, dir: inDir }, out: { pos: outPos, dir: outDir } })
    prevOut = { pos: outPos, dir: outDir }
  }
  return result
}
