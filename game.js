// 広告で見たあのピン抜き。描画・画面・音・入力。物理は engine.js、面は levels.js、文言は data.js
;(function () {
  'use strict'
  window.__jsUp = true
  const E = window.PinEngine, LV = window.LEVELS
  const { WATER, LAVA, COIN, STONE } = E
  const $ = id => document.getElementById(id)
  const URL0 = 'https://tom3games.github.io/pin-rescue/'
  const Q = new URLSearchParams(location.search)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {} },
  }
  let lang = store.get('pinr_lang', null) || ((navigator.language || 'ja').indexOf('ja') === 0 ? 'ja' : 'en')
  let T = TXT[lang]
  const coarse = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window

  // ---- 状態
  const cv = $('stage'), ctx = cv.getContext('2d')
  let dpr = 1, VW = 0, VH = 0
  const view = { s: 1, ox: 0, oy: 0 }, target = { s: 1, ox: 0, oy: 0 }
  let mode = 'boot', world = null, lvIdx = 0, paused = false
  let acc = 0, lastT = performance.now(), clock = 0
  let bg = null
  const fx = []
  let bubble = null, shake = 0, sheetOn = false, tutorOn = false, hintPin = null
  let best = store.get('pinr_best', 0)
  const fails = store.get('pinr_fails', {})
  let sessionFails = 0, totalFails = store.get('pinr_totalFails', 0)
  let demo = null
  let muted = store.get('pinr_mute', false)

  // ---- 音（録音素材だけ）
  Snd.def({
    pin: ['snd/pin1.mp3', 'snd/pin2.mp3', 'snd/pin3.mp3'], splash: ['snd/splash1.mp3', 'snd/splash2.mp3', 'snd/splash3.mp3'],
    steam: ['snd/steam1.mp3', 'snd/steam2.mp3'], stone: ['snd/stone1.mp3', 'snd/stone2.mp3', 'snd/stone3.mp3'],
    coin: ['snd/coin1.mp3', 'snd/coin2.mp3', 'snd/coin3.mp3'], get: ['snd/get1.mp3', 'snd/get2.mp3', 'snd/get3.mp3'],
    grunt: ['snd/grunt1.mp3', 'snd/grunt2.mp3', 'snd/grunt3.mp3'], bub: ['snd/bub1.mp3', 'snd/bub2.mp3', 'snd/bub3.mp3'],
    boom: 'snd/boom.mp3', crack: 'snd/crack.mp3', scream: ['snd/scream1.mp3', 'snd/scream2.mp3'],
    j_win: 'snd/j_win.mp3', j_lose: 'snd/j_lose.mp3', j_end: 'snd/j_end.mp3', click: 'snd/click.mp3', squeak: 'snd/squeak.mp3',
  })
  Snd.muted = muted
  let audioOn = false, lavaLoop = false
  function audioStart() {
    if (audioOn) { Snd.init(); return }
    audioOn = true; Snd.init(); Snd.setMute(muted)
    Snd.loop('amb', 'snd/amb_cave.mp3', 0.32)
    Snd.loop('bgm', 'snd/bgm.mp3', 0.15)
  }
  const thr = {}
  function play(name, o, gap) { const n = performance.now(); if (gap && thr[name] && n - thr[name] < gap) return; thr[name] = n; if (mode === 'play' || o && o.ui) Snd.play(name, o || {}) }

  // ---- 乱数（見た目用。物理は使わない）
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  const pick = a => a[Math.floor(Math.random() * a.length)]

  // ---- 配置
  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1); VW = innerWidth; VH = innerHeight
    cv.width = Math.round(VW * dpr); cv.height = Math.round(VH * dpr)
    calcTarget(); Object.assign(view, target); bg = null
  }
  function calcTarget() {
    let top = 0, bottom = 0
    if (mode === 'play') {
      const hud = document.querySelector('.hud'); top = hud.getBoundingClientRect().bottom + 2; bottom = 6
      if (sheetOn) bottom = Math.max(bottom, VH - $('sheet').getBoundingClientRect().top + 4)
    } else if (mode === 'title') { top = document.querySelector('.logo').getBoundingClientRect().bottom + 4; bottom = VH - $('bStart').getBoundingClientRect().top + 14 }
    else { top = 0; bottom = 0 }
    const aw = VW - 8, ah = Math.max(120, VH - top - bottom)
    const s = Math.min(aw / E.W, ah / E.H)
    target.s = s; target.ox = (VW - E.W * s) / 2; target.oy = mode === 'play' ? top + Math.min(10, (ah - E.H * s) / 2) : top + (ah - E.H * s) / 2
  }

  // ---- 絵: 背景と壁（面ごとに1回）
  function drawStatic(c, w, k, seed) {
    const R = rng(seed + 7)
    c.save()
    c.fillStyle = '#3a2e25'; c.fillRect(0, 0, E.W, E.H)
    // 奥の壁のレンガ
    for (let y = 0, row = 0; y < E.H; y += 22, row++) {
      for (let x = (row % 2) * -20; x < E.W; x += 40) {
        const v = R(); c.fillStyle = `rgb(${56 + v * 14 | 0},${45 + v * 11 | 0},${36 + v * 8 | 0})`
        c.fillRect(x + 1, y + 1, 38, 20)
      }
    }
    // たいまつの明かり
    for (const [tx, ty] of w.def.torches || [[60, 90], [300, 380]]) {
      const g = c.createRadialGradient(tx, ty, 4, tx, ty, 130); g.addColorStop(0, 'rgba(255,170,80,.30)'); g.addColorStop(1, 'rgba(255,170,80,0)')
      c.fillStyle = g; c.fillRect(tx - 130, ty - 130, 260, 260)
    }
    // 壁
    for (const P of w.polys) if (P.kind === 'wall') drawStone(c, P, R, false)
    // 下の方を少し暗く
    const v = c.createLinearGradient(0, 0, 0, E.H); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.22)')
    c.fillStyle = v; c.fillRect(0, 0, E.W, E.H)
    c.restore()
  }
  function polyPath(c, P) { c.beginPath(); P.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath() }
  function drawStone(c, P, R, cracked) {
    c.save(); polyPath(c, P); c.fillStyle = cracked ? '#a8957a' : '#85745f'; c.fill(); c.clip()
    const x0 = Math.max(-10, P.x0), x1 = Math.min(E.W + 10, P.x1), y0 = Math.max(-10, P.y0), y1 = Math.min(E.H + 10, P.y1)
    for (let y = Math.floor(y0 / 18) * 18, row = 0; y < y1; y += 18, row++) {
      for (let x = Math.floor(x0 / 32) * 32 - (Math.floor(y / 18) % 2) * 16; x < x1; x += 32) {
        const v = R(); c.fillStyle = cracked ? `rgb(${160 + v * 20 | 0},${142 + v * 18 | 0},${116 + v * 14 | 0})` : `rgb(${118 + v * 24 | 0},${103 + v * 20 | 0},${84 + v * 16 | 0})`
        c.fillRect(x + 1.2, y + 1.2, 29.6, 15.6)
        c.fillStyle = 'rgba(255,240,210,.10)'; c.fillRect(x + 1.2, y + 1.2, 29.6, 2.4)
      }
    }
    if (cracked) {
      c.strokeStyle = '#3b2c1e'; c.lineWidth = 1.6; c.beginPath()
      const cx = (P.x0 + P.x1) / 2, cy = (P.y0 + P.y1) / 2
      c.moveTo(cx - 2, P.y0); c.lineTo(cx + 5, cy - 8); c.lineTo(cx - 4, cy + 2); c.lineTo(cx + 3, P.y1)
      c.moveTo(cx + 5, cy - 8); c.lineTo(P.x1, cy - 14); c.moveTo(cx - 4, cy + 2); c.lineTo(P.x0, cy + 10); c.stroke()
    }
    c.restore()
    // 上を向いた面は明るく、輪郭は濃く
    c.save(); polyPath(c, P); c.strokeStyle = '#211910'; c.lineWidth = 2.4; c.lineJoin = 'round'; c.stroke()
    c.strokeStyle = cracked ? '#d8c6a6' : '#bba98c'; c.lineWidth = 2
    for (const e of P.edges) if (e.ny < -0.5) { c.beginPath(); c.moveTo(e.ax - e.nx * 2, e.ay - e.ny * 2); c.lineTo(e.bx - e.nx * 2, e.by - e.ny * 2); c.stroke() }
    c.restore()
  }
  function makeBg(w) {
    const k = Math.max(1, view.s * dpr), c = document.createElement('canvas')
    c.width = Math.ceil(E.W * k); c.height = Math.ceil(E.H * k)
    const g = c.getContext('2d'); g.scale(k, k); drawStatic(g, w, k, w.def.seed || lvIdx * 31 + 3)
    return { c, w }
  }

  // ---- 絵: 動く物
  function drawParts(c, w, t) {
    const P = w.parts, surf = new Set(), SC = 11
    for (const p of P) if (p.alive && (p.t === WATER || p.t === LAVA)) surf.add(p.t * 1e6 + ((p.x / SC) | 0) * 1000 + ((p.y / SC) | 0))
    const isTop = p => !surf.has(p.t * 1e6 + ((p.x / SC) | 0) * 1000 + (((p.y - SC) / SC) | 0))
    const layer = (type, r, color) => {
      c.beginPath(); for (const p of P) if (p.alive && p.t === type) { c.moveTo(p.x + r, p.y); c.arc(p.x, p.y, r, 0, 6.2832) } c.fillStyle = color; c.fill()
      if (type > LAVA) return
      // 落ちている水と溶岩は尾を引かせて、粒でなく流れに見せる
      c.beginPath(); for (const p of P) if (p.alive && p.t === type && p.px != null) { const dx = p.x - p.px, dy = p.y - p.py; if (dx * dx + dy * dy > 2.2) { c.moveTo(p.x, p.y); c.lineTo(p.x - dx * 4, p.y - dy * 4) } }
      c.strokeStyle = color; c.lineWidth = r * 2; c.lineCap = 'round'; c.stroke()
    }
    // 溶岩の光
    c.save(); c.globalCompositeOperation = 'lighter'; layer(LAVA, 12, 'rgba(255,90,0,.07)'); c.restore()
    layer(STONE, 6.4, '#241c16'); layer(STONE, 5.1, '#7d7266')
    c.beginPath(); for (const p of P) if (p.alive && p.t === STONE) { c.moveTo(p.x - 1 + 1.8, p.y - 1.6); c.arc(p.x - 1, p.y - 1.6, 1.8, 0, 6.2832) } c.fillStyle = '#a69b8d'; c.fill()
    layer(WATER, 7.6, '#17508e'); layer(WATER, 6.2, '#3d97e3')
    c.beginPath(); for (const p of P) if (p.alive && p.t === WATER && isTop(p)) { c.moveTo(p.x + 3.4, p.y - 2.5); c.arc(p.x, p.y - 2.5, 3.4, 0, 6.2832) } c.fillStyle = '#9fd4ff'; c.fill()
    layer(LAVA, 7.6, '#7c1804'); layer(LAVA, 6.2, '#f2520f')
    c.beginPath(); for (const p of P) if (p.alive && p.t === LAVA) { const r = 2.4 + 1.2 * Math.sin(t * 3 + p.id); c.moveTo(p.x + r, p.y); c.arc(p.x, p.y, r, 0, 6.2832) } c.fillStyle = '#ffb53a'; c.fill()
    // 金貨
    layer(COIN, 6.9, '#6e4a00'); layer(COIN, 5.7, '#f2c230')
    c.lineWidth = 1.1; c.strokeStyle = '#c68a10'; c.beginPath(); for (const p of P) if (p.alive && p.t === COIN && !p.button) { c.moveTo(p.x + 3.4, p.y); c.arc(p.x, p.y, 3.4, 0, 6.2832) } c.stroke()
    c.fillStyle = '#fff6c9'; c.beginPath(); for (const p of P) if (p.alive && p.t === COIN) { c.moveTo(p.x - 2 + 1.3, p.y - 2.4); c.arc(p.x - 2, p.y - 2.4, 1.3, 0, 6.2832) } c.fill()
    for (const p of P) if (p.alive && p.button) {   // まれにボタンが混ざる
      c.fillStyle = '#d9cdb8'; c.beginPath(); c.arc(p.x, p.y, 5.7, 0, 6.2832); c.fill()
      c.fillStyle = '#6b5d4f'; for (const [a, b] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { c.beginPath(); c.arc(p.x + a, p.y + b, 0.9, 0, 6.2832); c.fill() }
    }
  }
  function drawPins(c, w, t) {
    for (const p of w.pins) {
      if (p.gone) continue
      const [ax, ay, bx, by] = E.pinSeg(p), nx = -p.uy, ny = p.ux
      const hx = bx + p.ux * 9, hy = by + p.uy * 9
      c.save(); c.lineCap = 'round'
      if (hintPin === p.id && !p.pulling) {
        c.strokeStyle = `rgba(255,246,200,${0.35 + 0.3 * Math.sin(t * 6)})`; c.lineWidth = 24
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.beginPath(); c.arc(hx, hy, 12, 0, 6.2832); c.stroke()
      }
      c.strokeStyle = '#3a2706'; c.lineWidth = 13.5; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke()
      c.strokeStyle = '#d9a131'; c.lineWidth = 9.5; c.stroke()
      c.strokeStyle = '#ffeaa0'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(ax + nx * -2.2, ay + ny * -2.2); c.lineTo(bx + nx * -2.2, by + ny * -2.2); c.stroke()
      c.strokeStyle = '#3a2706'; c.lineWidth = 8.5; c.beginPath(); c.arc(hx, hy, 9, 0, 6.2832); c.stroke()
      c.strokeStyle = '#e8b43e'; c.lineWidth = 4.4; c.stroke()
      c.strokeStyle = '#fff1b8'; c.lineWidth = 1.4; c.beginPath(); c.arc(hx, hy, 9, 3.6, 5.2); c.stroke()
      c.restore()
    }
  }
  function sline(c, pts, wOut, wIn, colIn) {   // 輪郭つきの太い線（腕）
    c.lineCap = 'round'; c.lineJoin = 'round'
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))
    c.strokeStyle = '#1b130c'; c.lineWidth = wOut; c.stroke(); c.strokeStyle = colIn; c.lineWidth = wIn; c.stroke()
  }
  function shape(c, fill, f, lw) { c.beginPath(); f(); c.fillStyle = fill; c.fill(); c.lineWidth = lw || 1.6; c.strokeStyle = '#1b130c'; c.stroke() }
  function drawHero(c, h, t, win) {
    const dead = h.dead, how = h.how, dt = dead ? t - h.deadT : 0
    const mode = dead ? 'dead' : win ? 'win' : h.fear > 0.35 ? 'fear' : h.joy > 0.15 ? 'joy' : h.wet > 0.2 ? 'wet' : 'idle'
    const char = dead && (how === 'lava' || how === 'bomb')
    const skin = char ? '#3b322c' : '#f0bf8c', shirt = char ? '#302824' : '#f6f1e6', shorts = char ? '#28211d' : '#9a8453', boot = char ? '#1d1815' : '#5a3b22'
    c.save(); c.translate(h.x, h.y)
    let jy = 0, sx = 0
    if (mode === 'fear') sx = Math.sin(t * 55) * 1.3 * h.fear
    if (mode === 'win') jy = -Math.abs(Math.sin(t * 6)) * 12
    if (mode === 'joy') jy = -Math.abs(Math.sin(t * 10)) * 3
    if (mode === 'idle') jy = Math.sin(t * 2.4) * 0.5
    if (dead && how === 'bomb') jy = -Math.max(0, Math.sin(Math.min(1, dt * 2) * Math.PI)) * 18
    c.translate(sx, jy)
    if (dead && how === 'monster') { const a = Math.min(1, dt * 5); c.translate(0, -2); c.rotate(-a * 1.45); c.translate(a * 6, 0) }
    // 足
    shape(c, boot, () => { c.roundRect(-11, -6, 9, 6, 2); c.roundRect(2, -6, 9, 6, 2) })
    shape(c, skin, () => { c.rect(-8, -12, 5, 6); c.rect(3, -12, 5, 6) })
    shape(c, shorts, () => { c.roundRect(-11, -20, 22, 9, 2) })
    // 腕（ポーズで変える）
    const arms = mode === 'fear' ? [[[-10, -33], [-15, -42], [-10, -51]], [[10, -33], [15, -42], [10, -51]]]
      : mode === 'joy' || mode === 'win' ? [[[-10, -33], [-18, -44], [-21, -56]], [[10, -33], [18, -44], [21, -56]]]
        : mode === 'wet' ? [[[-10, -33], [-4, -27], [6, -30]], [[10, -33], [4, -27], [-6, -30]]]
          : dead && how === 'monster' ? [[[-10, -33], [-20, -38], [-27, -36]], [[10, -33], [19, -26], [24, -22]]]
            : [[[-10, -33], [-14, -26], [-14, -19]], [[10, -33], [14, -26], [14, -19]]]
    // 胴（タンクトップとお腹）
    shape(c, shirt, () => { c.moveTo(-9, -37); c.quadraticCurveTo(-13, -26, -11, -19); c.lineTo(11, -19); c.quadraticCurveTo(14, -27, 9, -37); c.closePath() })
    if (!char) { c.strokeStyle = '#d8cfbf'; c.lineWidth = 1; c.beginPath(); c.moveTo(-5, -37); c.lineTo(-4, -31); c.moveTo(5, -37); c.lineTo(4, -31); c.stroke() }
    for (const a of arms) { sline(c, a, 6.6, 3.8, skin); shape(c, skin, () => c.arc(a[2][0], a[2][1], 2.8, 0, 6.2832), 1.3) }
    // 頭
    const hy = -47
    shape(c, skin, () => { c.arc(-11.5, hy + 1, 2.6, 0, 6.2832); c.moveTo(14.1, hy + 1); c.arc(11.5, hy + 1, 2.6, 0, 6.2832) })
    shape(c, skin, () => c.arc(0, hy, 11.5, 0, 6.2832))
    if (dead && how === 'bomb') {   // 爆発頭
      shape(c, '#1c1714', () => { for (let i = 0; i < 7; i++) { const a = Math.PI + i * Math.PI / 6; c.moveTo(Math.cos(a) * 11 + 5, hy - 3 + Math.sin(a) * 11); c.arc(Math.cos(a) * 11, hy - 3 + Math.sin(a) * 11, 5, 0, 6.2832) } })
    } else {
      // 探検帽（溶岩だと飛んでいく）
      c.save(); if (dead && how === 'lava') { c.translate(4, -Math.min(34, dt * 60)); c.rotate(Math.min(0.6, dt)) }
      shape(c, '#c9b07a', () => c.ellipse(0, hy - 4, 17, 3.6, 0, 0, 6.2832))
      shape(c, '#dcc590', () => { c.arc(0, hy - 4.5, 12, Math.PI, 0); c.closePath() })
      c.fillStyle = '#6b4a2a'; c.fillRect(-11.6, hy - 7.2, 23.2, 2.8)
      c.restore()
    }
    // 顔
    const ey = hy + 1, blink = !dead && (t % 3.3) < 0.12
    c.lineCap = 'round'; c.strokeStyle = '#1b130c'; c.fillStyle = '#1b130c'
    if (dead && (how === 'monster')) {
      c.lineWidth = 1.6; c.beginPath(); for (const ex of [-4.5, 4.5]) { c.moveTo(ex - 2, ey - 2); c.lineTo(ex + 2, ey + 2); c.moveTo(ex + 2, ey - 2); c.lineTo(ex - 2, ey + 2) } c.stroke()
    } else if (char) {
      c.fillStyle = '#fff'; for (const ex of [-4.5, 4.5]) { c.beginPath(); c.arc(ex, ey, (t * 2 % 2) < 0.1 ? 0.4 : 2.2, 0, 6.2832); c.fill() }
    } else if (mode === 'joy' || mode === 'win') {
      c.lineWidth = 1.8; c.beginPath(); for (const ex of [-4.5, 4.5]) { c.moveTo(ex - 2.6, ey + 1); c.quadraticCurveTo(ex, ey - 3, ex + 2.6, ey + 1) } c.stroke()
    } else if (mode === 'wet') {
      c.lineWidth = 1.6; c.beginPath(); c.moveTo(-7, ey - 2); c.lineTo(-3, ey); c.lineTo(-7, ey + 2); c.moveTo(7, ey - 2); c.lineTo(3, ey); c.lineTo(7, ey + 2); c.stroke()
    } else if (blink) {
      c.lineWidth = 1.5; c.beginPath(); c.moveTo(-7, ey); c.lineTo(-2, ey); c.moveTo(2, ey); c.lineTo(7, ey); c.stroke()
    } else {
      const big = mode === 'fear' ? 3.6 : 2.7, pr = mode === 'fear' ? 0.9 : 1.5
      for (const ex of [-4.5, 4.5]) { shape(c, '#fff', () => c.arc(ex, ey, big, 0, 6.2832), 1.1); c.fillStyle = '#1b130c'; c.beginPath(); c.arc(ex + (mode === 'fear' ? 0 : 0.6), ey + 0.3, pr, 0, 6.2832); c.fill() }
      if (mode === 'fear') { c.lineWidth = 1.5; c.beginPath(); c.moveTo(-8, ey - 6); c.lineTo(-2, ey - 7.5); c.moveTo(8, ey - 6); c.lineTo(2, ey - 7.5); c.stroke() }
    }
    // 鼻とひげ
    if (!char) shape(c, '#e3a473', () => c.arc(0, hy + 5, 2.4, 0, 6.2832), 1.1)
    c.fillStyle = char ? '#0f0c0a' : '#2a1a10'
    c.beginPath(); c.moveTo(0, hy + 6.5); c.bezierCurveTo(-4, hy + 5, -9, hy + 6, -11, hy + 9.5); c.bezierCurveTo(-12, hy + 11, -13.5, hy + 10, -13, hy + 8.4)
    c.bezierCurveTo(-11, hy + 12, -5, hy + 11, 0, hy + 9.4); c.bezierCurveTo(5, hy + 11, 11, hy + 12, 13, hy + 8.4); c.bezierCurveTo(13.5, hy + 10, 12, hy + 11, 11, hy + 9.5); c.bezierCurveTo(9, hy + 6, 4, hy + 5, 0, hy + 6.5); c.fill()
    // 口
    const my = hy + 12.4
    if (mode === 'fear' || (dead && how !== 'bomb')) { c.fillStyle = '#5a1410'; c.beginPath(); c.ellipse(0, my + 0.6, 2.6, 3.2, 0, 0, 6.2832); c.fill() }
    else if (mode === 'joy' || mode === 'win') { c.fillStyle = '#7a1f16'; c.beginPath(); c.moveTo(-4.5, my - 1); c.quadraticCurveTo(0, my + 5.5, 4.5, my - 1); c.closePath(); c.fill() }
    // 汗・しずく・煙
    if (mode === 'fear') { c.fillStyle = '#7cc6ff'; c.beginPath(); c.moveTo(14, hy - 6); c.quadraticCurveTo(17.5, hy - 1, 14, hy); c.quadraticCurveTo(10.5, hy - 1, 14, hy - 6); c.fill() }
    if (mode === 'wet') { c.fillStyle = '#7cc6ff'; for (let i = 0; i < 3; i++) { const yy = hy - 8 + ((t * 30 + i * 9) % 26); c.beginPath(); c.arc(-14 + i * 14, yy, 1.4, 0, 6.2832); c.fill() } }
    if (char) { c.fillStyle = 'rgba(70,64,60,.55)'; for (let i = 0; i < 4; i++) { const k = (t * 0.7 + i * 0.25) % 1; c.beginPath(); c.arc(-6 + i * 4 + Math.sin(k * 7 + i) * 3, hy - 14 - k * 30, 3 + k * 6, 0, 6.2832); c.fill() } }
    c.restore()
  }
  function drawMonster(c, b, t, ghost) {
    c.save(); c.translate(b.x, b.y)
    if (ghost) { c.globalAlpha = ghost.a; if (ghost.rot) c.rotate(ghost.rot) }
    c.scale(b.face < 0 ? -1 : 1, 1)
    const walk = !ghost && b.ground ? Math.sin(t * 12) : 0
    const body = ghost && ghost.how === 'drown' ? '#5b86a8' : ghost && ghost.how === 'burn' ? '#2c2522' : '#4f8a62'
    const belly = ghost && ghost.how === 'drown' ? '#9cc0d8' : ghost && ghost.how === 'burn' ? '#3a322e' : '#9bc785'
    shape(c, '#22301f', () => { c.ellipse(-7, 13 + Math.max(0, walk), 4.5, 2.6, 0, 0, 6.2832); c.moveTo(11.5, 13); c.ellipse(7, 13 + Math.max(0, -walk), 4.5, 2.6, 0, 0, 6.2832) })
    shape(c, '#eadfc4', () => { c.moveTo(-9, -10); c.lineTo(-12, -20); c.lineTo(-3, -13); c.moveTo(3, -14); c.lineTo(8, -22); c.lineTo(10, -11) }, 1.3)
    shape(c, body, () => c.ellipse(0, 0 - Math.abs(walk) * 0.8, 16, 14, 0, 0, 6.2832))
    c.fillStyle = belly; c.beginPath(); c.ellipse(3, 5, 9, 6.5, 0, 0, 6.2832); c.fill()
    const dead = !!ghost
    for (const ex of [1, 9]) {
      if (dead) { c.strokeStyle = '#1b130c'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(ex - 2, -6); c.lineTo(ex + 2, -2); c.moveTo(ex + 2, -6); c.lineTo(ex - 2, -2); c.stroke(); continue }
      shape(c, '#fff8e6', () => c.arc(ex, -4, 3.6, 0, 6.2832), 1.1); c.fillStyle = '#7a1010'; c.beginPath(); c.arc(ex + 1, -3.6, 1.7, 0, 6.2832); c.fill()
    }
    if (!dead) { c.strokeStyle = '#1b130c'; c.lineWidth = 2.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(-3, -10); c.lineTo(5, -7); c.moveTo(13, -9.5); c.lineTo(7, -7); c.stroke() }
    c.fillStyle = '#2a0f0c'; c.beginPath(); c.moveTo(-3, 3); c.quadraticCurveTo(6, 10, 14, 2); c.closePath(); c.fill()
    c.fillStyle = '#fff8e6'; c.beginPath(); c.moveTo(0, 3.6); c.lineTo(2, 7); c.lineTo(4, 4.4); c.moveTo(9, 4.4); c.lineTo(11, 7); c.lineTo(12.5, 3.2); c.fill()
    if (b.tie) {   // まれに来る、ネクタイの魔物
      c.strokeStyle = '#1b130c'; c.lineWidth = 1.2; c.beginPath(); c.arc(1, -4, 4.6, 0, 6.2832); c.moveTo(13.6, -4); c.arc(9, -4, 4.6, 0, 6.2832); c.moveTo(5.6, -4); c.lineTo(4.4, -4); c.stroke()
      shape(c, '#8b2a2a', () => { c.moveTo(4, 9); c.lineTo(7, 9); c.lineTo(8, 17); c.lineTo(5.5, 20); c.lineTo(3, 17); c.closePath() }, 1.1)
    }
    c.restore()
  }
  function drawBomb(c, b, t) {
    c.save(); c.translate(b.x, b.y)
    shape(c, '#2a2a2f', () => c.arc(0, 0, 11, 0, 6.2832), 1.8)
    if (b.lit >= 0) { c.fillStyle = `rgba(230,40,20,${0.25 + 0.25 * Math.sin(t * 40)})`; c.beginPath(); c.arc(0, 0, 10, 0, 6.2832); c.fill() }
    c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(-4, -4, 3.6, 0, 6.2832); c.fill()
    shape(c, '#8a8a90', () => c.rect(-4, -14, 8, 4.5), 1.3)
    c.strokeStyle = '#7a5a33'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -14); c.quadraticCurveTo(7, -19, 3, -25); c.stroke()
    if (b.lit >= 0) {
      const f = 3 + Math.random() * 3; c.fillStyle = '#ffe36a'; c.beginPath()
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? f * 0.4 : f; c.lineTo(3 + Math.cos(a) * r, -25 + Math.sin(a) * r) } c.closePath(); c.fill()
    }
    c.restore()
  }
  function drawFx(c, t) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], k = (t - f.t0) / f.life
      if (k >= 1) { fx.splice(i, 1); continue }
      if (f.k === 'puff') { c.fillStyle = `rgba(${f.col},${(1 - k) * f.a})`; c.beginPath(); c.arc(f.x + f.vx * k, f.y + f.vy * k, f.r * (0.6 + k), 0, 6.2832); c.fill() }
      else if (f.k === 'spark') {
        const x = f.x + f.vx * k, y = f.y + f.vy * k - 20 * k, r = 4 * (1 - k)
        c.fillStyle = '#fff3a0'; c.beginPath(); c.moveTo(x, y - r * 2); c.lineTo(x + r * 0.5, y - r * 0.5); c.lineTo(x + r * 2, y); c.lineTo(x + r * 0.5, y + r * 0.5); c.lineTo(x, y + r * 2); c.lineTo(x - r * 0.5, y + r * 0.5); c.lineTo(x - r * 2, y); c.lineTo(x - r * 0.5, y - r * 0.5); c.fill()
      } else if (f.k === 'boom') {
        c.fillStyle = `rgba(255,${200 - k * 150 | 0},80,${1 - k})`; c.beginPath(); c.arc(f.x, f.y, 20 + k * 70, 0, 6.2832); c.fill()
        c.strokeStyle = `rgba(255,255,230,${1 - k})`; c.lineWidth = 6 * (1 - k); c.beginPath(); c.arc(f.x, f.y, 30 + k * 90, 0, 6.2832); c.stroke()
      } else if (f.k === 'mghost') {
        const b = f.b, how = f.how
        const g = { a: 1 - k, how, rot: how === 'blast' ? k * 9 : 0 }
        const o = { x: b.x + (how === 'blast' ? f.vx * k : 0), y: b.y + (how === 'drown' ? -k * 30 : how === 'blast' ? -60 * k + 120 * k * k : 0), face: b.face, tie: b.tie }
        drawMonster(c, o, t, g)
        if (how === 'drown' && Math.random() < 0.3) addFx('puff', o.x + (Math.random() - 0.5) * 16, o.y - 10, { col: '200,235,255', a: 0.8, r: 2, vx: 0, vy: -24, life: 0.6 })
      }
    }
  }
  function addFx(k, x, y, o) { fx.push(Object.assign({ k, x, y, t0: clock, life: 0.8, vx: 0, vy: 0, r: 4, a: 0.7, col: '230,230,230' }, o || {})); if (fx.length > 260) fx.shift() }
  function drawBubble(c, w, t) {
    if (!bubble || t - bubble.t0 > bubble.dur) { bubble = null; return }
    const h = w.hero, fs = 12.5
    c.save(); c.font = `${fs}px "RocknRoll One",sans-serif`
    const tw = c.measureText(bubble.text).width, bw = tw + 16, bh = fs + 12
    let x = Math.max(26 + bw / 2, Math.min(E.W - 26 - bw / 2, h.x)), y = h.y - 82
    if (h.dead && h.how === 'monster') y = h.y - 50
    c.fillStyle = '#fff'; c.strokeStyle = '#1b130c'; c.lineWidth = 2
    c.beginPath(); c.roundRect(x - bw / 2, y - bh / 2, bw, bh, 7); c.moveTo(h.x - 4, y + bh / 2); c.lineTo(h.x, y + bh / 2 + 8); c.lineTo(h.x + 5, y + bh / 2); c.fill(); c.stroke()
    c.fillStyle = '#fff'; c.fillRect(h.x - 3, y + bh / 2 - 2.5, 7, 3)
    c.fillStyle = '#1b130c'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(bubble.text, x, y + 1)
    c.restore()
  }
  function say(text, dur) { bubble = { text, t0: clock, dur: dur || Math.max(1.2, 0.9 + text.length * 0.1) } }
  function drawCounter(c, w) {
    const h = w.hero
    c.save(); c.font = '15px "RocknRoll One",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
    const s = T.count(w.collected, w.need), x = Math.max(60, Math.min(E.W - 60, h.x)), y = E.H - 12
    c.fillStyle = '#f2c230'; c.strokeStyle = '#6e4a00'; c.lineWidth = 1.6
    const tw = c.measureText(s).width
    c.beginPath(); c.arc(x - tw / 2 - 10, y, 6, 0, 6.2832); c.fill(); c.stroke()
    c.lineWidth = 4; c.strokeStyle = '#1b130c'; c.strokeText(s, x + 4, y + 1); c.fillStyle = w.collected >= w.need ? '#ffe14a' : '#f4ead8'; c.fillText(s, x + 4, y + 1)
    c.restore()
  }
  function drawTorches(c, w, t) {
    for (const [tx, ty] of w.def.torches || [[60, 90], [300, 380]]) {
      c.fillStyle = '#4a3220'; c.fillRect(tx - 2, ty, 4, 14)
      const f = 1 + 0.15 * Math.sin(t * 13 + tx) + 0.1 * Math.sin(t * 29 + ty)
      c.fillStyle = '#ff8a1e'; c.beginPath(); c.ellipse(tx, ty - 4 * f, 4.4, 7 * f, 0, 0, 6.2832); c.fill()
      c.fillStyle = '#ffe08a'; c.beginPath(); c.ellipse(tx, ty - 2.5 * f, 2.2, 4 * f, 0, 0, 6.2832); c.fill()
    }
  }
  // 1枚ぶんの世界を描く（変換は呼ぶ側で）
  function drawWorld(c, w, t, bgc, opt) {
    opt = opt || {}
    c.save(); c.beginPath(); c.rect(0, 0, E.W, E.H); c.clip()
    if (bgc) c.drawImage(bgc, 0, 0, E.W, E.H); else drawStatic(c, w, 1, 9)
    drawTorches(c, w, t)
    const R = rng(77)
    for (const P of w.polys) if (P.kind === 'cracked' && !P.gone) drawStone(c, P, R, true)
    drawParts(c, w, t)
    for (const b of w.bodies) if (b.alive) { if (b.kind === 'monster') drawMonster(c, b, t); else drawBomb(c, b, t) }
    drawHero(c, w.hero, t, w.state === 'clear')
    drawPins(c, w, t)
    if (!opt.thumb) { drawFx(c, t); drawCounter(c, w); drawBubble(c, w, t) }
    c.restore()
  }

  // ---- 面を始める
  function load(i, o) {
    o = o || {}
    lvIdx = Math.max(0, Math.min(LV.length - 1, i))
    const d = LV[lvIdx]
    const variant = { tie: (d.monsters || []).length > 0 && Math.random() < 1 / 7 }
    if (o.variant) Object.assign(variant, o.variant)
    world = E.create(d, { variant })
    if ((o.button != null ? o.button : Math.random() < 1 / 6)) { const cs = world.parts.filter(p => p.t === COIN); if (cs.length) cs[(cs.length * 0.37) | 0].button = true }
    for (let i = 0; i < 60; i++) E.step(world)   // 置いた直後の粒を落ち着かせる（検証の台本と同じ1秒）
    world.events.length = 0
    bg = null; fx.length = 0; bubble = null; shake = 0; sheetOn = false
    $('sheet').hidden = true; $('stamp').textContent = ''; $('stamp').className = ''
    $('lvNum').textContent = T.level(lvIdx + 1)
    const cap = T.caps[lvIdx] || ''
    $('capT').textContent = cap
    hintPin = (fails[lvIdx] || 0) >= 2 ? d.solve[0] : null
    tutorOn = lvIdx === 0 && !Q.has('notut') && (fails[0] || 0) < 3 && best < 1
    $('capT').parentElement.style.visibility = tutorOn ? 'hidden' : ''
    $('tutorT').textContent = coarse ? T.tutor : T.tutorPc
    $('tutor').hidden = !tutorOn
    acc = 0; lastT = performance.now()
    if (!tutorOn) setTimeout(() => { if (world && world.pulls.length === 0 && mode === 'play') say(pick(T.hero.start)) }, 700)
    if (window.TM) TM.start()
    calcTarget(); Object.assign(view, target)
  }

  // ---- 画面切り替え
  function show(m) {
    mode = m
    for (const id of ['vTitle', 'vStages', 'vHow', 'vPlay', 'vEnd']) $(id).hidden = true
    const map = { title: 'vTitle', stages: 'vStages', how: 'vHow', play: 'vPlay', end: 'vEnd' }
    if (map[m]) $(map[m]).hidden = false
    document.body.classList.toggle('playing', m === 'play')
    $('bMute').hidden = false
    if (m === 'title') startDemo()
    calcTarget(); Object.assign(view, target); bg = null
  }
  function applyLang() {
    T = TXT[lang]; document.documentElement.lang = lang
    $('tl1').textContent = T.title1; $('tl2').textContent = T.title2; $('tl2').style.fontSize = lang === 'en' ? 'min(12.5vw,58px)' : ''; $('tl3').textContent = T.titleSub
    $('bStart').textContent = best > 0 && best < LV.length ? T.cont : T.start
    $('bStages').textContent = T.stages; $('bHow').textContent = T.how; $('bLang').textContent = T.lang
    $('stH').textContent = T.stages; $('bStBack').textContent = T.back
    $('howH').textContent = T.howH; $('howLead').textContent = T.howLead; $('bHowClose').textContent = T.back
    $('howFoot').textContent = T.howFoot; $('lPrivacy').textContent = T.privacy
    $('adTag').textContent = T.adTag
    $('bSave').textContent = T.save; $('bPost').textContent = T.post; $('bEndSave').textContent = T.save; $('bEndPost').textContent = T.post
    $('bAgain').textContent = T.again
    if (world) { $('capT').textContent = T.caps[lvIdx]; $('tutorT').textContent = coarse ? T.tutor : T.tutorPc }
    const ul = $('howList'); ul.textContent = ''
    for (const [k, s] of T.howList) { const li = document.createElement('li'), c = document.createElement('canvas'); c.width = 88; c.height = 88; drawIcon(c, k); const sp = document.createElement('span'); sp.textContent = s; li.append(c, sp); ul.append(li) }
  }
  function drawIcon(cvs, k) {
    const c = cvs.getContext('2d'); c.scale(2, 2); c.fillStyle = '#3a2e25'; c.fillRect(0, 0, 44, 44)
    const fake = { parts: [], pins: [] }
    if (k === 'pin') { fake.pins.push({ ax: 4, ay: 24, bx: 30, by: 24, ux: 1, uy: 0, L: 26, off: 0, gone: false }); drawPins(c, fake, 0) }
    if (k === 'coin') { for (const [x, y] of [[14, 30], [26, 30], [20, 20], [32, 22], [9, 20]]) fake.parts.push({ t: COIN, x, y, alive: true, id: x }); drawParts(c, fake, 0) }
    if (k === 'lava') { for (let i = 0; i < 9; i++) fake.parts.push({ t: i < 5 ? LAVA : i < 7 ? STONE : WATER, x: 8 + (i % 5) * 7, y: i < 5 ? 34 : i < 7 ? 26 + (i - 5) * 0 : 18, alive: true, id: i }); fake.parts[5].x = 16; fake.parts[6].x = 24; fake.parts[7].x = 18; fake.parts[8].x = 26; drawParts(c, fake, 1) }
    if (k === 'monster') { c.translate(22, 26); c.scale(1.1, 1.1); c.translate(-22, -26); drawMonster(c, { x: 22, y: 26, face: -1, ground: false }, 0) }
    if (k === 'bomb') { drawBomb(c, { x: 22, y: 28, lit: 0 }, 0.2) }
  }
  function openStages() {
    show('stages')
    const g = $('grid'); g.textContent = ''
    LV.forEach((d, i) => {
      const b = document.createElement('button'), c = document.createElement('canvas')
      c.width = 120; c.height = 200
      const w = E.create(d), x = c.getContext('2d'); x.scale(120 / 360, 200 / 600); drawWorld(x, w, 0, null, { thumb: true })
      const n = document.createElement('b'); n.textContent = i + 1
      b.append(c, n); if (i < best) b.append(document.createElement('i'))
      const lock = i > best && !Q.has('all')
      if (lock) b.classList.add('lock')
      b.disabled = lock
      b.onclick = () => { click(); show('play'); load(i) }
      g.append(b)
    })
  }

  // ---- 決着
  function finish() {
    const w = world, ok = w.state === 'clear'
    sheetOn = true; bubble = null
    $('capT').parentElement.style.visibility = 'hidden'
    let line
    if (ok) {
      best = Math.max(best, lvIdx + 1); store.set('pinr_best', best)
      line = Math.random() < 0.18 ? pick(T.narrClear.slice(3)) : T.narrClear[0]
      $('stamp').textContent = T.stampClear; $('stamp').className = ''; void $('stamp').offsetWidth; $('stamp').className = 'on'
      $('bNext').textContent = T.next
      Snd.duck(0.3, 2); play('j_win', { vol: 0.9, jitter: 0 })
    } else {
      fails[lvIdx] = (fails[lvIdx] || 0) + 1; store.set('pinr_fails', fails)
      totalFails++; store.set('pinr_totalFails', totalFails)
      line = sessionFails === 0 ? T.narrFirst : pick(T.narr[w.reason] || T.narr.stuck)
      sessionFails++
      $('stamp').textContent = ''
      $('bNext').textContent = T.retry
      play('j_lose', { vol: 0.8, jitter: 0 })
    }
    $('narr').textContent = line
    const text = ok ? T.postText(lvIdx + 1, true) : T.postText(lvIdx + 1, false)
    $('bPost').href = 'https://x.com/intent/post?text=' + encodeURIComponent(text + '\n' + T.tag) + '&url=' + encodeURIComponent(URL0)
    $('sheet').hidden = false
    if (window.TM) TM.end(lvIdx + 1, ok)
    requestAnimationFrame(() => calcTarget())
  }
  function shareImage(ok) {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1350
    const g = c.getContext('2d')
    g.fillStyle = '#1e1813'; g.fillRect(0, 0, 1080, 1350)
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.font = '64px "RocknRoll One",sans-serif'; g.lineJoin = 'round'; g.lineWidth = 16; g.strokeStyle = '#000'; g.strokeText(T.caps[lvIdx], 540, 92); g.fillStyle = '#fff'; g.fillText(T.caps[lvIdx], 540, 92)
    g.fillStyle = '#f2f2f2'; g.fillRect(60, 40, 64, 30); g.fillStyle = '#555'; g.font = '22px sans-serif'; g.fillText(T.adTag, 92, 56)
    const s = 1.75, ox = (1080 - E.W * s) / 2, oy = 170
    g.save(); g.translate(ox, oy); g.scale(s, s); drawWorld(g, world, clock, bg && bg.c); g.restore()
    if (ok) { g.save(); g.translate(540, 520); g.rotate(-0.14); g.font = '92px "RocknRoll One",sans-serif'; g.lineWidth = 22; g.strokeStyle = '#000'; g.strokeText(T.stampClear, 0, 0); g.fillStyle = '#ffe14a'; g.fillText(T.stampClear, 0, 0); g.restore() }
    const line = $('narr').textContent
    g.font = '600 44px "Shippori Mincho B1",serif'; const tw = g.measureText(line).width
    g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(540 - tw / 2 - 30, 1130, tw + 60, 84); g.fillStyle = '#fff'; g.fillText(line, 540, 1173)
    g.font = '30px "RocknRoll One",sans-serif'; g.fillStyle = '#f2c230'; g.fillText(T.shareFoot, 540, 1270); g.fillStyle = '#a89a86'; g.font = '24px sans-serif'; g.fillText('tom3games.github.io/pin-rescue', 540, 1312)
    return c
  }
  function saveCanvas(c, name) {
    window.__saved = (window.__saved || 0) + 1
    c.toBlob(b => { if (!b) return; const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000) }, 'image/png')
  }
  function drawEnd() {
    const c = $('endCv'), g = c.getContext('2d')
    g.fillStyle = '#2a211a'; g.fillRect(0, 0, 1080, 1080)
    const R = rng(5); for (let y = 0, row = 0; y < 1080; y += 66, row++) for (let x = (row % 2) * -60; x < 1080; x += 120) { const v = R(); g.fillStyle = `rgb(${56 + v * 14 | 0},${45 + v * 11 | 0},${36 + v * 8 | 0})`; g.fillRect(x + 3, y + 3, 114, 60) }
    const gr = g.createRadialGradient(540, 640, 40, 540, 640, 520); gr.addColorStop(0, 'rgba(255,200,90,.45)'); gr.addColorStop(1, 'rgba(255,200,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, 1080, 1080)
    // 金貨の山と勇者
    const fake = { parts: [] }; const R2 = rng(11)
    for (let i = 0; i < 160; i++) { const a = R2(), x = 540 + (a - 0.5) * 2 * 150 * (1 - R2() * 0.4), y = 196 - Math.abs(a - 0.5) * 2 * 0 - R2() * 60 * (1 - Math.abs(a - 0.5) * 2); fake.parts.push({ t: COIN, x: (x - 540) / 3.4 + 180, y: y, alive: true, id: i }) }
    g.save(); g.translate(540 - 180 * 3.4, 920 - 200 * 3.4); g.scale(3.4, 3.4); drawParts(g, fake, 0); g.restore()
    g.save(); g.translate(540 - 180 * 4.2, 760 - 200 * 4.2); g.scale(4.2, 4.2); drawHero(g, { x: 180, y: 200, dead: false, fear: 0, joy: 1, wet: 0 }, 0.26, true); g.restore()
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'
    g.fillStyle = '#f2f2f2'; g.fillRect(60, 60, 70, 32); g.fillStyle = '#555'; g.font = '22px sans-serif'; g.fillText(T.adTag, 95, 77)
    g.font = '86px "RocknRoll One",sans-serif'; g.lineWidth = 20; g.strokeStyle = '#000'; g.strokeText(T.endH, 540, 170); g.fillStyle = '#ffe14a'; g.fillText(T.endH, 540, 170)
    g.font = '600 42px "Shippori Mincho B1",serif'; const sub = T.endSub(totalFails); const tw = g.measureText(sub).width
    g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(540 - tw / 2 - 26, 925, tw + 52, 76); g.fillStyle = '#fff'; g.fillText(sub, 540, 964)
    g.font = '26px sans-serif'; g.fillStyle = '#d8c9b0'; g.fillText('tom3games.github.io/pin-rescue', 540, 1040)
  }
  function openEnd() {
    show('end'); drawEnd(); play('j_end', { vol: 0.9, jitter: 0, ui: true })
    $('bEndPost').href = 'https://x.com/intent/post?text=' + encodeURIComponent(T.postEnd(totalFails) + '\n' + T.tag) + '&url=' + encodeURIComponent(URL0)
  }

  // ---- 出来事 → 音と絵
  function handleEvents(w) {
    const h = w.hero
    for (const e of w.events) {
      switch (e.e) {
        case 'pin': {
          play('pin', { vol: 0.8 })
          // 抜いたピンの上に何が載っているかで音を足す
          const p = w.pins.find(q => q.id === e.id); let wa = 0, co = 0, la = 0
          for (const q of w.parts) if (q.alive) { const s = E.pinSeg(p); const d = distSeg(q.x, q.y, s); if (d < 22) { if (q.t === WATER) wa++; else if (q.t === COIN) co++; else if (q.t === LAVA) la++ } }
          if (wa > 3) setTimeout(() => play('splash', { vol: 0.8 }), 220)
          if (co > 3) setTimeout(() => play('coin', { vol: 0.7 }), 300)
          if (la > 3) setTimeout(() => { if (!h.dead && Math.abs(h.x - p.ax) < 400) say(pick(T.hero.fear)) }, 200)
          if (tutorOn) { tutorOn = false; $('tutor').hidden = true; $('capT').parentElement.style.visibility = '' }
          if (hintPin === e.id) hintPin = null
          break
        }
        case 'steam': play('steam', { vol: 0.5, rate: 1.1 }, 140); if (Math.random() < 0.5) addFx('puff', e.x, e.y, { col: '235,235,230', a: 0.7, r: 4, vy: -40, vx: (Math.random() - 0.5) * 20, life: 0.9 }); if (Math.random() < 0.05) play('stone', { vol: 0.5 }, 200); break
        case 'melt': play('steam', { vol: 0.45, rate: 0.8 }, 160); addFx('puff', e.x, e.y, { col: '255,140,60', a: 0.8, r: 3, vy: -30, life: 0.6 }); break
        case 'get': play('get', { vol: 0.55 }, 70); addFx('spark', e.x, e.y, { vx: (h.x - e.x) * 0.9, vy: (h.y - 40 - e.y) * 0.9 + 20, life: 0.45 }); if (e.button) { say(T.hero.button[0], 2.2); play('squeak', { vol: 0.6 }) } else if (!bubble && Math.random() < 0.08) say(pick(T.hero.coin)); break
        case 'mdie': {
          const b = { x: e.x, y: e.y, face: -1, tie: e.tie }
          addFx('mghost', e.x, e.y, { b, how: e.how, life: e.how === 'blast' ? 1 : 1.4, vx: (e.x < h.x ? -1 : 1) * 90 })
          if (e.how === 'drown') play('bub', { vol: 0.8 }); else if (e.how === 'burn') { play('steam', { vol: 0.7, rate: 0.7 }); for (let i = 0; i < 6; i++) addFx('puff', e.x, e.y - 6, { col: '60,55,50', a: 0.7, r: 6, vy: -50, vx: (i - 3) * 8, life: 1.1 }) }
          play('grunt', { vol: 0.7, rate: 0.8 }, 200)
          if (e.tie) setTimeout(() => say(T.hero.tie, 2.4), 300)
          break
        }
        case 'fuse': play('steam', { vol: 0.35, rate: 1.6 }); break
        case 'boom': play('boom', { vol: 1 }); shake = 1; addFx('boom', e.x, e.y, { life: 0.55 }); for (let i = 0; i < 10; i++) addFx('puff', e.x, e.y, { col: '70,60,55', a: 0.8, r: 9, vx: Math.cos(i) * 60, vy: Math.sin(i) * 60 - 30, life: 1.2 }); break
        case 'crack': play('crack', { vol: 0.9 }); break
        case 'hdie': shake = Math.max(shake, 0.6); play('scream', { vol: 0.65, jitter: 0.04 }); say(T.hero.die[e.how] || '…', 2.4); if (e.how === 'lava') for (let i = 0; i < 8; i++) addFx('puff', e.x, e.y - 30, { col: '60,55,50', a: 0.7, r: 6, vy: -60, vx: (i - 4) * 9, life: 1.3 }); break
      }
    }
    w.events.length = 0
  }
  function distSeg(x, y, s) { const dx = s[2] - s[0], dy = s[3] - s[1]; let t = ((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy); t = Math.max(0, Math.min(1, t)); return Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t) }

  // ---- ループ
  let lastCoinSnd = 0, prevState = 'play', saidMonster = false, saidWet = false
  function stepOnce() {
    const w = world
    E.step(w)
    clock += 1 / 60
    if (mode === 'play') {
      handleEvents(w)
      const h = w.hero
      // 金貨が落ちる音
      if (clock - lastCoinSnd > 0.16) { let n = 0; for (const p of w.parts) if (p.alive && p.t === COIN && Math.abs(p.y - p.py) * 180 > 140) n++; if (n > 2) { play('coin', { vol: Math.min(0.7, 0.2 + n * 0.03) }); lastCoinSnd = clock } }
      if (!saidMonster && h.fear > 0.5 && w.bodies.some(b => b.alive && b.kind === 'monster' && Math.hypot(b.x - h.x, b.y - h.y) < 110)) { saidMonster = true; say(pick(T.hero.monster)) }
      if (!saidWet && h.wet > 0.8) { saidWet = true; say(pick(T.hero.wet)) }
      if (w.state === 'clear' && prevState === 'play') say(pick(T.hero.win), 2.6)
      prevState = w.state
      if (w.state !== 'play' && !sheetOn && w.t >= w.endAt) finish()
      const hasLava = w.parts.some(p => p.alive && p.t === LAVA)
      if (hasLava !== lavaLoop && audioOn) { lavaLoop = hasLava; Snd.loop('lava', hasLava ? 'snd/amb_lava.mp3' : null, 0.2) }
    } else { w.events.length = 0 }
  }
  function frame() {
    const now = performance.now()
    let dt = (now - lastT) / 1000; lastT = now
    if (dt > 0.25) dt = 0.25
    if (!paused && world) {
      acc += dt; let n = 0
      while (acc >= 1 / 60 && n < 4) { stepOnce(); acc -= 1 / 60; n++ }
      if (n === 4) acc = 0
      if (mode === 'title') demoTick()
    }
    render()
    requestAnimationFrame(frame)
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#1e1813'; ctx.fillRect(0, 0, cv.width, cv.height)
    if (!world || mode === 'boot') return
    // 画面の位置はなめらかに寄せる
    for (const k of ['s', 'ox', 'oy']) view[k] += (target[k] - view[k]) * 0.18
    if (!bg || bg.w !== world || Math.abs(bg.k - view.s) > 0.5) { bg = makeBg(world); bg.k = view.s }
    let sx = 0, sy = 0
    if (shake > 0) { sx = (Math.random() - 0.5) * 10 * shake; sy = (Math.random() - 0.5) * 10 * shake; shake = Math.max(0, shake - 0.04) }
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * (view.ox + sx), dpr * (view.oy + sy))
    // 外のまわりの岩
    ctx.fillStyle = '#2a211a'; ctx.fillRect(-30, -30, E.W + 60, E.H + 60)
    drawWorld(ctx, world, clock, bg.c)
    if (mode === 'title') {   // 広告の枠
      ctx.lineWidth = 3 / view.s; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.strokeRect(0, 0, E.W, E.H)
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(8, 8, 34, 18); ctx.fillStyle = '#555'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(T.adTag, 25, 17.5)
    }
    if (tutorOn && mode === 'play') {
      const p = pinScreen(LV[0].solve[0]); if (p) { const el = $('tutor'); el.style.left = (p.x - 58) + 'px'; el.style.top = (p.y + 6) + 'px' }
    }
  }

  // タイトルの後ろで、広告みたいに勝手に解いてみせる
  const DEMO = [{ lv: 0, steps: [[1.4, 'A']] }, { lv: 2, steps: [[1.2, 'W'], [3.4, 'C']] }, { lv: 0, steps: [[1.4, 'B']] }]
  let demoI = 0
  function startDemo() { demo = DEMO[demoI % DEMO.length]; demoI++; lvIdx = demo.lv; world = E.create(LV[demo.lv], {}); for (let i = 0; i < 60; i++) E.step(world); world.events.length = 0; demo.t0 = clock; demo.k = 0; demo.end = 0; bg = null }
  function demoTick() {
    if (!demo) return startDemo()
    const t = clock - demo.t0
    while (demo.k < demo.steps.length && t > demo.steps[demo.k][0]) { E.pull(world, demo.steps[demo.k][1]); demo.k++ }
    if (world.state !== 'play' && !demo.end) demo.end = clock
    if ((demo.end && clock - demo.end > 2.2) || t > 14) startDemo()
  }

  // ---- 入力
  function pinScreen(id) {
    if (!world) return null
    const p = world.pins.find(q => q.id === id); if (!p || p.gone) return null
    const s = E.pinSeg(p)
    return { x: view.ox + (s[2] + p.ux * 9) * view.s, y: view.oy + (s[3] + p.uy * 9) * view.s, mx: view.ox + (s[0] + s[2]) / 2 * view.s, my: view.oy + (s[1] + s[3]) / 2 * view.s }
  }
  function click() { audioStart(); play('click', { vol: 0.5, jitter: 0, ui: true }) }
  cv.addEventListener('pointerdown', e => {
    audioStart()
    if (mode !== 'play' || !world || world.state !== 'play' || sheetOn) return
    const wx = (e.clientX - view.ox) / view.s, wy = (e.clientY - view.oy) / view.s
    let bestP = null, bd = Math.max(20, 26 / view.s)
    for (const p of world.pins) {
      if (p.gone || p.pulling) continue
      const s = E.pinSeg(p), d = Math.min(distSeg(wx, wy, s), Math.hypot(wx - s[2] - p.ux * 9, wy - s[3] - p.uy * 9) - 4)
      if (d < bd) { bd = d; bestP = p }
    }
    if (bestP) { E.pull(world, bestP.id); window.__taps = (window.__taps || 0) + 1 }
  })
  $('bStart').onclick = () => { click(); show('play'); load(best > 0 && best < LV.length ? best : (Q.has('lv') ? Number(Q.get('lv')) - 1 : 0)) }
  $('bStages').onclick = () => { click(); openStages() }
  $('bStBack').onclick = () => { click(); show('title') }
  $('bHow').onclick = () => { click(); show('how') }
  $('bHowClose').onclick = () => { click(); show('title') }
  $('bLang').onclick = () => { click(); lang = lang === 'ja' ? 'en' : 'ja'; store.set('pinr_lang', lang); applyLang() }
  $('bRestart').onclick = () => { click(); load(lvIdx) }
  $('bMenu').onclick = () => { click(); applyLang(); show('title') }
  $('bNext').onclick = () => {
    click()
    if (world.state === 'clear') { if (lvIdx === LV.length - 1) openEnd(); else load(lvIdx + 1) }
    else load(lvIdx)
  }
  $('bSave').onclick = () => { click(); saveCanvas(shareImage(world.state === 'clear'), `pin-rescue-${lvIdx + 1}.png`); if (window.TM) TM.share('save') }
  $('bPost').onclick = () => { if (window.TM) TM.share('x') }
  $('bEndSave').onclick = () => { click(); saveCanvas($('endCv'), 'pin-rescue-all.png'); if (window.TM) TM.share('save') }
  $('bEndPost').onclick = () => { if (window.TM) TM.share('x') }
  $('bAgain').onclick = () => { click(); show('play'); load(0) }
  $('bMute').onclick = () => { audioStart(); muted = !muted; store.set('pinr_mute', muted); Snd.setMute(muted); $('bMute').classList.toggle('on', muted) }
  $('bMute').classList.toggle('on', muted)
  addEventListener('resize', () => { layout() })

  // ---- 検証用の窓口
  window.pinr = {
    get w() { return world }, get mode() { return mode }, get lv() { return lvIdx }, get sheet() { return sheetOn }, get view() { return Object.assign({}, view) },
    get hint() { return hintPin }, get tutor() { return tutorOn },
    load: (i, o) => { show('play'); load(i, o) }, pinXY: pinScreen, levels: LV.length,
    dbg: { pause: v => { paused = v !== false; acc = 0; lastT = performance.now() }, step: n => { for (let i = 0; i < (n || 1); i++) stepOnce() }, settleView: () => { calcTarget(); Object.assign(view, target) }, setView: o => { Object.assign(target, o); Object.assign(view, o) }, say },
    art: { drawHero, drawPins, drawParts, drawMonster },
    texts: () => [...document.querySelectorAll('main:not([hidden]) #capT, main:not([hidden]) #narr, main:not([hidden]) #stamp, main:not([hidden]) #tutorT')].filter(e => e.offsetParent && e.textContent && getComputedStyle(e.closest('.cap') || e).visibility !== 'hidden' && !e.closest('[hidden]')).map(e => e.textContent).concat(bubble ? [bubble.text] : []),
    T: () => T,
  }

  // ---- 起動
  applyLang()
  layout()
  const fontsReady = (document.fonts && document.fonts.ready) ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]) : Promise.resolve()
  fontsReady.then(() => {
    window.__bootStep(); window.__bootStep()
    window.__bootDone = true
    $('boot').classList.add('gone')
    if (Q.has('lv')) { show('play'); load(Number(Q.get('lv')) - 1) } else show('title')
    layout()
    window.__pinrReady = true
  })
  requestAnimationFrame(frame)
})()
