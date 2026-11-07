import './mute-auto.mjs'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 検証。node verify.mjs（音は出さない。押す操作は全部、ピンの画面座標を本物の指・マウスで押す）
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
const PORT = 5951
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(msg) }
async function open(browser, opts = {}, q = '') {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('keep')) localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0 + q); await p.waitForFunction(() => window.__pinrReady, null, { timeout: 15000 })
  return p
}
// ボタンを本物のマウスで押す（CTA は脈打つので座標で押す）
const tap = async (p, sel, touch) => { const r = await p.locator(sel).boundingBox(); if (!r) throw new Error('no box ' + sel); const x = r.x + r.width / 2, y = r.y + r.height / 2; if (touch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y) }
// ピンを、画面に描かれた輪っかの位置で押す
async function tapPin(p, id, touch) {
  const xy = await p.evaluate(id => pinr.pinXY(id), id)
  expect(xy, 'pin not found ' + id)
  const vw = await p.evaluate(() => [innerWidth, innerHeight])
  expect(xy.x > 0 && xy.x < vw[0] && xy.y > 0 && xy.y < vw[1], `pin ${id} off screen ${Math.round(xy.x)},${Math.round(xy.y)}`)
  const before = await p.evaluate(() => pinr.w.pulls.length)
  if (touch) await p.touchscreen.tap(xy.x, xy.y); else await p.mouse.click(xy.x, xy.y)
  const after = await p.evaluate(() => pinr.w.pulls.length)
  expect(after === before + 1, `tap on pin ${id} did not pull`)
}
// 台本と同じ「落ち着くまで待つ」（最大7秒）
const settle = p => p.evaluate(() => { for (let i = 0; i < 420 && pinr.w.state === 'play'; i++) { pinr.dbg.step(1); if (pinr.w.quiet > 0.5 && !pinr.w.pins.some(q => q.pulling && !q.gone)) break } })
const finishRun = p => p.evaluate(() => { for (let i = 0; i < 900 && !pinr.sheet; i++) pinr.dbg.step(1); return { state: pinr.w.state, reason: pinr.w.reason, got: pinr.w.collected, need: pinr.w.need, sheet: pinr.sheet } })
async function playLevel(p, i, order, touch) {
  await p.evaluate(i => { pinr.load(i, { button: false, variant: { tie: false } }); pinr.dbg.pause(true); pinr.dbg.settleView() }, i)
  for (const id of order) { if (await p.evaluate(() => pinr.w.state !== 'play')) break; await tapPin(p, id, touch); await settle(p) }   // 先に失敗が決まったら、残りは押せない
  return finishRun(p)
}
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *')) {
    if (el.closest('[hidden]') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  for (const el of document.querySelectorAll('main:not([hidden]) button,main:not([hidden]) a,#bMute')) { if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; const r = el.getBoundingClientRect(); if (!r.width) continue; if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  return { H, over: over.slice(0, 6) }
})
// 世界が他の部品と重なっていないか（HUD の下・決着の板の上）
const worldBox = p => p.evaluate(() => { const v = pinr.view; return { top: v.oy, bottom: v.oy + 600 * v.s, left: v.ox, right: v.ox + 360 * v.s } })
const variance = (p, sel) => p.evaluate(sel => {
  const c = document.querySelector(sel), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 13) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ }
  return Math.round(s2 / n - (s / n) ** 2)
}, sel)
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [430, 932, 'big']]

const browser = await chromium.launch(MUTE_LAUNCH)
const p = await open(browser)
const N = await p.evaluate(() => window.LEVELS.length), HARD = 12
await t('起動時にエラーが出ない・ロード画面が消える', async () => { expect(p.errs.length === 0, p.errs.join('|')); const g = await p.evaluate(() => document.getElementById('boot').classList.contains('gone')); expect(g, 'boot visible') })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', JSON.stringify(r))
})
await t('画面と文言に「広告」が残っていない（日英）', async () => {
  const r = await p.evaluate(() => { const bad = []; for (const l of ['ja', 'en']) { const j = JSON.stringify(window.TXT[l], (k, v) => typeof v === 'function' ? v(1, 30) : v); if (/広告|\bad\b|the ad/i.test(j)) bad.push(l) } if (/広告/.test(document.title + document.body.innerText)) bad.push('dom'); return bad })
  expect(!r.length, r.join())
})
await t('OGP 一式がある', async () => {
  const r = await p.evaluate(() => ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => !!document.querySelector(`meta[property="${k}"]`)).concat(!!document.querySelector('meta[name="twitter:card"]')))
  expect(r.every(Boolean), JSON.stringify(r))
})
await t('タイトルの後ろで勝手に解いてみせる（何か描けている）', async () => { await p.waitForTimeout(1500); const v = await variance(p, '#stage'); expect(v > 300, 'variance ' + v); return v })
await t('始めるで1面・チュートリアルの指が最初のピンを指す', async () => {
  await tap(p, '#bStart')
  const r = await p.evaluate(() => ({ lv: pinr.lv, tut: pinr.tutor, mode: pinr.mode }))
  expect(r.lv === 0 && r.tut && r.mode === 'play', JSON.stringify(r))
  await p.waitForTimeout(200)
  const d = await p.evaluate(() => { const el = document.getElementById('tutor').getBoundingClientRect(), xy = pinr.pinXY('A'); return { dx: Math.round(el.left + 58 - xy.x), dy: Math.round(el.top - xy.y) } })
  expect(Math.abs(d.dx) < 4 && d.dy > 0 && d.dy < 20, JSON.stringify(d)); return d
})
await t('音を鳴らす操作のあとも実際には無音（Chromium）', async () => { const r = await p.evaluate(() => ({ ok: window.__muteOk(), calls: window.__soundCalls })); expect(r.ok && r.calls > 0, JSON.stringify(r)); return r })
await t('チュートリアルは最初のピンを抜くと消える・遊び中の文字は2つまで', async () => {
  await p.evaluate(() => pinr.dbg.pause(true))
  await tapPin(p, 'A')
  await p.evaluate(() => pinr.dbg.step(30))
  const r = await p.evaluate(() => ({ tut: pinr.tutor, texts: pinr.texts() }))
  expect(!r.tut && r.texts.length <= 2, JSON.stringify(r)); return r.texts
})

// ---- 全面: 本物のクリックで、解き方ならクリア・間違いなら失敗・何もしないとクリアしない
for (let i = 0; i < N; i++) {
  const order = await p.evaluate(i => window.LEVELS[i].solve, i), wrong = await p.evaluate(i => window.LEVELS[i].wrong, i)
  await t(`${i + 1}面: 解く順番でクリア ${order.join('→')}`, async () => {
    const r = await playLevel(p, i, order); expect(r.state === 'clear' && r.sheet, JSON.stringify(r))
    const nx = await p.evaluate(() => document.getElementById('bNext').textContent); expect(nx === '次へ', nx)
    await p.screenshot({ path: `${ROOT}/shots/lv${i + 1}-clear.png` })
    return `${r.got}/${r.need}`
  })
  await t(`${i + 1}面: 間違えた順番で失敗 ${wrong.join('→')}`, async () => {
    const r = await playLevel(p, i, wrong); expect(r.state === 'fail' && r.sheet, JSON.stringify(r))
    const nx = await p.evaluate(() => [document.getElementById('bNext').textContent, document.getElementById('narr').textContent])
    expect(nx[0] === 'もう一回' && nx[1].length > 4, JSON.stringify(nx))
    await p.screenshot({ path: `${ROOT}/shots/lv${i + 1}-fail.png` })
    return r.reason
  })
  for (const wr of await p.evaluate(i => window.LEVELS[i].wrongs || [], i)) {
    await t(`${i + 1}面: ほかの間違いも失敗 ${wr.join('→')}`, async () => { const r = await playLevel(p, i, wr); expect(r.state === 'fail', JSON.stringify(r)); return r.reason })
  }
  if (i >= HARD) await t(`${i + 1}面: 2回失敗したあと、光るピンだけを順に押すとクリアできる`, async () => {
    await p.evaluate(i => { pinr.dbg.setFails(i, 2); pinr.load(i, { button: false, variant: { tie: false } }); pinr.dbg.pause(true); pinr.dbg.settleView() }, i)
    const seq = []
    for (let k = 0; k < 10; k++) {
      const h = await p.evaluate(() => { for (let n = 0; n < 600 && pinr.w.state === 'play' && !pinr.hint; n++) pinr.dbg.step(1); return pinr.w.state === 'play' ? pinr.hint : null })
      if (!h) break
      seq.push(h); await tapPin(p, h)
    }
    const r = await finishRun(p); await p.evaluate(i => pinr.dbg.setFails(i, 0), i)
    expect(r.state === 'clear', JSON.stringify(r) + seq.join('')); return seq.join('→')
  })
  await t(`${i + 1}面: 何もしないとクリアしない`, async () => {
    await p.evaluate(i => { pinr.load(i, { button: false, variant: { tie: false } }); pinr.dbg.pause(true); pinr.dbg.step(900) }, i)
    const r = await p.evaluate(() => ({ s: pinr.w.state, got: pinr.w.collected })); expect(r.s !== 'clear' && r.got === 0, JSON.stringify(r))
  })
}
await t('ピンでない所を押しても何も抜けない', async () => {
  await p.evaluate(() => { pinr.load(0, { button: false }); pinr.dbg.pause(true) })
  const v = await p.evaluate(() => pinr.view)
  await p.mouse.click(v.ox + 120 * v.s, v.oy + 470 * v.s)
  const n = await p.evaluate(() => pinr.w.pulls.length); expect(n === 0, n)
})
await t('ピンの棒の真ん中を押しても抜ける', async () => {
  await p.evaluate(() => { pinr.load(0, { button: false }); pinr.dbg.pause(true) })
  const xy = await p.evaluate(() => pinr.pinXY('A')); await p.mouse.click(xy.mx, xy.my)
  const n = await p.evaluate(() => pinr.w.pulls.map(q => q.id).join()); expect(n === 'A', n)
})
await t('2回失敗した面は、次の正解のピンが光る（ヒント）', async () => {
  // 上の通しで4面は1回失敗している。もう1回失敗させてから開き直す
  const before = await p.evaluate(() => { pinr.load(3); return pinr.hint })
  await playLevel(p, 3, ['M'])
  const after = await p.evaluate(() => { pinr.load(3); return pinr.hint })
  expect(before === null && after === 'W', JSON.stringify({ before, after }))
  await tapPin(p, 'W'); await p.evaluate(() => pinr.dbg.step(1)); expect(await p.evaluate(() => pinr.hint) === null, 'hint stays after pull')
  await settle(p); const nx = await p.evaluate(() => pinr.hint); expect(nx === 'M', 'next hint ' + nx)
})
await t('失敗の語りは最初が「最初は、だいたいこうなります。」', async () => {
  const q = await open(browser)
  await q.evaluate(() => { pinr.load(0, { button: false }); pinr.dbg.pause(true) })
  await tapPin(q, 'B'); await finishRun(q)
  const n = await q.evaluate(() => document.getElementById('narr').textContent); await q.close()
  expect(n === '最初は、だいたいこうなります。', n)
})
await t('画像で保存・Xでポスト（失敗の画面）', async () => {
  await p.evaluate(() => { pinr.load(0, { button: false }); pinr.dbg.pause(true) })
  await tapPin(p, 'B'); await finishRun(p)
  const dl = p.waitForEvent('download', { timeout: 5000 })
  await tap(p, '#bSave'); const d = await dl
  const href = await p.evaluate(() => document.getElementById('bPost').href)
  expect(/pin-rescue-1\.png/.test(d.suggestedFilename()) && /x\.com\/intent\/post/.test(href) && /tom3games\.github\.io%2Fpin-rescue/.test(href), d.suggestedFilename() + ' ' + href)
})
await t('まれな変化（ネクタイの魔物・ボタンの金貨）でも落ちない', async () => {
  await p.evaluate(() => { pinr.load(3, { button: true, variant: { tie: true } }); pinr.dbg.pause(true) })
  for (const id of ['W', 'M']) { await tapPin(p, id); await settle(p) }
  const r = await finishRun(p); await p.screenshot({ path: `${ROOT}/shots/rare.png` })
  expect(r.state === 'clear' && !p.errs.length, JSON.stringify(r) + p.errs.join('|'))
})
await t('12面クリアの語りは「ここから先は、少しだけ意地悪です。」・次へで13面（上級の札）', async () => {
  const r = await playLevel(p, HARD - 1, await p.evaluate(i => window.LEVELS[i].solve, HARD - 1)); expect(r.state === 'clear', JSON.stringify(r))
  const n = await p.evaluate(() => document.getElementById('narr').textContent); expect(n === 'ここから先は、少しだけ意地悪です。', n)
  await tap(p, '#bNext')
  const q = await p.evaluate(() => ({ lv: pinr.lv, tag: !document.getElementById('lvTag').hidden && document.getElementById('lvTag').textContent, hard: document.querySelector('.lvplate').classList.contains('hard') }))
  await p.screenshot({ path: `${ROOT}/shots/lv13-start.png` })
  expect(q.lv === HARD && q.tag === '上級' && q.hard, JSON.stringify(q)); return q
})
await t('最終面クリアで最後の画面（全N面・絵が描けている・最初から・支援リンク）', async () => {
  const r = await playLevel(p, N - 1, await p.evaluate(i => window.LEVELS[i].solve, N - 1)); expect(r.state === 'clear', JSON.stringify(r))
  expect(await p.evaluate(() => document.getElementById('bNext').textContent) === '次へ', 'next label')
  await tap(p, '#bNext'); await p.waitForTimeout(300)
  const v = await variance(p, '#endCv'), m = await p.evaluate(() => pinr.mode), sup = await p.evaluate(() => !!document.getElementById('tmSupport'))
  await p.screenshot({ path: `${ROOT}/shots/end.png` })
  expect(m === 'end' && v > 300 && sup, JSON.stringify({ m, v, sup }))
  await tap(p, '#bAgain'); expect(await p.evaluate(() => pinr.mode === 'play' && pinr.lv === 0), 'again')
})
await t('English に切り替えると文言が英語', async () => {
  await tap(p, '#bMenu'); await tap(p, '#bLang')
  const r = await p.evaluate(() => [document.getElementById('bStart').textContent, document.getElementById('tl2').textContent])
  await p.screenshot({ path: `${ROOT}/shots/title-en.png` })
  await tap(p, '#bStart')
  const c = await p.evaluate(() => document.getElementById('capT').textContent)
  expect(/Play|Continue/.test(r[0]) && /[A-Za-z]/.test(c), JSON.stringify(r) + c)
  await tap(p, '#bMenu'); await tap(p, '#bLang')
})
await t('ミュートの切り替え', async () => {
  await tap(p, '#bMute'); const a = await p.evaluate(() => Snd.muted); await tap(p, '#bMute'); const b = await p.evaluate(() => Snd.muted)
  expect(a === true && b === false, [a, b])
})
await t('ここまでエラーなし（Chromium）', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await p.close()

// ---- 3サイズ × 全画面で一画面に収まる・ピンが全部画面内・世界が HUD や板と重ならない
for (const [w, h, name] of SIZES) {
  const q = await open(browser, { viewport: { width: w, height: h } })
  const views = {}
  await q.waitForTimeout(400)
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await tap(q, '#bHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` }); await tap(q, '#bHowClose')
  await tap(q, '#bStages'); views.stages = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-stages.png` })
  await tap(q, '#tabHard'); views.stagesHard = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-stages-hard.png` })
  await t(`${name}: ステージ選択の上級ページに13面からが並び、まだ遊べない面は押せない`, async () => {
    const r = await q.evaluate(() => [...document.querySelectorAll('#grid button')].map(b => [b.querySelector('b').textContent, b.disabled]))
    expect(r.length === N - HARD && r[0][0] === String(HARD + 1) && r.every(x => x[1]), JSON.stringify(r.slice(0, 3)))
  })
  await tap(q, '#tabBasic'); await t(`${name}: 基本ページに戻ると1〜12面`, async () => { const n = await q.evaluate(() => document.querySelectorAll('#grid button').length); expect(n === HARD, n) })
  await tap(q, '#bStBack')
  await tap(q, '#bStart'); await q.waitForTimeout(300); views.play = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-play.png` })
  await t(`${name}: 全${N}面のピンの輪っかが画面内・44px 相当の押せる幅・輪っか同士が近すぎない`, async () => {
    const out = []
    for (let i = 0; i < N; i++) {
      const r = await q.evaluate(i => { pinr.load(i, { button: false }); pinr.dbg.pause(true); pinr.dbg.settleView(); const v = pinr.view, hud = document.querySelector('.hud').getBoundingClientRect().bottom; return { pins: pinr.w.pins.map(p => pinr.pinXY(p.id)), s: v.s, top: v.oy, hud, W: innerWidth, H: innerHeight } }, i)
      for (const xy of r.pins) if (xy.x < 4 || xy.x > r.W - 4 || xy.y < r.hud || xy.y > r.H - 4) out.push(`${i + 1}:${Math.round(xy.x)},${Math.round(xy.y)}`)
      if (r.top < r.hud - 1) out.push(`${i + 1}: world under hud`)
      if (Math.max(20, 26 / r.s) * 2 * r.s < 44) out.push(`${i + 1}: hit ${r.s}`)
      for (let a = 0; a < r.pins.length; a++) for (let b = a + 1; b < r.pins.length; b++) if (Math.hypot(r.pins[a].x - r.pins[b].x, r.pins[a].y - r.pins[b].y) < 30) out.push(`${i + 1}: rings close ${a},${b}`)
    }
    expect(!out.length, out.join(' '))
  })
  await q.evaluate(() => { pinr.load(0, { button: false }); pinr.dbg.pause(true) })
  await tapPin(q, 'B'); await finishRun(q); await q.evaluate(() => pinr.dbg.pause(false)); await q.waitForTimeout(700)
  views.fail = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-fail.png` })
  await t(`${name}: 決着の時、勇者が板に隠れない`, async () => {
    const r = await q.evaluate(() => { const v = pinr.view, top = document.getElementById('sheet').getBoundingClientRect().top; return { heroY: v.oy + 576 * v.s, top } })
    expect(r.heroY <= r.top + 2, JSON.stringify(r)); return r
  })
  await q.evaluate(i => { pinr.load(i, { button: false, variant: { tie: false } }); pinr.dbg.pause(true) }, N - 1)
  for (const id of await q.evaluate(i => window.LEVELS[i].solve, N - 1)) { await tapPin(q, id); await settle(q) }
  await finishRun(q); await tap(q, '#bNext'); await q.waitForTimeout(300)
  views.end = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-end.png` })
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, JSON.stringify(r)) })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.close()
}
await browser.close()

// ---- WebKit（iPhone 相当）: 指でタップして全12面を解く
const wb = await webkit.launch(MUTE_LAUNCH)
const wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await t('WebKit: 2本指の touchmove を止める', async () => {
  const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
  expect(r, r)
})
await t('WebKit: 始めるをタップして1面を指で解く', async () => {
  await tap(wp, '#bStart', true); await wp.evaluate(() => pinr.dbg.pause(true))
  await tapPin(wp, 'A', true); await settle(wp); const r = await finishRun(wp)
  expect(r.state === 'clear', JSON.stringify(r))
})
await t('WebKit: 実際には無音（タップで音を鳴らしたあと）', async () => { const r = await wp.evaluate(() => ({ ok: window.__muteOk(), calls: window.__soundCalls })); expect(r.ok && r.calls > 0, JSON.stringify(r)); return r })
for (let i = 1; i < N; i++) {
  await t(`WebKit: ${i + 1}面を指で解く`, async () => { const r = await playLevel(wp, i, await wp.evaluate(i => window.LEVELS[i].solve, i), true); expect(r.state === 'clear', JSON.stringify(r)) })
}
await wp.screenshot({ path: `${ROOT}/shots/webkit-last.png` })
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
