import { useState, useEffect, useCallback } from "react";
import {
  initGoogle,
  signIn,
  signOut,
  fetchWeekEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "./googleCalendar";

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

// --- Helpers ---
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function hourFromDate(dateStr) {
  const d = new Date(dateStr);
  return d.getHours() + d.getMinutes() / 60;
}

function durationHours(start, end) {
  return (new Date(end) - new Date(start)) / 3600000;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7am–9pm

const CATEGORY_COLORS = {
  "deep-work": { bg: "rgba(245,158,11,0.18)", border: "#F59E0B", text: "#FCD34D", dot: "#F59E0B" },
  meeting: { bg: "rgba(59,130,246,0.18)", border: "#3B82F6", text: "#93C5FD", dot: "#3B82F6" },
  content: { bg: "rgba(20,184,166,0.18)", border: "#14B8A6", text: "#5EEAD4", dot: "#14B8A6" },
  admin: { bg: "rgba(107,114,128,0.18)", border: "#6B7280", text: "#9CA3AF", dot: "#6B7280" },
  other: { bg: "rgba(139,92,246,0.18)", border: "#8B5CF6", text: "#C4B5FD", dot: "#8B5CF6" },
};

// Sample events for demo mode
function getSampleEvents(weekStart) {
  const d = (dayOffset, h, m) => {
    const dt = new Date(weekStart);
    dt.setDate(dt.getDate() + dayOffset);
    dt.setHours(h, m, 0, 0);
    return dt.toISOString();
  };
  return [
    { id: "s1", title: "Deep Work: Product Strategy", start: d(1, 9, 0), end: d(1, 11, 0), category: "deep-work", color: "#F59E0B" },
    { id: "s2", title: "Team Standup", start: d(1, 11, 0), end: d(1, 11, 30), category: "meeting", color: "#3B82F6" },
    { id: "s3", title: "Client Call — Acme Corp", start: d(2, 14, 0), end: d(2, 15, 0), category: "meeting", color: "#3B82F6" },
    { id: "s4", title: "Content Creation Block", start: d(3, 10, 0), end: d(3, 12, 0), category: "content", color: "#14B8A6" },
    { id: "s5", title: "Deep Work: Feature Dev", start: d(4, 9, 0), end: d(4, 12, 0), category: "deep-work", color: "#F59E0B" },
    { id: "s6", title: "Admin & Email", start: d(4, 16, 0), end: d(4, 17, 0), category: "admin", color: "#6B7280" },
    { id: "s7", title: "Weekly Review", start: d(5, 15, 0), end: d(5, 16, 0), category: "admin", color: "#6B7280" },
  ];
}

export default function App() {
  const [googleReady, setGoogleReady] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [events, setEvents] = useState([]);
  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [command, setCommand] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showEnergy, setShowEnergy] = useState(false);
  const [goals, setGoals] = useState([
    { id: 1, label: "Deep Work", target: 10, unit: "hrs", category: "deep-work" },
    { id: 2, label: "Content", target: 4, unit: "hrs", category: "content" },
    { id: 3, label: "Meetings", target: 6, unit: "hrs max", category: "meeting" },
  ]);
  const [demoMode, setDemoMode] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Init Google
  useEffect(() => {
    initGoogle(() => setGoogleReady(true));
  }, []);

  // Load events when signed in or week changes
  const loadEvents = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const evts = await fetchWeekEvents(weekStart);
      setEvents(evts);
    } catch (e) {
      console.error(e);
    }
  }, [isSignedIn, weekStart]);

  useEffect(() => {
    if (isSignedIn) loadEvents();
  }, [loadEvents]);

  // Demo mode
  useEffect(() => {
    if (demoMode) setEvents(getSampleEvents(weekStart));
  }, [demoMode, weekStart]);

  const handleSignIn = () => {
    signIn((ok) => {
      if (ok) {
        setIsSignedIn(true);
        setDemoMode(false);
      }
    });
  };

  const handleSignOut = () => {
    signOut();
    setIsSignedIn(false);
    setEvents([]);
  };

  // Compute goal progress
  function getProgress(category) {
    const relevant = events.filter((e) => e.category === category);
    const totalHrs = relevant.reduce((sum, e) => {
      if (!e.start || !e.end) return sum;
      return sum + durationHours(e.start, e.end);
    }, 0);
    return Math.round(totalHrs * 10) / 10;
  }

  // AI Scheduling
  async function runAI() {
    if (!command.trim()) return;
    setAiLoading(true);
    setSuggestions([]);

    const evtSummary = events
      .slice(0, 20)
      .map((e) => `- ${e.title} (${formatTime(e.start)}–${formatTime(e.end)}, ${e.category})`)
      .join("\n");

    const prompt = `You are an AI scheduling assistant. Here is the user's current week:
${evtSummary || "(No events yet)"}

User goal: "${command}"

Return EXACTLY 4 scheduling suggestions as a JSON array. Each suggestion must have:
- "action": one of "move", "create", "delete", "protect"
- "title": event title
- "reason": one sentence explanation (max 15 words)
- "from": current time (if move/delete, e.g. "Mon 2pm")
- "to": new time (if move/create, e.g. "Tue 9am")
- "startISO": ISO datetime string for the new/created event start
- "endISO": ISO datetime string for the new/created event end (1-2 hours after start)

Respond ONLY with a valid JSON array. No markdown, no explanation.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "[]";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setSuggestions(parsed);
    } catch (e) {
      setSuggestions([
        { action: "create", title: "Deep Work Block", reason: "Schedule focused time aligned with your goal", from: "", to: "Tomorrow 9am", startISO: "", endISO: "" },
      ]);
    } finally {
      setAiLoading(false);
    }
  }

  async function applySuggestion(s) {
    if (!isSignedIn) {
      // Demo mode: just show a message
      setStatusMsg(`✓ Applied: "${s.title}" — ${s.reason}`);
      setTimeout(() => setStatusMsg(""), 3000);
      setSuggestions((prev) => prev.filter((x) => x !== s));
      return;
    }
    try {
      if (s.action === "create" && s.startISO && s.endISO) {
        await createCalendarEvent({ title: s.title, startDateTime: s.startISO, endDateTime: s.endISO });
      } else if (s.action === "move" && s.startISO && s.endISO) {
        const existing = events.find((e) => e.title.toLowerCase().includes(s.title.toLowerCase()));
        if (existing?.id && existing.googleEvent) {
          await updateCalendarEvent(existing.id, {
            start: { dateTime: s.startISO },
            end: { dateTime: s.endISO },
          });
        } else {
          await createCalendarEvent({ title: s.title, startDateTime: s.startISO, endDateTime: s.endISO });
        }
      } else if (s.action === "delete") {
        const existing = events.find((e) => e.title.toLowerCase().includes(s.title.toLowerCase()));
        if (existing?.id && existing.googleEvent) await deleteCalendarEvent(existing.id);
      }
      setStatusMsg(`✓ Applied: "${s.title}"`);
      setTimeout(() => setStatusMsg(""), 3000);
      setSuggestions((prev) => prev.filter((x) => x !== s));
      await loadEvents();
    } catch (e) {
      setStatusMsg("⚠ Could not apply — check console");
      setTimeout(() => setStatusMsg(""), 3000);
    }
  }

  async function applyAll() {
    for (const s of suggestions) await applySuggestion(s);
  }

  // Week navigation
  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  // Grid rendering helpers
  function getEventStyle(evt) {
    const d = new Date(evt.start);
    const dayIdx = d.getDay();
    const top = ((hourFromDate(evt.start) - 7) / 15) * 100;
    const height = Math.max((durationHours(evt.start, evt.end) / 15) * 100, 2);
    const col = CATEGORY_COLORS[evt.category] || CATEGORY_COLORS.other;
    return { dayIdx, top: `${top}%`, height: `${height}%`, ...col };
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const isToday = (d) => {
    const today = new Date();
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
  };

  // Energy overlay data (peak hours: 9-11am, 3-5pm)
  const energyPeaks = [{ start: 9, end: 11 }, { start: 15, end: 17 }];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0e1a 0%, #0d1220 50%, #0a0e1a 100%)",
      color: "#e2e8f0",
      fontFamily: "'DM Sans', sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 28px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(10,14,26,0.8)", backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #F59E0B, #EF4444)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 700,
          }}>N</div>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, letterSpacing: "-0.5px" }}>
            Nexus
          </span>
          <span style={{ fontSize: 11, color: "#6b7280", background: "rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: 20, marginLeft: 4 }}>
            AI Scheduler
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Week nav */}
          <button onClick={prevWeek} style={navBtn}>‹</button>
          <span style={{ fontSize: 13, color: "#94a3b8", minWidth: 160, textAlign: "center" }}>
            {formatDate(weekStart)} — {formatDate(weekDays[6])}
          </span>
          <button onClick={nextWeek} style={navBtn}>›</button>

          {/* Energy toggle */}
          <button onClick={() => setShowEnergy(!showEnergy)} style={{
            ...navBtn, padding: "6px 12px", fontSize: 12,
            background: showEnergy ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.05)",
            border: showEnergy ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(255,255,255,0.08)",
            color: showEnergy ? "#F59E0B" : "#94a3b8",
          }}>⚡ Energy</button>

          {/* Auth */}
          {!googleReady ? (
            <span style={{ fontSize: 12, color: "#6b7280" }}>Loading Google…</span>
          ) : isSignedIn ? (
            <button onClick={handleSignOut} style={{ ...navBtn, padding: "6px 14px", fontSize: 12, color: "#f87171" }}>
              Sign Out
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSignIn} style={{
                ...navBtn, padding: "6px 14px", fontSize: 12,
                background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(99,102,241,0.2))",
                border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc",
              }}>
                🗓 Connect Google Calendar
              </button>
              <button onClick={() => setDemoMode(true)} style={{
                ...navBtn, padding: "6px 12px", fontSize: 12, color: "#6b7280",
              }}>
                Try Demo
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Status message */}
      {statusMsg && (
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "#10b981", color: "#fff", padding: "10px 20px", borderRadius: 8,
          fontSize: 13, fontWeight: 500, zIndex: 100, boxShadow: "0 4px 20px rgba(16,185,129,0.3)",
        }}>{statusMsg}</div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden", gap: 0 }}>
        {/* Left Sidebar */}
        <aside style={{
          width: 220, flexShrink: 0, padding: "20px 16px",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          overflowY: "auto", display: "flex", flexDirection: "column", gap: 20,
        }}>
          {/* Goals */}
          <section>
            <h3 style={sideHeading}>Weekly Goals</h3>
            {goals.map((g) => {
              const progress = getProgress(g.category);
              const pct = Math.min((progress / g.target) * 100, 100);
              const col = CATEGORY_COLORS[g.category];
              return (
                <div key={g.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: "#cbd5e1" }}>{g.label}</span>
                    <span style={{ color: col?.text || "#94a3b8" }}>{progress}/{g.target} {g.unit}</span>
                  </div>
                  <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: col?.dot || "#8B5CF6", borderRadius: 2, transition: "width 0.4s" }} />
                  </div>
                </div>
              );
            })}
          </section>

          {/* Legend */}
          <section>
            <h3 style={sideHeading}>Event Types</h3>
            {Object.entries(CATEGORY_COLORS).map(([cat, col]) => (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: col.dot, flexShrink: 0 }} />
                <span style={{ color: "#94a3b8", textTransform: "capitalize" }}>{cat.replace("-", " ")}</span>
              </div>
            ))}
          </section>

          {/* Unscheduled tasks */}
          <section>
            <h3 style={sideHeading}>Tasks (Notion)</h3>
            {[
              { label: "Write Q2 report", priority: "P1" },
              { label: "Record tutorial video", priority: "P2" },
              { label: "Update pricing page", priority: "P2" },
              { label: "Send invoices", priority: "P3" },
            ].map((t) => (
              <div key={t.label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "6px 8px", borderRadius: 6, marginBottom: 4,
                background: "rgba(255,255,255,0.03)", fontSize: 11,
              }}>
                <span style={{ color: "#94a3b8" }}>{t.label}</span>
                <span style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: 4,
                  background: t.priority === "P1" ? "rgba(239,68,68,0.15)" : t.priority === "P2" ? "rgba(245,158,11,0.15)" : "rgba(107,114,128,0.15)",
                  color: t.priority === "P1" ? "#f87171" : t.priority === "P2" ? "#fbbf24" : "#9ca3af",
                }}>{t.priority}</span>
              </div>
            ))}
          </section>
        </aside>

        {/* Main Calendar */}
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Day Headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "52px repeat(7, 1fr)",
            borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
          }}>
            <div />
            {weekDays.map((d, i) => (
              <div key={i} style={{
                padding: "10px 6px", textAlign: "center",
                borderLeft: "1px solid rgba(255,255,255,0.04)",
              }}>
                <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {DAYS[d.getDay()]}
                </div>
                <div style={{
                  fontSize: 18, fontWeight: 300, marginTop: 2,
                  color: isToday(d) ? "#F59E0B" : "#e2e8f0",
                  ...(isToday(d) && { fontWeight: 600 }),
                }}>{d.getDate()}</div>
              </div>
            ))}
          </div>

          {/* Time Grid */}
          <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "52px repeat(7, 1fr)",
              minHeight: "100%", position: "relative",
            }}>
              {/* Time labels */}
              <div>
                {HOURS.map((h) => (
                  <div key={h} style={{ height: 56, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 8, paddingTop: 2 }}>
                    <span style={{ fontSize: 10, color: "#4b5563" }}>
                      {h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`}
                    </span>
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {weekDays.map((day, dayIdx) => {
                const dayEvents = events.filter((e) => {
                  const d = new Date(e.start);
                  return d.getDate() === day.getDate() && d.getMonth() === day.getMonth();
                });

                return (
                  <div key={dayIdx} style={{
                    borderLeft: "1px solid rgba(255,255,255,0.04)",
                    position: "relative", height: `${HOURS.length * 56}px`,
                  }}>
                    {/* Hour lines */}
                    {HOURS.map((h) => (
                      <div key={h} style={{
                        position: "absolute", left: 0, right: 0,
                        top: `${((h - 7) / HOURS.length) * 100}%`,
                        borderTop: "1px solid rgba(255,255,255,0.03)",
                      }} />
                    ))}

                    {/* Energy overlay */}
                    {showEnergy && energyPeaks.map((peak, pi) => (
                      <div key={pi} style={{
                        position: "absolute", left: 2, right: 2,
                        top: `${((peak.start - 7) / HOURS.length) * 100}%`,
                        height: `${((peak.end - peak.start) / HOURS.length) * 100}%`,
                        background: "rgba(245,158,11,0.06)",
                        borderLeft: "2px solid rgba(245,158,11,0.25)",
                        borderRadius: 4, pointerEvents: "none",
                      }} />
                    ))}

                    {/* Events */}
                    {dayEvents.map((evt) => {
                      const top = ((hourFromDate(evt.start) - 7) / HOURS.length) * 100;
                      const height = Math.max((durationHours(evt.start, evt.end) / HOURS.length) * 100, 2);
                      const col = CATEGORY_COLORS[evt.category] || CATEGORY_COLORS.other;
                      const isSelected = selectedEvent?.id === evt.id;

                      return (
                        <div key={evt.id} onClick={() => setSelectedEvent(isSelected ? null : evt)}
                          style={{
                            position: "absolute", left: 3, right: 3,
                            top: `${top}%`, height: `${height}%`,
                            background: col.bg, borderLeft: `3px solid ${col.border}`,
                            borderRadius: "0 5px 5px 0", padding: "3px 6px",
                            cursor: "pointer", overflow: "hidden",
                            boxShadow: isSelected ? `0 0 0 1px ${col.border}` : "none",
                            transition: "box-shadow 0.15s",
                            zIndex: isSelected ? 10 : 1,
                          }}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: col.text, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {evt.title}
                          </div>
                          {height > 5 && (
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                              {formatTime(evt.start)}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Today line */}
                    {isToday(day) && (() => {
                      const now = new Date();
                      const pct = ((now.getHours() + now.getMinutes() / 60 - 7) / HOURS.length) * 100;
                      return pct > 0 && pct < 100 ? (
                        <div style={{
                          position: "absolute", left: 0, right: 0, top: `${pct}%`,
                          borderTop: "2px solid #F59E0B", zIndex: 20,
                        }}>
                          <div style={{ width: 8, height: 8, background: "#F59E0B", borderRadius: "50%", marginTop: -5, marginLeft: -4 }} />
                        </div>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Command Bar */}
          <div style={{
            padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(10,14,26,0.9)", flexShrink: 0,
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#4b5563" }}>✦</span>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runAI()}
                  placeholder='Try: "I need 10 hours of deep work this week" or "protect my mornings"'
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10,
                    padding: "11px 14px 11px 34px", fontSize: 13, color: "#e2e8f0",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
              <button onClick={runAI} disabled={aiLoading} style={{
                padding: "11px 20px", borderRadius: 10, border: "none", cursor: "pointer",
                background: aiLoading ? "rgba(245,158,11,0.1)" : "linear-gradient(135deg, #F59E0B, #EF4444)",
                color: aiLoading ? "#6b7280" : "#fff", fontSize: 13, fontWeight: 600,
                whiteSpace: "nowrap", transition: "opacity 0.2s",
              }}>
                {aiLoading ? "Thinking…" : "Ask AI →"}
              </button>
            </div>

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>AI Suggestions</span>
                  <button onClick={applyAll} style={{
                    fontSize: 11, padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.3)",
                    background: "rgba(245,158,11,0.08)", color: "#fbbf24", cursor: "pointer",
                  }}>Apply All</button>
                </div>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                  {suggestions.map((s, i) => (
                    <div key={i} style={{
                      flexShrink: 0, background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8,
                      padding: "10px 12px", minWidth: 200, maxWidth: 240,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, padding: "2px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.05em",
                          background: s.action === "create" ? "rgba(20,184,166,0.15)" : s.action === "move" ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)",
                          color: s.action === "create" ? "#5eead4" : s.action === "move" ? "#93c5fd" : "#f87171",
                        }}>{s.action}</span>
                        <button onClick={() => setSuggestions(prev => prev.filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "#e2e8f0", marginBottom: 3 }}>{s.title}</div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{s.reason}</div>
                      {(s.from || s.to) && (
                        <div style={{ fontSize: 10, color: "#4b5563", marginBottom: 8 }}>
                          {s.from && <span>{s.from} → </span>}
                          {s.to && <span style={{ color: "#94a3b8" }}>{s.to}</span>}
                        </div>
                      )}
                      <button onClick={() => applySuggestion(s)} style={{
                        width: "100%", padding: "6px", borderRadius: 6, border: "none", cursor: "pointer",
                        background: "rgba(245,158,11,0.12)", color: "#fbbf24", fontSize: 11, fontWeight: 500,
                      }}>Apply →</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right Panel — selected event */}
        {selectedEvent && (
          <aside style={{
            width: 220, flexShrink: 0, padding: "20px 16px",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(10,14,26,0.5)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ ...sideHeading, margin: 0 }}>Event Details</h3>
              <button onClick={() => setSelectedEvent(null)}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <div style={{
              padding: 12, borderRadius: 8,
              background: CATEGORY_COLORS[selectedEvent.category]?.bg || "rgba(255,255,255,0.04)",
              borderLeft: `3px solid ${CATEGORY_COLORS[selectedEvent.category]?.border || "#8B5CF6"}`,
              marginBottom: 14,
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#e2e8f0", marginBottom: 6 }}>{selectedEvent.title}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {formatTime(selectedEvent.start)} — {formatTime(selectedEvent.end)}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, textTransform: "capitalize" }}>
                {selectedEvent.category?.replace("-", " ")}
              </div>
            </div>
            {selectedEvent.description && (
              <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>{selectedEvent.description}</p>
            )}
            <button onClick={() => {
              if (command) setCommand(command + ` Move "${selectedEvent.title}"`);
              else setCommand(`Reschedule "${selectedEvent.title}" to a better time`);
              setSelectedEvent(null);
            }} style={{
              width: "100%", padding: "8px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.2)",
              background: "rgba(245,158,11,0.05)", color: "#fbbf24", fontSize: 12, cursor: "pointer",
            }}>
              Ask AI to reschedule ✦
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

// Shared styles
const navBtn = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8, color: "#94a3b8",
  cursor: "pointer", padding: "6px 10px", fontSize: 14,
  transition: "background 0.15s",
};

const sideHeading = {
  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
  color: "#4b5563", marginBottom: 10, marginTop: 0,
};
