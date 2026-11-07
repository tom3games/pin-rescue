// 全部の面を node で回す。解ける順番でクリア・間違った順番で失敗・何もしないとクリアしない
// node tools/check.mjs [面番号]
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const root = new URL('..', import.meta.url).pathname
vm.runInThisContext(readFileSync(root + 'engine.js', 'utf8'))
vm.runInThisContext(readFileSync(root + 'levels.js', 'utf8'))
const E = globalThis.PinEngine, LV = globalThis.LEVELS
const only = process.argv[2] ? [Number(process.argv[2]) - 1] : LV.map((_, i) => i)
let bad = 0
for (const i of only) {
  const d = LV[i], t0 = performance.now()
  const s = E.runScript(d, d.solve), w = E.runScript(d, d.wrong), n = E.runScript(d, [])
  const fast = E.runScript(d, d.solve.map(id => [id, 0.6]))
  // 人の間合いはばらつくので、抜く間隔を変えても同じ結果になるか
  const sweep = [1.5, 2.5, 4].map(sec => [E.runScript(d, d.solve.map(id => [id, sec])).state, E.runScript(d, d.wrong.map(id => [id, sec])).state])
  const robust = sweep.every(([a, b]) => a === 'clear' && b === 'fail')
  const ok = s.state === 'clear' && w.state === 'fail' && n.state !== 'clear' && robust
  if (!ok) bad++
  const f = x => `${x.state}${x.reason ? '/' + x.reason : ''} c${x.collected}/${x.coinsTotal} m${x.melted} t${x.t.toFixed(1)}`
  console.log(`${ok ? 'ok ' : 'NG '} ${i + 1} ${d.key.padEnd(8)} solve=${f(s)} | wrong=${f(w)} | none=${f(n)} | fast=${f(fast)} | sweep=${sweep.map(x => x.join('/')).join(' ')}  ${(performance.now() - t0 | 0)}ms`)
}
process.exit(bad ? 1 : 0)
