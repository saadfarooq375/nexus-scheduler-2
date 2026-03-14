import { useState, useEffect, useRef } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";
const SCOPES = "https://www.googleapis.com/auth/calendar";

const C = {
  bg:"#0a0a0f", surface:"#12121a", border:"#1e1e2e",
  amber:"#f5a623", amberDim:"#f5a62318", blue:"#4a9eff", blueDim:"#4a9eff18",
  teal:"#2dd4bf", tealDim:"#2dd4bf18", rose:"#fb7185", roseDim:"#fb718518",
  muted:"#4a4a6a", text:"#e2e2f0", textDim:"#7a7a9a",
};
const EC = {
  "deep-work": { bg:C.amberDim, border:C.amber, label:C.amber, tag:"Deep Work" },
  meeting:     { bg:C.blueDim,  border:C.blue,  label:C.blue,  tag:"Meeting"   },
  content:     { bg:C.tealDim,  border:C.teal,  label:C.teal,  tag:"Content"   },
  admin:       { bg:"#ffffff08",border:C.muted,  label:C.textDim,tag:"Admin"   },
  personal:    { bg:C.roseDim,  border:C.rose,  label:C.rose,  tag:"Personal"  },
};
const HOURS = Array.from({ length:13 }, (_,i) => i + 7);
const DAYS  = ["Mon","Tue","Wed","Thu","Fri"];
const TASKS = [
  { id:"t1", title:"Prepare pitch deck",            priority:"P1", source:"Notion", estimate:"3h" },
  { id:"t2", title:"Record product demo video",     priority:"P1", source:"Linear", estimate:"2h" },
  { id:"t3", title:"Write case study #3",           priority:"P2", source:"Notion", estimate:"2h" },
  { id:"t4", title:"Respond to partnership emails", priority:"P2", source:"Linear", estimate:"1h" },
  { id:"t5", title:"Update pricing page",           priority:"P3", source:"Notion", estimate:"1h" },
];

function getWeekDates() {
  const now = new Date(), day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(now); mon.setDate(diff);
  return Array.from({ length:5 }, (_,i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i); return d;
  });
}
function parseGCEvents(items, weekDates) {
  return items.filter(e => e.start?.dateTime).map((e,i) => {
    const s = new Date(e.start.dateTime), en = new Date(e.end?.dateTime || e.start.dateTime);
    const di = weekDates.findIndex(d => d.toDateString() === s.toDateString());
    if (di === -1) return null;
    const sh = s.getHours() + s.getMinutes()/60, eh = en.getHours() + en.getMinutes()/60;
    const t = e.summary || "Untitled", l = t.toLowerCase();
    let type = "meeting";
    if (l.includes("deep")||l.includes("focus")) type = "deep-work";
    else if (l.includes("content")||l.includes("write")||l.includes("record")) type = "content";
    else if (l.includes("admin")||l.includes("email")||l.includes("review")) type = "admin";
    return { id:`gc-${e.id||i}`, gcId:e.id, title:t, day:di, startHour:sh, endHour:eh, type, source:"google" };
  }).filter(Boolean);
}
function calcGoals(evts) {
  const s = t => evts.filter(e=>e.type===t).reduce((a,e)=>a+(e.endHour-e.startHour),0);
  return { deepWork:s("deep-work"), content:s("content"), meetings:s("meeting") };
}
function fmt(h) { return h%1===0?`${h}:00`:`${Math.floor(h)}:30`; }

// Dynamically load a script and return a promise
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export default function App() {
  const [events,    setEvents]    = useState([]);
  const [weekDates]               = useState(getWeekDates);
  const [cmd,       setCmd]       = useState("");
  const [loading,   setLoading]   = useState(false);
  const [suggs,     setSuggs]     = useState([]);
  const [gcOn,      setGcOn]      = useState(false);
  const [gcLoading, setGcLoading] = useState(false);
  const [gcReady,   setGcReady]   = useState(false);
  const [toast,     setToast]     = useState("");
  const tcRef = useRef(null);
  const g = calcGoals(events);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  }

  // Load Google scripts dynamically on mount
  useEffect(() => {
    async function initGoogle() {
      try {
        // Step 1: load both scripts in parallel
        await Promise.all([
          loadScript("https://apis.google.com/js/api.js"),
          loadScript("https://accounts.google.com/gsi/client"),
        ]);

        // Step 2: init gapi client
        await new Promise((resolve, reject) => {
          window.gapi.load("client", async () => {
            try {
              await window.gapi.client.init({
                discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"],
              });
              resolve();
            } catch(e) { reject(e); }
          });
        });

        // Step 3: init token client
        if (!GOOGLE_CLIENT_ID) {
          console.warn("No VITE_GOOGLE_CLIENT_ID set");
          return;
        }
        tcRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: async (r) => {
            if (r.error) { setGcLoading(false); showToast("Google sign-in failed — please try again."); return; }
            window.gapi.client.setToken({ access_token: r.access_token });
            await fetchGC();
            setGcOn(true);
            setGcLoading(false);
            showToast("✓ Google Calendar connected!");
          },
        });
        setGcReady(true);
      } catch(err) {
        console.error("Google init error:", err);
        showToast("Could not load Google API — check your internet connection.");
      }
    }
    initGoogle();
  }, []);

  async function fetchGC() {
    try {
      const mon = new Date(weekDates[0]); mon.setHours(0,0,0,0);
      const sun = new Date(weekDates[4]); sun.setHours(23,59,59,999);
      const r = await window.gapi.client.calendar.events.list({
        calendarId:"primary", timeMin:mon.toISOString(), timeMax:sun.toISOString(),
        singleEvents:true, orderBy:"startTime", maxResults:100,
      });
      setEvents(parseGCEvents(r.result.items||[], weekDates));
    } catch(e) { console.error("fetchGC:", e); }
  }

  function connectGC() {
    if (!GOOGLE_CLIENT_ID) { showToast("VITE_GOOGLE_CLIENT_ID is not set in Vercel."); return; }
    if (!gcReady || !tcRef.current) { showToast("Google is still loading — please wait a second and try again."); return; }
    setGcLoading(true);
    tcRef.current.requestAccessToken({ prompt:"consent" });
  }

  async function runCmd() {
    if (!cmd.trim()) return;
    setLoading(true); setSuggs([]);
    const today  = new Date();
    const evtStr = events.map(e=>`${DAYS[e.day]||"?"} ${fmt(e.startHour)}-${fmt(e.endHour)}: ${e.title} (${e.type}, id:${e.id})`).join("\n") || "(no events this week)";
    const tskStr = TASKS.map(t=>`${t.title} [${t.priority}, ${t.estimate}]`).join("\n");
    const exStart = new Date(weekDates[1]); exStart.setHours(9,0,0,0);
    const exEnd   = new Date(weekDates[1]); exEnd.setHours(11,0,0,0);
    const prompt = `You are a smart AI calendar assistant for a solopreneur.
Today is ${today.toDateString()}.

CALENDAR THIS WEEK:
${evtStr}

UNSCHEDULED TASKS:
${tskStr}

GOALS: Deep Work ${g.deepWork.toFixed(1)}h/10h target | Content ${g.content.toFixed(1)}h/5h target | Meetings ${g.meetings.toFixed(1)}h/8h max

USER REQUEST: "${cmd}"

Return ONLY a valid JSON array of exactly 3 suggestions. Each must have:
- "title": short calendar event name
- "action": one sentence what to do
- "reason": one sentence why it helps
- "gcAction": exactly "create", "delete", or "none"
- "startISO": ISO 8601 datetime this week (e.g. "${exStart.toISOString()}") when gcAction is "create", else ""
- "endISO": ISO 8601 end datetime (e.g. "${exEnd.toISOString()}") when gcAction is "create", else ""
- "eventId": id from calendar list (e.g. "gc-abc123") when gcAction is "delete", else ""

Output ONLY the JSON array. No markdown, no explanation.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-api-key":ANTHROPIC_KEY, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" },
        body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1200, messages:[{role:"user",content:prompt}] }),
      });
      const data = await res.json();
      const text = (data.content?.[0]?.text||"[]").replace(/```json|```/g,"").trim();
      setSuggs(JSON.parse(text));
    } catch(err) {
      console.error("AI error:",err);
      const fs = new Date(weekDates[0]); fs.setHours(9,0,0,0);
      const fe = new Date(weekDates[0]); fe.setHours(11,0,0,0);
      setSuggs([{ title:"Morning Deep Work", action:"Block Monday 9–11 AM for focused work", reason:"Protects your peak cognitive hours.", gcAction:"create", startISO:fs.toISOString(), endISO:fe.toISOString(), eventId:"" }]);
    }
    setLoading(false); setCmd("");
  }

  async function applysugg(s, i) {
    if (!gcOn) { showToast("Connect Google Calendar first!"); return; }
    try {
      if (s.gcAction==="create" && s.startISO && s.endISO) {
        await window.gapi.client.calendar.events.insert({
          calendarId:"primary",
          resource:{ summary:s.title, start:{dateTime:s.startISO, timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}, end:{dateTime:s.endISO, timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone} },
        });
        await fetchGC();
        showToast(`✓ "${s.title}" added to Google Calendar!`);
      } else if (s.gcAction==="delete" && s.eventId) {
        await window.gapi.client.calendar.events.delete({ calendarId:"primary", eventId:s.eventId.replace(/^gc-/,"") });
        await fetchGC();
        showToast(`✓ "${s.title}" removed from Google Calendar!`);
      } else {
        showToast(`✓ Noted: ${s.action}`);
      }
      setSuggs(p=>p.filter((_,j)=>j!==i));
    } catch(err) {
      console.error("Apply error:",err);
      showToast("Something went wrong — check browser console.");
    }
  }

  function renderEvts(di) {
    return events.filter(e=>e.day===di).map(e=>{
      const top = ((Math.max(e.startHour-7,0))/13)*100;
      const h   = ((e.endHour-e.startHour)/13)*100;
      const col = EC[e.type]||EC.admin;
      return (
        <div key={e.id} style={{ position:"absolute",left:3,right:3,top:`${top}%`,height:`${Math.max(h,2)}%`,background:col.bg,border:`1px solid ${col.border}`,borderRadius:5,padding:"3px 7px",fontSize:11,color:col.label,overflow:"hidden",zIndex:2,boxSizing:"border-box" }}>
          <div style={{ fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{e.title}</div>
          <div style={{ fontSize:10,opacity:.7 }}>{fmt(e.startHour)} – {fmt(e.endHour)}</div>
        </div>
      );
    });
  }

  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif",background:C.bg,color:C.text,minHeight:"100vh",display:"flex",flexDirection:"column" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"#1a3a1a",border:"1px solid #2d5a2d",color:"#4ade80",padding:"10px 24px",borderRadius:10,fontSize:13,fontWeight:500,zIndex:999,boxShadow:"0 4px 20px rgba(0,0,0,0.5)",whiteSpace:"nowrap" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header style={{ padding:"14px 24px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.surface }}>
        <div style={{ fontFamily:"'DM Serif Display',serif",fontSize:22,letterSpacing:"-0.5px" }}>
          nexus<span style={{ color:C.amber }}>.</span>
        </div>
        <div style={{ display:"flex",gap:8,alignItems:"center" }}>
          {!gcReady && !gcOn && (
            <span style={{ fontSize:11,color:C.textDim }}>Loading Google API…</span>
          )}
          <button onClick={gcOn?undefined:connectGC} disabled={gcLoading||(!gcReady&&!gcOn)} style={{
            display:"flex",alignItems:"center",gap:6,
            background:gcOn?"#1a2a1a":C.border,
            border:`1px solid ${gcOn?"#2d5a2d":C.muted}`,
            color:gcOn?"#4ade80":gcReady?C.text:C.textDim,
            borderRadius:8,padding:"8px 14px",fontSize:12,
            cursor:gcOn||!gcReady?"default":"pointer",
            fontFamily:"'DM Sans',sans-serif",fontWeight:500,
          }}>
            {gcLoading?"Connecting…":gcOn?"✓ Google Calendar Connected":gcReady?"＋ Connect Google Calendar":"Loading…"}
          </button>
          {gcOn && (
            <button onClick={fetchGC} title="Refresh" style={{ background:C.border,border:`1px solid ${C.muted}`,color:C.text,borderRadius:8,padding:"8px 12px",fontSize:14,cursor:"pointer" }}>↺</button>
          )}
        </div>
      </header>

      <div style={{ display:"flex",flex:1,overflow:"hidden",height:"calc(100vh - 57px)" }}>

        {/* Left Sidebar */}
        <aside style={{ width:232,borderRight:`1px solid ${C.border}`,padding:"20px 14px",overflowY:"auto",display:"flex",flexDirection:"column",gap:22,background:C.surface,flexShrink:0 }}>
          <div>
            <div style={{ fontSize:10,letterSpacing:2,color:C.textDim,textTransform:"uppercase",marginBottom:10 }}>Weekly Goals</div>
            {[{l:"Deep Work",v:g.deepWork,max:10,c:C.amber},{l:"Content",v:g.content,max:5,c:C.teal},{l:"Meetings",v:g.meetings,max:8,c:C.blue}].map(x=>(
              <div key={x.l} style={{ marginBottom:12 }}>
                <div style={{ fontSize:12,color:C.textDim,marginBottom:4,display:"flex",justifyContent:"space-between" }}>
                  <span>{x.l}</span><span style={{ color:x.c }}>{x.v.toFixed(1)}h / {x.max}h</span>
                </div>
                <div style={{ height:4,background:C.border,borderRadius:2,overflow:"hidden" }}>
                  <div style={{ width:`${Math.min((x.v/x.max)*100,100)}%`,height:"100%",background:x.c,borderRadius:2,transition:"width .4s" }} />
                </div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize:10,letterSpacing:2,color:C.textDim,textTransform:"uppercase",marginBottom:10 }}>Unscheduled Tasks</div>
            {TASKS.map(t=>(
              <div key={t.id} style={{ padding:"8px 10px",borderRadius:6,border:`1px solid ${C.border}`,marginBottom:8,fontSize:12 }}>
                <div style={{ marginBottom:4 }}>
                  <span style={{ fontSize:10,padding:"1px 6px",borderRadius:3,fontWeight:600,marginRight:6,background:t.priority==="P1"?C.roseDim:t.priority==="P2"?C.amberDim:C.border,color:t.priority==="P1"?C.rose:t.priority==="P2"?C.amber:C.muted }}>{t.priority}</span>
                  <span style={{ fontSize:10,color:C.textDim }}>{t.source}</span>
                </div>
                <div>{t.title}</div>
                <div style={{ color:C.muted,fontSize:10,marginTop:2 }}>~{t.estimate}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize:10,letterSpacing:2,color:C.textDim,textTransform:"uppercase",marginBottom:10 }}>Legend</div>
            {Object.entries(EC).map(([k,v])=>(
              <div key={k} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6,fontSize:12 }}>
                <div style={{ width:10,height:10,borderRadius:2,background:v.border,opacity:.8 }} />
                <span style={{ color:C.textDim }}>{v.tag}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* Calendar */}
        <main style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
          <div style={{ flex:1,overflowY:"auto",padding:"0 16px 16px" }}>
            <div style={{ display:"grid",gridTemplateColumns:"48px repeat(5,1fr)" }}>
              <div style={{ borderBottom:`1px solid ${C.border}`,height:56 }} />
              {DAYS.map((d,i)=>(
                <div key={d} style={{ padding:"12px 8px 8px",textAlign:"center",borderBottom:`1px solid ${C.border}`,fontSize:12,color:C.textDim }}>
                  <span style={{ fontSize:18,fontFamily:"'DM Serif Display',serif",color:C.text,display:"block" }}>{weekDates[i]?.getDate()}</span>
                  {d}
                </div>
              ))}
              {HOURS.map(h=>(
                <div key={h} style={{ display:"contents" }}>
                  <div style={{ fontSize:10,color:C.muted,textAlign:"right",paddingRight:8,paddingTop:2,height:52,borderBottom:`1px solid ${C.border}` }}>
                    {h<12?`${h}am`:h===12?"12pm":`${h-12}pm`}
                  </div>
                  {DAYS.map((_,di)=>(
                    <div key={`${h}-${di}`} style={{ height:52,borderBottom:`1px solid ${C.border}`,borderLeft:`1px solid ${C.border}`,position:"relative" }}>
                      {h===HOURS[0]&&renderEvts(di)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop:`1px solid ${C.border}`,padding:"12px 16px",background:C.surface,display:"flex",gap:10,alignItems:"center" }}>
            <span style={{ fontSize:16,color:C.amber }}>✦</span>
            <input
              style={{ flex:1,background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",color:C.text,fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif" }}
              placeholder='Try: "I need 10 hours of deep work" or "cancel my 9am meeting"'
              value={cmd} onChange={e=>setCmd(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runCmd()}
            />
            <button onClick={runCmd} disabled={loading} style={{ background:loading?C.border:C.amber,color:loading?C.textDim:"#000",border:"none",borderRadius:8,padding:"10px 18px",fontWeight:600,fontSize:13,cursor:loading?"default":"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap" }}>
              {loading?"Thinking…":"Ask AI →"}
            </button>
          </div>
        </main>

        {/* Right Panel */}
        <aside style={{ width:268,borderLeft:`1px solid ${C.border}`,padding:"20px 14px",overflowY:"auto",background:C.surface,display:"flex",flexDirection:"column",gap:10,flexShrink:0 }}>
          <div style={{ fontSize:10,letterSpacing:2,color:C.textDim,textTransform:"uppercase",marginBottom:4 }}>AI Suggestions</div>
          {suggs.length===0?(
            <div style={{ fontSize:12,color:C.textDim,lineHeight:1.7 }}>
              Type a goal below — Nexus will analyze your week and suggest real changes.
              <br/><br/><span style={{ color:C.amber }}>Try:</span><br/>
              • "I need 10h deep work this week"<br/>
              • "Cancel my 9am meeting"<br/>
              • "Schedule my P1 tasks"<br/>
              • "Protect my mornings"
            </div>
          ):(
            <>
              {suggs.map((s,i)=>(
                <div key={i} style={{ border:`1px solid ${C.amber}44`,borderRadius:8,padding:11,background:C.amberDim,fontSize:12,lineHeight:1.5 }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
                    <div style={{ fontWeight:600,color:C.amber,fontSize:13 }}>{s.title}</div>
                    <span style={{ fontSize:9,padding:"2px 6px",borderRadius:4,fontWeight:700,textTransform:"uppercase",letterSpacing:1,background:s.gcAction==="create"?C.tealDim:s.gcAction==="delete"?C.roseDim:C.border,color:s.gcAction==="create"?C.teal:s.gcAction==="delete"?C.rose:C.muted }}>{s.gcAction}</span>
                  </div>
                  <div style={{ color:C.text,marginBottom:4 }}>{s.action}</div>
                  <div style={{ color:C.textDim,fontSize:11,marginBottom:8 }}>{s.reason}</div>
                  {s.startISO&&(
                    <div style={{ fontSize:10,color:C.muted,marginBottom:8 }}>
                      {new Date(s.startISO).toLocaleString("en-US",{weekday:"short",hour:"numeric",minute:"2-digit"})}
                      {s.endISO?` – ${new Date(s.endISO).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}` :""}
                    </div>
                  )}
                  <button onClick={()=>applysugg(s,i)} style={{ background:C.amber,color:"#000",border:"none",borderRadius:6,padding:"6px 14px",fontWeight:600,fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",width:"100%" }}>
                    Apply to Calendar ✓
                  </button>
                </div>
              ))}
              {suggs.length>1&&(
                <button onClick={async()=>{for(let i=suggs.length-1;i>=0;i--)await applysugg(suggs[i],i);}} style={{ background:"transparent",color:C.amber,border:`1px solid ${C.amber}`,padding:8,borderRadius:8,width:"100%",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600 }}>
                  Apply All
                </button>
              )}
            </>
          )}
          <div style={{ marginTop:"auto",paddingTop:16,borderTop:`1px solid ${C.border}` }}>
            <div style={{ fontSize:10,letterSpacing:2,color:C.textDim,textTransform:"uppercase",marginBottom:8 }}>Sync Status</div>
            <div style={{ fontSize:11,color:C.textDim,lineHeight:1.9 }}>
              <div>{events.filter(e=>e.source==="google").length} events from Google</div>
              <div style={{ color:gcOn?"#4ade80":C.muted }}>{gcOn?"● Live — writes enabled":"○ Not connected"}</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
