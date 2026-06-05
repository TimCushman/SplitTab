// SplitTab — Shared dish support
// Each item divides equally among everyone who taps it.
// More people tap → everyone's share drops automatically.

import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://muatxclycldcailbunjw.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11YXR4Y2x5Y2xkY2FpbGJ1bmp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MjQ1NjAsImV4cCI6MjA5NjIwMDU2MH0.pN6bMBwUUcZmBiuQea9qXqnYsI64jkDfpvNbHSlVWnY";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

const DEMO_ITEMS = [
  { id: "1", name: "Spicy Tuna Roll",     price: 16.00 },
  { id: "2", name: "Chicken Katsu Curry", price: 22.00 },
  { id: "3", name: "Edamame",             price:  7.00 },
  { id: "4", name: "Miso Soup x2",        price:  8.00 },
  { id: "5", name: "Sapporo Lager x3",    price: 21.00 },
  { id: "6", name: "Gyoza (6pc)",         price: 12.00 },
  { id: "7", name: "Green Tea Ice Cream", price:  9.00 },
];

function calcMyShare(items, myId, claimerMap, taxRate, tipRate) {
  let sub = 0;
  const lines = [];
  items.forEach(item => {
    const claimers = claimerMap[item.id] || [];
    if (!claimers.includes(myId)) return;
    const split = item.price / claimers.length;
    sub += split;
    lines.push({ ...item, split, splitCount: claimers.length });
  });
  const tax = sub * taxRate;
  const tip = sub * tipRate;
  return { sub, tax, tip, total: sub + tax + tip, lines };
}

function buildClaimerMap(allSelections) {
  const map = {};
  allSelections.forEach(({ participant_id, item_id }) => {
    if (!map[item_id]) map[item_id] = [];
    if (!map[item_id].includes(participant_id)) map[item_id].push(participant_id);
  });
  return map;
}

function venmoLink(handle, amount, note) {
  const p = new URLSearchParams({
    txn: "pay", recipients: handle.replace("@", ""),
    amount: amount.toFixed(2), note: note || "Tab split",
  });
  return `venmo://paycharge?${p}`;
}

function getRoomIdFromUrl() {
  return new URLSearchParams(window.location.search).get("room");
}

export default function App() {
  const urlRoomId = getRoomIdFromUrl();

  const [screen, setScreen]             = useState(urlRoomId ? "join" : "home");
  const [room, setRoom]                 = useState(null);
  const [participants, setParticipants] = useState([]);
  const [allSelections, setAllSelections] = useState([]);
  const [myParticipant, setMyParticipant] = useState(null);
  const [mySelected, setMySelected]     = useState([]);
  const [activeSettle, setActiveSettle] = useState(null);
  const [copied, setCopied]             = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);

  const [dinnerName, setDinnerName] = useState("");
  const [myName,     setMyName]     = useState("");
  const [myVenmo,    setMyVenmo]    = useState("");
  const [dragging,     setDragging]     = useState(false);
  const [parsedItems,  setParsedItems]  = useState(null);
  const [parsedRates,  setParsedRates]  = useState(null);
  const [parsing,      setParsing]      = useState(false);
  const fileRef = useRef();

  const items   = room?.items    || DEMO_ITEMS;
  const taxRate = room?.tax_rate || 0.08875;
  const tipRate = room?.tip_rate || 0.20;

  const liveSelections = myParticipant
    ? [
        ...allSelections.filter(s => s.participant_id !== myParticipant.id),
        ...mySelected.map(item_id => ({ participant_id: myParticipant.id, item_id })),
      ]
    : allSelections;

  const claimerMap = buildClaimerMap(liveSelections);
  const myShare    = myParticipant
    ? calcMyShare(items, myParticipant.id, claimerMap, taxRate, tipRate)
    : { sub: 0, tax: 0, tip: 0, total: 0, lines: [] };

  const allDone = participants.length > 0 && participants.every(p => p.done);

  useEffect(() => { if (urlRoomId) loadRoom(urlRoomId); }, []);

  async function loadRoom(id) {
    setLoading(true);
    const { data, error } = await sb.from("rooms").select("*").eq("id", id).single();
    if (error || !data) { setError("Room not found."); setLoading(false); return; }
    setRoom(data);
    await refreshRoom(id);
    setLoading(false);
    setScreen("join");
  }

  async function refreshRoom(roomId) {
    const [{ data: parts }, { data: sels }] = await Promise.all([
      sb.from("participants").select("*").eq("room_id", roomId),
      sb.from("selections").select("participant_id, item_id").eq("room_id", roomId),
    ]);
    setParticipants(parts || []);
    setAllSelections(sels || []);
  }

  useEffect(() => {
    if (!room) return;
    const ch = sb.channel(`room-${room.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `room_id=eq.${room.id}` }, () => refreshRoom(room.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "selections",   filter: `room_id=eq.${room.id}` }, () => refreshRoom(room.id))
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [room]);

  async function createRoom() {
    if (!dinnerName || !myName || !myVenmo) return;
    setLoading(true);
    const { data, error } = await sb.from("rooms").insert({
      name: dinnerName, payer_name: myName,
      payer_venmo: myVenmo.replace("@", ""), items: parsedItems || DEMO_ITEMS,
      ...(parsedRates && { tax_rate: parsedRates.taxRate, tip_rate: parsedRates.tipRate }),
    }).select().single();
    if (error) { setError(error.message); setLoading(false); return; }
    setRoom(data);
    const me = await addParticipant(data.id, myName, myVenmo);
    setMyParticipant(me);
    setLoading(false);
    setScreen("select");
    window.history.pushState({}, "", `?room=${data.id}`);
  }

  async function joinRoom() {
    if (!myName || !room) return;
    setLoading(true);
    const me = await addParticipant(room.id, myName, myVenmo);
    setMyParticipant(me);
    setLoading(false);
    setScreen("select");
  }

  async function addParticipant(roomId, name, venmo) {
    const { data } = await sb.from("participants").insert({
      room_id: roomId, name, venmo: venmo?.replace("@", "") || null, done: false,
    }).select().single();
    return data;
  }

  function toggleItem(itemId) {
    setMySelected(prev =>
      prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]
    );
  }

  async function saveSelections() {
    if (!myParticipant) return;
    setLoading(true);
    await sb.from("selections").delete().eq("participant_id", myParticipant.id);
    if (mySelected.length > 0) {
      await sb.from("selections").insert(
        mySelected.map(item_id => ({ participant_id: myParticipant.id, room_id: room.id, item_id }))
      );
    }
    await sb.from("participants").update({ done: true }).eq("id", myParticipant.id);
    setLoading(false);
    setScreen("waiting");
  }

  async function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1200;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = url;
    });
  }

  async function handleReceiptFile(file) {
    if (!file) return;
    setParsing(true);
    try {
      const dataUrl = await compressImage(file);
      const base64 = dataUrl.split(",")[1];
      const res = await fetch("/api/parse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" }),
      });
      const data = await res.json();
      if (data.items) {
        setParsedItems(data.items);
        if (data.subtotal > 0) {
          setParsedRates({
            taxRate: data.tax / data.subtotal,
            tipRate: data.tip / data.subtotal,
          });
        }
      } else setError(data.error || "Could not parse receipt");
    } catch {
      setError("Receipt parsing failed");
    }
    setParsing(false);
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return (
    <div style={s.page}><div style={s.card}>
      <p style={{ textAlign:"center", color:"#4efe9a", fontSize:24 }}>⬡</p>
      <p style={{ textAlign:"center", color:"#666", fontSize:13 }}>Loading...</p>
    </div></div>
  );

  if (error) return (
    <div style={s.page}><div style={s.card}>
      <p style={{ color:"#ff6b6b" }}>{error}</p>
      <button style={s.ghostBtn} onClick={() => { setError(null); setScreen("home"); }}>Back</button>
    </div></div>
  );

  if (screen === "home") return (
    <div style={s.page}><div style={s.card}>
      <div style={s.logo}><span style={s.logoMark}>⬡</span><span style={s.logoText}>SplitTab</span></div>
      <p style={s.sub}>Drop a receipt. Tap what you had. Shared dishes split automatically.</p>
      <Divider>The dinner</Divider>
      <Field label="Dinner name" value={dinnerName} onChange={setDinnerName} placeholder="e.g. Sushi Friday" />
      <Divider>You (the one who paid)</Divider>
      <Field label="Your name"  value={myName}  onChange={setMyName}  placeholder="e.g. Tim" />
      <Field label="Your Venmo" value={myVenmo} onChange={setMyVenmo} placeholder="@your-handle" />
      <div style={{ ...s.dropzone, ...(dragging ? s.dropzoneActive : {}) }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleReceiptFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
          onChange={e => handleReceiptFile(e.target.files[0])} />
        {parsing
          ? <><div style={{ fontSize:20, marginBottom:6 }}>⏳</div><div style={{ fontSize:13, color:"#888" }}>Reading receipt...</div></>
          : parsedItems
          ? <><div style={{ fontSize:20, marginBottom:6 }}>✓</div><div style={{ fontSize:13, color:"#4efe9a" }}>{parsedItems.length} items parsed — edit below</div></>
          : <><div style={{ fontSize:28, marginBottom:6 }}>📸</div><div style={{ fontSize:14, fontWeight:600, color:"#ccc", marginBottom:3 }}>Drop receipt photo</div><div style={{ fontSize:12, color:"#555" }}>Or tap to upload — using demo items if skipped</div></>
        }
      </div>
      {parsedItems && (
        <div style={{ marginBottom:18 }}>
          <div style={s.divider}>Edit items</div>
          {parsedItems.map((item, i) => (
            <div key={item.id} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center" }}>
              <input style={{ ...s.input, flex:1 }} value={item.name}
                onChange={e => setParsedItems(prev => prev.map((it, idx) => idx===i ? {...it, name: e.target.value} : it))} />
              <input style={{ ...s.input, width:80 }} value={item.price} type="number" step="0.01"
                onChange={e => setParsedItems(prev => prev.map((it, idx) => idx===i ? {...it, price: parseFloat(e.target.value)||0} : it))} />
              <button style={{ ...s.ghostBtn, color:"#ff6b6b", fontSize:18, lineHeight:1 }}
                onClick={() => setParsedItems(prev => prev.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}
          <button style={{ ...s.ghostBtn, color:"#4efe9a", fontSize:13, marginTop:4 }}
            onClick={() => setParsedItems(prev => [...prev, { id: String(Date.now()), name: "", price: 0 }])}>
            + Add item
          </button>
        </div>
      )}
      <button style={{ ...s.primaryBtn, ...(!dinnerName||!myName||!myVenmo ? s.disabled : {}) }}
        disabled={!dinnerName||!myName||!myVenmo} onClick={createRoom}>
        Create room & get link
      </button>
    </div></div>
  );

  if (screen === "join") return (
    <div style={s.page}><div style={s.card}>
      <div style={s.logo}><span style={s.logoMark}>⬡</span><span style={s.logoText}>SplitTab</span></div>
      {room && <p style={{ fontSize:13, color:"#4efe9a", marginBottom:4 }}>📍 {room.name}</p>}
      <p style={s.sub}>You've been invited to split the tab.</p>
      <Field label="Your name"        value={myName}  onChange={setMyName}  placeholder="e.g. Jordan" />
      <Field label="Your Venmo (opt)" value={myVenmo} onChange={setMyVenmo} placeholder="@your-handle" />
      <button style={{ ...s.primaryBtn, ...(!myName ? s.disabled : {}) }}
        disabled={!myName} onClick={joinRoom}>
        Join & pick my items
      </button>
    </div></div>
  );

  if (screen === "select") return (
    <div style={s.page}><div style={s.card}>
      <div style={s.topRow}>
        <span style={s.logoText}>⬡ SplitTab</span>
        <button style={s.copyBtn} onClick={copyLink}>{copied ? "Copied!" : "Share link"}</button>
      </div>
      <h2 style={s.h2}>Tap what you had</h2>
      <p style={s.sub2}>Hey {myParticipant?.name} — tap every item you ordered or shared</p>
      <div style={s.itemList}>
        {items.map(item => {
          const claimers   = claimerMap[item.id] || [];
          const iClaimed   = mySelected.includes(item.id);
          const splitCount = claimers.length;
          const otherNames = claimers
            .filter(pid => pid !== myParticipant?.id)
            .map(pid => participants.find(p => p.id === pid)?.name)
            .filter(Boolean);
          const myChunk = iClaimed && splitCount > 0 ? item.price / splitCount : null;
          return (
            <div key={item.id} style={{ ...s.item, ...(iClaimed ? s.itemOn : {}) }} onClick={() => toggleItem(item.id)}>
              <span style={s.itemCheck}>{iClaimed ? "✓" : "○"}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={s.itemName}>{item.name}</div>
                {otherNames.length > 0 && (
                  <div style={s.itemSharedBy}>shared with {otherNames.join(", ")}</div>
                )}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={s.itemPrice}>${item.price.toFixed(2)}</div>
                {myChunk !== null && splitCount > 1 && (
                  <div style={s.itemMyChunk}>your share ${myChunk.toFixed(2)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {myShare.lines.length > 0 && (
        <div style={s.tally}>
          {myShare.lines.map(line => (
            <div key={line.id} style={s.tallyRow}>
              <span style={{ color:"#bbb" }}>
                {line.name}
                {line.splitCount > 1 && <span style={{ color:"#555", fontSize:11 }}> ÷{line.splitCount}</span>}
              </span>
              <span>${line.split.toFixed(2)}</span>
            </div>
          ))}
          <div style={s.tallyDivider} />
          <TallyRow label={`Tax (${(taxRate*100).toFixed(3)}%)`} val={myShare.tax} />
          <TallyRow label={`Tip (${(tipRate*100).toFixed(0)}%)`} val={myShare.tip} />
          <TallyRow label="Your total" val={myShare.total} bold />
        </div>
      )}
      <button style={{ ...s.primaryBtn, ...(mySelected.length === 0 ? s.disabled : {}) }}
        disabled={mySelected.length === 0} onClick={saveSelections}>
        Save & wait for everyone
      </button>
    </div></div>
  );

  if (screen === "waiting") return (
    <div style={s.page}><div style={s.card}>
      <div style={s.topRow}>
        <h2 style={{ ...s.h2, margin:0 }}>Waiting on the crew</h2>
        <button style={s.copyBtn} onClick={copyLink}>{copied ? "Copied!" : "Share link"}</button>
      </div>
      <div style={s.progressBar}>
        <div style={{ ...s.progressFill, width:`${participants.length ? (participants.filter(p=>p.done).length/participants.length)*100 : 0}%` }} />
      </div>
      <p style={{ fontSize:12, color:"#666", marginBottom:20 }}>
        {participants.filter(p=>p.done).length} of {participants.length} submitted
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:22 }}>
        {participants.map(p => (
          <div key={p.id} style={s.friendRow}>
            <span style={{ fontSize:14 }}>{p.name}{p.id===myParticipant?.id?" (you)":""}</span>
            <span style={p.done ? s.badgeDone : s.badgePending}>{p.done?"✓ done":"⏳ pending"}</span>
          </div>
        ))}
      </div>
      {allDone
        ? <button style={s.primaryBtn} onClick={() => setScreen("settle")}>Everyone's in — Settle up 🎉</button>
        : <p style={{ textAlign:"center", color:"#555", fontSize:12, marginTop:10 }}>Updates live as friends submit</p>
      }
    </div></div>
  );

  if (screen === "settle") {
    const finalMap = buildClaimerMap(allSelections);
    return (
      <div style={s.page}><div style={s.card}>
        <h2 style={s.h2}>Settle up 💸</h2>
        <p style={s.sub2}>Everyone pays {room?.payer_name} back via Venmo</p>
        {participants.map((p, i) => {
          const share = calcMyShare(items, p.id, finalMap, taxRate, tipRate);
          const open  = activeSettle === i;
          const isMe  = p.id === myParticipant?.id;
          return (
            <div key={p.id} style={s.settleCard}>
              <div style={s.settleHeader} onClick={() => setActiveSettle(open ? null : i)}>
                <span style={{ flex:1, fontSize:14, fontWeight:600 }}>{p.name}{isMe?" (you)":""}</span>
                <span style={{ fontSize:15, fontWeight:700, color:"#4efe9a" }}>${share.total.toFixed(2)}</span>
                <span style={{ fontSize:11, color:"#555", marginLeft:8 }}>{open?"▲":"▼"}</span>
              </div>
              {open && (
                <div style={s.settleBody}>
                  {share.lines.map(line => (
                    <div key={line.id} style={s.settleItem}>
                      <span>{line.name}{line.splitCount > 1 && <span style={{ color:"#555", fontSize:11 }}> (split {line.splitCount} ways)</span>}</span>
                      <span>${line.split.toFixed(2)}</span>
                    </div>
                  ))}
                  <div style={s.tallyDivider} />
                  <TallyRow label="Tax" val={share.tax} />
                  <TallyRow label="Tip" val={share.tip} />
                  {!isMe && room?.payer_venmo && (
                    <a href={venmoLink(room.payer_venmo, share.total, `${room.name} tab`)} style={s.venmoBtn}>
                      <span>Pay ${share.total.toFixed(2)} on Venmo</span>
                      <span style={s.venmoV}>V</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div></div>
    );
  }
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div style={s.field}>
      <label style={s.label}>{label}</label>
      <input style={s.input} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function Divider({ children }) {
  return <div style={s.divider}>{children}</div>;
}

function TallyRow({ label, val, bold }) {
  return (
    <div style={{ ...s.tallyRow, ...(bold ? s.tallyTotal : {}) }}>
      <span>{label}</span><span>${val.toFixed(2)}</span>
    </div>
  );
}

const s = {
  page:         { minHeight:"100vh", background:"linear-gradient(135deg,#080810 0%,#10101c 60%,#0c180f 100%)", display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"24px 16px 60px", fontFamily:"'DM Sans','Segoe UI',sans-serif" },
  card:         { width:"100%", maxWidth:460, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:20, padding:"28px 24px", color:"#f0f0f0" },
  logo:         { display:"flex", alignItems:"center", gap:10, marginBottom:6 },
  logoMark:     { fontSize:28, color:"#4efe9a" },
  logoText:     { fontSize:22, fontWeight:800, letterSpacing:"-0.5px", color:"#fff" },
  sub:          { color:"#888", fontSize:14, marginBottom:20, marginTop:4 },
  sub2:         { color:"#888", fontSize:13, marginBottom:18 },
  h2:           { fontSize:22, fontWeight:700, marginBottom:4, marginTop:0 },
  topRow:       { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 },
  divider:      { fontSize:11, color:"#555", letterSpacing:"0.1em", textTransform:"uppercase", margin:"18px 0 12px", borderBottom:"1px solid rgba(255,255,255,0.07)", paddingBottom:6 },
  field:        { marginBottom:14 },
  label:        { display:"block", fontSize:11, color:"#666", marginBottom:5, letterSpacing:"0.06em", textTransform:"uppercase" },
  input:        { width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.11)", borderRadius:10, padding:"11px 14px", color:"#fff", fontSize:15, outline:"none" },
  dropzone:     { border:"2px dashed rgba(255,255,255,0.12)", borderRadius:14, padding:"24px 20px", textAlign:"center", cursor:"pointer", marginBottom:18, marginTop:10 },
  dropzoneActive:{ borderColor:"#4efe9a", background:"rgba(78,254,154,0.05)" },
  primaryBtn:   { width:"100%", padding:"14px", background:"#4efe9a", color:"#080810", border:"none", borderRadius:12, fontSize:15, fontWeight:700, cursor:"pointer", marginTop:6 },
  disabled:     { opacity:0.3, cursor:"not-allowed" },
  ghostBtn:     { background:"none", border:"none", color:"#888", cursor:"pointer", fontSize:13, padding:0 },
  copyBtn:      { background:"rgba(78,254,154,0.12)", border:"1px solid rgba(78,254,154,0.25)", color:"#4efe9a", borderRadius:8, padding:"6px 12px", fontSize:12, fontWeight:600, cursor:"pointer" },
  itemList:     { display:"flex", flexDirection:"column", gap:8, marginBottom:18 },
  item:         { display:"flex", alignItems:"flex-start", gap:12, padding:"12px 14px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, cursor:"pointer" },
  itemOn:       { background:"rgba(78,254,154,0.09)", border:"1px solid rgba(78,254,154,0.3)" },
  itemCheck:    { fontSize:15, width:18, textAlign:"center", color:"#4efe9a", paddingTop:1 },
  itemName:     { fontSize:14, lineHeight:1.3 },
  itemSharedBy: { fontSize:11, color:"#4efe9a", marginTop:2, opacity:0.75 },
  itemPrice:    { fontSize:14, color:"#aaa" },
  itemMyChunk:  { fontSize:11, color:"#4efe9a", marginTop:1 },
  tally:        { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"14px 16px", marginBottom:18, display:"flex", flexDirection:"column", gap:6 },
  tallyRow:     { display:"flex", justifyContent:"space-between", fontSize:13, color:"#999" },
  tallyTotal:   { fontSize:15, color:"#fff", fontWeight:700, paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.1)", marginTop:4 },
  tallyDivider: { height:1, background:"rgba(255,255,255,0.08)", margin:"6px 0" },
  progressBar:  { height:5, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden", marginBottom:8, marginTop:4 },
  progressFill: { height:"100%", background:"#4efe9a", borderRadius:999, transition:"width 0.5s ease" },
  friendRow:    { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:"rgba(255,255,255,0.04)", borderRadius:10 },
  badgeDone:    { fontSize:11, background:"rgba(78,254,154,0.14)", color:"#4efe9a", padding:"3px 10px", borderRadius:999, fontWeight:600 },
  badgePending: { fontSize:11, background:"rgba(255,255,255,0.06)", color:"#666", padding:"3px 10px", borderRadius:999 },
  settleCard:   { border:"1px solid rgba(255,255,255,0.09)", borderRadius:14, marginBottom:10, overflow:"hidden" },
  settleHeader: { display:"flex", alignItems:"center", gap:10, padding:"14px 16px", cursor:"pointer", background:"rgba(255,255,255,0.04)" },
  settleBody:   { padding:"14px 16px", borderTop:"1px solid rgba(255,255,255,0.07)" },
  settleItem:   { display:"flex", justifyContent:"space-between", fontSize:13, color:"#999", marginBottom:5 },
  venmoBtn:     { display:"flex", justifyContent:"space-between", alignItems:"center", background:"#3d95ce", color:"#fff", textDecoration:"none", borderRadius:10, padding:"12px 16px", fontSize:14, fontWeight:700, marginTop:12 },
  venmoV:       { background:"#fff", color:"#3d95ce", width:22, height:22, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:900 },
};
