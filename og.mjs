import './mute-auto.mjs'
// SNS 用の画像（og.png 1200x630）と icon.png を作る。遊んでいる一番の山場（溶岩が勇者に迫る）＋題名。音は出さない
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ROOT = import.meta.dirname, PORT = 5955
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH)
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 1200, height: 630 } })
await muteContext(ctx)
const p = await ctx.newPage()
await p.goto(`http://localhost:${PORT}/?lv=1&notut=1`); await p.waitForFunction(() => window.__pinrReady)
await p.evaluate(() => document.fonts.ready)
await p.evaluate(() => {
  pinr.load(0, { button: false }); pinr.dbg.pause(true)
  for (const id of ['vPlay']) document.getElementById(id).hidden = true
  document.getElementById('bMute').hidden = true
  window.PinEngine.pull(pinr.w, 'B'); pinr.dbg.step(64)
  pinr.dbg.say('ちょっ、熱っ', 99)
  const s = 1.5; pinr.dbg.setView({ s, ox: 10, oy: -186 * s })
  const d = document.createElement('div'); d.id = 'ogt'
  d.innerHTML = `<p class="a">ピンを抜け！</p><h1>勇者と金貨</h1><p class="b">抜く順番で、勇者の運命が決まる。</p><p class="c">全30面（上級18面）・ダウンロードなし</p>`
  document.body.appendChild(d)
  const st = document.createElement('style'); st.textContent = `
    #ogt{position:fixed;left:556px;top:0;width:640px;height:630px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 40px 0 30px;z-index:9}
    #ogt .a{font-family:"RocknRoll One";font-size:56px;color:#fff;-webkit-text-stroke:8px #0d0a07;paint-order:stroke fill;transform:rotate(-2deg)}
    #ogt h1{font-family:"RocknRoll One";font-weight:400;font-size:104px;line-height:1.05;color:#f2c230;-webkit-text-stroke:12px #0d0a07;paint-order:stroke fill;filter:drop-shadow(0 8px 0 #000);transform:rotate(-2deg);margin:6px 0 4px;white-space:nowrap}
    #ogt .b{font-family:"Shippori Mincho B1";font-weight:600;font-size:32px;white-space:nowrap;color:#fff;text-shadow:0 3px 8px #000}
    #ogt .c{margin-top:22px;font-size:24px;font-weight:700;color:#d8c9b0}`
  document.head.appendChild(st)
})
await p.waitForTimeout(400)
await p.screenshot({ path: `${ROOT}/og.png` })
// アイコン: 勇者の顔と金貨
await p.setViewportSize({ width: 192, height: 192 })
await p.evaluate(() => {
  document.getElementById('ogt').remove()
  const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.id = 'ic'; c.style.cssText = 'position:fixed;left:0;top:0;z-index:99'
  document.body.appendChild(c); const g = c.getContext('2d')
  g.fillStyle = '#3a2e25'; g.fillRect(0, 0, 192, 192)
  g.save(); g.translate(96, 100); g.scale(2.7, 2.7); g.translate(-180, -40)
  pinr.art.drawHero(g, { x: 180, y: 70, dead: false, fear: 0, joy: 1, wet: 0 }, 0.26, false); g.restore()
})
await p.screenshot({ path: `${ROOT}/icon.png` })
await b.close(); server.kill()
console.log('og.png icon.png')
