// 面づくり用。node tools/try.mjs <面番号> [--all]  解き方・間違い・何もしない・間隔違い、--all で全部の抜く順番を試してクリアになる順番を数える
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const root = new URL('..', import.meta.url).pathname
vm.runInThisContext(readFileSync(root + 'engine.js', 'utf8')); vm.runInThisContext(readFileSync(root + 'levels.js', 'utf8'))
for (const f of (process.env.EXTRA || '').split(',').filter(Boolean)) vm.runInThisContext(readFileSync(f, 'utf8'))   // 作りかけの面（面づくり用）
const E = globalThis.PinEngine, LV = globalThis.LEVELS
const args = process.argv.slice(2), i = Number(args[0]) - 1, d = LV[i]
const f = x => `${x.state}${x.reason ? '/' + x.reason : ''} c${x.collected}/${x.need}(${x.coinsTotal}) m${x.melted} l${x.lost} t${x.t.toFixed(1)} mon${x.bodies.filter(b => b.kind === 'monster' && b.alive).length}`
console.log('solve', d.solve.join(''), f(E.runScript(d, d.solve)))
console.log('wrong', d.wrong.join(''), f(E.runScript(d, d.wrong)))
for (const w of d.wrongs || []) console.log('wrong', w.join(''), f(E.runScript(d, w)))
console.log('none ', f(E.runScript(d, [])))
for (const t of [0.6, 1, 1.3, 2, 3, 4.5, 6]) console.log('solve@' + t, f(E.runScript(d, d.solve.map(id => [id, t]))))
if (args.includes('--all')) {
  const ids = d.pins.map(p => p.id), res = []
  const perm = (a, pre) => { if (!a.length) return res.push(pre); for (const x of a) perm(a.filter(y => y !== x), pre.concat(x)) }
  perm(ids, [])
  const seen = new Map()
  for (const o of res) {
    const w = E.runScript(d, o)
    // 失敗が決まった所までの順番でまとめる
    const k = w.state === 'clear' ? o.slice(0, w.pulls.length).join('') : o.slice(0, w.pulls.length).join('') + '…'
    if (!seen.has(k)) seen.set(k, f(w))
  }
  const cl = [...seen].filter(([k, v]) => v.startsWith('clear'))
  console.log(`orders ${res.length}, distinct ${seen.size}, clear ${cl.length}:`, cl.map(x => x[0]).join(' '))
  if (args.includes('-v')) for (const [k, v] of seen) console.log('  ', k.padEnd(9), v)
}
