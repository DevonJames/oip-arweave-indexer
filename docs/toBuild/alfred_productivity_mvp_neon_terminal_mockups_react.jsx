import React, { useMemo, useState } from "react";

// ===============================
// Alfred × SLObotics Unified Mockups
//  - Onboarding Wizard / Time Allocation Worksheet
//  - Main Task Entry & Weekly Planning Interface
//  - Routine Builder Interface
//  - Smart Calendar View
//  - Rewards System Interface
// Notes:
//  - This is a static, interactive mock (no backend).
//  - Visuals follow the provided neon-glass × retro-terminal aesthetic.
//  - Tailwind is not required; design tokens are mapped to CSS variables below.
// ===============================

export default function App() {
  return (
    <div className="app-root">
      <StyleTokens />
      <BackgroundDecor />
      <header className="hero">
        <AsciiHeader />
        <GlitchTitle text="ALFRED · CALENDAR OPS" />
        <p className="subtitle">own your time • neon-glass ops • retro-terminal flow</p>
        <div className="actions">
          <NeonButton label=">> INIT_BUILD_SEQUENCE" />
          <NeonButton label=">> LOAD_PRESET" variant="pink" />
        </div>
      </header>
      <main className="container">
        <ProductivityTabs />
      </main>
      <footer className="footer">© 2025 ALFRED · SLObotics // unified console</footer>
    </div>
  );
}

// ===============================
// Tabs Container
// ===============================
function ProductivityTabs() {
  const tabs = [
    { key: "onboarding", label: "Onboarding Wizard" },
    { key: "planner", label: "Weekly Planner" },
    { key: "routines", label: "Routine Builder" },
    { key: "calendar", label: "Smart Calendar" },
    { key: "rewards", label: "Rewards" },
  ];
  const [active, setActive] = useState("onboarding");

  return (
    <div className="tabs-wrap panel-glass">
      <div className="tablist" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            className={`tab-pill ${active === t.key ? "active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tabpanel">
        {active === "onboarding" && <OnboardingWizardMock />}
        {active === "planner" && <WeeklyPlannerMock />}
        {active === "routines" && <RoutineBuilderMock />}
        {active === "calendar" && <CalendarViewMock />}
        {active === "rewards" && <RewardsMock />}
      </div>
    </div>
  );
}

// ===============================
// Onboarding Wizard / Time Allocation Worksheet
// ===============================
function OnboardingWizardMock() {
  const [sleep, setSleep] = useState(8);
  const [workDays, setWorkDays] = useState(5);
  const [workHrs, setWorkHrs] = useState(8);
  const [exerciseSessions, setExerciseSessions] = useState(3);
  const [exerciseMin, setExerciseMin] = useState(45);
  const [mealMinPerDay, setMealMinPerDay] = useState(90);

  const totals = useMemo(() => {
    const weekHrs = 168;
    const sleepHrs = sleep * 7;
    const workTotal = workDays * workHrs;
    const exerciseHrs = (exerciseSessions * exerciseMin) / 60;
    const mealsHrs = (mealMinPerDay * 7) / 60;
    const used = sleepHrs + workTotal + exerciseHrs + mealsHrs;
    const remaining = Math.max(0, weekHrs - used);
    return { weekHrs, used: +used.toFixed(2), remaining: +remaining.toFixed(2) };
  }, [sleep, workDays, workHrs, exerciseSessions, exerciseMin, mealMinPerDay]);

  return (
    <div className="grid two">
      <div className="terminal panel">
        <Titlebar title="ONBOARDING :: TIME BUDGET" />
        <div className="terminal-body">
          <Prompt label="> sleep hours per night" suffix="hrs" value={sleep} onChange={setSleep} min={4} max={12} />
          <Prompt label="> work days per week" value={workDays} onChange={setWorkDays} min={0} max={7} />
          <Prompt label="> work hours per day" suffix="hrs" value={workHrs} onChange={setWorkHrs} min={0} max={16} />

          <div className="divider" />
          <Prompt label="> exercise sessions / week" value={exerciseSessions} onChange={setExerciseSessions} min={0} max={10} />
          <Prompt label="> exercise minutes / session" suffix="min" value={exerciseMin} onChange={setExerciseMin} min={0} max={180} />

          <div className="divider" />
          <Prompt label="> meal minutes / day" suffix="min" value={mealMinPerDay} onChange={setMealMinPerDay} min={30} max={240} />
        </div>
      </div>

      <div className="panel-glass stats">
        <h3 className="h3">WEEKLY TIME ALLOCATION</h3>
        <RingChart used={totals.used} total={totals.weekHrs} />
        <div className="metrics">
          <Metric label="Total Week" value={`${totals.weekHrs} hrs`} />
          <Metric label="Used" value={`${totals.used} hrs`} />
          <Metric label="Remaining" value={`${totals.remaining} hrs`} highlight />
        </div>
        <div className="hints">
          <Badge text="TIP" />
          <p>Use natural language later to add tasks, e.g. <code>get haircut Thursday 3pm 45m</code>.</p>
        </div>
        <div className="actions end">
          <NeonButton label=">> CONTINUE" />
        </div>
      </div>
    </div>
  );
}

// ===============================
// Main Task Entry & Weekly Planning Interface
// ===============================
function WeeklyPlannerMock() {
  const [input, setInput] = useState("");
  const [tasks, setTasks] = useState([
    { id: 1, title: "Write blog intro", type: "flex", cat: "Side Project", freq: "3x/wk", pts: 5 },
    { id: 2, title: "Client call Fri 10:00 (45m)", type: "fixed", cat: "Work", freq: "once", pts: 3 },
    { id: 3, title: "Gym (45m)", type: "fixed", cat: "Health", freq: "3x/wk", pts: 4 },
  ]);

  function addTask() {
    if (!input.trim()) return;
    setTasks((t) => [
      { id: Date.now(), title: input.trim(), type: guessType(input), cat: "Unassigned", freq: "once", pts: 1 },
      ...t,
    ]);
    setInput("");
  }

  return (
    <div className="grid two">
      <div className="panel-glass">
        <h3 className="h3">NATURAL LANGUAGE ENTRY</h3>
        <div className="nlp-row">
          <input
            className="input-retro"
            placeholder="> add task… e.g. meet Devon next Fri 2pm 60m @Work +5pts"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
          />
          <NeonButton label=">> PARSE & ADD" onClick={addTask} />
        </div>
        <p className="muted">Parser mock guesses fixed vs flexible and extracts duration when present.</p>
      </div>

      <div className="terminal panel">
        <Titlebar title="WEEKLY TASKS :: QUEUE" />
        <div className="task-table">
          <div className="thead">
            <span>Task</span><span>Type</span><span>Category</span><span>Freq</span><span>Pts</span>
          </div>
          {tasks.map((t) => (
            <div className="trow" key={t.id}>
              <span className="ttext">{t.title}</span>
              <span className={`badge ${t.type === "fixed" ? "cyan" : "pink"}`}>{t.type}</span>
              <span>{t.cat}</span>
              <span>{t.freq}</span>
              <span>{t.pts}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function guessType(s) {
  return /(\d+\s?(m|min|minutes)|am|pm|:\d{2})/i.test(s) ? "fixed" : "flex";
}

// ===============================
// Routine Builder Interface
// ===============================
function RoutineBuilderMock() {
  const [duration, setDuration] = useState(45);
  const [items, setItems] = useState([
    { id: 1, label: "Wake / hydrate", min: 3 },
    { id: 2, label: "Stretch", min: 10 },
    { id: 3, label: "Meditate", min: 10 },
    { id: 4, label: "Shower", min: 10 },
    { id: 5, label: "Breakfast", min: 12 },
  ]);

  const total = items.reduce((a, b) => a + b.min, 0);

  return (
    <div className="grid two">
      <div className="panel-glass">
        <h3 className="h3">ROUTINE SUMMARY</h3>
        <div className="metrics">
          <Metric label="Routine Duration" value={`${duration} min`} />
          <Metric label="Checklist Total" value={`${total} min`} highlight={total > duration} />
        </div>
        <div className="control-row">
          <label className="lbl">Total Duration</label>
          <input type="range" min={10} max={120} value={duration} onChange={(e) => setDuration(+e.target.value)} />
        </div>
        <p className="muted">Shown on calendar as a single block; detailed steps available on tap.</p>
      </div>

      <div className="terminal panel">
        <Titlebar title="MORNING ROUTINE :: CHECKLIST" />
        <div className="routine-list">
          {items.map((it) => (
            <div key={it.id} className="routine-item">
              <span className="dot" />
              <input className="routine-input" defaultValue={it.label} />
              <span className="spacer" />
              <span className="mini">{it.min}m</span>
            </div>
          ))}
          <div className="add-row">
            <NeonButton label=">> ADD_STEP" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ===============================
// Smart Calendar View (static mock grid)
// ===============================
function CalendarViewMock() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const items = [
    { day: 0, start: 8, len: 1, label: "Morning Routine", type: "routine" },
    { day: 0, start: 9, len: 3, label: "Focus: Side Project", type: "flex" },
    { day: 0, start: 13, len: 1, label: "Lunch", type: "routine" },
    { day: 0, start: 14, len: 2, label: "Client Prep", type: "flex" },
    { day: 2, start: 10, len: 1, label: "Haircut (45m)", type: "fixed" },
    { day: 4, start: 7, len: 1, label: "Morning Routine", type: "routine" },
    { day: 4, start: 18, len: 1, label: "Gym (45m)", type: "fixed" },
  ];

  return (
    <div className="calendar panel-glass">
      <h3 className="h3">SMART CALENDAR (Preview)</h3>
      <div className="cal-grid">
        <div className="col timecol">
          {[...Array(15)].map((_, i) => (
            <div key={i} className="time">{8 + i}:00</div>
          ))}
        </div>
        {days.map((d, di) => (
          <div key={d} className="col">
            <div className="dayhdr">{d}</div>
            <div className="slots">
              {[...Array(15)].map((_, i) => (
                <div key={i} className="slot" />
              ))}
              {items
                .filter((it) => it.day === di)
                .map((it, idx) => (
                  <div
                    key={idx}
                    className={`cal-item ${it.type}`}
                    style={{ top: (it.start - 8) * 48, height: it.len * 48 }}
                    title={it.label}
                  >
                    <span>{it.label}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="legend">
        <span className="badge cyan">fixed</span>
        <span className="badge pink">flex</span>
        <span className="badge green">routine</span>
      </div>
    </div>
  );
}

// ===============================
// Rewards System Interface
// ===============================
function RewardsMock() {
  const [threshold, setThreshold] = useState(250);
  const earned = 180; // mock
  const pct = Math.min(100, Math.round((earned / threshold) * 100));

  return (
    <div className="grid two">
      <div className="panel-glass">
        <h3 className="h3">REWARD PLAN</h3>
        <div className="form-row">
          <label className="lbl">Reward</label>
          <input className="input-retro" defaultValue="Ice cream night 🍨" />
        </div>
        <div className="form-row">
          <label className="lbl">Threshold</label>
          <input className="input-retro" type="number" value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
        </div>
        <p className="muted">Points accrue from task completion. Threshold unlock triggers a celebratory pulse.</p>
      </div>

      <div className="terminal panel">
        <Titlebar title="POINTS :: WEEKLY STATUS" />
        <div className="points-wrap">
          <div className="points">
            <span className="value">{earned}</span>
            <span className="slash">/</span>
            <span className="thresh">{threshold}</span>
          </div>
          <div className="bar">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="badges">
            <Badge text="DAILY +12" />
            <Badge text="STREAK +10" />
            <Badge text="BONUS +8" />
          </div>
          <div className="actions end">
            <NeonButton label=">> VIEW HISTORY" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ===============================
// UI Primitives
// ===============================
function NeonButton({ label, onClick, variant = "cyan" }) {
  return (
    <button className={`btn-neon ${variant}`} onClick={onClick}>
      <span>{label}</span>
    </button>
  );
}

function Metric({ label, value, highlight }) {
  return (
    <div className={`metric ${highlight ? "highlight" : ""}`}>
      <span className="mlabel">{label}</span>
      <span className="mvalue">{value}</span>
    </div>
  );
}

function Badge({ text }) {
  return <span className="badge chip">{text}</span>;
}

function Titlebar({ title }) {
  return (
    <div className="titlebar">
      <span className="dots">● ● ●</span>
      <span className="tt">{title}</span>
    </div>
  );
}

function Prompt({ label, value, onChange, min = 0, max = 24, suffix }) {
  return (
    <label className="prompt">
      <span className="plabel">{label}</span>
      <div className="prow">
        <input
          className="input-retro"
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(+e.target.value)}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </label>
  );
}

function RingChart({ used, total }) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" className="track" />
        <circle cx="60" cy="60" r="54" className="prog" style={{ strokeDashoffset: 339.292 - (339.292 * pct) / 100 }} />
        <text x="60" y="66" textAnchor="middle" className="ringtxt">{pct}%</text>
      </svg>
    </div>
  );
}

function AsciiHeader() {
  const art = [
    "  █████╗ ██╗     ███████╗██████╗ ███████╗██████╗  ██████╗  ",
    " ██╔══██╗██║     ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔═══██╗ ",
    " ███████║██║     █████╗  ██████╔╝█████╗  ██████╔╝██║   ██║ ",
    " ██╔══██║██║     ██╔══╝  ██╔══██╗██╔══╝  ██╔══██╗██║   ██║ ",
    " ██║  ██║███████╗███████╗██║  ██║███████╗██║  ██║╚██████╔╝ ",
    " ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝  ",
  ].join("\n");
  return (
    <pre className="ascii" aria-hidden>{art}</pre>
  );
}

function GlitchTitle({ text }) {
  return (
    <h1 className="glitch" data-text={text}>
      {text}
      <span aria-hidden>{text}</span>
      <span aria-hidden>{text}</span>
    </h1>
  );
}

function BackgroundDecor() {
  return (
    <>
      <div className="grid-bg" />
      <div className="scanlines" />
    </>
  );
}

function StyleTokens() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;600;700&family=Orbitron:wght@700;800&display=swap');

      :root{
        --bg-base:#10141A; --bg-deep:#0A0A0A;
        --surface-glass:rgba(255,255,255,.08); --surface-glass-strong:rgba(255,255,255,.12);
        --text-primary:#E8EEF6; --text-muted:#90A4B4; --text-invert:#061018;
        --accent-cyan:#00FFFF; --accent-pink:#FF00FF; --accent-green:#00FF41; --accent-orange:#FF6600; --accent-purple:#AA00FF;
        --border-soft:rgba(255,255,255,.12); --border-medium:rgba(255,255,255,.18);
        --r-xs:8px; --r-sm:12px; --r-md:16px; --r-pill:999px;
        --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px;
        --sh-neon-cyan:0 0 20px rgba(0,255,255,.35), 0 0 40px rgba(0,255,255,.25);
        --sh-neon-pink:0 0 20px rgba(255,0,255,.35), 0 0 40px rgba(255,0,255,.25);
        --sh-panel:0 10px 40px rgba(0,0,0,.5);
        --glass-blur:20px; --glass-sat:140%;
        --dur:250ms; --ease:cubic-bezier(.2,0,.2,1);
      }

      *{box-sizing:border-box}
      html,body,#root{height:100%}
      body{margin:0; background:var(--bg-base); color:var(--text-primary); font-family:Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;}

      .app-root{position:relative; min-height:100vh;}

      .hero{position:relative; padding:48px 24px 24px; text-align:center}
      .ascii{font-family:'JetBrains Mono', ui-monospace, monospace; color:var(--accent-green); opacity:.8; line-height:1; font-size:10px; white-space:pre; margin:0 0 12px}
      .glitch{font-family:'Orbitron', sans-serif; font-size:48px; letter-spacing:.12em; text-transform:uppercase; position:relative; display:inline-block}
      .glitch span{position:absolute; left:0; top:0}
      .glitch span:nth-child(2){transform:translate(2px,0); color:var(--accent-pink); mix-blend-mode:screen; opacity:.7;}
      .glitch span:nth-child(3){transform:translate(-2px,0); color:var(--accent-cyan); mix-blend-mode:screen; opacity:.7;}
      .subtitle{margin:8px 0 20px; color:var(--text-muted)}
      .actions{display:flex; gap:12px; justify-content:center}

      .container{max-width:1200px; margin:0 auto; padding:24px}

      .panel-glass{background:var(--surface-glass); border:1px solid var(--border-soft); border-radius:var(--r-md); backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat)); box-shadow:var(--sh-panel); padding:16px}
      .terminal.panel{background:linear-gradient(145deg, rgba(0,0,0,.9), rgba(0,20,20,.9)); border:2px solid var(--accent-cyan); border-radius:var(--r-xs); box-shadow:0 0 20px rgba(0,255,255,.3), inset 0 0 20px rgba(0,255,255,.1); overflow:hidden}
      .titlebar{position:relative; height:30px; background:linear-gradient(90deg, var(--accent-cyan), var(--accent-pink), var(--accent-cyan)); display:flex; align-items:center; gap:12px; padding:0 12px}
      .titlebar .dots{color:var(--accent-green); font-family:'JetBrains Mono', monospace; font-size:12px}
      .titlebar .tt{font-weight:700; text-transform:uppercase; letter-spacing:.12em; font-size:12px}
      .terminal-body{padding:12px}

      .tabs-wrap{padding:0}
      .tablist{display:flex; flex-wrap:wrap; gap:8px; padding:12px; border-bottom:1px solid var(--border-soft)}
      .tab-pill{position:relative; background:rgba(255,255,255,.06); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:999px; padding:8px 14px; font-family:'JetBrains Mono', monospace; text-transform:uppercase; letter-spacing:.08em}
      .tab-pill.active{background:linear-gradient(90deg, var(--accent-cyan), var(--accent-pink)); color:var(--text-invert); box-shadow:var(--sh-neon-cyan); border-color:transparent}
      .tabpanel{padding:16px}

      .grid.two{display:grid; grid-template-columns:1fr 1fr; gap:16px}
      @media (max-width: 980px){ .grid.two{grid-template-columns:1fr} }

      .input-retro{width:100%; background:rgba(0,0,0,.7); border:2px solid var(--accent-green); color:var(--accent-green); border-radius:8px; padding:10px 12px; font-family:'JetBrains Mono', monospace}
      .input-retro:focus{outline:none; border-color:var(--accent-cyan); box-shadow:0 0 15px rgba(0,255,255,.5)}

      .prompt{display:block; margin-bottom:12px}
      .prompt .plabel{display:block; font-family:'JetBrains Mono', monospace; color:var(--accent-green); margin-bottom:6px}
      .prompt .prow{display:flex; align-items:center; gap:8px}
      .suffix{color:var(--text-muted); font-family:'JetBrains Mono', monospace}

      .divider{height:1px; background:var(--border-medium); margin:12px 0}
      .h3{font-family:'Orbitron', sans-serif; letter-spacing:.14em; text-transform:uppercase; margin:8px 0 12px}
      .muted{color:var(--text-muted)}

      .metrics{display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:12px 0}
      .metric{background:rgba(255,255,255,.05); border:1px solid var(--border-soft); border-radius:8px; padding:10px}
      .metric.highlight{border-color:var(--accent-pink); box-shadow:var(--sh-neon-pink)}
      .mlabel{display:block; color:var(--text-muted); font-size:12px}
      .mvalue{font-family:'JetBrains Mono', monospace; font-size:18px}

      .nlp-row{display:flex; gap:12px; align-items:center}
      @media (max-width: 680px){ .nlp-row{flex-direction:column; align-items:stretch} }

      .task-table{padding:12px}
      .task-table .thead, .task-table .trow{display:grid; grid-template-columns:2fr 90px 1fr 1fr 60px; gap:12px; align-items:center}
      .task-table .thead{color:var(--accent-cyan); font-family:'JetBrains Mono', monospace; border-bottom:1px solid var(--border-soft); padding-bottom:6px; margin-bottom:6px}
      .task-table .trow{padding:8px 0; border-bottom:1px dashed rgba(255,255,255,.1)}
      .task-table .ttext{white-space:nowrap; overflow:hidden; text-overflow:ellipsis}

      .badge{display:inline-block; border:1px solid var(--border-medium); border-radius:999px; padding:2px 8px; font-family:'JetBrains Mono', monospace; font-size:12px}
      .badge.chip{background:rgba(255,255,255,.06)}
      .badge.cyan{border-color:var(--accent-cyan); color:var(--accent-cyan)}
      .badge.pink{border-color:var(--accent-pink); color:var(--accent-pink)}
      .badge.green{border-color:var(--accent-green); color:var(--accent-green)}

      .routine-list{padding:12px}
      .routine-item{display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px dashed rgba(255,255,255,.1)}
      .routine-input{flex:1; background:transparent; border:none; color:var(--text-primary); font-family:'JetBrains Mono', monospace}
      .routine-input:focus{outline:none}
      .dot{width:8px; height:8px; border-radius:50%; background:var(--accent-cyan)}
      .mini{color:var(--text-muted)}
      .add-row{padding-top:8px}

      .calendar{position:relative}
      .cal-grid{display:grid; grid-template-columns:80px repeat(7,1fr); gap:12px}
      .col{position:relative}
      .dayhdr{font-family:'Orbitron', sans-serif; letter-spacing:.2em; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px}
      .timecol .time{height:48px; color:var(--text-muted); font-family:'JetBrains Mono', monospace}
      .slots{position:relative; border:1px solid var(--border-soft); border-radius:8px; min-height:48px * 12; padding-top:24px}
      .slot{height:48px; border-bottom:1px dashed rgba(255,255,255,.06)}
      .slot:last-child{border-bottom:none}
      .cal-item{position:absolute; left:6px; right:6px; border-radius:8px; padding:8px 10px; font-family:'JetBrains Mono', monospace; overflow:hidden}
      .cal-item.fixed{border:1px solid var(--accent-cyan); background:rgba(0,255,255,.08)}
      .cal-item.flex{border:1px solid var(--accent-pink); background:rgba(255,0,255,.08)}
      .cal-item.routine{border:1px solid var(--accent-green); background:rgba(0,255,65,.08)}

      .legend{display:flex; gap:8px; margin-top:12px}

      .points-wrap{padding:16px}
      .points{font-family:'JetBrains Mono', monospace; font-size:28px; display:flex; align-items:baseline; gap:8px}
      .points .slash{color:var(--text-muted)}
      .bar{height:10px; border:1px solid var(--accent-cyan); border-radius:999px; overflow:hidden; margin:10px 0 6px}
      .bar .fill{height:100%; background:linear-gradient(90deg, var(--accent-cyan), var(--accent-pink)); box-shadow:var(--sh-neon-cyan)}
      .badges{display:flex; gap:8px; margin-top:8px}

      .btn-neon{position:relative; background:transparent; border:2px solid var(--accent-cyan); color:var(--accent-cyan); padding:10px 18px; border-radius:999px; font-family:'JetBrains Mono', monospace; letter-spacing:.12em; text-transform:uppercase; transition:all var(--dur) var(--ease); cursor:pointer; overflow:hidden}
      .btn-neon.pink{border-color:var(--accent-pink); color:var(--accent-pink)}
      .btn-neon:hover{background:var(--accent-cyan); color:var(--text-invert); box-shadow:var(--sh-neon-cyan)}
      .btn-neon.pink:hover{background:var(--accent-pink); box-shadow:var(--sh-neon-pink)}
      .btn-neon span{position:relative; z-index:2}
      .btn-neon::before{content:""; position:absolute; inset:0; left:-100%; background:linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); transition:left .5s}
      .btn-neon:hover::before{left:100%}

      .grid-bg{position:fixed; inset:0; background-image:linear-gradient(rgba(0,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.03) 1px, transparent 1px); background-size: 60px 60px, 60px 60px; animation:gridMove 20s linear infinite; z-index:-2}
      .scanlines{position:fixed; inset:0; background:linear-gradient(transparent 50%, rgba(0,255,0,0.03) 50%); background-size: 2px 2px; animation:scan 0.1s linear infinite; z-index:-1}

      .footer{padding:32px; text-align:center; color:var(--text-muted)}

      @keyframes gridMove { 0%{background-position:0 0, 0 0} 100%{background-position:60px 60px, 60px 60px} }
      @keyframes scan { 0%{background-position:0 0} 100%{background-position:0 2px} }

      .actions.end{display:flex; justify-content:flex-end}
      .form-row, .control-row{display:grid; grid-template-columns:180px 1fr; gap:12px; align-items:center; margin-bottom:12px}
      .lbl{font-family:'JetBrains Mono', monospace; color:var(--accent-green)}

      .ring{width:180px; margin:6px auto 0}
      .ring svg{width:100%; height:100%}
      .ring .track{fill:none; stroke:rgba(255,255,255,.1); stroke-width:12}
      .ring .prog{fill:none; stroke:url(#grad) var(--accent-cyan); stroke:var(--accent-cyan); stroke-width:12; stroke-linecap:round; stroke-dasharray:339.292; stroke-dashoffset:339.292}
      .ringtxt{font-family:'JetBrains Mono', monospace; font-size:18px; fill:var(--text-primary)}
    `}</style>
  );
}
