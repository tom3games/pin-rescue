import '../mute-auto.mjs'
// ステージ選択（上級）・遊び方・最終面を2サイズで撮る（無音）。node tools/uishot.mjs <出力先>
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ROOT = new URL('..', import.meta.url).pathname, PORT = 5971, SP = process.argv[2]
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch()
for (const [w, h] of [[360, 640], [430, 932]]) {
  const ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: w, height: h } })
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(`http://localhost:${PORT}/?all=1&notut=1`); await p.waitForFunction(() => window.__pinrReady)
  if (!(await p.evaluate(() => window.__muteOk()))) throw new Error('mute')
  await p.waitForTimeout(1500); await p.screenshot({ path: `${SP}/ui-${w}-title.png` })
  await p.click('#bStages'); await p.click('#tabHard'); await p.waitForTimeout(200); await p.screenshot({ path: `${SP}/ui-${w}-hard.png` })
  await p.click('#bStBack'); await p.click('#bHow'); await p.waitForTimeout(200); await p.screenshot({ path: `${SP}/ui-${w}-how.png` })
  await p.click('#bHowClose'); await p.evaluate(() => { pinr.load(pinr.levels - 1, { button: false }) }); await p.waitForTimeout(300); await p.screenshot({ path: `${SP}/ui-${w}-last.png` })
  console.log(w, errs.join('|') || 'no errors', await p.evaluate(() => window.__muteOk()))
  await ctx.close()
}
await b.close(); server.kill()
