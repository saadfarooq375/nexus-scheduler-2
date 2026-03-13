import { useState, useRef, useEffect } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8);

const EVENT_TYPES = {
  deepWork: { label: "Deep Work", color: "#C8860A", bg: "#2A1F0A", border: "#C8860A" },
  meeting: { label: "Meeting", color: "#4A9EE8", bg: "#0A1A2A", border: "#4A9EE8" },
  admin: { label: "Admin", color: "#7A7A8A", bg: "#1A1A22", border: "#5A5A6A" },
  content: { label: "Content", color: "#4ACE9A", bg: "#0A1E14", border: "#4ACE9A" },
  personal: { label: "Personal", color: "#C86AB0", bg: "#1E0A1A", border: "#C86AB0" },
};

const INITIAL_EVENTS = [
  { id: 1, day: 0, start: 9, end: 11, type: "meeting", title: "Client Sync — Acme Corp", source: "gcal" },
  { id: 2, day: 0, start: 14, end: 16, type: "deepWork", title: "Q4 Strategy Doc", source: "notion" },
  { id: 3, day: 1, start: 8, end: 10, type: "deepWork", title: "Feature Sprint Planning", source: "linear" },
  { id: 4, day: 1, start: 11, end: 12, type: "admin", title: "Inbox Zero", source: "gcal" },
  { id: 5, day: 1, start: 15, end: 16, type: "meeting", title: "1:1 with Mentor", source: "gcal" },
  { id: 6, day: 2, start: 9, end: 10, type: "meeting", title: "Team Standup", source: "gcal" },
  { id: 7, day: 2, start: 10, end: 13, type: "content", title: "Newsletter Draft", source: "notion" },
  { id: 8, day: 2, start: 14, end: 15, type: "admin", title: "Invoicing & Billing", source: "gcal" },
  { id: 9, day: 3, start: 9, end: 12, type: "deepWork", title: "Product Roadmap", source: "notion" },
  { id: 10, day: 3, start: 13, end: 14, type: "meeting", title: "Sales Discovery Call", source: "gcal" },
  { id: 11, day: 4, start: 10, end: 11, type: "meeting", title: "Weekly Review", source: "gcal" },
  { id: 12, day: 4, start: 11, end: 13, type: "content", title: "LinkedIn Content Batch", source: "notion" },
];

const NOTION_TASKS = [
  { id: 1, title: "Finish Q4 strategy doc", priority: "P1", due: "Mon", type: "deepWork", est: "3h" },
  { id: 2, title: "Record product demo video", priority: "P1", due: "Wed", type: "content", est: "2h" },
  { id: 3, title: "Update pricing page copy", priority: "P2", due: "Fri", type: "deepWork", est: "1.5h" },
  { id: 4, title: "Draft investor update", priority: "P1", due: "Thu", type: "deepWork", est: "2h" },
  { id: 5, title: "Review Linear backlog", priority: "P3", due: "Fri", type: "admin", est: "1h" },
];

const GOALS = [
  { id: 1, label: "Deep work hours", target: 10, current: 5, unit: "hrs", type: "deepWork" },
  { id: 2, label: "Content creation", target: 4, current: 2, unit: "hrs", type: "content" },
  { id: 3, label: "Max meeting time", target: 8, current: 5, unit: "hrs", type: "meeting", inverse: true },
];

const ENERGY = [
  { day: 0, pattern: [2, 3, 3, 1, 1, 1, 2, 2, 1, 0, 0] },
  { day: 1, pattern: [3, 3, 2, 2, 1, 1, 1, 1, 1, 0, 0] },
  { day: 2, pattern: [1, 2, 3, 3, 2, 1, 1, 1, 0, 0, 0] },
  { day: 3, pattern: [2, 3, 3, 2, 2, 1, 1, 0, 0, 0, 0] },
  { day: 4, pattern: [1, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0] },
];

const EXAMPLE_COMMANDS = [
  "I need 10 hours of deep work this week",
  "Protect my mornings for focused work",
  "Move all meetings to Tuesday and Thursday",
  "I have a deadline Monday — clear my Monday afternoon",
  "Batch my admin tasks into one block",
];

function getDeepWorkHours(events) {
  return events.filter(e => e.type === "deepWork").reduce((sum, e) => sum + (e.end - e.start), 0);
}

function getMeetingHours(events) {
  return events.filter(e => e.type === "meeting").reduce((sum, e) => sum + (e.end - e.start), 0);
}

const HOUR_H = 52;
const DAY_START = 8;

export default function AIScheduler() {
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [pendingEvents, setPendingEvents] = useState(null);
  const [activeGoalEdit, setActiveGoalEdit] = useState(null);
  const [goals, setGoals] = useState(GOALS);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEnergy, setShowEnergy] = useState(false);
  const [notification, setNotification] = useState(null);
  const inputRef = useRef(null);

  const showNotif = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const totalDeepWork = getDeepWorkHours(events);
  const totalMeetings = getMeetingHours(events);

  const callClaude = async (userCommand) => {
    setLoading(true);
    setSuggestions(null);

    const eventsContext = events.map(e => ({
      id: e.id, day: FULL_DAYS[e.day], start: `${e.start}:00`, end: `${e.end}:00`,
      type: e.type, title: e.title, source: e.source
    }));

    const tasksContext = NOTION_TASKS.map(t => ({
      title: t.title, priority: t.priority, due: t.due, type: t.type, estimate: t.est
    }));

    const currentStats = {
      deepWorkHours: totalDeepWork,
      meetingHours: totalMeetings,
    };

    const prompt = `You are an intelligent calendar optimizer for a solopreneur.

Current schedule:
${JSON.stringify(eventsContext, null, 2)}

Pending tasks from Notion/Linear:
${JSON.stringify(tasksContext, null, 2)}

Current week stats: ${JSON.stringify(currentStats)}

User command: "${userCommand}"

Respond ONLY with valid JSON in this exact format:
{
  "analysis": "Brief 1-2 sentence analysis of the current schedule issue",
  "suggestions": [
    {
      "id": "s1",
      "action": "move" | "create" | "delete" | "resize",
      "title": "Short action title (max 6 words)",
      "reason": "One sentence explanation why",
      "impact": "positive" | "warning",
      "eventId": <existing event id, or null for create>,
      "newDay": <0-4 for Mon-Fri, or null>,
      "newStart": <hour 8-18, or null>,
      "newEnd": <hour 9-19, or null>,
      "newTitle": <new title string or null>,
      "newType": <"deepWork"|"meeting"|"admin"|"content"|"personal"|null>
    }
  ],
  "summary": "One sentence describing the overall schedule transformation"
}

Provide 3-5 concrete, actionable suggestions. Be specific about moving/resizing events.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      const withPreviews = parsed.suggestions.map(s => {
        if (!s.eventId) return s;
        const existing = events.find(e => e.id === s.eventId);
        return { ...s, existingEvent: existing };
      });

      setSuggestions({ ...parsed, suggestions: withPreviews });

      const previewEvts = [...events];
      setPendingEvents(previewEvts);
    } catch (err) {
      setSuggestions({
        analysis: "Unable to reach AI. Showing a sample optimization.",
        summary: "Protecting morning hours for peak-performance deep work.",
        suggestions: [
          { id: "s1", action: "move", title: "Shift standup to afternoon", reason: "Free your peak morning hours for deep work.", impact: "positive", eventId: 6, newDay: 2, newStart: 15, newEnd: 16 },
          { id: "s2", action: "create", title: "Add deep work block Mon AM", reason: "Monday morning is your highest-energy slot.", impact: "positive", eventId: null, newDay: 0, newStart: 8, newEnd: 11, newTitle: "Deep Work — Strategy", newType: "deepWork" },
          { id: "s3", action: "move", title: "Consolidate Tuesday meetings", reason: "Batch meetings to preserve focus days.", impact: "positive", eventId: 5, newDay: 1, newStart: 14, newEnd: 15 },
        ]
      });
    }
    setLoading(false);
  };

  const applySuggestion = (s) => {
    setEvents(prev => {
      let updated = [...prev];
      if (s.action === "delete" && s.eventId) {
        updated = updated.filter(e => e.id !== s.eventId);
      } else if (s.action === "move" && s.eventId) {
        updated = updated.map(e => e.id === s.eventId ? {
          ...e,
          day: s.newDay ?? e.day,
          start: s.newStart ?? e.start,
          end: s.newEnd ?? e.end,
        } : e);
      } else if (s.action === "resize" && s.eventId) {
        updated = updated.map(e => e.id === s.eventId ? {
          ...e,
          start: s.newStart ?? e.start,
          end: s.newEnd ?? e.end,
        } : e);
      } else if (s.action === "create") {
        updated.push({
          id: Date.now(),
          day: s.newDay ?? 0,
          start: s.newStart ?? 9,
          end: s.newEnd ?? 11,
          type: s.newType ?? "deepWork",
          title: s.newTitle ?? "New Block",
          source: "ai",
        });
      }
      return updated;
    });
    showNotif(`Applied: ${s.title}`);
  };

  const applyAll = () => {
    if (!suggestions) return;
    suggestions.suggestions.forEach(s => applySuggestion(s));
    setSuggestions(null);
    showNotif("All suggestions applied ✓");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!command.trim()) return;
    callClaude(command);
  };

  const updatedGoals = goals.map(g => {
    if (g.type === "deepWork") return { ...g, current: totalDeepWork };
    if (g.type === "meeting") return { ...g, current: totalMeetings };
    return g;
  });

  return (
    <div style={{
      minHeight: "100vh", background: "#0E0E12", color: "#E8E4DC",
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
      display: "flex", flexDirection: "column",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #16161C; }
        ::-webkit-scrollbar-thumb { background: #2A2A35; border-radius: 2px; }
        .evt-block { transition: all 0.15s ease; cursor: pointer; }
        .evt-block:hover { filter: brightness(1.2); transform: translateX(2px); }
        .cmd-input { background: transparent; border: none; outline: none; color: #E8E4DC; font-size: 15px; font-family: 'DM Sans', sans-serif; width: 100%; }
        .cmd-input::placeholder { color: #4A4A5A; }
        .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; cursor: pointer; border: 1px solid; transition: all 0.1s; }
        .pill:hover { opacity: 0.8; }
        .sugg-card { background: #16161C; border: 1px solid #2A2A35; border-radius: 10px; padding: 14px; transition: border-color 0.15s; }
        .sugg-card:hover { border-color: #3A3A48; }
        .apply-btn { background: #C8860A; color: #0E0E12; border: none; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: background 0.1s; }
        .apply-btn:hover { background: #E09A12; }
        .dismiss-btn { background: transparent; color: #5A5A6A; border: 1px solid #2A2A35; padding: 6px 14px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; transition: all 0.1s; }
        .dismiss-btn:hover { border-color: #4A4A5A; color: #9A9AAA; }
        .example-tag { background: #1A1A22; border: 1px solid #2A2A35; border-radius: 20px; padding: 4px 10px; font-size: 11px; color: #7A7A8A; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .example-tag:hover { border-color: #C8860A44; color: #C8860A; background: #1E1608; }
        @keyframes shimmer { 0%,100% { opacity:0.4 } 50% { opacity:1 } }
        @keyframes slideUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        .loading-dot { animation: shimmer 1.2s ease-in-out infinite; }
        .slide-up { animation: slideUp 0.25s ease forwards; }
        .fade-in { animation: fadeIn 0.2s ease forwards; }
        .notif { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1E2018; border: 1px solid #4ACE9A44; color: #4ACE9A; padding: 10px 20px; border-radius: 8px; font-size: 13px; z-index: 999; animation: slideUp 0.2s ease; }
        .toggle-btn { background: transparent; border: 1px solid #2A2A35; color: #7A7A8A; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; font-family: inherit; transition: all 0.1s; }
        .toggle-btn:hover { border-color: #4A4A5A; color: #9A9AAA; }
        .toggle-btn.active { background: #1E1608; border-color: #C8860A44; color: #C8860A; }
      `}</style>

      {notification && <div className="notif">{notification.msg}</div>}

      <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "100vh" }}>

        {/* LEFT SIDEBAR */}
        <div style={{
          width: 240, background: "#0A0A0E", borderRight: "1px solid #1E1E28",
          display: "flex", flexDirection: "column", overflow: "hidden"
        }}>
          <div style={{ padding: "20px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <div style={{ width: 28, height: 28, background: "#C8860A", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="4" r="2.5" fill="#0E0E12"/>
                  <path d="M2 12c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="#0E0E12" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#E8E4DC" }}>Nexus</div>
                <div style={{ fontSize: 10, color: "#4A4A5A", letterSpacing: "0.05em" }}>AI SCHEDULER</div>
              </div>
            </div>

            {/* Weekly goals */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: "#4A4A5A", letterSpacing: "0.08em", marginBottom: 10, textTransform: "uppercase" }}>Weekly Goals</div>
              {updatedGoals.map(g => {
                const pct = Math.min(100, (g.current / g.target) * 100);
                const over = g.current > g.target;
                const warn = g.inverse && over;
                const color = warn ? "#E24B4A" : pct >= 80 ? "#4ACE9A" : "#C8860A";
                return (
                  <div key={g.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "#7A7A8A" }}>{g.label}</span>
                      <span style={{ fontSize: 11, color, fontFamily: "DM Mono" }}>{g.current}/{g.target}{g.unit}</span>
                    </div>
                    <div style={{ height: 3, background: "#1E1E28", borderRadius: 2 }}>
                      <div style={{ height: 3, width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.4s ease" }}/>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
              {[
                { label: "Deep work", val: `${totalDeepWork}h`, color: "#C8860A" },
                { label: "Meetings", val: `${totalMeetings}h`, color: "#4A9EE8" },
                { label: "Events", val: events.length, color: "#7A7A8A" },
                { label: "Free slots", val: "6", color: "#4ACE9A" },
              ].map(s => (
                <div key={s.label} style={{ background: "#111118", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: "#4A4A5A" }}>{s.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: s.color, fontFamily: "DM Mono" }}>{s.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* TASKS from Notion/Linear */}
          <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#4A4A5A", letterSpacing: "0.08em", textTransform: "uppercase" }}>Unscheduled Tasks</div>
            </div>
            {NOTION_TASKS.map(t => (
              <div key={t.id} style={{
                background: "#111118", borderRadius: 8, padding: "8px 10px", marginBottom: 6,
                borderLeft: `2px solid ${EVENT_TYPES[t.type]?.color || "#5A5A6A"}`,
                cursor: "pointer", transition: "background 0.1s"
              }}>
                <div style={{ fontSize: 11, color: "#C8C4BC", marginBottom: 3, lineHeight: 1.3 }}>{t.title}</div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: t.priority === "P1" ? "#E24B4A" : t.priority === "P2" ? "#C8860A" : "#5A5A6A", fontFamily: "DM Mono" }}>{t.priority}</span>
                  <span style={{ fontSize: 9, color: "#3A3A48" }}>·</span>
                  <span style={{ fontSize: 9, color: "#5A5A6A" }}>due {t.due}</span>
                  <span style={{ fontSize: 9, color: "#3A3A48" }}>·</span>
                  <span style={{ fontSize: 9, color: "#5A5A6A" }}>{t.est}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Integrations */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #1E1E28" }}>
            <div style={{ fontSize: 10, color: "#4A4A5A", letterSpacing: "0.08em", marginBottom: 8, textTransform: "uppercase" }}>Connected</div>
            {[
              { name: "Google Calendar", color: "#4A9EE8", dot: true },
              { name: "Notion", color: "#7A7A8A", dot: true },
              { name: "Linear", color: "#C86AB0", dot: true },
            ].map(i => (
              <div key={i.name} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: i.color }}/>
                <span style={{ fontSize: 11, color: "#5A5A6A" }}>{i.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* MAIN CALENDAR AREA */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Header */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #1E1E28", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#E8E4DC" }}>This Week</div>
              <div style={{ fontSize: 11, color: "#4A4A5A" }}>Mar 10–14, 2025</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className={`toggle-btn ${showEnergy ? "active" : ""}`} onClick={() => setShowEnergy(v => !v)}>
                ⚡ Energy
              </button>
              <div style={{ display: "flex", gap: 6 }}>
                {Object.entries(EVENT_TYPES).map(([k, v]) => (
                  <span key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5A5A6A" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: v.color, display: "inline-block" }}/>
                    {v.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Calendar Grid */}
          <div style={{ flex: 1, overflow: "auto", padding: "0 20px 20px" }}>
            <div style={{ minWidth: 700 }}>
              {/* Day headers */}
              <div style={{ display: "grid", gridTemplateColumns: "48px repeat(5, 1fr)", marginBottom: 0 }}>
                <div/>
                {DAYS.map((d, i) => (
                  <div key={d} style={{
                    padding: "12px 8px 8px", textAlign: "center",
                    borderBottom: "1px solid #1E1E28"
                  }}>
                    <div style={{ fontSize: 11, color: "#4A4A5A", letterSpacing: "0.05em" }}>{d}</div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: i === 0 ? "#C8860A" : "#E8E4DC" }}>{10 + i}</div>
                  </div>
                ))}
              </div>

              {/* Time grid */}
              <div style={{ position: "relative" }}>
                {HOURS.map((hr, hi) => (
                  <div key={hr} style={{
                    display: "grid", gridTemplateColumns: "48px repeat(5, 1fr)",
                    height: HOUR_H,
                  }}>
                    <div style={{ fontSize: 10, color: "#3A3A48", paddingTop: 6, fontFamily: "DM Mono", textAlign: "right", paddingRight: 8 }}>
                      {hr}:00
                    </div>
                    {DAYS.map((_, di) => (
                      <div key={di} style={{
                        borderTop: "1px solid #1A1A22",
                        borderLeft: di === 0 ? "none" : "1px solid #15151C",
                        position: "relative"
                      }}>
                        {showEnergy && (() => {
                          const lvl = ENERGY[di]?.pattern[hi] ?? 0;
                          const opacity = lvl === 3 ? 0.12 : lvl === 2 ? 0.06 : lvl === 1 ? 0.03 : 0;
                          return opacity > 0 ? (
                            <div style={{ position: "absolute", inset: 0, background: `rgba(200,134,10,${opacity})`, pointerEvents: "none" }}/>
                          ) : null;
                        })()}
                      </div>
                    ))}
                  </div>
                ))}

                {/* Events overlay */}
                <div style={{ position: "absolute", top: 0, left: 48, right: 0, height: "100%", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", pointerEvents: "none" }}>
                  {DAYS.map((_, di) => (
                    <div key={di} style={{ position: "relative", pointerEvents: "none" }}>
                      {events.filter(e => e.day === di).map(evt => {
                        const top = (evt.start - DAY_START) * HOUR_H;
                        const height = (evt.end - evt.start) * HOUR_H - 3;
                        const type = EVENT_TYPES[evt.type] || EVENT_TYPES.admin;
                        const isSelected = selectedEvent === evt.id;
                        return (
                          <div
                            key={evt.id}
                            className="evt-block"
                            onClick={() => { setSelectedEvent(isSelected ? null : evt.id); }}
                            style={{
                              position: "absolute", top, left: 2, right: 2, height,
                              background: type.bg,
                              border: `1px solid ${isSelected ? type.color : type.border + "66"}`,
                              borderLeft: `3px solid ${type.color}`,
                              borderRadius: 6, padding: "5px 8px",
                              overflow: "hidden", pointerEvents: "all",
                              zIndex: isSelected ? 10 : 1,
                              boxShadow: isSelected ? `0 0 0 1px ${type.color}44` : "none",
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 500, color: type.color, lineHeight: 1.2, marginBottom: 1 }}>{evt.title}</div>
                            {height > 36 && (
                              <div style={{ fontSize: 10, color: "#4A4A5A" }}>{evt.start}:00–{evt.end}:00</div>
                            )}
                            {height > 48 && evt.source !== "gcal" && (
                              <div style={{ fontSize: 9, color: "#3A3A48", marginTop: 2 }}>
                                {evt.source === "notion" ? "↗ Notion" : evt.source === "linear" ? "↗ Linear" : evt.source === "ai" ? "✦ AI" : ""}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* AI COMMAND BAR */}
          <div style={{ borderTop: "1px solid #1E1E28", padding: "0 20px 0" }}>

            {/* AI Suggestions Panel */}
            {loading && (
              <div style={{ padding: "16px 0", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", gap: 5 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="loading-dot" style={{
                      width: 6, height: 6, borderRadius: "50%", background: "#C8860A",
                      animationDelay: `${i * 0.2}s`
                    }}/>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: "#5A5A6A" }}>Analyzing your schedule and priorities…</span>
              </div>
            )}

            {suggestions && !loading && (
              <div className="slide-up" style={{ padding: "16px 0", borderBottom: "1px solid #1E1E28" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#C8860A", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>✦ AI Suggestions</div>
                    <div style={{ fontSize: 12, color: "#7A7A8A", maxWidth: 500 }}>{suggestions.analysis}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
                    <button className="apply-btn" onClick={applyAll}>Apply all</button>
                    <button className="dismiss-btn" onClick={() => setSuggestions(null)}>Dismiss</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                  {suggestions.suggestions.map(s => (
                    <div key={s.id} className="sugg-card" style={{ minWidth: 200, maxWidth: 220, flexShrink: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: s.impact === "positive" ? "#4ACE9A" : "#E24B4A", display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 12 }}>{s.impact === "positive" ? "↑" : "⚠"}</span>
                          {s.action.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "#C8C4BC", marginBottom: 4, lineHeight: 1.3 }}>{s.title}</div>
                      <div style={{ fontSize: 11, color: "#5A5A6A", marginBottom: 8, lineHeight: 1.4 }}>{s.reason}</div>
                      {s.existingEvent && (
                        <div style={{ fontSize: 10, color: "#3A3A48", marginBottom: 8, fontFamily: "DM Mono" }}>
                          "{s.existingEvent.title}" → {s.newDay !== null ? DAYS[s.newDay] : "—"} {s.newStart}:00
                        </div>
                      )}
                      <button className="apply-btn" style={{ fontSize: 10, padding: "4px 10px" }} onClick={() => applySuggestion(s)}>
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
                {suggestions.summary && (
                  <div style={{ fontSize: 11, color: "#3A3A48", marginTop: 8, fontStyle: "italic" }}>
                    ✦ {suggestions.summary}
                  </div>
                )}
              </div>
            )}

            {/* Example commands */}
            {!suggestions && !loading && (
              <div style={{ padding: "10px 0 6px", display: "flex", gap: 6, overflowX: "auto" }}>
                {EXAMPLE_COMMANDS.map((ex, i) => (
                  <button key={i} className="example-tag" onClick={() => {
                    setCommand(ex);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}>
                    {ex}
                  </button>
                ))}
              </div>
            )}

            {/* Command input */}
            <form onSubmit={handleSubmit} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 0", borderTop: "1px solid #1A1A22"
            }}>
              <div style={{ color: "#C8860A", fontSize: 14, flexShrink: 0 }}>✦</div>
              <input
                ref={inputRef}
                className="cmd-input"
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="Tell me your scheduling goals… 'I need 10 hours of deep work this week'"
                disabled={loading}
              />
              <button type="submit" disabled={loading || !command.trim()} style={{
                background: command.trim() ? "#C8860A" : "#1E1E28",
                color: command.trim() ? "#0E0E12" : "#3A3A48",
                border: "none", borderRadius: 6, padding: "7px 16px",
                fontSize: 12, fontWeight: 500, cursor: command.trim() ? "pointer" : "default",
                fontFamily: "inherit", transition: "all 0.15s", flexShrink: 0
              }}>
                {loading ? "…" : "Optimize →"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
