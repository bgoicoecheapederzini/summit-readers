const API_URL = "https://xbqgnbdhgorrgvcbyzyo.supabase.co/rest/v1/rpc/";
const API_KEY = "sb_publishable_Xw1bAL6qlys6ObFjMVLW7Q_uAtto4jH";
const READ_SECONDS = 900;
const STOPS = [
  { p: 0, name: "Trailhead", x: 90, y: 470 }, { p: 25, name: "Pine Forest", x: 300, y: 425 },
  { p: 50, name: "River Bridge", x: 535, y: 468 }, { p: 75, name: "Echo Cave", x: 800, y: 400 },
  { p: 100, name: "Windy Ridge", x: 610, y: 305 }, { p: 125, name: "Cloud Camp", x: 370, y: 225 },
  { p: 150, name: "Summit", x: 610, y: 88 }
];
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const ICONS = {
  map: '<path d="M3 20 9.5 8l4 6 2.5-3.5L21 20Z"/><circle cx="17" cy="6" r="2"/>',
  add: '<path d="M4 5.5C7 4 10 4.5 12 6c2-1.5 5-2 8-.5V19c-3-1.5-6-1-8 .5-2-1.5-5-2-8-.5Z"/><path d="M12 6v13.5"/>',
  points: '<path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.7l6.2-.9Z"/>',
  rules: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  class: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .8 3.2 2.8 3.5 5.6"/>',
  review: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  spot: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.8-4.8"/>',
  bme: '<circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 12h2M14.5 12h2"/>',
  facts: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  words: '<path d="M3 18 7.5 6 12 18M4.7 14h5.6"/><circle cx="17.5" cy="15" r="3.5"/><path d="M21 11.5V18"/>',
  draw: '<path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19Z"/><path d="m14.5 6.5 3 3"/>',
  write: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  achieve: '<path d="M8 4h8v6a4 4 0 0 1-8 0Z"/><path d="M8 6H4c0 3 1.5 5 4 5M16 6h4c0 3-1.5 5-4 5M12 14v4M8 21h8M9.5 18h5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
};
const icon = name => SVG_OPEN + ICONS[name] + "</svg>";
const ACTIVITIES = {
  bme: { name: "Beginning, Middle, End", blurb: "Tell what happened.", color: "#2f8bf0", fields: [["beginning", "Beginning", "What happened first?"], ["middle", "Middle", "What happened next?"], ["end", "End", "How did it end?"]] },
  facts: { name: "3 Cool Facts", blurb: "Share what you learned.", color: "#12a594", fields: [["f1", "Fact 1", "Something you learned"], ["f2", "Fact 2", "Another fact"], ["f3", "Fact 3", "One more fact"]] },
  words: { name: "New Words", blurb: "Find two new words.", color: "#8b4ae8", fields: [["w1", "New word 1", "Copy it from your reading"], ["m1", "It means...", "Use your own words"], ["w2", "New word 2", "Copy it from your reading"], ["m2", "It means...", "Use your own words"]] },
  draw: { name: "Draw It", blurb: "Draw your favorite part.", color: "#ef4d8c", fields: [["caption", "This picture shows...", "Write one sentence."]] },
  write: { name: "Write It", blurb: "Write three sentences.", color: "#e8710a", fields: [["text", "My writing", "This reading is about... The best part was... because... I wonder..."]] },
  achieve: { name: "Achieve3000", blurb: "Share your quiz score.", color: "#1f9d55", fields: [["learned", "I learned...", "Write one new thing you learned."]] }
};
const proofName = p => p === "teacher" ? "Added by your teacher" : (ACTIVITIES[p] || {}).name || "";
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
  <div class="card"><h2>How to play</h2>
    <ol class="steps">
      <li>Open <b>Add Reading</b> and start the timer.</li>
      <li>Read anything you like for 15 minutes.</li>
      <li>Choose one activity from the choice board and send it.</li>
      <li>When your teacher approves it, you earn points and move up the map.</li>
    </ol></div>
  <div class="two">
    <div class="card"><h2>Points</h2>
      <div class="table-box"><table>
        <tr><th>What you did</th><th class="n">Points</th></tr>
        <tr><td>Read for 15 minutes and finish one activity</td><td class="n">10</td></tr>
        <tr><td>Pass a Spot Check</td><td class="n">+3</td></tr>
      </table></div>
      <p class="meta">Every activity earns the same points. Choose the one you like best.</p></div>
    <div class="card"><h2>Fair play</h2>
      <ul class="bullets">
        <li>Your teacher may ask you about any reading, at any time. Keep your book close.</li>
        <li>If you can't answer yet, you don't lose points. Read it again and try again.</li>
        <li>Choose a book that feels just right for you.</li>
      </ul></div>
  </div>`;

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const friendly = e => MESSAGES[e.message] || MESSAGES.network;
const stopIndex = p => { let i = 0; STOPS.forEach((s, n) => { if (p >= s.p) i = n; }); return i; };
const levelName = p => STOPS[stopIndex(p)].name;
const FACE_COLORS = ["#5b3fe0", "#ef4d8c", "#2f8bf0", "#12a594", "#e8710a", "#8b4ae8", "#1f9d55", "#c2255c"];
const faceColor = name => FACE_COLORS[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % FACE_COLORS.length];
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

/* Smooth trail through the stops: one cubic curve per step, so points map directly onto the path. */
function segment(i) {
  const P = k => STOPS[Math.max(0, Math.min(STOPS.length - 1, k))], a = P(i), b = P(i + 1), pre = P(i - 1), post = P(i + 2);
  return [a, { x: a.x + (b.x - pre.x) / 6, y: a.y + (b.y - pre.y) / 6 }, { x: b.x - (post.x - a.x) / 6, y: b.y - (post.y - a.y) / 6 }, b];
}
function pointOnPath(p) {
  const v = Math.max(0, Math.min(p, STOPS[STOPS.length - 1].p));
  let i = 0; while (i < STOPS.length - 2 && v > STOPS[i + 1].p) i++;
  const t = (v - STOPS[i].p) / (STOPS[i + 1].p - STOPS[i].p), [a, b, c, d] = segment(i), u = 1 - t;
  const mix = k => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k];
  return { x: mix("x"), y: mix("y") };
}
const trailPath = () => "M" + STOPS[0].x + " " + STOPS[0].y + STOPS.slice(0, -1).map((_, i) => { const [, b, c, d] = segment(i); return ` C${b.x} ${b.y} ${c.x} ${c.y} ${d.x} ${d.y}`; }).join("");

function scenery() {
  const pines = [[40, 395, 1], [80, 372, .8], [130, 398, 1.1], [190, 372, .85], [235, 392, 1.1], [355, 372, .9], [395, 392, 1.05], [440, 375, .8], [690, 420, .9], [905, 395, 1.1], [955, 415, .9], [45, 505, 1.3], [215, 505, 1.2], [395, 515, 1.3], [745, 510, 1.3], [930, 505, 1.3]];
  const tree = ([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-4" y="26" width="8" height="12" fill="#7a4a24"/><path d="M0 -24 19 8H-19Z" fill="#169a62"/><path d="M0 -6 23 30H-23Z" fill="#0f8453"/></g>`;
  return `<defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a8bff"/><stop offset=".55" stop-color="#ffb6c9"/><stop offset="1" stop-color="#ffe3a6"/></linearGradient>
      <linearGradient id="peak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a56d6"/><stop offset="1" stop-color="#3f2f9c"/></linearGradient>
      <linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a8df0"/><stop offset="1" stop-color="#c3a9ec"/></linearGradient>
      <linearGradient id="hill1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fdc8c"/><stop offset="1" stop-color="#2fb56b"/></linearGradient>
      <linearGradient id="hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37c47a"/><stop offset="1" stop-color="#149257"/></linearGradient>
    </defs>
    <rect width="1000" height="540" fill="url(#sky)"/>
    <circle cx="865" cy="105" r="78" fill="#fff3b0" opacity=".55"/><circle cx="865" cy="105" r="50" fill="#ffd23f"/>
    <g fill="#fff" opacity=".92"><ellipse cx="135" cy="85" rx="74" ry="24"/><ellipse cx="190" cy="66" rx="50" ry="27"/><ellipse cx="90" cy="70" rx="36" ry="20"/><ellipse cx="800" cy="228" rx="64" ry="20"/><ellipse cx="850" cy="214" rx="40" ry="20"/><ellipse cx="225" cy="205" rx="52" ry="16"/></g>
    <path d="M0 330 130 215 250 300 380 195 480 290 760 240 880 150 1000 260V540H0Z" fill="url(#far)"/>
    <path d="M90 540 350 270 440 315 610 40 835 345 905 300 1000 410V540Z" fill="url(#peak)"/>
    <path d="M610 40 440 315 590 400 690 290Z" fill="#fff" opacity=".1"/>
    <path d="M610 40 552 133 581 117 610 145 640 119 671 133Z" fill="#fff"/>
    <path d="M610 88V30" stroke="#241a5e" stroke-width="4" stroke-linecap="round"/><path d="M610 30 650 42 610 54Z" fill="#ff5d9e"/>
    <ellipse cx="830" cy="378" rx="42" ry="30" fill="#241a5e"/>
    <path d="M0 415C170 355 300 375 470 418C640 458 830 350 1000 398V540H0Z" fill="url(#hill1)"/>
    <path d="M430 408C500 425 530 450 515 485C505 510 545 525 600 540H520C460 520 450 490 470 460C485 435 460 420 410 410Z" fill="#46b8f5"/>
    <path d="M0 490C200 455 370 512 590 490C760 472 880 488 1000 462V540H0Z" fill="url(#hill2)"/>
    ${pines.map(tree).join("")}`;
}
const stopMarks = open => STOPS.map((s, i) => {
  const on = open >= s.p, lblY = i === 6 ? s.y - 44 : s.y + 50;
  return `<circle cx="${s.x}" cy="${s.y}" r="29" fill="${on ? "#ffc52e" : "#e6e2f7"}" stroke="#fff" stroke-width="6"/>
    <text x="${s.x}" y="${s.y + 7}" text-anchor="middle" fill="#241a5e" font-size="20" font-weight="800">${s.p}</text>
    <text x="${s.x + (i === 6 ? 58 : 0)}" y="${lblY}" text-anchor="middle" fill="#241a5e" font-size="19" font-weight="800" stroke="#fff" stroke-width="6" paint-order="stroke">${s.name}</text>`;
}).join("");
const initials = name => [...String(name)].slice(0, 2).join("");

function mapFrame(open, marks, label) {
  return `<div class="map-box"><svg viewBox="0 0 1000 540" role="img" aria-label="${esc(label)}" font-family="Nunito, Segoe UI, sans-serif">
    ${scenery()}
    <path d="${trailPath()}" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round"/>
    <path d="${trailPath()}" fill="none" stroke="#ffdf8a" stroke-width="14" stroke-linecap="round" stroke-dasharray="2 22"/>
    ${stopMarks(open)}${marks}</svg></div>`;
}
// A student's own map: just one climber on the trail.
function myMapHtml(name, points) {
  const pos = pointOnPath(points), c = faceColor(name), x = pos.x, y = pos.y - 42;
  return mapFrame(points, `<path d="M${x} ${pos.y - 10} l-11 -18 h22 Z" fill="${c}" stroke="#fff" stroke-width="3"/>
    <circle cx="${x}" cy="${y}" r="27" fill="${c}" stroke="#fff" stroke-width="5"/>
    <text x="${x}" y="${y + 9}" text-anchor="middle" fill="#fff" font-size="25" font-weight="800">${esc(initials(name))}</text>`,
    `${name} has ${points} points and is at ${levelName(points)}.`);
}
// The class map: every reader in a small group near the last stop they reached.
function classMapHtml(readers) {
  const groups = STOPS.map(() => []);
  readers.forEach(r => groups[stopIndex(r.points)].push(r));
  const marks = groups.map((g, i) => g.slice(0, 12).map((r, n) => {
    const row = Math.floor(n / 4), x = STOPS[i].x - 42 + (n % 4) * 28 + (i === 6 ? -90 : 0), y = STOPS[i].y - 48 - row * 28, color = faceColor(r.name);
    return `<circle cx="${x}" cy="${y}" r="14" fill="${color}" stroke="#fff" stroke-width="2.5"/><text x="${x}" y="${y + 5}" text-anchor="middle" fill="#fff" font-size="13" font-weight="800">${esc(initials(r.name))}</text>`;
  }).join("") + (g.length > 12 ? `<text x="${STOPS[i].x + 74}" y="${STOPS[i].y - 44}" fill="#241a5e" font-size="17" font-weight="800" stroke="#fff" stroke-width="5" paint-order="stroke">+${g.length - 12}</text>` : "")).join("");
  return mapFrame(Math.max(0, ...readers.map(r => r.points)), marks, "Class map. " + STOPS.map((s, i) => s.name + ": " + groups[i].length + " readers").join(", "));
}

// Shows a student's finished work, read-only.
function workHtml(w) {
  const c = w.content || {}, a = ACTIVITIES[w.proof], parts = [];
  if (w.proof === "draw") parts.push(`<img class="art" alt="${esc(c.caption)}" src="${esc(w.drawing)}">`);
  if (w.proof === "achieve") parts.push(`<div class="box" style="--c:${a.color}"><span class="bt">Quiz score</span><div class="done-text">${esc(w.score)}%</div></div>`);
  if (a) parts.push(`<div class="boxes">${a.fields.map(f => `<div class="box" style="--c:${a.color}"><span class="bt">${f[1]}</span><div class="done-text">${esc(c[f[0]])}</div></div>`).join("")}</div>`);
  return parts.join("");
}
