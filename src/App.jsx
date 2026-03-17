import { useEffect, useMemo, useRef, useState } from "react";

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const DATABASES = {
  color:   { name: "Color Database",       url: "https://www.notion.so/2fcac19f35ca8086be1cef0c2b2961e5" },
  axes:    { name: "Live Axes Database",    url: "https://www.notion.so/77d36188fcec4d529fe8ec89e3069254" },
  history: { name: "Trade History Database",url: "https://www.notion.so/2fdac19f35ca807da521de890720c067" },
};
const today = new Date().toISOString().slice(0, 10);

const C = {
  bg:"#0a0c0f",surface:"#111318",panel:"#0f1217",border:"#1e2128",
  borderLight:"#2a2d36",text:"#e8eaf0",muted:"#6b7280",accent:"#4a9eff",
  accentDim:"#183554",green:"#22c55e",greenDim:"#123820",amber:"#f59e0b",
  amberDim:"#3f2b09",red:"#ef4444",redDim:"#4a1717",tag:"#171b25",
};

const SYSTEM = `
You are Trading Desk Assistant, a conversational structured credit desk tool for traders.
You have access to a Notion MCP server. The relevant databases are:
1. ${DATABASES.color.name}   URL: ${DATABASES.color.url}
2. ${DATABASES.axes.name}    URL: ${DATABASES.axes.url}
3. ${DATABASES.history.name} URL: ${DATABASES.history.url}
Today is ${today}.

CORE BEHAVIOR
- Be conversational, helpful, and desk-smart.
- Understand natural trader language, not just rigid commands.
- If the user provides only a CUSIP, partial CUSIP, bond name, or deal name, default to SEARCH across all three databases.
- If the user asks "color on X", "anything on X", "what do we have on X", treat it as SEARCH.
- Use a trader-friendly tone.

NON-NEGOTIABLE RULES
- Never pretend you searched Notion if you did not actually use a tool.
- If tool access is unavailable or a query fails, say that clearly.
- Do not fabricate matches, rows, links, or fields.
- Do not output hidden reasoning, chain-of-thought, or <thinking> tags.

INTENT MODES

1) SEARCH — default for bare CUSIPs, bond names, deal names, conversational lookup
- Search ALL THREE databases: Live Axes, Color, Trade History
- CUSIP: exact match first, then first 6 digits
- Bond/deal: exact match first, then deal/root match
- Output: conversational opening, grouped by database, most recent first, key fields, page link if available
- No matches: "No matches found"
- Cross-database results: add a short Desk Takeaway

2) COLOR_ENTRY — when user is clearly logging/adding/saving color
- Parse free text, create entry in Color Database
- Extract: Bond Name, CUSIP, BID, OFFERS, PX COLOR, Dealer/Account, Additional Accounts, SIZE, NOTES, Date=${today}
- Use "N/A" for missing fields. Confirm what was saved.

3) AXES_ENTRY — when user is clearly logging/adding/saving axes
- Parse free text, create entries in Live Axes Database
- Extract: Counterparty/Dealer, Trade Type, Bond Name/Security, CUSIP, Price/Spread, SIZE, NOTES, Timestamp=now
- Split multiple axes into separate rows. Confirm what was saved.

4) CHAT — broad conversational questions
- If a chat question implies a lookup, search all three databases.

GROSS REVENUE CALCULATION (Trade History Database)
- Each trade in the Trade History Database has TWO rows: one where B/S = "B" (buy) and one where B/S = "S" (sell).
- NEVER report Total Price from a single row as revenue.
- When revenue is requested or relevant, you MUST:
  1. Fetch ALL rows for that trade (same bond/CUSIP).
  2. Identify the row where B/S = "S" → that row's "Total Price" = Sale Price.
  3. Identify the row where B/S = "B" → that row's "Total Price" = Buy Price.
  4. Compute: Gross Revenue = Sale Total Price − Buy Total Price.
  5. Report only the final Gross Revenue figure. Do not show individual leg prices unless explicitly asked.
- If only one leg is found, say so clearly and do not guess or fabricate the other leg.

STYLE: concise, smart, conversational, trader-facing.
`;

function sanitize(t) {
  return t
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi,"")
    .replace(/<\/?thinking>/gi,"")
    .replace(/^\s*thinking:\s*$/gim,"")
    .replace(/^\s*thought\s*:.*$/gim,"")
    .replace(/<search_[^>]+>[\s\S]*?<\/search_[^>]+>/gi,"")
    .trim();
}

function extractReply(data) {
  const blocks = Array.isArray(data.content) ? data.content : [];
  const textParts = [], toolNames = new Set();
  let toolUsed = false;
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") { textParts.push(b.text); continue; }
    if (["tool_use","server_tool_use","mcp_tool_use","server_tool_result","mcp_tool_result"].includes(b.type)) {
      toolUsed = true;
      if (typeof b.name === "string") toolNames.add(b.name);
    }
  }
  return {
    text: sanitize(textParts.join("\n\n")) || "No response.",
    toolUsed,
    toolNames: [...toolNames],
    stopReason: data.stop_reason || "unknown",
  };
}

function looksLikeCusip(t) { return /^[0-9A-Z]{6,9}$/.test(t.trim().toUpperCase()); }
function isLikelyBareLookup(t) {
  const s = t.trim();
  if (!s) return false;
  if (looksLikeCusip(s)) return true;
  if (/^[A-Z0-9.\-]+\s+\d{4}(?:-[A-Z0-9.\-]+)*(?:\s+[A-Z0-9.\-]+)?$/i.test(s)) return true;
  if (/^[A-Z]{2,10}\s+\d{4}/i.test(s)) return true;
  return false;
}
function classifyIntent(input) {
  const t = input.trim(), l = t.toLowerCase();
  if (!t) return "CHAT";
  if (isLikelyBareLookup(t)) return "SEARCH";
  if (/^(search)(:|\s)/i.test(t) || /\b(search|look up|lookup|find|show me|check|pull|do we have|anything on|what do we have on|color on|what color on)\b/i.test(l) || /\?$/.test(t)) return "SEARCH";
  // COLOR_ENTRY: "color [bond] [notes]" OR explicit log/add/save color commands
  if (/^color\s+[A-Z0-9]/i.test(t) || /^(color:)/i.test(t) || /\b(add color|log color|enter color|save color|put this in color|record color)\b/i.test(l)) return "COLOR_ENTRY";
  if (/^(axes:|axe:|live axes:|live axe:)/i.test(t) || /\b(add axes|log axes|enter axes|save axes|log axe|put this in axes|live axe)\b/i.test(l)) return "AXES_ENTRY";
  return "CHAT";
}
function buildUserMessage(raw, intent) {
  const t = raw.trim();
  if (intent === "SEARCH") return `INTENT: SEARCH\nSearch all three Notion databases for: ${t.replace(/^(search)(:|\s)/i,"").trim() || t}\nSearch Live Axes, Color, and Trade History. CUSIP: exact then first-6. Bond/deal: exact then root match. Respond conversationally with trader-useful results.`;
  if (intent === "COLOR_ENTRY") return `INTENT: COLOR_ENTRY\nParse and add to Color Database:\n${t}\nIf this is actually a lookup, treat as SEARCH instead.`;
  if (intent === "AXES_ENTRY") return `INTENT: AXES_ENTRY\nParse and add to Live Axes Database:\n${t}`;
  return `INTENT: CHAT\nRespond conversationally. If user names a bond, deal, or CUSIP, search all three databases.\nUser: ${t}`;
}

const pillStyle = intent => {
  const m = {
    SEARCH:      { bg:C.amberDim, fg:C.amber,  bd:`${C.amber}55` },
    COLOR_ENTRY: { bg:C.greenDim, fg:C.green,  bd:`${C.green}55` },
    AXES_ENTRY:  { bg:"#16263a",  fg:C.accent, bd:`${C.accent}55` },
    CHAT:        { bg:"#262626",  fg:"#d1d5db",bd:"#525252" },
  };
  const { bg, fg, bd } = m[intent] || m.CHAT;
  return { display:"inline-block", fontSize:10, fontWeight:700, letterSpacing:"0.09em", background:bg, color:fg, border:`1px solid ${bd}`, borderRadius:4, padding:"2px 7px", marginBottom:8 };
};

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
      <div style={{ maxWidth:"84%", background:isUser ? C.accentDim : C.surface, border:`1px solid ${isUser ? "#245b92" : C.border}`, borderRadius:8, padding:"12px 14px", whiteSpace:"pre-wrap", wordBreak:"break-word", lineHeight:1.6, fontSize:12, color:C.text, fontFamily:"Inter, ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        {isUser && msg.meta?.intent && <div style={pillStyle(msg.meta.intent)}>{msg.meta.intent}</div>}
        {msg.content}
        {!isUser && msg.meta && (
          <div style={{ marginTop:10, paddingTop:8, borderTop:`1px dashed ${C.borderLight}`, display:"flex", flexDirection:"column", gap:4 }}>
            <div style={{ fontSize:10, color:C.muted }}>tool activity: {msg.meta.toolUsed ? "✓ detected" : "none detected"}</div>
            {msg.meta.toolNames?.length > 0 && <div style={{ fontSize:10, color:C.muted }}>tools used: {msg.meta.toolNames.join(", ")}</div>}
            {msg.meta.rawStopReason && <div style={{ fontSize:10, color:C.muted }}>stop: {msg.meta.rawStopReason}</div>}
            {msg.meta.warning && <div style={{ fontSize:10, color:C.amber }}>⚠ {msg.meta.warning}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([{
    role:"assistant",
    content:"TRADING DESK ASSISTANT ONLINE\n\nNatural language supported.\nExamples:\n  STWD 2021-LIH B\n  color on STWD 2021-LIH B?\n  anything on 85572RAC8\n  add color: STWD 2021-LIH B BLK 10mm 99-19+\n  MS selling 5mm BMARK 2020-B20 A +155\n\nSending only a CUSIP or bond name will search all 3 databases by default.",
    meta:{ toolUsed:false, toolNames:[], rawStopReason:"startup" },
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(true);
  const bottomRef = useRef(null);
  const taRef = useRef(null);
  const hints = useMemo(() => ["STWD 2021-LIH B","color on STWD 2021-LIH B?","add color: ","MS selling 5mm "], []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const intent = classifyIntent(trimmed);
    const userMsg = { role:"user", content:trimmed, meta:{ intent } };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);
    try {
      const apiMessages = history.map(m => ({
        role: m.role,
        content: m.role === "user"
          ? buildUserMessage(m.content, m.meta?.intent || "CHAT")
          : (typeof m.content === "string" ? m.content : ""),
      }));

      const body = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1600,
        system: SYSTEM,
        messages: apiMessages,
        mcp_servers: [{
          type: "url",
          url: NOTION_MCP_URL,
          name: "notion",
        }],
      };

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setConnected(false);
        setMessages(prev => [...prev, {
          role:"assistant",
          content:`Connection issue.\n\n${data?.error?.message || `HTTP ${res.status}`}\n\nCheck that your Notion MCP integration is authorized in Claude.ai Settings → Integrations.`,
          meta:{ toolUsed:false, toolNames:[], rawStopReason:data?.error?.type || "http_error" },
        }]);
        return;
      }

      const parsed = extractReply(data);
      const warning = !parsed.toolUsed
        ? "No Notion tool activity detected. Artifact API calls cannot inherit your Claude.ai Notion session — use this chat window (not the artifact) to run live database queries."
        : "";

      setMessages(prev => [...prev, {
        role:"assistant",
        content: parsed.text,
        meta:{ toolUsed:parsed.toolUsed, toolNames:parsed.toolNames, rawStopReason:parsed.stopReason, warning },
      }]);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setMessages(prev => [...prev, {
        role:"assistant",
        content:`Request failed.\n\n${e.message}\n\nIf this persists, verify your Notion connection is active under Settings → Integrations in Claude.ai.`,
        meta:{ toolUsed:false, toolNames:[], rawStopReason:"exception" },
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background:C.bg, minHeight:"100vh", display:"flex", flexDirection:"column", color:C.text, fontFamily:"Inter, ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      {/* Header */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:10, height:10, borderRadius:"999px", background:connected ? C.green : C.red, boxShadow:`0 0 12px ${connected ? C.green : C.red}66` }} />
          <div>
            <div style={{ fontSize:13, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>Trading Desk Assistant</div>
            <div style={{ fontSize:11, color:C.muted }}>Claude + Notion MCP</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          {["COLOR DB","AXES DB","HISTORY DB"].map(l => (
            <div key={l} style={{ fontSize:10, color:C.muted, background:C.tag, border:`1px solid ${C.border}`, padding:"4px 8px", borderRadius:4, letterSpacing:"0.05em" }}>{l}</div>
          ))}
          <div style={{ fontSize:10, color:connected ? C.green : C.red }}>{connected ? "connection ok" : "connection issue"}</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ flex:1, overflowY:"auto", padding:18, display:"flex", flexDirection:"column", gap:16 }}>
          {messages.map((m, i) => <Bubble key={i} msg={m} />)}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
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
            <button
              onClick={send}
              style={{ height:44, minWidth:90, borderRadius:8, border:"none", background:input.trim() && !loading ? C.accent : C.borderLight, color:input.trim() && !loading ? "#fff" : C.muted, fontSize:11, fontWeight:700, letterSpacing:"0.07em", cursor:input.trim() && !loading ? "pointer" : "default" }}>
              SEND
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
