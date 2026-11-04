const API_URL = "https://xbqgnbdhgorrgvcbyzyo.supabase.co/rest/v1/rpc/";
const API_KEY = "sb_publishable_Xw1bAL6qlys6ObFjMVLW7Q_uAtto4jH";
const READ_SECONDS = 900;
const STOPS = [
  { p: 0, name: "Trailhead", x: 85, y: 465 }, { p: 25, name: "Forest Gate", x: 300, y: 430 },
  { p: 50, name: "River Bridge", x: 530, y: 470 }, { p: 75, name: "Echo Cave", x: 800, y: 395 },
  { p: 100, name: "Windy Ridge", x: 600, y: 300 }, { p: 125, name: "Cloud Camp", x: 365, y: 215 },
  { p: 150, name: "Summit", x: 610, y: 82 }
];
const BADGES = [[150, "Summit Reader"], [100, "Book Ranger"], [50, "Story Tracker"], [25, "Page Scout"], [0, "Trail Starter"]];
const COLORS = ["#d9480f", "#1971c2", "#7b2cbf", "#c2255c", "#0b7a75", "#8a5a00", "#3f51b5", "#2b8a3e"];
const PROOF_NAMES = { map: "Story Map", idea: "Main Idea and Details", draw: "Draw and Explain", write: "Write About It", achieve: "Achieve3000 Article", teacher: "Added by teacher" };
const FIELDS = {
  map: [["somebody", "Somebody", "Who is the story about?", "--blue"], ["wanted", "Wanted", "What did they want?", "--green"], ["but", "But", "What was the problem?", "--coral"], ["so", "So", "What did they do about it?", "--purple"], ["then", "Then", "How did it end?", "--gold"]],
  idea: [["main", "Main Idea", "What is this reading mostly about?", "--purple"], ["d1", "Detail 1", "A fact from the reading", "--blue"], ["d2", "Detail 2", "Another fact", "--green"], ["d3", "Detail 3", "One more fact", "--coral"]]
};
const MESSAGES = {
  network: "We can't reach Summit Readers right now. Check the internet and try again. If it keeps happening, tell your teacher.",
  bad_code: "We can't find that class code. Check it and try again.",
  locked: "Too many tries. Wait a little and try again.",
  bad_login: "That didn't match. Check it and try again.",
  short_password: "Your password needs at least 8 characters.",
  title: "Write the title of your reading.",
  incomplete: "Fill in every box first.",
  too_short: "Write a little more. You need at least 15 words.",
  score: "Write your quiz score as a number from 0 to 100.",
  score_low: "Achieve3000 counts at 75% or higher. Try another article, or choose a different activity.",
  drawing: "Your drawing didn't save. Try again.",
  too_soon: "Your 15 minutes aren't finished yet.",
  no_reading: "Start a new reading first.",
  not_found: "We can't find that work.",
  auth: "Please sign in again."
};
const RULES_HTML = `
  <ol class="steps">
    <li>Tap <b>Start reading</b> and read anything you like for 15 minutes.</li>
    <li>When the time is up, choose one activity: a graphic organizer, a drawing, your own writing, or Achieve3000.</li>
    <li>Your teacher checks your work. Then your points count and your team moves up the map.</li>
  </ol>
  <div class="table-box"><table>
    <tr><th>What you did</th><th class="n">Points</th></tr>
    <tr><td>Read for 15 minutes and finish one activity</td><td class="n">10</td></tr>
    <tr><td>Read together with a teammate</td><td class="n">+2</td></tr>
    <tr><td>Pass a Spot Check</td><td class="n">+3</td></tr>
  </table></div>
  <ul class="bullets">
    <li>Every activity earns the same points. Choose the one you like best.</li>
    <li>Your teacher may ask you about any reading, at any time. Keep your book close.</li>
    <li>If you can't answer yet, you don't lose points. Read it again and try again.</li>
    <li>Your team score is the average of its readers, so every reader helps.</li>
  </ul>`;

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const badgeFor = p => BADGES.find(b => p >= b[0])[1];
const teamLetter = name => name.replace(/^team\s+/i, "").charAt(0).toUpperCase() || "?";
const friendly = e => MESSAGES[e.message] || MESSAGES.network;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

async function rpc(name, args) {
  let res;
  try {
    res = await fetch(API_URL + name, { method: "POST", headers: { apikey: API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
  } catch (e) { throw new Error("network"); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { throw new Error("network"); }
  if (!res.ok) throw new Error(data && MESSAGES[data.message] ? data.message : "network");
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function pointOnPath(p) {
  const v = Math.max(0, Math.min(p, STOPS[STOPS.length - 1].p));
  for (let i = 1; i < STOPS.length; i++) {
    const a = STOPS[i - 1], b = STOPS[i];
    if (v <= b.p) { const t = (v - a.p) / (b.p - a.p); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
  }
  return STOPS[STOPS.length - 1];
}

function mapHtml(board, myTeam) {
  const top = Math.max(0, ...board.map(t => t.avg));
  const line = STOPS.map(s => `${s.x},${s.y}`).join(" ");
  const stops = STOPS.map((s, i) => `<circle cx="${s.x}" cy="${s.y}" r="27" fill="${top >= s.p ? "var(--sun)" : "var(--locked)"}" stroke="var(--ink)" stroke-width="5"/>
    <text x="${s.x}" y="${s.y + 7}" text-anchor="middle" fill="var(--ink)" font-size="20" font-weight="800">${s.p}</text>
    <text x="${s.x}" y="${i !== 6 ? s.y + 49 : s.y - 37}" text-anchor="middle" fill="var(--ink)" font-size="19" font-weight="800" stroke="var(--path)" stroke-width="5" paint-order="stroke">${s.name}</text>`).join("");
  const seen = {};
  const tokens = board.map((t, i) => {
    const pos = pointOnPath(t.avg), key = Math.round(pos.x) + "," + Math.round(pos.y);
    const n = seen[key] = (seen[key] || 0) + 1, ox = (n - 1) * 34 - 26, oy = -34, isMine = t.id === myTeam;
    return `<g><line x1="${pos.x}" y1="${pos.y}" x2="${pos.x + ox}" y2="${pos.y + oy}" stroke="var(--ink)" stroke-width="3"/>
      <circle cx="${pos.x + ox}" cy="${pos.y + oy}" r="${isMine ? 23 : 19}" fill="${COLORS[i % COLORS.length]}" stroke="${isMine ? "var(--sun)" : "var(--ink)"}" stroke-width="${isMine ? 6 : 4}"/>
      <text x="${pos.x + ox}" y="${pos.y + oy + 8}" text-anchor="middle" fill="#fff" font-size="22" font-weight="800">${esc(teamLetter(t.name))}</text>
      <title>${esc(t.name)}: ${t.avg} points</title></g>`;
  }).join("");
  const legend = board.map((t, i) => `<span class="${t.id === myTeam ? "mine" : ""}"><span class="token" style="background:${COLORS[i % COLORS.length]}">${esc(teamLetter(t.name))}</span>${esc(t.name)}: ${t.avg}</span>`).join("");
  return `<div class="map-box"><svg viewBox="0 0 1000 540" role="img" aria-label="Level map. ${esc(board.map(t => t.name + ": " + t.avg + " points").join(", "))}" font-family="Nunito, Segoe UI, sans-serif">
    <circle cx="880" cy="85" r="46" fill="var(--sun)"/>
    <g fill="#fff"><ellipse cx="150" cy="80" rx="70" ry="24"/><ellipse cx="205" cy="62" rx="48" ry="26"/><ellipse cx="800" cy="205" rx="62" ry="20"/></g>
    <polygon points="40,540 330,250 420,300 610,30 830,330 900,290 1000,420 1000,540" fill="var(--rock)"/>
    <polygon points="610,30 420,300 600,420 700,300" fill="var(--rock-dark)" opacity=".45"/>
    <polygon points="610,30 553,112 582,98 610,124 640,100 668,112" fill="var(--snow)"/>
    <path d="M0 410 C170 350 300 372 470 415 C640 455 830 345 1000 395 V540 H0 Z" fill="var(--grass)"/>
    <path d="M0 480 C200 445 370 505 590 482 C760 464 880 480 1000 455 V540 H0 Z" fill="var(--hill)"/>
    <polyline points="${line}" fill="none" stroke="var(--ink)" stroke-width="24" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${line}" fill="none" stroke="var(--path)" stroke-width="16" stroke-linejoin="round" stroke-linecap="round"/>
    ${stops}${tokens}</svg></div>${legend ? `<div class="legend">${legend}</div>` : ""}`;
}

// Shows a student's finished work, read-only.
function workHtml(w) {
  const line = (label, value) => `<div class="box" style="--c:var(--ink)"><span class="bt">${esc(label)}</span><div class="done-text">${esc(value)}</div></div>`;
  const parts = [];
  if (w.pages) parts.push(`<p class="meta">Pages: ${esc(w.pages)}</p>`);
  const c = w.content || {};
  if (FIELDS[w.proof]) parts.push(`<div class="boxes">${FIELDS[w.proof].map(f => `<div class="box" style="--c:var(${f[3]})"><span class="bt">${f[1]}</span><div class="done-text">${esc(c[f[0]])}</div></div>`).join("")}</div>`);
  if (w.proof === "draw") parts.push(`<img class="art" alt="${esc(c.caption)}" src="${esc(w.drawing)}">`, line("This picture shows...", c.caption));
  if (w.proof === "write") parts.push(line("My writing", c.text));
  if (w.proof === "achieve") parts.push(line("Quiz score", w.score + "%"), line("I learned...", c.learned));
  return parts.join("");
}
