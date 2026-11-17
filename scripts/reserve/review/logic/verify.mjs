import { sim } from './orig.mjs'
import { sim2, pct } from './sim2.mjs'
import { SCEN } from './base.mjs'
for (const s of SCEN) for (const opt of [{}, { rule: false }, { lower: false }, { lowerTo: 0.25 }, { upper: 0.35 }, { contrib: 0.03 }, { tax: 0.22 }]) {
  const a = sim(s.dates, s.assets, s.base, opt), b = sim2(s.dates, s.assets, s.base, opt)
  const ok = Math.abs(a.cagr - b.cagr) < 1e-12 && Math.abs(a.mdd - b.mdd) < 1e-12 && a.events.length === b.events.filter((e) => ['buy', 'sell', 'trim'].includes(e.type)).length
  console.log(s.id, JSON.stringify(opt), ok ? 'OK' : 'MISMATCH', pct(a.cagr, 3), pct(b.cagr, 3))
}
