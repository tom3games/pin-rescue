// 抜く間隔を細かく変えて、解き方はクリア・間違いは失敗になるかを数える。node tools/sweep.mjs
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const root = new URL('..', import.meta.url).pathname
vm.runInThisContext(readFileSync(root + 'engine.js', 'utf8')); vm.runInThisContext(readFileSync(root + 'levels.js', 'utf8'))
const E = globalThis.PinEngine, LV = globalThis.LEVELS
const W = [1, 1.3, 2, 2.7, 3.4, 4.5, 6]
let bad = 0
LV.forEach((d, i) => {
  const s = W.map(t => E.runScript(d, d.solve.map(id => [id, t])).state)
  const w = W.map(t => E.runScript(d, d.wrong.map(id => [id, t])).state)
  const ns = s.filter(x => x === 'clear').length, nw = w.filter(x => x === 'fail').length
  if (ns < W.length || nw < W.length) bad++
  console.log(`${i + 1} ${d.key.padEnd(9)} solve clear ${ns}/${W.length} [${s.join(' ')}]  wrong fail ${nw}/${W.length} [${w.join(' ')}]`)
})
process.exit(bad ? 1 : 0)
