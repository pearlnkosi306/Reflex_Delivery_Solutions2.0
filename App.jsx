import {
  useState, useEffect, useCallback, useRef, useMemo, createContext, useContext,
} from "react";
import {
  Package, Truck, CheckCircle2, MapPin, Phone, User, ScanLine, AlertTriangle,
  RefreshCw, Users, ChevronDown, ChevronUp, History, RotateCcw, Radio, X,
  Send, Check, AlertOctagon, Clock, Bike, Store, Headphones, Navigation,
  Sun, Eye, Volume2, VolumeX, Settings, Plus, Minus,
} from "lucide-react";

/* =========================================================================
   BRAND TOKENS
   ========================================================================= */
const C = {
  ink: "#16171D",
  muted: "#63677D",
  border: "#E7E8F0",
  neutralSoft: "#EEF0F4",
  surface: "#FAFAFB",
  white: "#FFFFFF",
};
const ROLE = {
  retailer: { id: "retailer", name: "Retailer", fill: "#7C3AED", text: "#6D28D9", soft: "#F1EBFE", pageBg: "#FBF9FE", Icon: Store },
  dispatcher: { id: "dispatcher", name: "Dispatcher", fill: "#F59E0B", text: "#92600A", soft: "#FEF3DD", pageBg: "#FFFCF6", Icon: Headphones },
  rider: { id: "rider", name: "Rider", fill: "#2563EB", text: "#2554C7", soft: "#E7EFFE", pageBg: "#F8FAFE", Icon: Bike },
};
const STATE = {
  success: { fill: "#16A34A", text: "#15803D", soft: "#E7F7EC" },
  danger: { fill: "#DC2626", text: "#B91C1C", soft: "#FDECEC" },
};

const RIDERS = [
  { id: "r1", name: "Brian Otieno", vehicle: "Boda" },
  { id: "r2", name: "Faith Wanjiru", vehicle: "Boda" },
  { id: "r3", name: "Kevin Mwangi", vehicle: "Van" },
  { id: "r4", name: "Grace Achieng", vehicle: "Boda" },
];

const OFFER_WINDOW_MS = 15000;

const STATUS_META = {
  requested: { label: "Finding Rider", color: C.muted, bg: C.neutralSoft, icon: RefreshCw },
  pending_acceptance: { label: "Awaiting Rider", color: ROLE.dispatcher.text, bg: ROLE.dispatcher.soft, icon: Radio },
  unassignable: { label: "Needs Dispatcher", color: STATE.danger.text, bg: STATE.danger.soft, icon: AlertTriangle },
  assigned: { label: "Assigned", color: ROLE.dispatcher.text, bg: ROLE.dispatcher.soft, icon: Users },
  picked_up: { label: "Picked Up", color: ROLE.rider.text, bg: ROLE.rider.soft, icon: Truck },
  delivered: { label: "Delivered", color: STATE.success.text, bg: STATE.success.soft, icon: CheckCircle2 },
  failed_attempt: { label: "Failed Attempt", color: STATE.danger.text, bg: STATE.danger.soft, icon: AlertTriangle },
  cancelled: { label: "Cancelled", color: C.muted, bg: C.neutralSoft, icon: X },
};
function flowIndex(status) {
  if (status === "delivered") return 3;
  if (status === "picked_up") return 2;
  if (status === "assigned") return 1;
  return 0;
}

const STORAGE_KEY = "reflex_deliveries_v3";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const tiny = { fontSize: 10 };
const small = { fontSize: 11 };

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function genCode() { let s = ""; for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
function genOrderId() { return `RFX-${Math.floor(1000 + Math.random() * 9000)}`; }
function nowIso() { return new Date().toISOString(); }
function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

/** Simulated distance, standing in for real GPS. Deterministic per
 * rider+address so the demo doesn't wobble between renders. */
function pseudoDistanceKm(riderId, address) {
  const s = riderId + "|" + (address || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return +(0.4 + (hash % 780) / 100).toFixed(1);
}

/** Crude "which neighborhood is this" extraction from free-text addresses —
 * takes the last comma-separated segment as a stand-in for a market/area. */
function normalizeArea(address) {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  return (parts[parts.length - 1] || address).toLowerCase();
}

/** A rider's track record — used both to bias the dispatch agent toward
 * riders who already know an area, and to show the dispatcher *why*. */
function computeRiderStats(riderId, allDeliveries) {
  const handled = allDeliveries.filter((d) => d.assignedRiderId === riderId);
  const delivered = handled.filter((d) => d.status === "delivered");
  const areas = new Set(delivered.map((d) => normalizeArea(d.address)));
  return { totalHandled: handled.length, totalDelivered: delivered.length, areas };
}

function busyRiderIds(allDeliveries, excludeDeliveryId) {
  const busy = new Set();
  for (const d of allDeliveries) {
    if (d.id === excludeDeliveryId) continue;
    if (d.status === "pending_acceptance" && d.candidateRiderId) busy.add(d.candidateRiderId);
    if ((d.status === "assigned" || d.status === "picked_up") && d.assignedRiderId) busy.add(d.assignedRiderId);
  }
  return busy;
}

/** Lower score wins. Distance is the base; a rider who has previously
 * delivered in this same area gets a strong discount (familiarity with the
 * environment — shortcuts, landmarks, difficult gates); a rider with fewer
 * total orders gets a small discount too, so work doesn't pile onto the
 * same one or two people. */
function scoreRider(rider, delivery, allDeliveries) {
  const stats = computeRiderStats(rider.id, allDeliveries);
  const distance = pseudoDistanceKm(rider.id, delivery.address);
  const familiar = stats.areas.has(normalizeArea(delivery.address));
  let score = distance;
  if (familiar) score -= 2.5;
  score -= Math.min(stats.totalHandled, 12) * 0.06;
  return { rider, distance, familiar, stats, score };
}

function pickBestFreeRider(delivery, allDeliveries) {
  const busy = busyRiderIds(allDeliveries, delivery.id);
  const tried = new Set(delivery.triedRiderIds || []);
  const free = RIDERS.filter((r) => !busy.has(r.id) && !tried.has(r.id));
  if (free.length === 0) return null;
  const scored = free.map((r) => scoreRider(r, delivery, allDeliveries));
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  const reason = best.familiar ? `knows this area, ${best.distance}km away` : `nearest free rider, ${best.distance}km away`;
  return { rider: best.rider, distanceKm: best.distance, reason };
}

/** The "dispatcher agent" — runs every poll tick and right after a new
 * request is created. */
function runDispatchAgent(list) {
  const now = Date.now();
  let changed = false;
  const next = list.map((d) => ({ ...d }));

  for (let i = 0; i < next.length; i++) {
    const d = next[i];

    if (d.status === "pending_acceptance" && d.offerExpiresAt && now > d.offerExpiresAt) {
      const triedRiderIds = [...(d.triedRiderIds || []), d.candidateRiderId];
      const pick = pickBestFreeRider({ ...d, triedRiderIds }, next);
      if (pick) {
        next[i] = { ...d, candidateRiderId: pick.rider.id, candidateRiderName: pick.rider.name, offerExpiresAt: now + OFFER_WINDOW_MS, triedRiderIds, updatedAt: nowIso(), events: [...d.events, { status: "pending_acceptance", at: nowIso(), note: `No response from ${d.candidateRiderName} — offered to ${pick.rider.name} (${pick.reason})` }] };
      } else {
        next[i] = { ...d, status: "unassignable", candidateRiderId: null, candidateRiderName: null, offerExpiresAt: null, triedRiderIds, updatedAt: nowIso(), events: [...d.events, { status: "unassignable", at: nowIso(), note: `No response from ${d.candidateRiderName} — no other free rider` }] };
      }
      changed = true;
      continue;
    }

    if (d.status === "requested" || d.status === "unassignable") {
      const triedRiderIds = d.status === "unassignable" ? [] : (d.triedRiderIds || []);
      const pick = pickBestFreeRider({ ...d, triedRiderIds }, next);
      if (pick) {
        next[i] = { ...d, status: "pending_acceptance", candidateRiderId: pick.rider.id, candidateRiderName: pick.rider.name, offerExpiresAt: now + OFFER_WINDOW_MS, triedRiderIds, updatedAt: nowIso(), events: [...d.events, { status: "pending_acceptance", at: nowIso(), note: `Offered to ${pick.rider.name} (${pick.reason})` }] };
        changed = true;
      }
    }
  }
  return { list: next, changed };
}

function seedDeliveries() {
  const t0 = Date.now();
  const mk = (mins) => new Date(t0 - mins * 60000).toISOString();
  const base = (over) => ({
    id: genId(), orderId: genOrderId(), assignedRiderId: null, assignedRiderName: null,
    candidateRiderId: null, candidateRiderName: null, offerExpiresAt: null, triedRiderIds: [],
    estimatedDistanceKm: null, confirmationCode: genCode(), deliveredAt: null, failedAttemptReason: null,
    smsLog: [], events: [], ...over,
  });
  return [
    base({ customerName: "Mercy Njoroge", customerPhone: "0712 345 678", address: "Kimathi Street, Nairobi CBD", itemDescription: "HP ink cartridge (black)", status: "requested", createdAt: mk(3), updatedAt: mk(3), events: [{ status: "requested", at: mk(3), note: "Request logged" }] }),
    base({ customerName: "Samuel Kiptoo", customerPhone: "0722 987 111", address: "Ngong Road, near Adams Arcade", itemDescription: "Paracetamol 500mg x3", status: "pending_acceptance", candidateRiderId: "r1", candidateRiderName: "Brian Otieno", offerExpiresAt: t0 + 12000, createdAt: mk(6), updatedAt: mk(1), events: [{ status: "requested", at: mk(6), note: "Request logged" }, { status: "pending_acceptance", at: mk(1), note: "Offered to Brian Otieno (nearest free rider, 2.3km away)" }] }),
    base({ customerName: "Wanjiku Kamau", customerPhone: "0733 222 456", address: "Ronald Ngala Street", itemDescription: "6mm drill bits set", status: "assigned", assignedRiderId: "r2", assignedRiderName: "Faith Wanjiru", estimatedDistanceKm: 1.8, createdAt: mk(24), updatedAt: mk(9), smsLog: [{ at: mk(9), text: "Good news — your order has been assigned to a rider and will be picked up shortly." }], events: [{ status: "requested", at: mk(24), note: "Request logged" }, { status: "pending_acceptance", at: mk(18), note: "Offered to Faith Wanjiru (nearest free rider, 1.8km away)" }, { status: "assigned", at: mk(9), note: "Faith Wanjiru accepted" }] }),
    base({ customerName: "David Mwangi", customerPhone: "0700 444 222", address: "Industrial Area, off Enterprise Road", itemDescription: "Office stationery box", status: "picked_up", assignedRiderId: "r3", assignedRiderName: "Kevin Mwangi", estimatedDistanceKm: 3.4, createdAt: mk(52), updatedAt: mk(5), smsLog: [{ at: mk(40), text: "Good news — your order has been assigned to a rider and will be picked up shortly." }, { at: mk(5), text: "Order picked up by rider Kevin Mwangi and in transit. Expected to arrive in about 11 minutes." }], events: [{ status: "requested", at: mk(52), note: "Request logged" }, { status: "pending_acceptance", at: mk(47), note: "Offered to Kevin Mwangi (nearest free rider, 3.4km away)" }, { status: "assigned", at: mk(40), note: "Kevin Mwangi accepted" }, { status: "picked_up", at: mk(5), note: "Order ID matched — item picked up" }] }),
  ];
}

// Claude's artifact runtime injects a `window.storage` API (shared,
// cross-device key-value storage) that doesn't exist in a normal browser.
// Running standalone, Reflex persists to localStorage instead. That means
// state lives in this one browser only — it won't sync across devices or
// even across browsers on the same device, unlike the Claude-hosted demo.
// See README.md "Known limitations" for how to restore real shared sync.
const LOCAL_STORAGE_KEY = "reflex:" + STORAGE_KEY;
async function fetchDeliveries() {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
async function persistDeliveries(list) {
  try { window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list)); return true; }
  catch (e) { console.error("Reflex storage error", e); return false; }
}

/* =========================================================================
   CONTEXTS
   ========================================================================= */
const A11yContext = createContext(null);
function useA11y() {
  return useContext(A11yContext) || { brightness: 1, fontScale: 1, dyslexia: false, highContrast: false, reduceMotion: false, autismFriendly: false, calmMotion: false };
}
function A11yProvider({ children }) {
  const [brightness, setBrightness] = useState(1);
  const [fontScale, setFontScale] = useState(1);
  const [dyslexia, setDyslexia] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [autismFriendly, setAutismFriendly] = useState(false);

  useEffect(() => {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) setReduceMotion(true);
    } catch (e) { /* matchMedia unavailable — ignore */ }
  }, []);

  const calmMotion = reduceMotion || autismFriendly;
  const value = { brightness, setBrightness, fontScale, setFontScale, dyslexia, setDyslexia, highContrast, setHighContrast, reduceMotion, setReduceMotion, autismFriendly, setAutismFriendly, calmMotion };
  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>;
}

const TickContext = createContext(Date.now());
function useTick() { return useContext(TickContext); }

/* =========================================================================
   SMALL UI ATOMS
   ========================================================================= */
function Logomark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
      <defs><clipPath id="reflex-logo-clip"><rect width="36" height="36" rx="9" /></clipPath></defs>
      <rect width="36" height="36" rx="9" fill={C.ink} />
      <g clipPath="url(#reflex-logo-clip)"><polygon points="-6,27 9,-6 18,-6 3,27" fill="#C6F135" /></g>
      <text x="19" y="25" textAnchor="middle" fontSize="17" fontWeight="800" fill={C.white} fontFamily="ui-sans-serif, system-ui">R</text>
    </svg>
  );
}

function Watermark({ tint, size = 240 }) {
  const { autismFriendly } = useA11y();
  if (autismFriendly) return null; // less visual clutter in calm mode
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 36 36" style={{ position: "absolute", right: -size * 0.22, top: -size * 0.28, opacity: 0.07 }}>
        <rect width="36" height="36" rx="9" fill={tint} />
        <text x="19" y="25" textAnchor="middle" fontSize="20" fontWeight="800" fill={tint}>R</text>
      </svg>
    </div>
  );
}

function StatusPill({ status, size = "md" }) {
  const { highContrast, calmMotion } = useA11y();
  const meta = STATUS_META[status] || STATUS_META.requested;
  const Icon = meta.icon;
  const spin = status === "requested" && !calmMotion;
  const style = highContrast
    ? { backgroundColor: meta.color, color: C.white, border: `1px solid ${meta.color}` }
    : { backgroundColor: meta.bg, color: meta.color };
  return (
    <span className="inline-flex items-center gap-1 rounded-full font-semibold px-2.5 py-1" style={{ ...style, fontSize: size === "sm" ? 10 : 11 }}>
      <Icon size={size === "sm" ? 11 : 12} className={spin ? "animate-spin" : ""} />
      {meta.label}
    </span>
  );
}

function ProgressDots({ status }) {
  const idx = flowIndex(status);
  const failed = status === "failed_attempt" || status === "cancelled";
  const colorFor = (i) => {
    if (i === 1) return ROLE.dispatcher.fill;
    if (i === 2) return ROLE.rider.fill;
    if (i === 3) return STATE.success.fill;
    return C.muted;
  };
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => {
        const reached = !failed && i <= idx;
        const isCurrent = !failed && i === idx;
        return <span key={i} className="rounded-full transition-all" style={{ width: isCurrent ? 16 : 7, height: 7, backgroundColor: reached ? colorFor(i) : C.neutralSoft }} />;
      })}
    </div>
  );
}

function CodeBadge({ code, tone = "ink" }) {
  const bg = tone === "amber" ? ROLE.dispatcher.fill : C.ink;
  return <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono font-bold tracking-wider" style={{ backgroundColor: bg, color: C.white, fontSize: 11 }}>{code}</span>;
}

function CodePattern({ code, size = 56, accent }) {
  const cells = 6;
  const cell = size / cells;
  const seed = code.split("").map((c) => c.charCodeAt(0));
  const isFinder = (r, c) => (r < 2 && c < 2) || (r < 2 && c > cells - 3) || (r > cells - 3 && c < 2);
  const squares = [];
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (isFinder(r, c)) continue;
      if ((seed[(r * cells + c) % seed.length] + r * 3 + c * 7) % 5 < 2) squares.push({ r, c });
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", flexShrink: 0 }}>
      <rect width={size} height={size} rx={7} fill={C.white} stroke={C.border} />
      {[[0, 0], [0, cells - 2], [cells - 2, 0]].map(([r, c], i) => (
        <g key={i}>
          <rect x={c * cell} y={r * cell} width={cell * 2} height={cell * 2} rx={2.5} fill="none" stroke={C.ink} strokeWidth={1.6} />
          <rect x={c * cell + cell * 0.55} y={r * cell + cell * 0.55} width={cell * 0.9} height={cell * 0.9} rx={1} fill={C.ink} />
        </g>
      ))}
      {squares.map(({ r, c }, i) => <rect key={i} x={c * cell + 1} y={r * cell + 1} width={cell - 2} height={cell - 2} rx={1} fill={accent || ROLE.rider.fill} />)}
    </svg>
  );
}

function Card({ children, className = "", style = {} }) {
  const { calmMotion } = useA11y();
  return (
    <div className={`rounded-2xl border ${calmMotion ? "" : "reflex-enter"} ${className}`} style={{ backgroundColor: C.white, borderColor: C.border, ...style }}>
      {children}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="rounded-2xl border border-dashed p-6 text-center text-xs" style={{ borderColor: C.border, color: C.muted }}>{text}</div>;
}

function Timeline({ events }) {
  return (
    <div className="mt-2 space-y-2 pl-1">
      {events.map((ev, i) => {
        const meta = STATUS_META[ev.status] || STATUS_META.requested;
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="flex flex-col items-center pt-0.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
              {i < events.length - 1 && <span className="w-px flex-1" style={{ backgroundColor: C.border, minHeight: 14 }} />}
            </div>
            <div className="flex-1 pb-1">
              <span className="font-semibold" style={{ color: C.ink, ...small }}>{meta.label}</span>
              <span style={{ color: C.muted, ...small }}> · {fmtTime(ev.at)}</span>
              {ev.note && <div style={{ color: C.muted, ...small }}>{ev.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SmsLog({ log }) {
  if (!log || log.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1 font-semibold" style={{ color: C.ink, ...small }}><Phone size={11} /> Customer updates (SMS)</div>
      <div className="space-y-1.5">
        {log.map((m, i) => (
          <div key={i} className="rounded-lg rounded-tl-sm px-2.5 py-1.5" style={{ backgroundColor: ROLE.rider.soft, color: C.ink }}>
            <div style={small}>{m.text}</div>
            <div style={{ color: C.muted, ...tiny }} className="mt-0.5">{fmtTime(m.at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const inputBase = { width: "100%", borderRadius: "0.65rem", border: `1px solid ${C.border}`, padding: "0.5rem 0.7rem", fontSize: "0.8rem", color: C.ink, outline: "none", backgroundColor: C.white };

function StyledInput({ as = "input", accent, style, ...props }) {
  const [focused, setFocused] = useState(false);
  const Tag = as;
  return (
    <Tag
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus && props.onFocus(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur && props.onBlur(e); }}
      style={{ ...inputBase, ...style, borderColor: focused ? accent : C.border, boxShadow: focused ? `0 0 0 3px ${accent}33` : "none", transition: "box-shadow 0.15s ease, border-color 0.15s ease" }}
    />
  );
}

function Toggle({ checked, onChange, accent, id }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition" style={{ backgroundColor: checked ? accent : C.border }}>
      <span className="inline-block h-4 w-4 transform rounded-full transition" style={{ backgroundColor: C.white, transform: checked ? "translateX(22px)" : "translateX(3px)" }} />
    </button>
  );
}

/* =========================================================================
   REUSABLE SCAN-OR-TYPE MODAL — pickup (against orderId) and delivery
   (against confirmationCode) share this exact interaction.
   ========================================================================= */
function CodeConfirmModal({ title, hint, targetCode, accentColor, successText, onClose, onConfirm }) {
  const { calmMotion } = useA11y();
  const [stage, setStage] = useState("scanning");
  const [entered, setEntered] = useState("");

  useEffect(() => { const t = setTimeout(() => setStage("manual"), calmMotion ? 200 : 1600); return () => clearTimeout(t); }, [calmMotion]);

  const submit = async () => {
    const clean = (s) => (s || "").trim().toUpperCase();
    if (clean(entered) !== clean(targetCode)) { setStage("error"); return; }
    setStage("success");
    await onConfirm();
    setTimeout(onClose, 1100);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(22,23,29,0.7)" }}>
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ backgroundColor: C.white }}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold" style={{ color: C.ink }}>{title}</h4>
          <button type="button" onClick={onClose} aria-label="Close"><X size={16} style={{ color: C.muted }} /></button>
        </div>

        {(stage === "scanning" || stage === "manual") && (
          <>
            <div className="relative mb-4 flex h-40 items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: C.ink }}>
              <div className="relative h-28 w-28 rounded-lg" style={{ border: `2px solid ${accentColor}` }}>
                <span className="absolute h-3 w-3" style={{ top: -1, left: -1, borderTop: `2px solid ${C.white}`, borderLeft: `2px solid ${C.white}` }} />
                <span className="absolute h-3 w-3" style={{ top: -1, right: -1, borderTop: `2px solid ${C.white}`, borderRight: `2px solid ${C.white}` }} />
                <span className="absolute h-3 w-3" style={{ bottom: -1, left: -1, borderBottom: `2px solid ${C.white}`, borderLeft: `2px solid ${C.white}` }} />
                <span className="absolute h-3 w-3" style={{ bottom: -1, right: -1, borderBottom: `2px solid ${C.white}`, borderRight: `2px solid ${C.white}` }} />
                {stage === "scanning" && !calmMotion && <div className="absolute left-0 right-0 h-0.5 animate-scanline" style={{ backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }} />}
              </div>
              <span className="absolute bottom-2" style={{ color: "#C9CFEA", ...tiny }}>{stage === "scanning" ? "Looking for a code…" : hint}</span>
            </div>
            <label className="mb-1 block font-semibold" style={{ color: C.muted, ...small }}>Or enter the ID manually</label>
            <div className="flex gap-2">
              <StyledInput accent={accentColor} autoFocus value={entered} onChange={(e) => setEntered(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder={targetCode.startsWith("RFX") ? "RFX-0000" : "AB12CD"} className="flex-1 font-mono uppercase tracking-widest" style={{ textAlign: "center" }} maxLength={8} />
              <button type="button" onClick={submit} className="rounded-xl px-4 text-sm font-bold text-white" style={{ backgroundColor: accentColor }} aria-label="Submit code"><Send size={14} /></button>
            </div>
          </>
        )}

        {stage === "error" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertOctagon size={34} style={{ color: STATE.danger.fill }} />
            <p className="text-sm font-semibold" style={{ color: STATE.danger.text }}>That ID doesn't match</p>
            <p style={{ color: C.muted, ...small }}>Double check it, then try again.</p>
            <button type="button" onClick={() => { setStage("manual"); setEntered(""); }} className="rounded-lg px-4 py-1.5 text-xs font-bold" style={{ backgroundColor: C.surface, color: C.ink }}>Try again</button>
          </div>
        )}

        {stage === "success" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 size={40} style={{ color: STATE.success.fill }} />
            <p className="text-sm font-bold" style={{ color: STATE.success.text }}>{successText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   CHARACTER
   ========================================================================= */
function PersonIllustration({ accent, variant, size = 76 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }} aria-hidden="true">
      <circle cx="50" cy="50" r="48" fill={C.white} opacity="0.55" />
      <path d="M 28 90 Q 28 60 50 60 Q 72 60 72 90 Z" fill={accent} />
      <circle cx="50" cy="41" r="17" fill={accent} />
      <circle cx="44" cy="39" r="2" fill={C.white} />
      <circle cx="56" cy="39" r="2" fill={C.white} />
      <path d="M 43 47 Q 50 52 57 47" stroke={C.white} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {variant === "retailer" && (
        <g>
          <rect x="35" y="68" width="30" height="21" rx="2.5" fill={C.white} stroke={accent} strokeWidth="2.5" />
          <line x1="50" y1="68" x2="50" y2="89" stroke={accent} strokeWidth="2.5" />
          <line x1="35" y1="77" x2="65" y2="77" stroke={accent} strokeWidth="2.5" />
        </g>
      )}
      {variant === "dispatcher" && (
        <g>
          <path d="M 30 39 A 20 20 0 0 1 70 39" stroke={accent} strokeWidth="4" fill="none" strokeLinecap="round" />
          <rect x="26" y="37" width="8" height="14" rx="3.5" fill={accent} />
          <rect x="66" y="37" width="8" height="14" rx="3.5" fill={accent} />
          <path d="M 30 51 Q 30 60 40 60" stroke={accent} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

function RadarPulse({ accent }) {
  const { calmMotion } = useA11y();
  if (calmMotion) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
      {[0, 0.7, 1.4].map((delay, i) => (
        <span key={i} className="absolute animate-radar rounded-full" style={{ width: 78, height: 78, border: `2px solid ${accent}`, animationDelay: `${delay}s` }} />
      ))}
    </div>
  );
}

function VehicleBanner({ vehicleType, accent }) {
  const { calmMotion } = useA11y();
  const VehicleIcon = vehicleType === "Van" ? Truck : Bike;
  return (
    <div className="relative h-20 overflow-hidden rounded-2xl" style={{ backgroundColor: accent }}>
      <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, ${C.white}20 1px, transparent 1px)`, backgroundSize: "16px 16px" }} aria-hidden="true" />
      <div className="absolute bottom-4 h-0.5 w-full" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${C.white}90 0 16px, transparent 16px 30px)` }} aria-hidden="true" />
      <div
        className={`absolute bottom-4 flex items-center justify-center rounded-full ${calmMotion ? "" : "animate-drive"}`}
        style={calmMotion ? { left: "50%", marginLeft: -22, height: 44, width: 44, backgroundColor: C.white } : { height: 44, width: 44, backgroundColor: C.white }}
      >
        <VehicleIcon size={22} style={{ color: accent }} />
      </div>
    </div>
  );
}

/* =========================================================================
   PER-ROLE HERO BANNERS
   ========================================================================= */
function RetailerHero({ count }) {
  const t = ROLE.retailer;
  return (
    <div className="relative overflow-hidden rounded-2xl p-4" style={{ backgroundColor: t.soft }}>
      <Watermark tint={t.fill} />
      <div className="relative flex items-center gap-4">
        <PersonIllustration accent={t.fill} variant="retailer" />
        <div>
          <div className="font-bold uppercase tracking-wide" style={{ color: t.text, ...small }}>Your storefront</div>
          <div className="text-lg font-black" style={{ color: C.ink }}>{count} request{count === 1 ? "" : "s"} logged</div>
          <div style={{ color: C.muted, ...small }}>Log one below — a rider gets offered the job automatically.</div>
        </div>
      </div>
    </div>
  );
}

function DispatcherHero({ openCount, activeRiders }) {
  const t = ROLE.dispatcher;
  return (
    <div className="relative overflow-hidden rounded-2xl p-4" style={{ backgroundColor: t.soft }}>
      <Watermark tint={t.fill} />
      <div className="relative flex items-center gap-4">
        <div style={{ position: "relative", height: 76, width: 76, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <RadarPulse accent={t.fill} />
          <PersonIllustration accent={t.fill} variant="dispatcher" />
        </div>
        <div>
          <div className="font-bold uppercase tracking-wide" style={{ color: t.text, ...small }}>Command center</div>
          <div className="text-lg font-black" style={{ color: C.ink }}>{openCount} not yet accepted</div>
          <div style={{ color: C.muted, ...small }}>{activeRiders} rider{activeRiders === 1 ? "" : "s"} busy · agent favors familiarity + fair load</div>
        </div>
      </div>
    </div>
  );
}

function RiderHero({ rider, activeCount, stats }) {
  const t = ROLE.rider;
  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ backgroundColor: t.soft }}>
      <Watermark tint={t.fill} size={320} />
      <div className="relative p-4">
        <VehicleBanner vehicleType={rider.vehicle} accent={t.fill} />
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="font-bold uppercase tracking-wide" style={{ color: t.text, ...small }}>On the road</div>
            <div className="text-lg font-black" style={{ color: C.ink }}>{rider.name}</div>
            <div style={{ color: C.muted, ...small }}>{rider.vehicle} · {activeCount} active job{activeCount === 1 ? "" : "s"}</div>
          </div>
          <div className="text-right" style={{ color: t.text, ...tiny }}>
            {stats.totalDelivered} delivered all-time{stats.areas.size > 0 ? ` · knows ${stats.areas.size} area${stats.areas.size === 1 ? "" : "s"}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   HEADER
   ========================================================================= */
function Header({ role, setRole, lastSync, onReset }) {
  const { calmMotion } = useA11y();
  const [confirmReset, setConfirmReset] = useState(false);
  const roles = [ROLE.retailer, ROLE.dispatcher, ROLE.rider];
  return (
    <div className="sticky top-0 z-30 border-b" style={{ borderColor: C.border, backgroundColor: C.white }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Logomark />
          <div>
            <div className="text-sm font-bold" style={{ color: C.ink }}>Reflex</div>
            <div style={{ color: C.muted, ...tiny }}>Delivery coordination</div>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-full p-1" style={{ backgroundColor: C.surface }}>
          {roles.map((r) => {
            const active = role === r.id;
            return (
              <button key={r.id} type="button" onClick={() => setRole(r.id)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition" style={active ? { backgroundColor: r.fill, color: C.white } : { color: C.muted }}>
                <r.Icon size={13} />{r.name}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5" style={{ color: C.muted, ...small }}>
            <Radio size={12} style={{ color: "#6B8500" }} className={calmMotion ? "" : "animate-pulse"} />
            {lastSync ? `Synced ${timeAgo(lastSync.toISOString())}` : "Syncing…"}
          </div>
          {!confirmReset ? (
            <button type="button" onClick={() => setConfirmReset(true)} className="rounded-lg border px-2.5 py-1.5 font-semibold transition hover:opacity-80" style={{ borderColor: C.border, color: C.muted, ...small }}>
              <RotateCcw size={12} className="mr-1 inline -mt-0.5" />Reset demo
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span style={{ color: STATE.danger.text, ...small }}>Clear all data?</span>
              <button type="button" onClick={() => { onReset(); setConfirmReset(false); }} className="rounded-lg px-2 py-1 font-semibold" style={{ backgroundColor: STATE.danger.fill, color: C.white, ...small }}>Yes</button>
              <button type="button" onClick={() => setConfirmReset(false)} className="rounded-lg border px-2 py-1 font-semibold" style={{ borderColor: C.border, color: C.muted, ...small }}>No</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   ACCESSIBILITY WIDGET
   ========================================================================= */
function AccessibilityWidget({ speechText }) {
  const a11y = useA11y();
  const [open, setOpen] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const supportsSpeech = typeof window !== "undefined" && "speechSynthesis" in window;

  const speak = () => {
    if (!supportsSpeech) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(speechText);
      u.rate = 0.95;
      u.onend = () => setIsSpeaking(false);
      u.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(u);
      setIsSpeaking(true);
    } catch (e) { setIsSpeaking(false); }
  };
  const stop = () => { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } setIsSpeaking(false); };

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Accessibility options" aria-expanded={open} className="fixed z-50 flex items-center justify-center rounded-full shadow-lg transition hover:opacity-90" style={{ bottom: 16, right: 16, height: 56, width: 56, backgroundColor: C.ink, color: C.white }}>
        <Settings size={24} />
      </button>

      {open && (
        <div role="dialog" aria-label="Accessibility options" className="fixed z-50 overflow-y-auto rounded-2xl border p-4 shadow-xl" style={{ bottom: 80, right: 16, width: 288, maxHeight: "76vh", backgroundColor: C.white, borderColor: C.border }}>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-bold" style={{ color: C.ink }}>Accessibility</h4>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close accessibility panel"><X size={16} style={{ color: C.muted }} /></button>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 font-semibold" style={{ color: C.ink, ...small }}><Sun size={13} /> Brightness</div>
              <input type="range" min="0.7" max="1.3" step="0.05" value={a11y.brightness} onChange={(e) => a11y.setBrightness(parseFloat(e.target.value))} className="w-full" aria-label="Adjust brightness" />
            </div>

            <div>
              <div className="mb-1.5 font-semibold" style={{ color: C.ink, ...small }}>Text size</div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => a11y.setFontScale(Math.max(0.85, +(a11y.fontScale - 0.1).toFixed(2)))} aria-label="Decrease text size" className="flex items-center justify-center rounded-lg border" style={{ height: 32, width: 32, borderColor: C.border }}><Minus size={14} /></button>
                <span className="flex-1 text-center font-bold" style={{ color: C.ink, fontSize: 15 }}>Aa</span>
                <button type="button" onClick={() => a11y.setFontScale(Math.min(1.4, +(a11y.fontScale + 0.1).toFixed(2)))} aria-label="Increase text size" className="flex items-center justify-center rounded-lg border" style={{ height: 32, width: 32, borderColor: C.border }}><Plus size={14} /></button>
              </div>
            </div>

            <label className="flex items-center justify-between" htmlFor="a11y-dyslexia">
              <span className="font-semibold" style={{ color: C.ink, ...small }}>Dyslexia-friendly text</span>
              <Toggle id="a11y-dyslexia" checked={a11y.dyslexia} onChange={a11y.setDyslexia} accent={ROLE.retailer.fill} />
            </label>

            <label className="flex items-center justify-between" htmlFor="a11y-contrast">
              <span className="flex items-center gap-1.5 font-semibold" style={{ color: C.ink, ...small }}><Eye size={13} /> High contrast</span>
              <Toggle id="a11y-contrast" checked={a11y.highContrast} onChange={a11y.setHighContrast} accent={ROLE.dispatcher.fill} />
            </label>

            <label className="flex items-center justify-between" htmlFor="a11y-autism">
              <span className="font-semibold" style={{ color: C.ink, ...small }}>Autism-friendly (calmer colors &amp; motion)</span>
              <Toggle id="a11y-autism" checked={a11y.autismFriendly} onChange={a11y.setAutismFriendly} accent={STATE.success.fill} />
            </label>

            <label className="flex items-center justify-between" htmlFor="a11y-motion">
              <span className="font-semibold" style={{ color: C.ink, ...small }}>Reduce motion</span>
              <Toggle id="a11y-motion" checked={a11y.reduceMotion} onChange={a11y.setReduceMotion} accent={ROLE.rider.fill} />
            </label>

            <div>
              <div className="mb-1.5 font-semibold" style={{ color: C.ink, ...small }}>Read this page aloud</div>
              {supportsSpeech ? (
                <button type="button" onClick={isSpeaking ? stop : speak} className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold" style={{ backgroundColor: isSpeaking ? STATE.danger.fill : C.ink, color: C.white }}>
                  {isSpeaking ? <><VolumeX size={14} /> Stop reading</> : <><Volume2 size={14} /> Read aloud</>}
                </button>
              ) : <p style={{ color: C.muted, ...tiny }}>Not supported in this browser.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* =========================================================================
   RETAILER VIEW
   ========================================================================= */
const SAVED_CUSTOMERS = [
  { customerName: "Mercy Njoroge", customerPhone: "0712 345 678", address: "Kimathi Street, Nairobi CBD" },
  { customerName: "Peter Omondi", customerPhone: "0701 556 234", address: "Moi Avenue, Nairobi CBD" },
];

function Field({ label, icon: Icon, children, full }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 flex items-center gap-1 font-semibold" style={{ color: C.muted, ...small }}><Icon size={11} /> {label}</span>
      {children}
    </label>
  );
}

function NewRequestForm({ onCreate }) {
  const [pathway, setPathway] = useState("manual");
  const [scanning, setScanning] = useState(false);
  const [filledFromScan, setFilledFromScan] = useState(false);
  const [form, setForm] = useState({ customerName: "", customerPhone: "", address: "", itemDescription: "" });
  const [toast, setToast] = useState(null);
  const accent = ROLE.retailer.fill;
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isValid = form.customerName && form.customerPhone && form.address && form.itemDescription;

  const runScan = () => {
    setScanning(true);
    setTimeout(() => {
      const c = SAVED_CUSTOMERS[Math.floor(Math.random() * SAVED_CUSTOMERS.length)];
      setForm((f) => ({ ...f, customerName: c.customerName, customerPhone: c.customerPhone, address: c.address }));
      setFilledFromScan(true);
      setScanning(false);
    }, 1400);
  };

  const submit = async () => {
    if (!isValid) return;
    const { orderId, code } = await onCreate(form);
    setForm({ customerName: "", customerPhone: "", address: "", itemDescription: "" });
    setFilledFromScan(false);
    setPathway("manual");
    setToast(`Order ${orderId} logged — code ${code} will be texted to the customer`);
    setTimeout(() => setToast(null), 3800);
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Package size={16} style={{ color: accent }} />
        <h3 className="text-sm font-bold" style={{ color: C.ink }}>New delivery request</h3>
      </div>

      <div className="mb-3 flex gap-1 rounded-full p-1" style={{ backgroundColor: C.surface }}>
        <button type="button" onClick={() => setPathway("manual")} className="flex-1 rounded-full py-1.5 text-xs font-semibold transition" style={pathway === "manual" ? { backgroundColor: accent, color: C.white } : { color: C.muted }}>Enter manually</button>
        <button type="button" onClick={() => { setPathway("scan"); setFilledFromScan(false); }} className="flex-1 rounded-full py-1.5 text-xs font-semibold transition" style={pathway === "scan" ? { backgroundColor: accent, color: C.white } : { color: C.muted }}><ScanLine size={12} className="mr-1 inline -mt-0.5" />Scan a saved QR</button>
      </div>

      {pathway === "scan" && !filledFromScan && (
        <div className="mb-3 rounded-xl p-4 text-center" style={{ backgroundColor: C.ink }}>
          {scanning ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <ScanLine size={26} className="animate-pulse" style={{ color: accent }} />
              <span style={{ color: "#C9CFEA", ...small }}>Reading QR…</span>
            </div>
          ) : (
            <button type="button" onClick={runScan} className="rounded-lg px-4 py-2 text-xs font-bold text-white" style={{ backgroundColor: accent }}><ScanLine size={13} className="mr-1 inline -mt-0.5" />Tap to scan</button>
          )}
          <div className="mt-2" style={{ color: "#9DA3C9", ...tiny }}>No QR on this order? Switch to "Enter manually" above.</div>
        </div>
      )}
      {filledFromScan && (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg px-3 py-2" style={{ backgroundColor: STATE.success.soft, color: STATE.success.text, ...small }}>
          <Check size={12} /> Filled from a saved customer QR — review before sending.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Customer name" icon={User}><StyledInput accent={accent} value={form.customerName} onChange={update("customerName")} placeholder="e.g. Mercy Njoroge" /></Field>
        <Field label="Customer phone" icon={Phone}><StyledInput accent={accent} value={form.customerPhone} onChange={update("customerPhone")} placeholder="07xx xxx xxx" /></Field>
        <Field label="Delivery address" icon={MapPin} full><StyledInput accent={accent} value={form.address} onChange={update("address")} placeholder="Street, area, landmark" /></Field>
        <Field label="Item description" icon={Package} full><StyledInput as="textarea" accent={accent} value={form.itemDescription} onChange={update("itemDescription")} placeholder="What's being delivered?" rows={2} style={{ resize: "none" }} /></Field>
        <div className="sm:col-span-2">
          <button type="button" onClick={submit} disabled={!isValid} className="w-full rounded-xl py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40" style={{ backgroundColor: accent }}>Log request</button>
        </div>
      </div>
      {toast && <div className="mt-3 rounded-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: STATE.success.soft, color: STATE.success.text }}><Check size={12} className="mr-1 inline -mt-0.5" />{toast}</div>}
    </Card>
  );
}

function RiderStatusStrip({ d }) {
  const now = useTick();
  if (d.status === "pending_acceptance") {
    const secondsLeft = Math.max(0, Math.round((d.offerExpiresAt - now) / 1000));
    return (
      <div className="mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ backgroundColor: ROLE.dispatcher.soft, color: ROLE.dispatcher.text, ...small }}>
        <Radio size={12} className="animate-pulse" /> Waiting for {d.candidateRiderName} to accept ({secondsLeft}s)
      </div>
    );
  }
  if (d.status === "unassignable") {
    return <div className="mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ backgroundColor: STATE.danger.soft, color: STATE.danger.text, ...small }}><AlertTriangle size={12} /> No rider available yet — our dispatcher will step in</div>;
  }
  if (["assigned", "picked_up"].includes(d.status) && d.assignedRiderName) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ backgroundColor: ROLE.rider.soft, color: ROLE.rider.text, ...small }}>
        <Bike size={12} /> <span className="font-semibold">{d.assignedRiderName}</span> is heading to your customer
      </div>
    );
  }
  return null;
}

function RequestCard({ d }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold" style={{ color: C.ink }}>{d.customerName}</span>
            <StatusPill status={d.status} size="sm" />
          </div>
          <div className="mt-0.5 flex items-center gap-1" style={{ color: C.muted, ...small }}><MapPin size={11} /> <span className="truncate">{d.address}</span></div>
          <div className="mt-0.5" style={{ color: C.muted, ...small }}>{d.itemDescription}</div>
          <RiderStatusStrip d={d} />
          <div className="mt-2"><ProgressDots status={d.status} /></div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <CodeBadge code={d.orderId} tone="amber" />
          <span style={{ color: C.muted, ...tiny }}>{timeAgo(d.updatedAt)}</span>
        </div>
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 flex items-center gap-1 font-semibold" style={{ color: ROLE.rider.text, ...small }}>
        <History size={11} /> {open ? "Hide" : "View"} timeline {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <>
          <div className="mt-2 flex items-center gap-2 rounded-lg p-2" style={{ backgroundColor: C.surface }}>
            <CodePattern code={d.confirmationCode} size={44} />
            <div>
              <div className="font-semibold" style={{ color: C.ink, ...small }}>Customer confirmation code</div>
              <div style={{ color: C.muted, ...tiny }}>Texted to the customer — the rider asks for this at drop-off.</div>
            </div>
          </div>
          <Timeline events={d.events} />
          <SmsLog log={d.smsLog} />
        </>
      )}
    </Card>
  );
}

function RetailerView({ deliveries, onCreate }) {
  const sorted = [...deliveries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-4">
      <RetailerHero count={deliveries.length} />
      <NewRequestForm onCreate={onCreate} />
      <div>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide" style={{ color: C.muted }}>Your requests ({sorted.length})</h3>
        <div className="space-y-2">
          {sorted.map((d) => <RequestCard key={d.id} d={d} />)}
          {sorted.length === 0 && <EmptyState text="No requests yet — log one above." />}
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   DISPATCHER VIEW
   ========================================================================= */
function RiderPicker({ deliveries, targetAddress, onPick, onClose }) {
  const busy = busyRiderIds(deliveries, null);
  const area = normalizeArea(targetAddress);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ backgroundColor: "rgba(22,23,29,0.55)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-t-2xl p-4 sm:rounded-2xl" style={{ backgroundColor: C.white }}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-sm font-bold" style={{ color: C.ink }}><Users size={14} /> Assign to a rider</h4>
          <button type="button" onClick={onClose} aria-label="Close"><X size={16} style={{ color: C.muted }} /></button>
        </div>
        <div className="space-y-2">
          {RIDERS.map((r) => {
            const isBusy = busy.has(r.id);
            const stats = computeRiderStats(r.id, deliveries);
            const knowsArea = area && stats.areas.has(area);
            return (
              <button key={r.id} type="button" disabled={isBusy} onClick={() => onPick(r)} className="flex w-full items-center justify-between rounded-xl border p-3 text-left transition hover:opacity-80 disabled:opacity-40" style={{ borderColor: knowsArea ? ROLE.dispatcher.fill : C.border }}>
                <div className="flex items-center gap-2">
                  <Bike size={16} style={{ color: ROLE.rider.fill }} />
                  <div>
                    <div className="text-sm font-semibold" style={{ color: C.ink }}>{r.name}</div>
                    <div style={{ color: C.muted, ...small }}>{r.vehicle} · {stats.totalDelivered} delivered{knowsArea ? " · knows this area" : ""}</div>
                  </div>
                </div>
                <span className="rounded-full px-2 py-0.5 font-bold" style={{ backgroundColor: isBusy ? ROLE.dispatcher.soft : STATE.success.soft, color: isBusy ? ROLE.dispatcher.text : STATE.success.text, ...small }}>{isBusy ? "busy" : "free"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DispatchCard({ d, onAssignClick, onReassignClick }) {
  const now = useTick();
  const secondsLeft = d.offerExpiresAt ? Math.max(0, Math.round((d.offerExpiresAt - now) / 1000)) : null;
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-sm font-bold" style={{ color: C.ink }}>{d.customerName}</span>
        <span className="flex shrink-0 items-center gap-0.5" style={{ color: C.muted, ...tiny }}><Clock size={10} />{timeAgo(d.createdAt)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1" style={{ color: C.muted, ...small }}><MapPin size={11} /> <span className="truncate">{d.address}</span></div>
      <div className="mt-0.5 truncate" style={{ color: C.muted, ...small }}>{d.itemDescription}</div>
      <div style={{ color: C.muted, ...tiny }} className="mt-0.5 font-mono">{d.orderId}</div>

      {d.status === "requested" && (
        <div className="mt-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1" style={{ color: C.muted, ...small }}><RefreshCw size={11} className="animate-spin" /> Finding a rider…</span>
          <button type="button" onClick={() => onAssignClick(d)} className="font-semibold underline" style={{ color: ROLE.dispatcher.text, ...tiny }}>Assign manually</button>
        </div>
      )}
      {d.status === "pending_acceptance" && (
        <div className="mt-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 font-semibold" style={{ color: ROLE.dispatcher.text, ...small }}><Radio size={11} className="animate-pulse" /> Offered to {d.candidateRiderName}</span>
            <span className="font-bold" style={{ color: ROLE.dispatcher.text, ...small }}>{secondsLeft}s</span>
          </div>
          <button type="button" onClick={() => onAssignClick(d)} className="mt-1 font-semibold underline" style={{ color: C.muted, ...tiny }}>Assign someone else now</button>
        </div>
      )}
      {d.status === "unassignable" && (
        <>
          <div className="mt-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: STATE.danger.soft, color: STATE.danger.text, ...small }}>No rider accepted — needs manual assignment</div>
          <button type="button" onClick={() => onReassignClick(d)} className="mt-2 w-full rounded-lg py-1.5 text-xs font-bold text-white" style={{ backgroundColor: STATE.danger.fill }}>Assign</button>
        </>
      )}
      {["assigned", "picked_up"].includes(d.status) && d.assignedRiderName && (
        <div className="mt-1.5 font-semibold" style={{ color: ROLE.dispatcher.text, ...small }}><Bike size={11} className="mr-1 inline -mt-0.5" /> {d.assignedRiderName}</div>
      )}
      {d.status === "failed_attempt" && (
        <>
          <div className="mt-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: STATE.danger.soft, color: STATE.danger.text, ...small }}>{d.failedAttemptReason}</div>
          <button type="button" onClick={() => onReassignClick(d)} className="mt-2 w-full rounded-lg py-1.5 text-xs font-bold text-white" style={{ backgroundColor: STATE.danger.fill }}>Re-assign</button>
        </>
      )}
    </Card>
  );
}

function KanbanColumn({ title, items, accentColor, onAssignClick, onReassignClick }) {
  return (
    <div className="flex flex-1 flex-col rounded-2xl p-2.5" style={{ backgroundColor: C.surface, minWidth: 235 }}>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: accentColor }}>{title}</span>
        <span className="rounded-full px-1.5 py-0.5 font-bold" style={{ backgroundColor: C.white, color: C.muted, ...tiny }}>{items.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((d) => <DispatchCard key={d.id} d={d} onAssignClick={onAssignClick || (() => {})} onReassignClick={onReassignClick || (() => {})} />)}
        {items.length === 0 && <div className="rounded-xl border border-dashed p-3 text-center" style={{ borderColor: C.border, color: C.muted, ...small }}>Empty</div>}
      </div>
    </div>
  );
}

function DispatcherView({ deliveries, onAssign, onReassign }) {
  const [picking, setPicking] = useState(null);
  const [conflict, setConflict] = useState(null);
  const by = (status) => deliveries.filter((d) => d.status === status);
  const needsAttention = deliveries.filter((d) => d.status === "failed_attempt" || d.status === "unassignable");
  const openCount = deliveries.filter((d) => ["requested", "pending_acceptance", "unassignable"].includes(d.status)).length;
  const activeRiders = busyRiderIds(deliveries, null).size;

  const handlePick = async (rider) => {
    const result = picking.mode === "reassign" ? await onReassign(picking.id, rider) : await onAssign(picking.id, rider);
    setPicking(null);
    if (result && !result.ok && result.reason === "conflict") {
      setConflict(`Already assigned to ${result.assignedTo} — board refreshed.`);
      setTimeout(() => setConflict(null), 3500);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4"><DispatcherHero openCount={openCount} activeRiders={activeRiders} /></div>
      {conflict && <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ backgroundColor: STATE.danger.soft, color: STATE.danger.text }}><AlertOctagon size={13} /> {conflict}</div>}
      {needsAttention.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wide" style={{ color: STATE.danger.text }}><AlertTriangle size={12} /> Needs attention ({needsAttention.length})</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {needsAttention.map((d) => <DispatchCard key={d.id} d={d} onAssignClick={() => {}} onReassignClick={(dd) => setPicking({ ...dd, mode: "reassign" })} />)}
          </div>
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        <KanbanColumn title="Finding a Rider" items={[...by("requested"), ...by("pending_acceptance")]} accentColor={ROLE.dispatcher.text} onAssignClick={(d) => setPicking({ ...d, mode: "assign" })} />
        <KanbanColumn title="Assigned" items={by("assigned")} accentColor={ROLE.dispatcher.text} />
        <KanbanColumn title="Picked Up" items={by("picked_up")} accentColor={ROLE.rider.text} />
        <KanbanColumn title="Delivered" items={by("delivered").slice(0, 8)} accentColor={STATE.success.text} />
      </div>
      {picking && <RiderPicker deliveries={deliveries} targetAddress={picking.address} onClose={() => setPicking(null)} onPick={handlePick} />}
    </div>
  );
}

/* =========================================================================
   RIDER VIEW
   ========================================================================= */
function IncomingOfferCard({ delivery, onAccept, onDecline }) {
  const now = useTick();
  const secondsLeft = Math.max(0, Math.round((delivery.offerExpiresAt - now) / 1000));
  const expired = secondsLeft <= 0;
  const pct = Math.max(0, Math.min(100, (secondsLeft / (OFFER_WINDOW_MS / 1000)) * 100));
  const dist = pseudoDistanceKm(delivery.candidateRiderId, delivery.address);

  return (
    <Card className="mb-3 overflow-hidden p-4" style={{ borderColor: ROLE.dispatcher.fill, borderWidth: 2 }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-bold uppercase tracking-wide" style={{ color: ROLE.dispatcher.text, ...small }}><Radio size={13} className="animate-pulse" /> Incoming order</span>
        <span className="font-bold" style={{ color: ROLE.dispatcher.text, ...small }}>{expired ? "Expiring…" : `${secondsLeft}s to respond`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: ROLE.dispatcher.soft }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: ROLE.dispatcher.fill }} />
      </div>
      <div className="mt-3">
        <div className="text-sm font-bold" style={{ color: C.ink }}>{delivery.customerName}</div>
        <div className="mt-0.5 flex items-center gap-1" style={{ color: C.muted, ...small }}><Navigation size={11} /> {delivery.address} · {dist} km away</div>
        <div className="mt-0.5" style={{ color: C.muted, ...small }}>{delivery.itemDescription}</div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={expired} onClick={onAccept} className="flex-1 rounded-lg py-2 text-xs font-bold text-white disabled:opacity-40" style={{ backgroundColor: STATE.success.fill }}><Check size={13} className="mr-1 inline -mt-0.5" />Accept</button>
        <button type="button" disabled={expired} onClick={onDecline} className="rounded-lg border px-4 text-xs font-semibold disabled:opacity-40" style={{ borderColor: C.border, color: C.muted }}>Decline</button>
      </div>
    </Card>
  );
}

function FailedAttemptForm({ onSubmit, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 rounded-xl border p-2.5" style={{ borderColor: STATE.danger.soft, backgroundColor: STATE.danger.soft }}>
      <StyledInput as="textarea" accent={STATE.danger.fill} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why couldn't this be completed? (required)" rows={2} style={{ resize: "none" }} />
      <div className="mt-1.5 flex gap-2">
        <button type="button" disabled={!reason.trim()} onClick={() => onSubmit(reason)} className="flex-1 rounded-lg py-1.5 text-xs font-bold text-white disabled:opacity-40" style={{ backgroundColor: STATE.danger.fill }}>Log failed attempt</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 text-xs font-semibold" style={{ color: C.muted }}>Cancel</button>
      </div>
    </div>
  );
}

function RiderJobCard({ d, onPickupClick, onDeliverClick, onFailedAttempt }) {
  const [showFail, setShowFail] = useState(false);
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-bold" style={{ color: C.ink }}>{d.customerName}</span>
        <StatusPill status={d.status} size="sm" />
      </div>
      <div className="mt-0.5 flex items-center gap-1" style={{ color: C.muted, ...small }}><Phone size={11} /> {d.customerPhone}</div>
      <div className="mt-0.5 flex items-center gap-1" style={{ color: C.muted, ...small }}><Navigation size={11} /> {d.address}</div>
      <div className="mt-0.5" style={{ color: C.muted, ...small }}>{d.itemDescription}</div>
      {d.status === "assigned" && <div className="mt-1 flex items-center gap-1" style={{ color: C.muted, ...tiny }}>Package ID <CodeBadge code={d.orderId} tone="amber" /></div>}

      {d.status === "assigned" && <button type="button" onClick={() => onPickupClick(d)} className="mt-2.5 w-full rounded-lg py-2 text-xs font-bold text-white" style={{ backgroundColor: ROLE.dispatcher.fill }}><ScanLine size={13} className="mr-1 inline -mt-0.5" />Scan to collect</button>}
      {d.status === "picked_up" && !showFail && (
        <div className="mt-2.5 flex gap-2">
          <button type="button" onClick={() => onDeliverClick(d)} className="flex-1 rounded-lg py-2 text-xs font-bold text-white" style={{ backgroundColor: ROLE.rider.fill }}><ScanLine size={13} className="mr-1 inline -mt-0.5" /> Deliver</button>
          <button type="button" onClick={() => setShowFail(true)} className="rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: C.border, color: STATE.danger.text }}>Can't complete?</button>
        </div>
      )}
      {showFail && <FailedAttemptForm onCancel={() => setShowFail(false)} onSubmit={(reason) => { onFailedAttempt(d.id, reason); setShowFail(false); }} />}
    </Card>
  );
}

function RiderView({ deliveries, riderId, setRiderId, onPickupClick, onDeliverClick, onFailedAttempt, onAcceptOffer, onDeclineOffer }) {
  const rider = RIDERS.find((r) => r.id === riderId) || RIDERS[0];
  const stats = computeRiderStats(riderId, deliveries);
  const mine = deliveries.filter((d) => d.assignedRiderId === riderId);
  const offers = deliveries.filter((d) => d.status === "pending_acceptance" && d.candidateRiderId === riderId);
  const active = mine.filter((d) => ["assigned", "picked_up"].includes(d.status)).sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
  const done = mine.filter((d) => ["delivered", "failed_attempt"].includes(d.status)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const [showDone, setShowDone] = useState(false);

  return (
    <div className="relative mx-auto max-w-xl p-4">
      <RiderHero rider={rider} activeCount={active.length} stats={stats} />

      <Card className="my-3 flex items-center justify-between p-3">
        <span className="font-semibold" style={{ color: C.muted, ...small }}>Acting as</span>
        <select value={riderId} onChange={(e) => setRiderId(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm font-bold" style={{ borderColor: C.border, color: C.ink }}>
          {RIDERS.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.vehicle}</option>)}
        </select>
      </Card>

      {offers.map((d) => (
        <IncomingOfferCard key={d.id} delivery={d} onAccept={() => onAcceptOffer(d.id)} onDecline={() => onDeclineOffer(d.id)} />
      ))}

      <h3 className="mb-2 flex items-center gap-1 px-1 text-xs font-bold uppercase tracking-wide" style={{ color: C.muted }}><Bike size={12} /> My jobs ({active.length})</h3>
      <div className="space-y-2">
        {active.map((d) => <RiderJobCard key={d.id} d={d} onPickupClick={onPickupClick} onDeliverClick={onDeliverClick} onFailedAttempt={onFailedAttempt} />)}
        {active.length === 0 && offers.length === 0 && <EmptyState text="No active jobs right now — new offers will appear here automatically." />}
      </div>

      {done.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowDone((s) => !s)} className="mb-2 flex items-center gap-1 px-1 text-xs font-bold" style={{ color: ROLE.rider.text }}>
            History ({done.length}) {showDone ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showDone && <div className="space-y-2">{done.map((d) => <RequestCard key={d.id} d={d} />)}</div>}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   SHELL
   ========================================================================= */
function ReflexShell() {
  const a11y = useA11y();
  const [role, setRole] = useState("retailer");
  const [riderId, setRiderId] = useState(RIDERS[0].id);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [pickupTarget, setPickupTarget] = useState(null);
  const [scanTarget, setScanTarget] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  const refresh = useCallback(async () => {
    let list = await fetchDeliveries();
    let isFreshSeed = false;
    if (!list) { list = seedDeliveries(); isFreshSeed = true; }
    const { list: processed, changed } = runDispatchAgent(list);
    if (changed || isFreshSeed) await persistDeliveries(processed);
    setDeliveries(processed);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2500);
    tickRef.current = setInterval(() => setNowTick(Date.now()), 1000);
    return () => { clearInterval(pollRef.current); clearInterval(tickRef.current); };
  }, [refresh]);

  const createRequest = useCallback(async (form) => {
    let latest = (await fetchDeliveries()) || deliveries;
    const code = genCode();
    const orderId = genOrderId();
    const record = {
      id: genId(), orderId, ...form, status: "requested",
      assignedRiderId: null, assignedRiderName: null,
      candidateRiderId: null, candidateRiderName: null, offerExpiresAt: null, triedRiderIds: [],
      estimatedDistanceKm: null, confirmationCode: code, createdAt: nowIso(), updatedAt: nowIso(), deliveredAt: null,
      failedAttemptReason: null, smsLog: [], events: [{ status: "requested", at: nowIso(), note: "Request logged" }],
    };
    latest = [record, ...latest];
    const { list: processed } = runDispatchAgent(latest);
    await persistDeliveries(processed);
    setDeliveries(processed);
    setLastSync(new Date());
    return { orderId, code };
  }, [deliveries]);

  const finalizeAssignment = useCallback(async (deliveryId, rider, guardStatuses) => {
    const latest = (await fetchDeliveries()) || deliveries;
    const idx = latest.findIndex((d) => d.id === deliveryId);
    if (idx === -1) return { ok: false, reason: "not-found" };
    const current = latest[idx];
    if (guardStatuses && !guardStatuses.includes(current.status)) {
      setDeliveries(latest);
      return { ok: false, reason: "conflict", assignedTo: current.assignedRiderName || current.candidateRiderName || "another rider" };
    }
    const distanceKm = pseudoDistanceKm(rider.id, current.address);
    latest[idx] = {
      ...current, status: "assigned", assignedRiderId: rider.id, assignedRiderName: rider.name,
      candidateRiderId: null, candidateRiderName: null, offerExpiresAt: null, estimatedDistanceKm: distanceKm,
      updatedAt: nowIso(),
      events: [...current.events, { status: "assigned", at: nowIso(), note: `Manually assigned to ${rider.name} by dispatcher` }],
      smsLog: [...(current.smsLog || []), { at: nowIso(), text: "Good news — your order has been assigned to a rider and will be picked up shortly." }],
    };
    await persistDeliveries(latest);
    setDeliveries([...latest]);
    setLastSync(new Date());
    return { ok: true };
  }, [deliveries]);

  const assignDelivery = useCallback((deliveryId, rider) => finalizeAssignment(deliveryId, rider, ["requested", "pending_acceptance"]), [finalizeAssignment]);
  const reassignDelivery = useCallback((deliveryId, rider) => finalizeAssignment(deliveryId, rider, null), [finalizeAssignment]);

  const acceptOffer = useCallback(async (deliveryId) => {
    const latest = (await fetchDeliveries()) || deliveries;
    const idx = latest.findIndex((d) => d.id === deliveryId);
    if (idx === -1) return;
    const current = latest[idx];
    if (current.status !== "pending_acceptance") { setDeliveries(latest); return; }
    const distanceKm = pseudoDistanceKm(current.candidateRiderId, current.address);
    latest[idx] = {
      ...current, status: "assigned", assignedRiderId: current.candidateRiderId, assignedRiderName: current.candidateRiderName,
      candidateRiderId: null, candidateRiderName: null, offerExpiresAt: null, estimatedDistanceKm: distanceKm,
      updatedAt: nowIso(),
      events: [...current.events, { status: "assigned", at: nowIso(), note: `${current.candidateRiderName} accepted` }],
      smsLog: [...(current.smsLog || []), { at: nowIso(), text: "Good news — your order has been assigned to a rider and will be picked up shortly." }],
    };
    await persistDeliveries(latest);
    setDeliveries([...latest]);
    setLastSync(new Date());
  }, [deliveries]);

  const declineOffer = useCallback(async (deliveryId) => {
    const latest = (await fetchDeliveries()) || deliveries;
    const idx = latest.findIndex((d) => d.id === deliveryId);
    if (idx === -1) return;
    const current = latest[idx];
    if (current.status !== "pending_acceptance") { setDeliveries(latest); return; }
    const triedRiderIds = [...(current.triedRiderIds || []), current.candidateRiderId];
    const who = current.candidateRiderName;
    const pick = pickBestFreeRider({ ...current, triedRiderIds }, latest);
    if (pick) {
      latest[idx] = { ...current, candidateRiderId: pick.rider.id, candidateRiderName: pick.rider.name, offerExpiresAt: Date.now() + OFFER_WINDOW_MS, triedRiderIds, updatedAt: nowIso(), events: [...current.events, { status: "pending_acceptance", at: nowIso(), note: `Declined by ${who} — offered to ${pick.rider.name} (${pick.reason})` }] };
    } else {
      latest[idx] = { ...current, status: "unassignable", candidateRiderId: null, candidateRiderName: null, offerExpiresAt: null, triedRiderIds, updatedAt: nowIso(), events: [...current.events, { status: "unassignable", at: nowIso(), note: `Declined by ${who} — no other free rider` }] };
    }
    await persistDeliveries(latest);
    setDeliveries([...latest]);
    setLastSync(new Date());
  }, [deliveries]);

  const confirmPickup = useCallback(async (deliveryId) => {
    const latest = (await fetchDeliveries()) || deliveries;
    const idx = latest.findIndex((d) => d.id === deliveryId);
    if (idx === -1) return { ok: false };
    const current = latest[idx];
    const dist = current.estimatedDistanceKm ?? pseudoDistanceKm(current.assignedRiderId, current.address);
    const etaMin = Math.max(10, Math.min(90, Math.round((dist / 18) * 60)));
    latest[idx] = {
      ...current, status: "picked_up", updatedAt: nowIso(),
      events: [...current.events, { status: "picked_up", at: nowIso(), note: "Order ID matched — item picked up" }],
      smsLog: [...(current.smsLog || []), { at: nowIso(), text: `Order picked up by rider ${current.assignedRiderName} and in transit. Expected to arrive in about ${etaMin} minutes.` }],
    };
    await persistDeliveries(latest);
    setDeliveries([...latest]);
    setLastSync(new Date());
    return { ok: true };
  }, [deliveries]);

  const confirmDelivery = useCallback(async (deliveryId) => {
    const latest = (await fetchDeliveries()) || deliveries;
    const idx = latest.findIndex((d) => d.id === deliveryId);
    if (idx === -1) return { ok: false };
    const current = latest[idx];
    latest[idx] = {
      ...current, status: "delivered", deliveredAt: nowIso(), updatedAt: nowIso(),
      events: [...current.events, { status: "delivered", at: nowIso(), note: "Confirmation code matched" }],
      smsLog: [...(current.smsLog || []), { at: nowIso(), text: "Your order has been delivered. Thank you for shopping with us!" }],
    };
    await persistDeliveries(latest);
    setDeliveries([...latest]);
    setLastSync(new Date());
    return { ok: true };
  }, [deliveries]);

  const logFailedAttempt = useCallback(async (deliveryId, reason) => {
    const latest = (await fetchDeliveries()) || deliveries;
    const idx = latest.findIndex((d) => d.id === deliveryId);
    if (idx === -1) return;
    const current = latest[idx];
    latest[idx] = {
      ...current, status: "failed_attempt", failedAttemptReason: reason, updatedAt: nowIso(),
      events: [...current.events, { status: "failed_attempt", at: nowIso(), note: reason }],
      smsLog: [...(current.smsLog || []), { at: nowIso(), text: "We attempted your delivery but couldn't complete it. We'll be in touch shortly to reschedule." }],
    };
    await persistDeliveries(latest);
    setDeliveries([...latest]);
    setLastSync(new Date());
  }, [deliveries]);

  const resetDemo = useCallback(async () => {
    const fresh = seedDeliveries();
    await persistDeliveries(fresh);
    setDeliveries(fresh);
    setLastSync(new Date());
  }, []);

  const speechText = useMemo(() => {
    if (role === "retailer") {
      const by = {};
      deliveries.forEach((d) => { by[d.status] = (by[d.status] || 0) + 1; });
      return `You have ${deliveries.length} delivery requests. ${(by.requested || 0) + (by.pending_acceptance || 0) + (by.unassignable || 0)} still finding a rider, ${by.assigned || 0} assigned, ${by.picked_up || 0} picked up, ${by.delivered || 0} delivered.`;
    }
    if (role === "dispatcher") {
      const finding = deliveries.filter((d) => ["requested", "pending_acceptance"].includes(d.status)).length;
      const active = deliveries.filter((d) => ["assigned", "picked_up"].includes(d.status)).length;
      const attention = deliveries.filter((d) => ["failed_attempt", "unassignable"].includes(d.status)).length;
      return `There are ${finding} requests still finding a rider, ${active} currently with a rider, and ${attention} needing your attention.`;
    }
    const rider = RIDERS.find((r) => r.id === riderId) || RIDERS[0];
    const offer = deliveries.find((d) => d.status === "pending_acceptance" && d.candidateRiderId === riderId);
    if (offer) return `You are acting as ${rider.name}. You have an incoming order from ${offer.customerName} at ${offer.address}. Accept or decline it at the top of your screen.`;
    const mine = deliveries.filter((d) => d.assignedRiderId === riderId && ["assigned", "picked_up"].includes(d.status));
    if (mine.length === 0) return `You are acting as ${rider.name}. You have no active jobs right now.`;
    const first = mine[0];
    return `You are acting as ${rider.name}. You have ${mine.length} active job${mine.length === 1 ? "" : "s"}. Next up: deliver to ${first.customerName} at ${first.address}, currently ${STATUS_META[first.status].label}.`;
  }, [role, deliveries, riderId]);

  const bodyFont = a11y.dyslexia ? 'Verdana, Tahoma, "Trebuchet MS", sans-serif' : "-apple-system, Inter, ui-sans-serif, system-ui";
  const activeTheme = ROLE[role];

  return (
    <TickContext.Provider value={nowTick}>
      <div
        className="min-h-full w-full"
        style={{
          zoom: String(a11y.fontScale),
          filter: `brightness(${a11y.brightness}) saturate(${a11y.autismFriendly ? 0.6 : 1})`,
          fontFamily: bodyFont,
          letterSpacing: a11y.dyslexia ? "0.04em" : "normal",
          lineHeight: a11y.dyslexia ? 1.7 : "normal",
          backgroundColor: C.surface,
          color: a11y.highContrast ? "#000000" : C.ink,
        }}
      >
        <style>{`
          @keyframes reflex-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          .reflex-enter { animation: reflex-fade-up 0.35s ease-out both; }
          @keyframes reflex-drive { 0% { left: -12%; } 100% { left: 112%; } }
          .animate-drive { position: absolute; animation: reflex-drive 5.5s linear infinite; }
          @keyframes reflex-radar { 0% { transform: scale(0.4); opacity: 0.65; } 100% { transform: scale(2.3); opacity: 0; } }
          .animate-radar { animation: reflex-radar 2.6s ease-out infinite; opacity: 0; }
          @keyframes reflex-scanline { 0% { top: 4%; } 50% { top: 88%; } 100% { top: 4%; } }
          .animate-scanline { animation: reflex-scanline 1.6s ease-in-out infinite; }
        `}</style>

        <Header role={role} setRole={setRole} lastSync={lastSync} onReset={resetDemo} />

        {loading ? (
          <div className="flex h-64 items-center justify-center"><RefreshCw size={20} className="animate-spin" style={{ color: activeTheme.fill }} /></div>
        ) : (
          <main style={{ backgroundColor: activeTheme.pageBg, transition: "background-color 0.3s ease", minHeight: "60vh" }}>
            {role === "retailer" && <RetailerView deliveries={deliveries} onCreate={createRequest} />}
            {role === "dispatcher" && <DispatcherView deliveries={deliveries} onAssign={assignDelivery} onReassign={reassignDelivery} />}
            {role === "rider" && (
              <RiderView
                deliveries={deliveries}
                riderId={riderId}
                setRiderId={setRiderId}
                onPickupClick={(d) => setPickupTarget(d)}
                onDeliverClick={(d) => setScanTarget(d)}
                onFailedAttempt={logFailedAttempt}
                onAcceptOffer={acceptOffer}
                onDeclineOffer={declineOffer}
              />
            )}
          </main>
        )}

        {pickupTarget && (
          <CodeConfirmModal
            title="Confirm pickup"
            hint="Scan the package's order ID"
            targetCode={pickupTarget.orderId}
            accentColor={ROLE.dispatcher.fill}
            successText="Picked up — confirmed"
            onClose={() => setPickupTarget(null)}
            onConfirm={() => confirmPickup(pickupTarget.id)}
          />
        )}
        {scanTarget && (
          <CodeConfirmModal
            title="Confirm delivery"
            hint="Ask the customer for their code"
            targetCode={scanTarget.confirmationCode}
            accentColor={ROLE.rider.fill}
            successText="Delivered — confirmed"
            onClose={() => setScanTarget(null)}
            onConfirm={() => confirmDelivery(scanTarget.id)}
          />
        )}

        <AccessibilityWidget speechText={speechText} />

        <div className="px-4 py-4 text-center" style={{ color: C.muted, ...tiny }}>
          Demo data lives in this browser's local storage — it stays on this device and won't sync to another browser or phone. See README.md for how to swap in a real backend (e.g. Supabase) for genuine multi-device sync.
        </div>
      </div>
    </TickContext.Provider>
  );
}

export default function ReflexApp() {
  return (
    <A11yProvider>
      <ReflexShell />
    </A11yProvider>
  );
}
