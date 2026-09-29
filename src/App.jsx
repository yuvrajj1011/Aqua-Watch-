import { useState, useEffect, useRef } from 'react'

const META = {
  ph: { n: 'pH', u: '', d: 2 },
  turb: { n: 'Turbidity', u: 'NTU', d: 1 },
  tds: { n: 'TDS', u: 'ppm', d: 0 },
  ec: { n: 'Conductivity', u: 'µS/cm', d: 0 },
  temp: { n: 'Temperature', u: '°C', d: 1 },
}
const DEF_LIM = { ph: [6.5, 8.5], turb: [0, 5], tds: [0, 500], ec: [0, 1000], temp: [10, 35] }
const BASE = { ph: 7.2, turb: 1.2, tds: 210, ec: 420, temp: 26 }
const EVENTS = { salt: { tds: 950, ec: 1900 }, mud: { turb: 14 }, acid: { ph: 4.8 }, heat: { temp: 41 } }
const EV_LABEL = { salt: 'Add salt', mud: 'Add mud', acid: 'Acid spill', heat: 'Heat spike' }
const TONE = { Safe: 'bg-emerald-100 text-emerald-800', Moderate: 'bg-amber-100 text-amber-800', Unsafe: 'bg-red-100 text-red-800' }
const STROKE = { Safe: '#2f9e6f', Moderate: '#e0a030', Unsafe: '#d64545' }
const PHASES = [
  ['Literature survey and component procurement', 'Week 1-2', 'done'],
  ['Sensor interfacing and calibration (ESP32)', 'Week 3-4', 'doing'],
  ['Cloud integration and dashboard', 'Week 5', 'doing'],
  ['Dataset collection and ML model training', 'Week 6-7', 'todo'],
  ['ML + live pipeline + Telegram/email alerts', 'Week 8', 'todo'],
  ['System testing with contaminated samples', 'Week 9-10', 'todo'],
]
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const risk = (k, v, l) => (k === 'ph' || k === 'temp' ? Math.abs(v - (l[0] + l[1]) / 2) / ((l[1] - l[0]) / 2) : v / l[1])
const fmt = (k, v) => v.toFixed(META[k].d)
const tm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// Placeholder for the Random Forest model. Replace with fetch('/predict') to your Python service later.
function classify(r, l) {
  const rs = Object.keys(META).map((k) => risk(k, r[k], l[k]))
  const avg = rs.reduce((a, b) => a + b) / rs.length
  const wqi = Math.round(clamp(100 - (avg + Math.max(...rs)) * 25, 0, 100))
  return { wqi, label: wqi >= 70 ? 'Safe' : wqi >= 45 ? 'Moderate' : 'Unsafe' }
}

function Chart({ data, lim, color }) {
  const W = 600, H = 190
  const min = Math.min(...data, lim[0]), max = Math.max(...data, lim[1])
  const y = (v) => H - ((v - min) / (max - min || 1)) * H
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${(i / (data.length - 1)) * W},${y(v)}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Trend chart">
      <rect x="0" y={y(lim[1])} width={W} height={Math.abs(y(lim[0]) - y(lim[1]))} fill="#2f9e6f" opacity=".1" />
      <line x1="0" x2={W} y1={y(lim[1])} y2={y(lim[1])} stroke="#d64545" strokeDasharray="5 5" opacity=".6" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  )
}

const Toggle = ({ on, set }) => (
  <button onClick={() => set(!on)} aria-pressed={on} className={`w-11 h-6 rounded-full p-0.5 transition ${on ? 'bg-aqua' : 'bg-slate-300'}`}>
    <span className={`block w-5 h-5 rounded-full bg-white transition ${on ? 'translate-x-5' : ''}`} />
  </button>
)
const Panel = ({ title, right, children }) => (
  <section className="bg-white rounded-lg border border-slate-200 p-5">
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-semibold">{title}</h2>
      {right}
    </div>
    {children}
  </section>
)

export default function App() {
  const [page, setPage] = useState('dash')
  const [lim, setLim] = useState(DEF_LIM)
  const [cfg, setCfg] = useState({ interval: 2, telegram: true, email: true, sms: false })
  const [running, setRunning] = useState(true)
  const [ev, setEv] = useState(null)
  const [sel, setSel] = useState('ph')
  const [admin, setAdmin] = useState(false)
  const [cred, setCred] = useState({ u: '', p: '', err: false })
  const [alerts, setAlerts] = useState([])
  const [toast, setToast] = useState(null)
  const [nodes, setNodes] = useState([
    { id: 'N-01', name: 'Overhead tank inlet', on: true, live: true },
    { id: 'N-02', name: 'Ward 4 distribution line', on: false },
    { id: 'N-03', name: 'Borewell outlet', on: false },
  ])
  const rRef = useRef({ ...BASE })
  const prev = useRef('Safe')
  const [hist, setHist] = useState(() =>
    Array.from({ length: 30 }, (_, i) => {
      const r = {}
      for (const k in BASE) r[k] = BASE[k] * (1 + (Math.random() - 0.5) * 0.04)
      return { ...r, ...classify(r, DEF_LIM), t: new Date(Date.now() - (30 - i) * 2000) }
    })
  )
  const now = hist[hist.length - 1]

  const fire = (msg) => {
    setAlerts((a) => [{ id: Date.now(), t: new Date(), msg, ack: false }, ...a])
    const ch = [cfg.telegram && 'Telegram', cfg.email && 'Email', cfg.sms && 'SMS'].filter(Boolean)
    setToast(ch.length ? `Alert sent via ${ch.join(', ')}` : 'Alert logged. All channels are off.')
  }

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const tgt = { ...BASE, ...(EVENTS[ev] || {}) }
      const nx = {}
      for (const k in BASE) nx[k] = rRef.current[k] + (tgt[k] - rRef.current[k]) * 0.25 + (Math.random() - 0.5) * BASE[k] * 0.02
      rRef.current = nx
      setHist((h) => [...h.slice(-59), { ...nx, ...classify(nx, lim), t: new Date() }])
    }, cfg.interval * 1000)
    return () => clearInterval(id)
  }, [running, ev, lim, cfg.interval])

  useEffect(() => {
    if (now.label === 'Unsafe' && prev.current !== 'Unsafe') {
      const k = Object.keys(META).sort((a, b) => risk(b, now[b], lim[b]) - risk(a, now[a], lim[a]))[0]
      fire(`${META[k].n} reached ${fmt(k, now[k])} ${META[k].u} (WQI ${now.wqi})`)
    }
    prev.current = now.label
  }, [hist])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(id)
  }, [toast])

  const open = alerts.filter((a) => !a.ack).length
  const nav = [['dash', 'Dashboard'], ['alerts', 'Alerts'], ['progress', 'Build progress'], ['admin', 'Admin']]
  const circ = 2 * Math.PI * 52

  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-56 bg-ink text-white md:min-h-screen p-4 flex md:flex-col gap-1 overflow-x-auto">
        <div className="hidden md:block mb-6 px-2">
          <div className="text-lg font-bold">AquaWatch</div>
          <div className="text-xs text-slate-400">Water supply monitor</div>
        </div>
        {nav.map(([id, label]) => (
          <button key={id} onClick={() => setPage(id)} className={`text-left px-3 py-2 rounded-md text-sm whitespace-nowrap flex justify-between items-center ${page === id ? 'bg-white/15' : 'hover:bg-white/10 text-slate-300'}`}>
            {label}
            {id === 'alerts' && open > 0 && <span className="ml-3 bg-red-500 text-white text-xs rounded-full px-1.5">{open}</span>}
          </button>
        ))}
        <div className="hidden md:block mt-auto text-xs text-slate-400 px-2">Prototype v0.1 · simulated data</div>
      </aside>

      <main className="flex-1 p-4 md:p-8 space-y-6 max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{nav.find((n) => n[0] === page)[1]}</h1>
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${running ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              N-01 Overhead tank inlet · {running ? `updating every ${cfg.interval}s` : 'paused'} · last reading {tm(now.t)}
            </p>
          </div>
          <button onClick={() => setRunning(!running)} className="px-4 py-2 rounded-md border border-slate-300 bg-white text-sm hover:bg-slate-50">
            {running ? 'Pause feed' : 'Resume feed'}
          </button>
        </header>

        {page === 'dash' && (
          <>
            <div className="grid lg:grid-cols-3 gap-6">
              <Panel title="Water quality now">
                <div className="flex items-center gap-5">
                  <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="#e5edef" strokeWidth="10" />
                    <circle cx="60" cy="60" r="52" fill="none" stroke={STROKE[now.label]} strokeWidth="10" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - now.wqi / 100)} style={{ transition: 'all .6s' }} />
                    <text x="60" y="66" textAnchor="middle" className="rotate-90 origin-center" style={{ fontSize: 28, fontWeight: 700, fill: '#0e2a33' }}>{now.wqi}</text>
                  </svg>
                  <div>
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${TONE[now.label]}`}>{now.label}</span>
                    <p className="text-sm text-slate-500 mt-3">Water Quality Index from the classifier (demo model).</p>
                  </div>
                </div>
              </Panel>
              <div className="lg:col-span-2">
                <Panel title="Test bench" right={<span className="text-xs text-slate-500">Simulate a contamination event</span>}>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(EV_LABEL).map((e) => (
                      <button key={e} onClick={() => setEv(ev === e ? null : e)} className={`px-4 py-2 rounded-md text-sm border ${ev === e ? 'bg-red-600 text-white border-red-600' : 'bg-white border-slate-300 hover:bg-slate-50'}`}>
                        {EV_LABEL[e]}
                      </button>
                    ))}
                    <button onClick={() => setEv(null)} className="px-4 py-2 rounded-md text-sm bg-aqua text-white hover:opacity-90">Flush with clean water</button>
                  </div>
                  <p className="text-sm text-slate-500 mt-4">Mirrors the lab tests in the plan: salt shifts TDS and conductivity, mud raises turbidity. The classifier and the alert respond to the change.</p>
                </Panel>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {Object.keys(META).map((k) => {
                const r = risk(k, now[k], lim[k])
                const st = r >= 1 ? ['Breach', 'text-red-600'] : r >= 0.8 ? ['Watch', 'text-amber-600'] : ['Normal', 'text-emerald-700']
                return (
                  <button key={k} onClick={() => setSel(k)} className={`text-left bg-white rounded-lg border p-4 ${sel === k ? 'border-aqua ring-1 ring-aqua' : 'border-slate-200'}`}>
                    <div className="text-sm text-slate-500">{META[k].n}</div>
                    <div className="text-2xl font-bold mt-1">{fmt(k, now[k])} <span className="text-sm font-normal text-slate-400">{META[k].u}</span></div>
                    <div className={`text-xs font-medium mt-1 ${st[1]}`}>{st[0]}</div>
                  </button>
                )
              })}
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <Panel title={`${META[sel].n} trend`} right={<span className="text-xs text-slate-500">Green band = safe range</span>}>
                  <Chart data={hist.map((h) => h[sel])} lim={lim[sel]} color="#1b9aaa" />
                </Panel>
              </div>
              <Panel title="Sensor nodes">
                <ul className="space-y-3 text-sm">
                  {nodes.map((n) => (
                    <li key={n.id} className="flex justify-between gap-2">
                      <span>{n.id} {n.name}</span>
                      <span className={n.live ? 'text-emerald-700 font-medium' : 'text-slate-400'}>{n.live ? 'Online' : 'Awaiting hardware'}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </>
        )}

        {page === 'alerts' && (
          <Panel title="Alert log" right={<button onClick={() => setAlerts([])} className="text-sm text-slate-500 hover:text-red-600">Clear all</button>}>
            {alerts.length === 0 ? (
              <p className="text-slate-500 text-sm">No alerts yet. Trigger a contamination event on the dashboard to see one here.</p>
            ) : (
              <ul className="divide-y">
                {alerts.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className={`text-sm font-medium ${a.ack ? 'text-slate-400' : ''}`}>Unsafe water: {a.msg}</div>
                      <div className="text-xs text-slate-500">{tm(a.t)} · N-01 Overhead tank inlet</div>
                    </div>
                    <button onClick={() => setAlerts((l) => l.map((x) => (x.id === a.id ? { ...x, ack: !x.ack } : x)))} className="text-sm px-3 py-1 rounded-md border border-slate-300 hover:bg-slate-50">
                      {a.ack ? 'Reopen' : 'Acknowledge'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {page === 'progress' && (
          <Panel title="Implementation plan (10 weeks)">
            <ul className="space-y-3">
              {PHASES.map(([t, w, s]) => (
                <li key={t} className="flex items-center justify-between gap-3 text-sm border-b pb-3 last:border-0">
                  <div><div className="font-medium">{t}</div><div className="text-xs text-slate-500">{w}</div></div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${s === 'done' ? 'bg-emerald-100 text-emerald-800' : s === 'doing' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                    {s === 'done' ? 'Completed' : s === 'doing' ? 'In progress' : 'Planned'}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {page === 'admin' && !admin && (
          <Panel title="Administrator sign in">
            <div className="max-w-xs space-y-3">
              <input placeholder="Username" value={cred.u} onChange={(e) => setCred({ ...cred, u: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
              <input type="password" placeholder="Password" value={cred.p} onChange={(e) => setCred({ ...cred, p: e.target.value })} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
              {cred.err && <p className="text-sm text-red-600">Username or password is incorrect.</p>}
              <button onClick={() => (cred.u === 'admin' && cred.p === 'water123' ? setAdmin(true) : setCred({ ...cred, err: true }))} className="px-4 py-2 rounded-md bg-ink text-white text-sm">Sign in</button>
              <p className="text-xs text-slate-400"></p>
            </div>
          </Panel>
        )}

        {page === 'admin' && admin && (
          <div className="grid lg:grid-cols-2 gap-6">
            <Panel title="Safe limits">
              <div className="space-y-3">
                {Object.keys(META).map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2 text-sm">
                    <span className="w-28">{META[k].n}</span>
                    {[0, 1].map((i) => (
                      <input key={i} type="number" step="0.1" value={lim[k][i]} onChange={(e) => setLim({ ...lim, [k]: lim[k].map((v, j) => (j === i ? +e.target.value : v)) })} className="w-24 border border-slate-300 rounded-md px-2 py-1" />
                    ))}
                  </div>
                ))}
                <button onClick={() => setLim(DEF_LIM)} className="text-sm text-aqua">Restore WHO-based defaults</button>
              </div>
            </Panel>
            <Panel title="Alerts and sampling">
              <div className="space-y-4 text-sm">
                {[['telegram', 'Telegram bot'], ['email', 'Email (SMTP)'], ['sms', 'SMS gateway']].map(([k, l]) => (
                  <div key={k} className="flex justify-between items-center">{l}<Toggle on={cfg[k]} set={(v) => setCfg({ ...cfg, [k]: v })} /></div>
                ))}
                <div className="flex justify-between items-center">Sampling interval
                  <select value={cfg.interval} onChange={(e) => setCfg({ ...cfg, interval: +e.target.value })} className="border border-slate-300 rounded-md px-2 py-1">
                    {[1, 2, 5, 10].map((s) => <option key={s} value={s}>{s} seconds</option>)}
                  </select>
                </div>
                <button onClick={() => fire('Test alert from the admin panel')} className="px-4 py-2 rounded-md bg-aqua text-white">Send test alert</button>
              </div>
            </Panel>
            <Panel title="Sensor nodes" right={<button onClick={() => setNodes([...nodes, { id: `N-0${nodes.length + 1}`, name: 'New node', on: false }])} className="text-sm text-aqua">Add node</button>}>
              <ul className="space-y-3 text-sm">
                {nodes.map((n, i) => (
                  <li key={n.id} className="flex justify-between items-center gap-2">
                    <input value={n.name} onChange={(e) => setNodes(nodes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="flex-1 border border-slate-300 rounded-md px-2 py-1" />
                    <Toggle on={n.on} set={(v) => setNodes(nodes.map((x, j) => (j === i ? { ...x, on: v } : x)))} />
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="ML model" right={<button onClick={() => { setAdmin(false); setCred({ u: '', p: '', err: false }) }} className="text-sm text-slate-500">Sign out</button>}>
              <div className="text-sm space-y-2">
                <div className="flex justify-between"><span>Algorithm</span><span>Random Forest</span></div>
                <div className="flex justify-between"><span>Training data</span><span>Kaggle water quality + prototype</span></div>
                <div className="flex justify-between"><span>Status</span><span className="text-amber-700">Training in progress</span></div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden"><div className="h-full w-2/5 bg-aqua" /></div>
                <p className="text-xs text-slate-500">Classification is currently a rule-based stand-in until the trained model is connected.</p>
              </div>
            </Panel>
          </div>
        )}
      </main>

      {toast && <div className="pop fixed bottom-6 right-6 bg-ink text-white text-sm px-4 py-3 rounded-lg shadow-lg" role="status">{toast}</div>}
    </div>
  )
}
