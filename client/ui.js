import * as PIXI from 'pixi.js'

// ── Pixi Application (transparent overlay over Three.js canvas) ───────────────
const app = new PIXI.Application({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundAlpha: 0,
  antialias: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
})
Object.assign(app.view.style, {
  position: 'fixed', top: '0', left: '0',
  pointerEvents: 'none', zIndex: '10',
})
document.body.appendChild(app.view)
window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight)
  _layout()
})

const FONT = '"Segoe UI", ui-sans-serif, sans-serif'
const W = () => app.screen.width
const H = () => app.screen.height

// ── Panel helper ──────────────────────────────────────────────────────────────
function mkPanel(label, init, valueColor = 0xffffff, pw = 110) {
  const c  = new PIXI.Container()
  const bg = new PIXI.Graphics()
  bg.beginFill(0x000000, 0.55); bg.lineStyle(1, 0xffffff, 0.12)
  bg.drawRoundedRect(0, 0, pw, 54, 8); bg.endFill()
  const lbl = new PIXI.Text(label, { fontFamily: FONT, fontSize: 10, fill: 0x777777, letterSpacing: 2 })
  lbl.x = pw / 2 - lbl.width / 2; lbl.y = 8
  const val = new PIXI.Text(init,  { fontFamily: FONT, fontSize: 22, fontWeight: 'bold', fill: valueColor })
  val.x = pw / 2 - val.width / 2; val.y = 24
  c.addChild(bg, lbl, val)
  c._val = val; c._pw = pw
  return c
}
function setPV(p, t) { p._val.text = t; p._val.x = p._pw / 2 - p._val.width / 2 }

// ── Info panels ───────────────────────────────────────────────────────────────
const pLap  = mkPanel('LAP',      '1 / 3', 0xffffff, 110)
const pPos  = mkPanel('POSITION', 'P1',    0xf9c74f, 110)
const pLast = mkPanel('LAST LAP', '—',     0xffffff, 124)
const pBest = mkPanel('BEST LAP', '—',     0x00ddff, 124)
pLast.visible = false; pBest.visible = false
app.stage.addChild(pLap, pPos, pLast, pBest)

// ── Timer ─────────────────────────────────────────────────────────────────────
const timerLbl = new PIXI.Text('TIME',    { fontFamily: FONT, fontSize: 10, fill: 0x777777, letterSpacing: 2 })
const timerVal = new PIXI.Text('0:00.00', { fontFamily: FONT, fontSize: 18, fill: 0xdddddd })
timerVal.y = 14
const timerBox = new PIXI.Container()
timerBox.addChild(timerLbl, timerVal)
app.stage.addChild(timerBox)

// ── Arc Speedometer ───────────────────────────────────────────────────────────
const SPD_R = 58
const SPD_S = Math.PI * 0.75   // 135° — left-bottom
const SPD_E = Math.PI * 2.25   // 405° — right-bottom (270° total sweep)
const spdBg   = new PIXI.Graphics()
const spdFill = new PIXI.Graphics()
const spdNum  = new PIXI.Text('0', {
  fontFamily: FONT, fontSize: 52, fontWeight: '900', fill: 0xffffff,
  dropShadow: true, dropShadowAlpha: 0.6, dropShadowBlur: 14, dropShadowDistance: 0,
})
const spdLbl  = new PIXI.Text('KM/H', { fontFamily: FONT, fontSize: 11, fill: 0x888888, letterSpacing: 3 })
spdNum.anchor.set(0.5); spdLbl.anchor.set(0.5)
const spdGrp = new PIXI.Container()
spdGrp.addChild(spdBg, spdFill, spdNum, spdLbl)
app.stage.addChild(spdGrp)

function _drawSpeedo(kmh) {
  const fill = Math.min(kmh / 220, 1)
  spdBg.clear()
  spdBg.lineStyle({ width: 7, color: 0x1a1c2e, alpha: 0.9, cap: 'round' })
  spdBg.moveTo(Math.cos(SPD_S) * SPD_R, Math.sin(SPD_S) * SPD_R)
  spdBg.arc(0, 0, SPD_R, SPD_S, SPD_E)
  spdFill.clear()
  if (fill > 0.003) {
    const col = fill > 0.85 ? 0xff3300 : fill > 0.6 ? 0xffaa00 : 0x00ddff
    spdFill.lineStyle({ width: 7, color: col, alpha: 1, cap: 'round' })
    spdFill.moveTo(Math.cos(SPD_S) * SPD_R, Math.sin(SPD_S) * SPD_R)
    spdFill.arc(0, 0, SPD_R, SPD_S, SPD_S + (SPD_E - SPD_S) * fill)
  }
  spdNum.text = String(kmh)
}

// ── Nitro bar ─────────────────────────────────────────────────────────────────
const NIT_W = 110, NIT_H = 5
const nitBg   = new PIXI.Graphics()
const nitFill = new PIXI.Graphics()
const nitLbl  = new PIXI.Text('NITRO', { fontFamily: FONT, fontSize: 9, fill: 0x555566, letterSpacing: 2 })
nitLbl.y = 8
const nitGrp = new PIXI.Container()
nitGrp.addChild(nitBg, nitFill, nitLbl)
app.stage.addChild(nitGrp)

function _drawNitro(level, active) {
  nitBg.clear(); nitBg.beginFill(0x0a0a1a, 0.7); nitBg.drawRoundedRect(0, 0, NIT_W, NIT_H, 3); nitBg.endFill()
  nitFill.clear()
  if (level > 0.005) {
    nitFill.beginFill(active ? 0xff7700 : 0x00ddff)
    nitFill.drawRoundedRect(0, 0, NIT_W * level, NIT_H, 3); nitFill.endFill()
  }
}

// ── Announcement text ─────────────────────────────────────────────────────────
const annTxt = new PIXI.Text('', {
  fontFamily: FONT, fontSize: 88, fontWeight: '900', fill: 0xffffff,
  stroke: 0x000000, strokeThickness: 6,
  dropShadow: true, dropShadowColor: 0xff7800,
  dropShadowAlpha: 0.9, dropShadowBlur: 32, dropShadowDistance: 0,
  align: 'center',
})
annTxt.anchor.set(0.5); annTxt.visible = false
app.stage.addChild(annTxt)
let _annTimer = null, _annTick = null

// ── Circular minimap ──────────────────────────────────────────────────────────
const MM_R = 64, MM_S = 0.9
const mmBg    = new PIXI.Graphics()
const mmTrack = new PIXI.Graphics()
const mmDots  = new PIXI.Graphics()
mmBg.beginFill(0x000000, 0.55); mmBg.drawCircle(0, 0, MM_R); mmBg.endFill()

const mmInner = new PIXI.Container()
mmInner.addChild(mmBg, mmTrack, mmDots)

const mmMask = new PIXI.Graphics()
mmMask.beginFill(0xffffff); mmMask.drawCircle(0, 0, MM_R); mmMask.endFill()
mmInner.addChild(mmMask)
mmInner.mask = mmMask

const mmBorder = new PIXI.Graphics()
mmBorder.lineStyle(1, 0xffffff, 0.2); mmBorder.drawCircle(0, 0, MM_R)

const mmWrap = new PIXI.Container()
mmWrap.addChild(mmInner, mmBorder)
app.stage.addChild(mmWrap)

// ── Controls hint ─────────────────────────────────────────────────────────────
const hintTxt = new PIXI.Text(
  'W/↑ Throttle  S/↓ Brake  A/← D/→ Steer  Space Handbrake  Shift Nitro',
  { fontFamily: FONT, fontSize: 11, fill: 0xffffff, alpha: 0.35 }
)
app.stage.addChild(hintTxt)

// ── Traffic lights (Pixi — replaces HTML divs) ────────────────────────────────
const TL_N = 5, TL_R = 17, TL_GAP = 14, TL_PX = 18, TL_PY = 14
const tlW = TL_N * (TL_R * 2) + (TL_N - 1) * TL_GAP + TL_PX * 2
const tlH = TL_R * 2 + TL_PY * 2

const tlGrp = new PIXI.Container()
const tlHse = new PIXI.Graphics()
tlHse.beginFill(0x111111); tlHse.lineStyle(3, 0x333333)
tlHse.drawRoundedRect(0, 0, tlW, tlH, 13); tlHse.endFill()
tlGrp.addChild(tlHse)

const _tll = [], _tlg = []
for (let i = 0; i < TL_N; i++) {
  const cx = TL_PX + TL_R + i * (TL_R * 2 + TL_GAP)
  const cy = TL_PY + TL_R
  const gw = new PIXI.Graphics()
  gw.beginFill(0xff2200, 0.55); gw.drawCircle(cx, cy, TL_R * 2.2); gw.endFill()
  gw.filters = [new PIXI.filters.BlurFilter(16)]
  gw.alpha = 0
  const lg = new PIXI.Graphics()
  lg._cx = cx; lg._cy = cy
  tlGrp.addChild(gw, lg)
  _tlg.push(gw); _tll.push(lg)
  _litLight(lg, false)   // function-declaration hoisting makes this safe
}
tlGrp.visible = false
app.stage.addChild(tlGrp)

function _litLight(g, on) {
  g.clear()
  g.beginFill(on ? 0xff1a00 : 0x2a0000); g.lineStyle(2, 0x444444)
  g.drawCircle(g._cx, g._cy, TL_R); g.endFill()
}

// ── Layout (called on init and resize) ────────────────────────────────────────
function _layout() {
  const w = W(), h = H()

  // panels — centred at top
  const active = [pLap, pPos, pLast.visible ? pLast : null, pBest.visible ? pBest : null].filter(Boolean)
  const gap = 10
  const totalW = active.reduce((s, p) => s + p._pw, 0) + gap * (active.length - 1)
  let px = w / 2 - totalW / 2
  active.forEach(p => { p.x = px; p.y = 20; px += p._pw + gap })

  // timer — top right
  timerBox.x = w - 28 - Math.max(timerLbl.width, timerVal.width); timerBox.y = 20

  // arc speedo — bottom right
  spdGrp.x = w - 100; spdGrp.y = h - 92
  spdNum.y = -12; spdLbl.y = 32

  // nitro bar — bottom right, just below speedo area
  nitGrp.x = w - 100 - NIT_W / 2; nitGrp.y = h - 32

  // announcement — screen centre
  annTxt.x = w / 2; annTxt.y = h * 0.38

  // minimap — bottom left
  mmWrap.x = MM_R + 28; mmWrap.y = h - MM_R - 28

  // controls hint — bottom left
  hintTxt.x = 20; hintTxt.y = h - hintTxt.height - 16

  // traffic lights — top centre
  tlGrp.x = w / 2 - tlW / 2; tlGrp.y = 60
}
_layout()

// ── Exported API ──────────────────────────────────────────────────────────────

export function updateHUD({ speedKmh, lapText, posText, timerText, nitroLevel, nitroActive }) {
  _drawSpeedo(speedKmh)
  spdLbl.y = 32   // stable anchor after text resize
  setPV(pLap, lapText)
  setPV(pPos, posText)
  _drawNitro(nitroLevel, nitroActive)
  timerVal.text = timerText
  timerBox.x = W() - 28 - Math.max(timerLbl.width, timerVal.width)
}

export function setLastLap(text) {
  pLast.visible = true; setPV(pLast, text); _layout()
}

export function setBestLap(text) {
  pBest.visible = true; setPV(pBest, text); _layout()
}

export function showAnn(text, ms = 1200) {
  if (_annTick) { app.ticker.remove(_annTick); _annTick = null }
  if (_annTimer) { clearTimeout(_annTimer); _annTimer = null }
  annTxt.text = text; annTxt.visible = true; annTxt.scale.set(1.35)
  _annTick = delta => {
    const s = annTxt.scale.x + (1.0 - annTxt.scale.x) * (0.18 * delta)
    annTxt.scale.set(s)
    if (Math.abs(s - 1) < 0.003) { annTxt.scale.set(1); app.ticker.remove(_annTick); _annTick = null }
  }
  app.ticker.add(_annTick)
  if (ms > 0) _annTimer = setTimeout(() => { annTxt.visible = false }, ms)
}

export function initMinimapWaypoints(waypoints) {
  mmTrack.clear()
  mmTrack.lineStyle(3, 0xffffff, 0.45)
  waypoints.forEach((wp, i) => {
    i === 0 ? mmTrack.moveTo(wp.x * MM_S, wp.z * MM_S) : mmTrack.lineTo(wp.x * MM_S, wp.z * MM_S)
  })
  if (waypoints.length) mmTrack.lineTo(waypoints[0].x * MM_S, waypoints[0].z * MM_S)
}

export function updateMinimap(playerPos, botsPos) {
  mmDots.clear()
  const colors = [0xef5350, 0x66bb6a, 0xffa726]
  botsPos.forEach((p, i) => {
    mmDots.beginFill(colors[i]); mmDots.drawCircle(p.x * MM_S, p.z * MM_S, 3.5); mmDots.endFill()
  })
  mmDots.beginFill(0x42a5f5); mmDots.drawCircle(playerPos.x * MM_S, playerPos.z * MM_S, 5.5); mmDots.endFill()
}

export function runTrafficLights(onGo) {
  tlGrp.visible = true
  let lit = 0
  function step() {
    if (lit < TL_N) {
      _litLight(_tll[lit], true); _tlg[lit].alpha = 1
      lit++; setTimeout(step, 800)
    } else {
      setTimeout(() => {
        for (let i = 0; i < TL_N; i++) { _litLight(_tll[i], false); _tlg[i].alpha = 0 }
        setTimeout(() => { tlGrp.visible = false; onGo() }, 260)
      }, 500 + Math.random() * 700)
    }
  }
  step()
}
