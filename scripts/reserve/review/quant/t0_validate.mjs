import { SCEN, simRef, simG, pct } from './lib.mjs'
for (const s of SCEN) {
  for (const [name, a, b] of [['plan', {}, {}], ['hold', { rule: false }, { mode: 'hold' }], ['nolower', { lower: false }, { useLower: false }], ['up35', { upper: 0.35 }, { upper: 0.35 }], ['tax', { tax: 0.22 }, { tax: 0.22 }], ['c3', { contrib: 0.03 }, { contrib: 0.03 }], ['notrim', { trim: false }, { trim: false }]]) {
    const r = simRef(s.dates, s.assets, s.base, a), g = simG(s.dates, s.assets, s.base, b)
    console.log(s.id, name.padEnd(8), 'ref', pct(r.cagr, 2), pct(r.mdd, 2), r.buys.length, r.sells.length, '| G', pct(g.cagr, 2), pct(g.mdd, 2), g.buys.length, g.sells.length, Math.abs(r.final.V - g.final.V) < 1e-6 ? 'OK' : 'DIFF')
  }
}
