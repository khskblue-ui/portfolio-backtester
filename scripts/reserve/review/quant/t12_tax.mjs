import { SCEN, simG, pct } from './lib.mjs'
for (const s of SCEN) {
  const p = simG(s.dates, s.assets, s.base, { tax: 0.22 }), h = simG(s.dates, s.assets, s.base, { mode: 'hold', tax: 0.22 })
  console.log(s.id, `실현분만: 규칙 ${pct(p.cagr, 2).trim()} 그냥둠 ${pct(h.cagr, 2).trim()} (차 ${pct(p.cagr - h.cagr, 2).trim()}) | 기간 끝 전량 매도: 규칙 ${pct(p.cagrLiq, 2).trim()} 그냥둠 ${pct(h.cagrLiq, 2).trim()} (차 ${pct(p.cagrLiq - h.cagrLiq, 2).trim()}) | 미실현 차익/자산: 규칙 ${pct(p.embFrac, 0).trim()} 그냥둠 ${pct(h.embFrac, 0).trim()}`)
}
