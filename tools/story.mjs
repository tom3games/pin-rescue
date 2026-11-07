// 面ごとに、台本どおりに抜いた途中を撮って横に並べる（音は出さない）。node tools/story.mjs <面...> [--wrong] [--sec=3]
import { MUTE_LAUNCH, muteContext } from '../mute.mjs'
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
const ROOT = new URL('..', import.meta.url).pathname, PORT = 5953
const OUT = process.env.STORY_OUT || (os.tmpdir() + '/pin-rescue-story')
mkdirSync(OUT, { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const args = process.argv.slice(2), lvs = args.filter(a => /^\d+$/.test(a)).map(Number), wrong = args.includes('--wrong')
const sec = Number((args.find(a => a.startsWith('--sec=')) || '--sec=3').slice(6))
const b = await chromium.launch(MUTE_LAUNCH)
const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })
await muteContext(ctx)
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto(`http://localhost:${PORT}/?notut=1`); await p.waitForFunction(() => window.__pinrReady, null, { timeout: 15000 })
for (const lv of lvs) {
  await p.evaluate(i => { pinr.load(i - 1, { button: false, variant: { tie: false } }); pinr.dbg.pause(true); pinr.dbg.settleView() }, lv)
  const order = await p.evaluate(([i, w]) => window.LEVELS[i - 1][w ? 'wrong' : 'solve'], [lv, wrong])
  const files = []
  let k = 0
  const snap = async () => { const f = `${OUT}/l${lv}-${k++}.png`; await p.screenshot({ path: f, clip: { x: 0, y: 0, width: 390, height: 760 } }); files.push(f) }
  await snap()
  for (const id of order) {
    await p.evaluate(([id, n]) => { window.PinEngine.pull(pinr.w, id); for (let i = 0; i < n && pinr.w.state === 'play'; i++) pinr.dbg.step(1) }, [id, Math.round(sec * 60)])
    await snap()
  }
  await p.evaluate(() => { for (let i = 0; i < 360 && pinr.w.state === 'play'; i++) pinr.dbg.step(1) })
  const st = await p.evaluate(() => `${pinr.w.state}/${pinr.w.reason} ${pinr.w.collected}/${pinr.w.need}`)
  await snap()
  execFileSync(process.env.HOME + '/tools/pyimg/bin/python', [process.env.HOME + '/Desktop/claudecode/_shared/montage.py', `${OUT}/L${lv}${wrong ? 'w' : ''}.png`, ...files, '--h', '520'])
  console.log(lv, order.join(','), st)
}
console.log(errs.length ? errs.join('\n') : 'no errors')
await b.close(); server.kill()
