// ピン抜きの物理。水・溶岩・金貨・石の粒と、魔物・爆弾の体、固定の壁、抜けるピン。
// 固定60Hz（step() 1回 = 1/60秒）。乱数を使わないので、同じ順番・同じ間合いなら同じ結果になる。
// ブラウザでは window.PinEngine、node（tools/check.mjs）では globalThis.PinEngine
;(function (root) {
  'use strict'
  const W = 360, H = 600, DT = 1 / 60, SUB = 3, ITER = 2
  const GRAV = 1000
  const WATER = 0, LAVA = 1, COIN = 2, STONE = 3
  const RAD = [5, 5, 6, 5]
  const INVM = [1, 0.9, 0.55, 0.4]
  const GRIP = [0, 0.02, 0.035, 0.12]   // 床や壁に触れた時の横すべりの止まり方（粒の種類ごと）
  const PIN_R = 6, PIN_TIME = 0.26
  const CELL = 13
  const HERO_W = 30, HERO_H = 50

  // ---- 形
  function rectPoly(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }
  function makePoly(pts, kind) {
    const n = pts.length, edges = []
    // 時計回り（画面座標）にそろえる
    let area = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1] }
    if (area < 0) pts = pts.slice().reverse()
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1
      edges.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], nx: dy / L, ny: -dx / L, L })
      x0 = Math.min(x0, a[0]); y0 = Math.min(y0, a[1]); x1 = Math.max(x1, a[0]); y1 = Math.max(y1, a[1])
    }
    return { pts, edges, x0, y0, x1, y1, kind: kind || 'wall', gone: false }
  }
  // 円と凸多角形。押し出す向きと量を返す（当たっていなければ null）
  function polyHit(P, x, y, r, out) {
    if (x < P.x0 - r || x > P.x1 + r || y < P.y0 - r || y > P.y1 + r) return false
    let maxD = -1e9, me = null
    for (const e of P.edges) { const d = (x - e.ax) * e.nx + (y - e.ay) * e.ny; if (d > maxD) { maxD = d; me = e } }
    if (maxD < 0) { out.nx = me.nx; out.ny = me.ny; out.d = r - maxD; return true }   // 中に入っている
    let best = 1e9, cx = 0, cy = 0
    for (const e of P.edges) {
      const dx = e.bx - e.ax, dy = e.by - e.ay
      let t = ((x - e.ax) * dx + (y - e.ay) * dy) / (e.L * e.L); t = t < 0 ? 0 : t > 1 ? 1 : t
      const px = e.ax + dx * t, py = e.ay + dy * t, d2 = (x - px) ** 2 + (y - py) ** 2
      if (d2 < best) { best = d2; cx = px; cy = py }
    }
    if (best >= r * r) return false
    const d = Math.sqrt(best) || 1e-6
    out.nx = (x - cx) / d; out.ny = (y - cy) / d; out.d = r - d; return true
  }
  function polyDist(P, x, y) {
    let maxD = -1e9; for (const e of P.edges) maxD = Math.max(maxD, (x - e.ax) * e.nx + (y - e.ay) * e.ny)
    if (maxD < 0) return 0
    let best = 1e9
    for (const e of P.edges) { const dx = e.bx - e.ax, dy = e.by - e.ay; let t = ((x - e.ax) * dx + (y - e.ay) * dy) / (e.L * e.L); t = t < 0 ? 0 : t > 1 ? 1 : t; best = Math.min(best, Math.hypot(x - e.ax - dx * t, y - e.ay - dy * t)) }
    return best
  }
  function segHit(ax, ay, bx, by, x, y, r, out) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy
    let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = ax + dx * t, py = ay + dy * t, ex = x - px, ey = y - py, d2 = ex * ex + ey * ey
    if (d2 >= r * r) return false
    const d = Math.sqrt(d2) || 1e-6
    out.nx = ex / d; out.ny = ey / d; out.d = r - d; return true
  }

  function create(def, opt) {
    opt = opt || {}
    const w = {
      def, t: 0, frame: 0, state: 'play', reason: '', endAt: 0, need: def.need,
      parts: [], bodies: [], polys: [], pins: [], events: [], collected: 0, melted: 0, lost: 0, coinsTotal: 0,
      hero: { x: def.hero[0], y: def.hero[1], dead: false, how: '', wet: 0, fear: 0, joy: 0, deadT: 0 },
      quiet: 0, winT: -1, failT: -1, pulls: [], cold: 0,
      variant: opt.variant || {},
    }
    // 外枠
    const B = def.border || {}
    w.polys.push(makePoly(rectPoly(-40, -200, 64, H + 240)))
    w.polys.push(makePoly(rectPoly(W - 24, -200, 64, H + 240)))
    if (!B.noFloor) w.polys.push(makePoly(rectPoly(-40, H - 24, W + 80, 64)))
    for (const r of def.walls || []) w.polys.push(makePoly(Array.isArray(r[0]) ? r : rectPoly(r[0], r[1], r[2], r[3])))
    for (const r of def.cracked || []) w.polys.push(makePoly(Array.isArray(r[0]) ? r : rectPoly(r[0], r[1], r[2], r[3]), 'cracked'))
    for (const r of def.ice || []) w.polys.push(makePoly(Array.isArray(r[0]) ? r : rectPoly(r[0], r[1], r[2], r[3]), 'ice'))
    const hx = w.hero.x, hy = w.hero.y
    w.zone = def.zone || [hx - 62, hx + 62, hy - 72]
    w.heroPoly = makePoly(rectPoly(hx - HERO_W / 2, hy - HERO_H, HERO_W, HERO_H), 'hero')
    for (const p of def.pins) {
      const dx = p.b[0] - p.a[0], dy = p.b[1] - p.a[1], L = Math.hypot(dx, dy)
      w.pins.push({ id: p.id, ax: p.a[0], ay: p.a[1], bx: p.b[0], by: p.b[1], ux: dx / L, uy: dy / L, L, pull: 0, pulling: false, gone: false, off: 0 })
    }
    const types = { water: WATER, lava: LAVA, coin: COIN, stone: STONE }
    for (const f of def.fill || []) {
      const t = types[f.type], r = RAD[t], sp = r * 2 * (t === COIN ? 1.0 : 0.96)
      const [x0, y0, fw, fh] = f.rect
      let row = 0
      for (let y = y0 + fh - r; y >= y0 + r - 0.01; y -= sp * 0.87, row++) {
        for (let x = x0 + r + (row % 2 ? sp / 2 : 0); x <= x0 + fw - r + 0.01; x += sp) addPart(w, t, x, y)
      }
    }
    w.coinsTotal = w.parts.filter(p => p.t === COIN).length
    for (const m of def.monsters || []) w.bodies.push({ kind: 'monster', x: m[0], y: m[1], px: m[0], py: m[1], r: 15, invm: 0.07, alive: true, sub: 0, ground: false, how: '', deadT: 0, face: -1, tie: !!(w.variant.tie && w.bodies.filter(b => b.kind === 'monster').length === 0) })
    for (const b of def.bombs || []) w.bodies.push({ kind: 'bomb', x: b[0], y: b[1], px: b[0], py: b[1], r: 11, invm: 0.08, alive: true, lit: -1, maxV: 0, ground: false })
    w.grid = new Map()
    return w
  }
  function addPart(w, t, x, y) {
    const p = { t, x, y, px: x, py: y, r: RAD[t], alive: true, id: w.parts.length, conv: false, hot: 0, button: false }
    w.parts.push(p); return p
  }

  function pull(w, id) {
    const p = w.pins.find(q => q.id === id)
    if (!p || p.pulling || p.gone || w.state !== 'play') return false
    p.pulling = true; w.pulls.push({ id, frame: w.frame }); w.events.push({ e: 'pin', id, x: p.bx, y: p.by })
    w.quiet = 0; w.progT = w.t
    return true
  }
  function pinSeg(p) { const o = p.off; return [p.ax + p.ux * o, p.ay + p.uy * o, p.bx + p.ux * o, p.by + p.uy * o] }

  const tmp = { nx: 0, ny: 0, d: 0 }
  function collideStatic(w, o, r, grip) {
    let ground = false
    const dxs = o.x - o.px, dys = o.y - o.py
    const check = (hit) => {
      if (!hit) return
      o.x += tmp.nx * tmp.d; o.y += tmp.ny * tmp.d
      if (tmp.ny < -0.5) ground = true
      if (grip) {   // 触れている面に沿った動きを少し止める
        const mx = o.x - o.px, my = o.y - o.py, dn = mx * tmp.nx + my * tmp.ny, tx = mx - dn * tmp.nx, ty = my - dn * tmp.ny
        o.x -= tx * grip; o.y -= ty * grip
      }
    }
    for (const P of w.polys) { if (!P.gone) check(polyHit(P, o.x, o.y, r, tmp)) }
    check(polyHit(w.heroPoly, o.x, o.y, r, tmp))
    const g0 = grip; grip = grip * 0.4
    for (const p of w.pins) { if (p.gone) continue; const s = pinSeg(p); check(segHit(s[0], s[1], s[2], s[3], o.x, o.y, r + PIN_R, tmp)) }
    grip = g0
    return ground
  }

  function buildGrid(w) {
    const g = w.grid; g.clear()
    for (const p of w.parts) {
      if (!p.alive) continue
      const k = ((p.x / CELL) | 0) + 1000 * ((p.y / CELL + 50) | 0)
      let a = g.get(k); if (!a) { a = []; g.set(k, a) } a.push(p)
    }
  }

  function solvePairs(w) {
    const g = w.grid
    for (const [k, a] of g) {
      const cx = k % 1000, cy = (k - cx) / 1000
      for (let ox = 0; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        if (ox === 0 && oy === -1) continue
        const b = (ox === 0 && oy === 0) ? a : g.get(k + ox + oy * 1000)
        if (!b) continue
        for (let i = 0; i < a.length; i++) {
          const p = a[i]; if (!p.alive) continue
          for (let j = (b === a ? i + 1 : 0); j < b.length; j++) {
            const q = b[j]; if (!q.alive) continue
            const dx = q.x - p.x, dy = q.y - p.y, R = p.r + q.r, d2 = dx * dx + dy * dy
            if (d2 >= R * R) continue
            const d = Math.sqrt(d2) || 0.001, nx = d2 ? dx / d : 0, ny = d2 ? dy / d : 1, ov = R - d
            // 混ざると変わる
            if ((p.t === WATER && q.t === LAVA) || (p.t === LAVA && q.t === WATER)) { p.conv = true; q.conv = true }
            else if (p.t === COIN && q.t === LAVA) { p.alive = false; w.melted++; w.events.push({ e: 'melt', x: p.x, y: p.y }); continue }
            else if (q.t === COIN && p.t === LAVA) { q.alive = false; w.melted++; w.events.push({ e: 'melt', x: q.x, y: q.y }); continue }
            const wp = INVM[p.t], wq = INVM[q.t], s = ov / (wp + wq)
            p.x -= nx * s * wp; p.y -= ny * s * wp; q.x += nx * s * wq; q.y += ny * s * wq
            if ((p.t >= COIN) && (q.t >= COIN)) {   // 金貨と石は砂のように積もる
              const rvx = (q.x - q.px) - (p.x - p.px), rvy = (q.y - q.py) - (p.y - p.py), rn = rvx * nx + rvy * ny
              const fr = (p.t === STONE || q.t === STONE) ? 0.2 : 0.035, tx = (rvx - rn * nx) * fr, ty = (rvy - rn * ny) * fr
              p.x += tx * 0.5; p.y += ty * 0.5; q.x -= tx * 0.5; q.y -= ty * 0.5
            }
          }
        }
      }
    }
  }

  function bodyVsParts(w, b) {
    const g = w.grid, R0 = b.r + 16
    const c0 = ((b.x - R0) / CELL) | 0, c1 = ((b.x + R0) / CELL) | 0, r0 = ((b.y - R0) / CELL + 50) | 0, r1 = ((b.y + R0) / CELL + 50) | 0
    let water = 0, waterAbove = 0, lava = 0
    for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) {
      const a = g.get(cx + cy * 1000); if (!a) continue
      for (const p of a) {
        if (!p.alive) continue
        const dx = p.x - b.x, dy = p.y - b.y, R = b.r + p.r, d2 = dx * dx + dy * dy
        if (d2 < (R + 5) * (R + 5)) { if (p.t === WATER) { water++; if (p.y < b.y - 4) waterAbove++ } else if (p.t === LAVA) lava++ }
        if (d2 >= R * R) continue
        const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d, ov = R - d, wp = INVM[p.t], s = ov / (wp + b.invm)
        p.x += nx * s * wp; p.y += ny * s * wp; b.x -= nx * s * b.invm; b.y -= ny * s * b.invm
        if (ny > 0.5) b.ground = true
      }
    }
    return { water, waterAbove, lava }
  }

  // 氷: 溶岩か爆風に触れると、その形のまま水になる
  function thaw(w, P) {
    P.gone = true; w.events.push({ e: 'thaw', x: (P.x0 + P.x1) / 2, y: (P.y0 + P.y1) / 2 })
    for (let y = P.y1 - 5, row = 0; y > P.y0 + 3; y -= 8.4, row++) for (let x = P.x0 + 5 + (row % 2) * 4.8; x < P.x1 - 3; x += 9.6) {
      if (polyDist(P, x, y) > 0) continue
      addPart(w, WATER, x, y)
    }
  }
  function explode(w, b) {
    b.alive = false; b.exploded = true
    const ER = 74
    w.events.push({ e: 'boom', x: b.x, y: b.y })
    for (const P of w.polys) {
      if (P.kind !== 'cracked' || P.gone) continue
      if (polyDist(P, b.x, b.y) < ER) {
        P.gone = true; w.events.push({ e: 'crack', x: (P.x0 + P.x1) / 2, y: (P.y0 + P.y1) / 2 })
        for (let y = P.y0 + 5; y < P.y1; y += 11) for (let x = P.x0 + 5; x < P.x1; x += 11) {
          if (polyDist(P, x, y) > 0) continue
          const s = addPart(w, STONE, x, y), dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy) || 1
          s.px = x - dx / d * 2.5; s.py = y - dy / d * 2.5
        }
      }
    }
    for (const P of w.polys) if (P.kind === 'ice' && !P.gone && polyDist(P, b.x, b.y) < ER) thaw(w, P)
    for (const o of w.bodies) {
      if (o === b || !o.alive) continue
      const d = Math.hypot(o.x - b.x, o.y - b.y)
      if (o.kind === 'monster' && d < ER + o.r) { o.alive = false; o.how = 'blast'; o.deadT = w.t; w.events.push({ e: 'mdie', how: 'blast', x: o.x, y: o.y }) }
      if (o.kind === 'bomb' && d < ER && o.lit < 0) o.lit = 0.15
    }
    const h = w.hero
    if (!h.dead && Math.hypot(h.x - b.x, h.y - HERO_H / 2 - b.y) < ER + 18) killHero(w, 'bomb')
    for (const p of w.parts) {
      if (!p.alive) continue
      const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy)
      if (d < ER && d > 0.01) { const k = (1 - d / ER) * (p.t === COIN || p.t === STONE ? 5 : 2.5); p.px = p.x - dx / d * k; p.py = p.y - dy / d * k }
    }
  }

  function killHero(w, how) {
    const h = w.hero; if (h.dead || w.state !== 'play') return
    h.dead = true; h.how = how; h.deadT = w.t
    w.events.push({ e: 'hdie', how, x: h.x, y: h.y })
  }

  function step(w) {
    if (w.state === 'done') return
    const dt = DT / SUB
    // ピンを抜く動き
    for (const p of w.pins) {
      if (!p.pulling || p.gone) continue
      p.pull = Math.min(1, p.pull + DT / PIN_TIME)
      const e = p.pull * p.pull
      p.off = e * (p.L + 50)
      if (p.pull >= 1) { p.gone = true }
    }
    const h = w.hero
    for (let s = 0; s < SUB; s++) {
      // 動かす（位置から速さを出す）
      for (const p of w.parts) {
        if (!p.alive) continue
        let vx = (p.x - p.px), vy = (p.y - p.py)
        const sp = Math.hypot(vx, vy), mx = 9; if (sp > mx) { vx *= mx / sp; vy *= mx / sp }
        p.px = p.x; p.py = p.y
        p.x += vx * 0.999; p.y += vy * 0.999 + GRAV * dt * dt
        if (p.t <= LAVA) p.x += ((((p.id * 73856093) ^ (w.frame * 19349663) ^ (s * 83492791)) >>> 0) % 1000 / 1000 - 0.5) * 0.14   // 真上に積み上がらないよう少し揺らす（乱数は使わない）
      }
      for (const b of w.bodies) {
        if (!b.alive) continue
        let vx = (b.x - b.px), vy = (b.y - b.py)
        b.px = b.x; b.py = b.y
        if (b.kind === 'monster' && b.ground && !h.dead) {   // 地面にいる魔物は勇者へ歩く
          const dir = Math.sign(h.x - b.x); b.face = dir || b.face
          vx = vx * 0.6 + dir * 34 * dt * 0.4
        }
        b.ground = false
        b.x += vx * 0.995; b.y += vy * 0.995 + GRAV * dt * dt
      }
      buildGrid(w)
      for (let it = 0; it < ITER; it++) {
        solvePairs(w)
        for (const b of w.bodies) if (b.alive) b.sense = bodyVsParts(w, b)
        // 体どうし
        for (let i = 0; i < w.bodies.length; i++) for (let j = i + 1; j < w.bodies.length; j++) {
          const a = w.bodies[i], c = w.bodies[j]; if (!a.alive || !c.alive) continue
          const dx = c.x - a.x, dy = c.y - a.y, R = a.r + c.r, d = Math.hypot(dx, dy)
          if (d >= R || d === 0) continue
          const nx = dx / d, ny = dy / d, sh = (R - d) / (a.invm + c.invm)
          a.x -= nx * sh * a.invm; a.y -= ny * sh * a.invm; c.x += nx * sh * c.invm; c.y += ny * sh * c.invm
          if (ny > 0.5) c.ground = true; if (ny < -0.5) a.ground = true
        }
        for (const p of w.parts) if (p.alive) collideStatic(w, p, p.r, GRIP[p.t])
        for (const b of w.bodies) if (b.alive && collideStatic(w, b, b.r, 0.3)) b.ground = true
      }
    }
    // 変化
    for (const p of w.parts) {
      if (!p.alive) continue
      if (p.conv) {
        p.conv = false
        if (p.t === LAVA) { p.t = STONE; p.r = RAD[STONE]; p.fresh = 12 }
        else if (p.t === WATER) { w.cold += 6; w.coldT = w.t; if (p.id % 2 === 0) { p.t = STONE; p.r = RAD[STONE]; p.fresh = 12 } else p.alive = false }
        w.events.push({ e: 'steam', x: p.x, y: p.y })
      }
      if (p.y > H + 40 || p.x < -40 || p.x > W + 40) { p.alive = false; if (p.t === COIN) w.lost++ ; continue }
      // 勇者に触れたら
      if (!h.dead) {
        const hp = w.heroPoly
        const near = p.x > hp.x0 - p.r - 3 && p.x < hp.x1 + p.r + 3 && p.y > hp.y0 - p.r - 3 && p.y < hp.y1 + p.r
        const Z = w.zone, grab = p.t === COIN && p.x > Z[0] && p.x < Z[1] && p.y > Z[2]   // 勇者の部屋に入った金貨は拾う
        if (near || grab) {
          if (p.t === COIN) { p.alive = false; w.collected++; w.progT = w.t; w.events.push({ e: 'get', x: p.x, y: p.y, button: p.button }); h.joy = 1 }
          else if (p.t === LAVA) killHero(w, 'lava')
          else if (p.t === WATER) h.wet = 1
        }
      }
    }
    // 石の膜ごしでも、近くの水は溶岩を冷やす（膜の下に溶岩が残って後で勇者を焼かないように）
    let nl = 0, nw = 0; for (const p of w.parts) if (p.alive) { if (p.t === LAVA) nl++; else if (p.t === WATER) nw++ }
    if (nl && nw) {
      buildGrid(w)
      for (const p of w.parts) {
        if (!p.alive || p.t !== LAVA) continue
        const cx = (p.x / CELL) | 0, cy = (p.y / CELL + 50) | 0
        let wq = null, crust = false
        for (let ox = -2; ox <= 2; ox++) for (let oy = -2; oy <= 2; oy++) {
          const a = w.grid.get(cx + ox + (cy + oy) * 1000); if (!a) continue
          for (const q of a) { if (!q.alive) continue; const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (q.t === WATER && d2 < 24 * 24) wq = q; else if (q.t === STONE && d2 < 144) crust = true }
        }
        if (wq && crust) { /* 石の膜があるときだけ（壁やピンごしには冷えない） */ p.t = STONE; p.r = RAD[STONE]; p.fresh = 20; wq.alive = false; w.cold += 6; w.coldT = w.t; w.events.push({ e: 'steam', x: p.x, y: p.y }) }
      }
    }
    // 水が触れた所から、つながった溶岩が固まっていく（水1粒で6粒まで）
    // 冷やす力は、水と溶岩が触れてから1秒だけ残す（後から落ちてきた溶岩が、離れた所で勝手に固まらないように）
    if (w.cold > 0 && w.t - (w.coldT || 0) > 1) w.cold = 0
    if (w.cold > 0) {
      buildGrid(w)
      for (const p of w.parts) {
        if (!p.alive || p.t !== LAVA || w.cold <= 0) continue
        const cx = (p.x / CELL) | 0, cy = (p.y / CELL + 50) | 0
        let hit = false
        for (let ox = -2; ox <= 2 && !hit; ox++) for (let oy = -2; oy <= 2 && !hit; oy++) { const a = w.grid.get(cx + ox + (cy + oy) * 1000); if (a) for (const q of a) if (q.alive && q.t === STONE && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 256) { hit = true; break } }
        // 取り残された1粒も固める
        if (!hit) { let lone = true; for (let ox = -1; ox <= 1 && lone; ox++) for (let oy = -1; oy <= 1 && lone; oy++) { const a = w.grid.get(cx + ox + (cy + oy) * 1000); if (a) for (const q of a) if (q !== p && q.alive && q.t === LAVA && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 196) { lone = false; break } } hit = lone }
        if (hit) { p.t = STONE; p.r = RAD[STONE]; p.fresh = 0; p.fresh2 = 1; w.cold--; if (p.id % 3 === 0) w.events.push({ e: 'steam', x: p.x, y: p.y }) }
      }
      for (const p of w.parts) if (p.fresh2) { p.fresh = 20; p.fresh2 = 0 }
    }
    for (const p of w.parts) if (p.fresh > 0) p.fresh--
    for (const P of w.polys) {
      if (P.kind !== 'ice' || P.gone) continue
      for (const p of w.parts) if (p.alive && p.t === LAVA && p.x > P.x0 - 8 && p.x < P.x1 + 8 && p.y > P.y0 - 8 && p.y < P.y1 + 8 && polyDist(P, p.x, p.y) < p.r + 1.5) { thaw(w, P); break }
    }
    // 魔物と爆弾
    for (const b of w.bodies) {
      if (!b.alive) continue
      if (b.y > H + 60) { b.alive = false; continue }
      const s = b.sense || { water: 0, waterAbove: 0, lava: 0 }
      if (b.kind === 'monster') {
        if (s.lava > 0) { b.alive = false; b.how = 'burn'; b.deadT = w.t; w.events.push({ e: 'mdie', how: 'burn', x: b.x, y: b.y, tie: b.tie }); continue }
        if (s.water >= 6 && s.waterAbove >= 4) b.sub += DT; else b.sub = Math.max(0, b.sub - DT * 0.5)
        if (b.sub > 0.7) { b.alive = false; b.how = 'drown'; b.deadT = w.t; w.events.push({ e: 'mdie', how: 'drown', x: b.x, y: b.y, tie: b.tie }); continue }
        if (!h.dead && polyDist(w.heroPoly, b.x, b.y) < b.r + 6) killHero(w, 'monster')
      } else if (b.kind === 'bomb') {
        const v = Math.hypot(b.x - b.px, b.y - b.py) * SUB * 60
        // 高い所から落ちて止まったら爆発（水の上でも、ゆっくり止まっても）
        if (w.t > 1.2) { b.maxV = Math.max(b.maxV || 0, v); if (b.lit < 0 && b.maxV > 300 && v < b.maxV * 0.3) { b.lit = 0.05; w.events.push({ e: 'fuse', x: b.x, y: b.y }) } }
        b.lastV = v
        if (b.lit < 0 && s.lava > 0) { b.lit = 0.4; w.events.push({ e: 'fuse', x: b.x, y: b.y }) }
        if (b.lit >= 0) { b.lit -= DT; if (b.lit <= 0) explode(w, b) }
      }
    }
    // 勝ち負け
    w.t += DT; w.frame++
    h.wet = Math.max(0, h.wet - DT * 0.8); h.joy = Math.max(0, h.joy - DT * 0.7)
    let fear = 0
    for (const p of w.parts) if (p.alive && p.t === LAVA) { const d = Math.hypot(p.x - h.x, p.y - (h.y - 25)); if (d < 170) fear = Math.max(fear, 1 - d / 170) }
    for (const b of w.bodies) if (b.alive && (b.kind === 'monster' || b.lit >= 0)) { const d = Math.hypot(b.x - h.x, b.y - (h.y - 25)); if (d < 130) fear = Math.max(fear, 1 - d / 130) }
    h.fear += (fear - h.fear) * 0.15
    // 静かになったか
    let ke = 0, n = 0, mx = 0
    for (const p of w.parts) if (p.alive) { const v = Math.hypot(p.x - p.px, p.y - p.py) * SUB * 60; ke += v; n++; if (v > mx) mx = v }
    for (const b of w.bodies) if (b.alive) { const v = Math.hypot(b.x - b.px, b.y - b.py) * SUB * 60; if (b.kind === 'monster' && b.ground) continue; mx = Math.max(mx, v); if (b.lit >= 0) mx = 999 }
    const anyPulling = w.pins.some(p => p.pulling && !p.gone)
    w.quiet = (!anyPulling && (n ? ke / n : 0) < 8 && mx < 90) ? w.quiet + DT : 0
    if (w.state === 'play') {
      const avail = w.parts.reduce((a, p) => a + (p.alive && p.t === COIN ? 1 : 0), 0)
      if (h.dead) { w.state = 'fail'; w.reason = h.how; w.endAt = w.t + 1.6 }
      else if (w.collected >= w.need) { if (w.winT < 0) w.winT = w.t; if (w.t - w.winT > 1.0) { w.state = 'clear'; w.endAt = w.t + 0.4 } }
      else if (avail + w.collected < w.need) { if (w.failT < 0) w.failT = w.t; if (w.t - w.failT > 1.0) { w.state = 'fail'; w.reason = w.melted > w.lost ? 'melt' : 'lost'; w.endAt = w.t + 0.6 } }
      else if (w.pins.every(p => p.gone) && w.winT < 0 && (w.quiet > 1.6 || w.t - (w.progT || 0) > 5)) { w.state = 'fail'; w.reason = 'stuck'; w.endAt = w.t + 0.3 }
    }
  }

  // 台本どおりに抜く（検証用）。steps = [[pinId, 待つ秒], ...]。最後は決着まで回す
  function runScript(def, steps, opt) {
    const w = create(def, opt)
    const settle = (maxSec) => { const end = w.t + maxSec; while (w.t < end && w.state === 'play') { step(w); if (w.quiet > 0.5 && !w.pins.some(p => p.pulling && !p.gone)) break } }
    for (let i = 0; i < 60; i++) step(w)   // ブラウザの load() と同じく、置いた直後は必ず1秒（60回）落ち着かせる
    for (const s of steps) {
      if (w.state !== 'play') break
      const [id, wait] = Array.isArray(s) ? s : [s, null]
      pull(w, id)
      if (wait == null) settle(7); else { const end = w.t + wait; while (w.t < end && w.state === 'play') step(w) }
    }
    const end = w.t + 14; while (w.t < end && w.state === 'play') step(w)
    return w
  }

  root.PinEngine = { W, H, HERO_W, HERO_H, PIN_R, WATER, LAVA, COIN, STONE, RAD, create, step, pull, pinSeg, runScript, polyDist }
})(typeof window !== 'undefined' ? window : globalThis)
