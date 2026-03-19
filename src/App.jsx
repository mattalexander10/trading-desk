import { useEffect, useRef, useState } from "react";

const today = new Date().toISOString().slice(0, 10);

const C = {
  bg:"#0a0c0f",surface:"#111318",panel:"#0f1217",border:"#1e2128",
  borderLight:"#2a2d36",text:"#e8eaf0",muted:"#6b7280",accent:"#4a9eff",
  accentDim:"#183554",green:"#22c55e",greenDim:"#123820",amber:"#f59e0b",
  amberDim:"#3f2b09",red:"#ef4444",redDim:"#4a1717",tag:"#171b25",
};

const SYSTEM = `
You are Trading Desk Assistant, a conversational structured credit desk tool for traders.
You have access to three databases: Color, Live Axes, and Trade History.
Today is ${today}.

CORE BEHAVIOR
- Be conversational, helpful, and desk-smart.
- Understand natural trader language.
- If the user provides only a CUSIP, partial CUSIP, bond name, or deal name, default to SEARCH.
- If the user asks "color on X", "anything on X", "what do we have on X", treat it as SEARCH.
- Use a trader-friendly tone.

NON-NEGOTIABLE RULES
- Never fabricate data. Only report what is returned from the database.
- If no results found, say so clearly.
- Do not output hidden reasoning or chain-of-thought tags.

INTENT MODES

1) SEARCH — default for bare CUSIPs, bond names, deal names
- Search ALL THREE databases
- Return all relevant fields conversationally
- Most recent first
- No matches: say "No matches found"

2) COLOR_ENTRY — when user is logging color
- Extract: Bond Name, BID, OFFERS, PX COLOR, ACCOUNT, ACCOUNT 1, SIZE, NOTES
- Confirm what was saved

3) AXES_ENTRY — when user is logging axes
- Extract: Counterparty, Trade Type, Security, CUSIP, Price, Size, Notes
- Confirm what was saved

4) CHAT — general questions

GROSS REVENUE (Trade History)
- Each trade has a BUY row and a SELL row
- Gross Revenue = Sale Total Price minus Buy Total Price
- Never report a single leg as revenue

STYLE: concise, smart, conversational, trader-facing.
`;

async function supabaseQuery(table, search) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "supabase_query", table, search }),
  });
  if (!res.ok) return [];
  return res.json();
}

async function supabaseInsert(table, row) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "supabase_insert", table, row }),
  });
  return res.ok;
}

function classifyIntent(input) {
  const l = input.trim().toLowerCase();
  if (!l) return "CHAT";
  if (/^(color:|color\s+[a-z0-9])/i.test(input) || /\b(add color|log color|save color)\b/i.test(l)) return "COLOR_ENTRY";
  if (/^(axes:|axe:|live axes?:?)/i.test(input) || /\b(add axes|log axes|save axes|live axe)\b/i.test(l)) return "AXES_ENTRY";
  if (/\b(search|look up|find|show me|check|color on|anything on|what do we have|what color|any color|any axes|any history)\b/i.test(l) || /^[0-9A-Z]{6,9}$/i.test(input.trim())) return "SEARCH";
  return "CHAT";
}

function pillStyle(intent) {
  const m = {
    SEARCH:      { bg:C.amberDim, fg:C.amber,  bd:`${C.amber}55` },
    COLOR_ENTRY: { bg:C.greenDim, fg:C.green,  bd:`${C.green}55` },
    AXES_ENTRY:  { bg:"#16263a",  fg:C.accent, bd:`${C.accent}55` },
    CHAT:        { bg:"#262626",  fg:"#d1d5db", bd:"#525252" },
  };
  const { bg, fg, bd } = m[intent] || m.CHAT;
  return { display:"inline-block", fontSize:10, fontWeight:700, letterSpacing:"0.09em", background:bg, color:fg, border:`1px solid ${bd}`, borderRadius:4, padding:"2px 7px", marginBottom:8 };
}

function TypingIndicator() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, width:"fit-content", padding:"10px 12px" }}>
      {[0,0.15,0.3].map((d,i) => <div key={i} style={{ width:6, height:6, borderRadius:"999px", background:C.muted, animation:`tpulse 1.1s ease-in-out ${d}s infinite` }} />)}
      <style>{`@keyframes tpulse{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}`}</style>
      <span style={{ fontSize:11, color:C.muted }}>working…</span>
    </div>
  );
}

function Bubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display:"flex", justifyContent:isUser ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth:"84%", background:isUser ? C.accentDim : C.surface, border:`1px solid ${isUser ? "#245b92" : C.border}`, borderRadius:8, padding:"12px 14px", whiteSpace:"pre-wrap", wordBreak:"break-word", lineHeight:1.6, fontSize:12, color:C.text, fontFamily:"Inter, ui-monospace, monospace" }}>
        {isUser && msg.intent && <div style={pillStyle(msg.intent)}>{msg.intent}</div>}
        {msg.content}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([{
    role:"assistant",
    content:"TRADING DESK ASSISTANT ONLINE\n\nNatural language supported.\nExamples:\n  STWD 2021-LIH B\n  color on STWD 2021-LIH B?\n  anything on 85572RAC8\n  color: STWD 2021-LIH B BLK 10mm 99-19+\n  MS selling 5mm BMARK 2020-B20 A +155\n\nSending only a CUSIP or bond name will search all 3 databases.",
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const taRef = useRef(null);
  const hints = ["STWD 2021-LIH B", "color on STWD 2021-LIH B?", "color: ", "MS selling 5mm "];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const intent = classifyIntent(trimmed);
    const userMsg = { role:"user", content:trimmed, intent };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      let dbContext = "";

      if (intent === "SEARCH") {
        const term = trimmed.replace(/^(search|color on|anything on|what do we have on|what color do we have on):?\s*/i, "").trim();
        const [colorRows, axesRows, historyRows] = await Promise.all([
          supabaseQuery("color", term),
          supabaseQuery("axes", term),
          supabaseQuery("trade_history", term),
        ]);
        dbContext = `DATABASE RESULTS:\nColor: ${JSON.stringify(colorRows)}\nAxes: ${JSON.stringify(axesRows)}\nTrade History: ${JSON.stringify(historyRows)}`;
      }

      const apiMessages = newMessages.map(m => ({
        role: m.role,
        content: m.role === "user" && m === userMsg
          ? `INTENT: ${intent}\n${dbContext ? dbContext + "\n" : ""}User: ${trimmed}`
          : m.content,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1600,
          system: SYSTEM,
          messages: apiMessages,
        }),
      });

      const data = await res.json();
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n\n") || "No response.";

      if (intent === "COLOR_ENTRY") {
        const parseRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 500,
            messages: [{ role: "user", content: `Parse this color entry and return ONLY a JSON object with keys: Property, BID, OFFERS, "PX COLOR", ACCOUNT, "ACCOUNT 1", SIZE, NOTES, DATE. DATE=${today}. Entry: ${trimmed}` }],
          }),
        });
        const parseData = await parseRes.json();
        const parseText = parseData.content?.[0]?.text || "";
        try {
          const clean = parseText.replace(/```json|```/g, "").trim();
          const row = JSON.parse(clean);
          await supabaseInsert("color", row);
        } catch {}
      }

      if (intent === "AXES_ENTRY") {
        const parseRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 500,
            messages: [{ role: "user", content: `Parse this axes entry and return ONLY a JSON object with keys: Summary, Counterparty, "Trade Type", Security, Price, Size, Notes, Date. Date=${today}. Entry: ${trimmed}` }],
          }),
        });
        const parseData = await parseRes.json();
        const parseText = parseData.content?.[0]?.text || "";
        try {
          const clean = parseText.replace(/```json|```/g, "").trim();
          const row = JSON.parse(clean);
          await supabaseInsert("axes", row);
        } catch {}
      }

      setMessages(prev => [...prev, { role:"assistant", content:text }]);
    } catch (e) {
      setMessages(prev => [...prev, { role:"assistant", content:`Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background:C.bg, minHeight:"100vh", display:"flex", flexDirection:"column", color:C.text, fontFamily:"Inter, ui-monospace, monospace" }}>
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:10, height:10, borderRadius:"999px", background:C.green, boxShadow:`0 0 12px ${C.green}66` }} />
          <div>
            <div style={{ fontSize:13, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>Trading Desk Assistant</div>
            <div style={{ fontSize:11, color:C.muted }}>Claude + Supabase</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {["COLOR DB","AXES DB","HISTORY DB"].map(l => (
            <div key={l} style={{ fontSize:10, color:C.muted, background:C.tag, border:`1px solid ${C.border}`, padding:"4px 8px", borderRadius:4 }}>{l}</div>
          ))}
        </div>
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ flex:1, overflowY:"auto", padding:18, display:"flex", flexDirection:"column", gap:16 }}>
          {messages.map((m,i) => <Bubble key={i} msg={m} />)}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        <div style={{ borderTop:`1px solid ${C.border}`, background:C.surface, padding:"14px 18px" }}>
          <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
            {hints.map(h => (
              <div key={h} onClick={() => { setInput(h); taRef.current?.focus(); }}
                style={{ fontSize:10, color:C.muted, background:C.tag, border:`1px solid ${C.border}`, padding:"4px 8px", borderRadius:4, cursor:"pointer" }}>{h}</div>
            ))}
            <div style={{ fontSize:10, color:C.muted, marginLeft:"auto" }}>enter to send · shift+enter for newline</div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
            <textarea
              ref={taRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask naturally… bond name or CUSIP alone will search all 3 databases."
              style={{ flex:1, minHeight:52, maxHeight:180, resize:"vertical", borderRadius:8, border:`1px solid ${C.borderLight}`, background:C.panel, color:C.text, padding:12, fontSize:12, lineHeight:1.6, outline:"none", fontFamily:"inherit" }}
            />
            <button onClick={send}
              style={{ height:44, minWidth:90, borderRadius:8, border:"none", background:input.trim() && !loading ? C.accent : C.borderLight, color:input.trim() && !loading ? "#fff" : C.muted, fontSize:11, fontWeight:700, letterSpacing:"0.07em", cursor:input.trim() && !loading ? "pointer" : "default" }}>
              SEND
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
