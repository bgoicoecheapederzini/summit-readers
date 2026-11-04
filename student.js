const app = $("app");
const TABS = [["map", "Map", "map"], ["add", "Add Reading", "add"], ["points", "My Points", "points"], ["rules", "Rules", "rules"], ["class", "My Class", "class"]];
let token = store.get("sr_student");
let home = null, tab = "map", login = { code: store.get("sr_code") || "", roster: null, student: null, pin: "", error: "" };
let confirmOut = false, draft = null, viewing = null;

/* ---------- Sign in ---------- */
function showCode() {
  app.innerHTML = `<h1 class="login-title">Summit Readers</h1>
    <form class="card" id="codeForm" style="width:min(100%,480px);justify-self:center">
      <h2>Hi, reader!</h2>
      <label for="code">Type your class code
        <input id="code" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(login.code)}" required>
      </label>
      ${login.error ? `<p class="error" role="alert">${esc(login.error)}</p>` : ""}
      <button class="btn primary big" type="submit">Next</button>
    </form>
    <p class="meta" style="color:#fff;text-align:center"><a href="teacher.html">Teacher sign-in</a></p>`;
  $("codeForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    login.code = $("code").value.trim().toUpperCase();
    try {
      login.roster = await rpc("class_roster", { p_code: login.code });
      store.set("sr_code", login.code); login.error = ""; showNames();
    } catch (e) { login.error = friendly(e); showCode(); }
  });
}

function showNames() {
  const names = login.roster.students;
  app.innerHTML = `<h1 class="login-title">${esc(login.roster.class_name)}</h1>
    <div class="card">
      <h2>Tap your name</h2>
      ${names.length ? `<div class="names">${names.map(s => `<button class="btn" data-id="${esc(s.id)}">${esc(s.name)}</button>`).join("")}</div>` : `<p>Your teacher hasn't added any readers yet.</p>`}
      <button class="btn link" id="back">Use a different class code</button>
    </div>`;
  app.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => {
    login.student = names.find(s => s.id === b.dataset.id); login.pin = ""; login.error = ""; showPin();
  }));
  $("back").addEventListener("click", () => { login.error = ""; showCode(); });
}

function showPin() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  app.innerHTML = `<h1 class="login-title">Hi, ${esc(login.student.name)}!</h1>
    <div class="card center" style="width:min(100%,420px);justify-self:center">
      <h2>Type your PIN</h2>
      <div class="dots" role="img" aria-label="${login.pin.length} of 4 digits typed">${[0, 1, 2, 3].map(i => `<i class="${i < login.pin.length ? "on" : ""}"></i>`).join("")}</div>
      ${login.error ? `<p class="error" role="alert">${esc(login.error)}</p>` : ""}
      <div class="pad" style="width:100%">${keys.map(k => k ? `<button data-k="${k}" aria-label="${k === "⌫" ? "Delete" : k}">${k}</button>` : "<span></span>").join("")}</div>
      <button class="btn link" id="back">That's not me</button>
    </div>`;
  app.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => pressPin(b.dataset.k)));
  $("back").addEventListener("click", showNames);
}

async function pressPin(k) {
  if (k === "⌫") { login.pin = login.pin.slice(0, -1); login.error = ""; showPin(); return; }
  if (login.pin.length >= 4) return;
  login.pin += k; login.error = ""; showPin();
  if (login.pin.length < 4) return;
  try {
    const r = await rpc("student_login", { p_code: login.code, p_student: login.student.id, p_pin: login.pin });
    if (r.error) { login.pin = ""; login.error = "That PIN isn't right. Try again, or ask your teacher."; showPin(); return; }
    token = r.token; store.set("sr_student", token); login.pin = ""; tab = "map"; await loadHome();
  } catch (e) { login.pin = ""; login.error = friendly(e); showPin(); }
}

async function logout() {
  const t = token; token = null; store.del("sr_student"); home = null; draft = null;
  try { await rpc("student_logout", { p_token: t }); } catch (e) {}
  showCode();
}

function handleAuth(e) {
  if (e.message === "auth") { token = null; store.del("sr_student"); login.error = MESSAGES.auth; showCode(); return true; }
  return false;
}

/* ---------- Shell ---------- */
async function loadHome() {
  try {
    home = await rpc("student_home", { p_token: token });
    render();
  } catch (e) {
    if (handleAuth(e)) return;
    app.innerHTML = `<h1 class="login-title">Summit Readers</h1><div class="card"><p class="error" role="alert">${esc(friendly(e))}</p><button class="btn primary" id="again">Try again</button></div>`;
    $("again").addEventListener("click", loadHome);
  }
}

function render() {
  const fix = home.work.filter(w => w.status === "retry").length;
  app.innerHTML = `<div class="top"><h1>Summit Readers</h1><div class="who"><span>Hi, ${esc(home.me.name)}!</span><button class="ghost" id="out">${confirmOut ? "Tap again to log out" : "Log out"}</button></div></div>
    <nav class="tabs" role="tablist" aria-label="Sections">${TABS.map(([k, label, ic]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}">${icon(ic)}<span>${label}</span>${k === "points" && fix ? `<span class="count">${fix}</span>` : ""}</button>`).join("")}</nav>
    <section id="view" class="stack"></section>`;
  $("out").addEventListener("click", () => { if (confirmOut) { confirmOut = false; logout(); } else { confirmOut = true; $("out").textContent = "Tap again to log out"; } });
  app.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
    if (tab === "add") saveDraft();
    tab = b.dataset.tab; confirmOut = false; viewing = null; render(); window.scrollTo(0, 0);
    if (tab !== "add") refreshQuietly();
  }));
  ({ map: viewMap, add: viewAdd, points: viewPoints, rules: viewRules, class: viewClass })[tab]();
}
async function refreshQuietly() {
  try {
    home = await rpc("student_home", { p_token: token });
    if (tab !== "add" && !viewing) render();
  } catch (e) { handleAuth(e); }
}

/* ---------- Map ---------- */
function viewMap() {
  const i = stopIndex(home.points), next = STOPS[i + 1];
  $("view").innerHTML = myMapHtml(home.me.name, home.points) + `<div class="card banner">
      <div><b>You are at ${STOPS[i].name}!</b><div class="muted">${next ? `${next.p - home.points} more points to ${next.name}.` : "You reached the top. Amazing reading!"}</div></div>
      <button class="btn primary" id="toAdd">Add a reading</button></div>`;
  $("toAdd").addEventListener("click", () => { tab = "add"; render(); window.scrollTo(0, 0); });
}

/* ---------- Add Reading ---------- */
const draftKey = () => "sr_draft_" + home.me.id;
function startDraft() {
  let saved = {};
  try { saved = JSON.parse(store.get(draftKey())) || {}; } catch (e) {}
  draft = { submissionId: null, title: "", minutes: "", jfk: false, proof: "", content: {}, score: "", drawing: "", ...saved };
}
function saveDraft() {
  if (!draft) return;
  readForm();
  if (draft.submissionId) return;
  const { content, proof, title, minutes, jfk, score, drawing } = draft;
  store.set(draftKey(), JSON.stringify({ content, proof, title, minutes, jfk, score, drawing }));
}
function readForm() {
  if ($("wTitle")) { draft.title = $("wTitle").value; draft.minutes = $("wMinutes").value; }
  if ($("wJfk")) draft.jfk = $("wJfk").checked;
  app.querySelectorAll("[data-field]").forEach(el => { draft.content[el.dataset.field] = el.value; });
  if ($("f-score")) draft.score = $("f-score").value;
}
const readingFields = () => `<div class="fields">
    <label for="wTitle">What did you read?<input id="wTitle" type="text" maxlength="120" autocomplete="off" value="${esc(draft.title)}"></label>
    <label for="wMinutes">How many minutes did you read?<input id="wMinutes" type="number" min="5" max="60" inputmode="numeric" value="${esc(draft.minutes)}"></label>
  </div>
  <div class="row" role="group" aria-label="Quick minutes">${[10, 15, 20, 30].map(m => `<button type="button" class="tool" data-min="${m}">${m} min</button>`).join("")}</div>`;
function bindMinutes() {
  app.querySelectorAll("[data-min]").forEach(b => b.addEventListener("click", () => { $("wMinutes").value = b.dataset.min; saveDraft(); }));
}

function viewAdd() {
  if (!draft) startDraft();
  if (draft.proof) { viewEditor(); return; }
  $("view").innerHTML = `<div class="card" id="reading">
      <h2>${draft.submissionId ? "Fix your reading" : "Step 1: Tell us about your reading"}</h2>
      ${readingFields()}
      <p class="meta">You earn 1 point for each minute. Write 5 to 60 minutes. If you read longer, add another reading.</p>
    </div>
    <div class="card"><h2>Step 2: Choose one activity</h2>
      <div class="board">${Object.entries(ACTIVITIES).map(([k, a]) => `<button class="tile" style="--c:${a.color}" data-proof="${k}">${icon(k)}<b>${a.name}</b><span>${a.blurb}</span></button>`).join("")}</div>
    </div>`;
  bindMinutes();
  $("reading").addEventListener("input", saveDraft);
  app.querySelectorAll("[data-proof]").forEach(b => b.addEventListener("click", () => { saveDraft(); draft.proof = b.dataset.proof; saveDraft(); render(); window.scrollTo(0, 0); }));
}

function viewEditor() {
  const a = ACTIVITIES[draft.proof], c = draft.content;
  const field = f => `<label class="box" style="--c:${a.color}" for="f-${f[0]}"><span>${f[1]}</span><small>${f[2]}</small><textarea id="f-${f[0]}" data-field="${f[0]}" maxlength="2000" ${draft.proof === "write" ? 'rows="6"' : 'rows="2"'}>${esc(c[f[0]])}</textarea></label>`;
  $("view").innerHTML = `<form class="card" id="work" novalidate>
      <div class="row" style="justify-content:space-between"><h2>${a.name}</h2><button type="button" class="btn small" id="change">Change activity</button></div>
      ${readingFields()}
      ${draft.proof === "draw" ? `<div class="draw-wrap"><div class="draw-tools" id="tools"></div><canvas class="paper" id="paper" width="1000" height="700" aria-label="Drawing space"></canvas></div>` : ""}
      ${draft.proof === "achieve" ? `<label class="box" style="--c:${a.color}" for="f-score"><span>My quiz score</span><small>75% or higher counts. Over 75% earns 3 extra points.</small><input id="f-score" type="number" min="0" max="100" inputmode="numeric" value="${esc(draft.score)}"></label>` : ""}
      <div class="boxes">${a.fields.map(field).join("")}</div>
      ${draft.proof === "write" ? `<p class="meta" id="wc" aria-live="polite"></p>` : ""}
      <label class="check" for="wJfk"><input id="wJfk" type="checkbox" ${draft.jfk ? "checked" : ""}>This is for JFK Reads</label>
      <button class="btn primary big" type="submit">Send to my teacher</button>
    </form>`;
  bindMinutes();
  if (draft.proof === "draw") makePainter($("paper"), $("tools"), draft.drawing);
  if (draft.proof === "write") {
    const count = () => { const n = ($("f-text").value.trim().match(/\S+/g) || []).length; $("wc").textContent = n >= 15 ? n + " words. Nice!" : n + " of 15 words"; };
    $("f-text").addEventListener("input", count); count();
  }
  $("change").addEventListener("click", () => { saveDraft(); draft.proof = ""; saveDraft(); render(); });
  $("work").addEventListener("input", saveDraft);
  $("work").addEventListener("submit", submitWork);
}

function makePainter(canvas, tools, startImage) {
  const ctx = canvas.getContext("2d");
  const palette = ["#241a5e", "#e03131", "#f08c00", "#ffd43b", "#2f9e44", "#1971c2", "#9c36b5", "#8a5a2b"];
  const sizes = [["Thin", 5], ["Medium", 12], ["Thick", 26]];
  const p = { color: palette[0], size: 12, eraser: false, drawn: !!startImage, undo: [] };
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1000, 700);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (startImage) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, 1000, 700); img.src = startImage; }
  const paintTools = () => {
    tools.innerHTML = palette.map(c => `<button type="button" class="swatch" style="background:${c}" data-color="${c}" aria-label="Color" aria-pressed="${!p.eraser && p.color === c}"></button>`).join("") +
      sizes.map(s => `<button type="button" class="tool" data-size="${s[1]}" aria-pressed="${p.size === s[1]}">${s[0]}</button>`).join("") +
      `<button type="button" class="tool" data-tool="eraser" aria-pressed="${p.eraser}">Eraser</button><button type="button" class="tool" data-tool="undo">Undo</button><button type="button" class="tool" data-tool="clear">Clear</button>`;
  };
  paintTools();
  const snapshot = () => { p.undo.push(ctx.getImageData(0, 0, 1000, 700)); if (p.undo.length > 8) p.undo.shift(); };
  const commit = () => { draft.drawing = p.drawn ? canvas.toDataURL("image/jpeg", .75) : ""; saveDraft(); };
  tools.addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.color) { p.color = b.dataset.color; p.eraser = false; }
    if (b.dataset.size) p.size = Number(b.dataset.size);
    if (b.dataset.tool === "eraser") p.eraser = !p.eraser;
    if (b.dataset.tool === "undo" && p.undo.length) { ctx.putImageData(p.undo.pop(), 0, 0); p.drawn = p.undo.length > 0 || !!startImage; commit(); }
    if (b.dataset.tool === "clear") { snapshot(); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1000, 700); p.drawn = false; startImage = ""; commit(); }
    paintTools();
  });
  const at = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * 1000 / r.width, (e.clientY - r.top) * 700 / r.height]; };
  let last = null;
  function stroke(a, b) {
    ctx.strokeStyle = p.eraser ? "#fff" : p.color; ctx.lineWidth = p.eraser ? p.size * 2 : p.size;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  canvas.addEventListener("pointerdown", e => {
    e.preventDefault(); canvas.setPointerCapture(e.pointerId); snapshot();
    last = at(e); stroke(last, last); p.drawn = true;
  });
  canvas.addEventListener("pointermove", e => {
    if (!last) return; e.preventDefault();
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (list.length ? list : [e]).forEach(ev => { const n = at(ev); stroke(last, n); last = n; });
  });
  const end = () => { if (last) { last = null; commit(); } };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

// Shows a message without redrawing the form, so a drawing in progress stays on the page.
function formError(msg) {
  let el = $("workError");
  if (!el) { el = document.createElement("p"); el.id = "workError"; el.className = "error"; el.setAttribute("role", "alert"); app.querySelector("button[type=submit]").before(el); }
  el.textContent = msg;
}
async function submitWork(ev) {
  ev.preventDefault();
  readForm();
  if (draft.proof === "draw" && !draft.drawing) { formError("Make your drawing first."); return; }
  const content = {}; ACTIVITIES[draft.proof].fields.forEach(f => { content[f[0]] = (draft.content[f[0]] || "").trim(); });
  const body = { title: draft.title.trim(), minutes: String(draft.minutes).trim(), jfk: draft.jfk, proof: draft.proof, content };
  if (draft.proof === "draw") body.drawing = draft.drawing;
  if (draft.proof === "achieve") body.score = String(draft.score).trim();
  const btn = app.querySelector("button[type=submit]"); btn.disabled = true;
  try {
    if (draft.submissionId) await rpc("submission_resubmit", { p_token: token, p_id: draft.submissionId, p: body });
    else { await rpc("submission_create", { p_token: token, p: body }); store.del(draftKey()); }
    draft = null;
    home = await rpc("student_home", { p_token: token });
    $("view").innerHTML = `<div class="card center pop"><h2>Sent to your teacher!</h2><p>When your teacher approves it, you earn your points and move up the map.</p><div class="row" style="justify-content:center"><button class="btn primary" id="next">Go to my map</button><button class="btn" id="more">Add another reading</button></div></div>`;
    $("next").addEventListener("click", () => { tab = "map"; render(); window.scrollTo(0, 0); });
    $("more").addEventListener("click", () => { render(); window.scrollTo(0, 0); });
  } catch (e) {
    btn.disabled = false;
    if (!handleAuth(e)) formError(friendly(e));
  }
}

/* ---------- My Points ---------- */
function viewPoints() {
  if (viewing) {
    const w = viewing;
    $("view").innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(w.title)}</h2><button class="btn small" id="back">Back</button></div><p class="meta">${esc(proofName(w.proof))} · ${w.minutes} minutes</p>${workHtml(w)}</div>`;
    $("back").addEventListener("click", () => { viewing = null; render(); });
    return;
  }
  const i = stopIndex(home.points), now = STOPS[i], next = STOPS[i + 1];
  const pct = next ? Math.round((home.points - now.p) / (next.p - now.p) * 100) : 100;
  const pill = w => w.status === "approved" ? `<span class="pill approved">+${submissionPoints(w)} points</span>` : w.status === "retry" ? `<span class="pill retry">Read it again</span>` : `<span class="pill pending">Waiting for your teacher</span>`;
  $("view").innerHTML = `<div class="card"><div class="score">
      <div><b>${home.points}</b><small>points</small></div>
      <div><b>${home.minutes}</b><small>minutes read</small></div>
      <div><b>★ ${home.stars}</b><small>readings</small></div>
      <div><b class="word">${now.name}</b><small>my level</small></div></div>
      <div class="bar" role="img" aria-label="${pct}% of the way to the next stop"><i style="width:${pct}%"></i></div>
      <p class="muted">${next ? `${next.p - home.points} more points to ${next.name}.` : "You reached the Summit!"}</p></div>
    <div class="card"><h2>My work</h2>
      ${home.work.length ? home.work.map(w => `<div class="work"><div><b>${esc(w.title)}</b><div class="meta">${esc(proofName(w.proof))} · ${w.minutes} minutes</div></div>
        <div class="row">${pill(w)}${w.proof === "teacher" ? "" : `<button class="btn small" data-work="${esc(w.id)}">${w.status === "retry" ? "Fix it" : "Open"}</button>`}</div></div>`).join("") : `<p class="muted">Your work will appear here after your first reading.</p>`}
    </div>`;
  app.querySelectorAll("[data-work]").forEach(b => b.addEventListener("click", () => openWork(b.dataset.work)));
}
async function openWork(id) {
  try {
    const w = await rpc("submission_get", { p_token: token, p_id: id });
    if (w.status === "retry") {
      draft = { submissionId: w.id, title: w.title, minutes: String(w.minutes), jfk: w.jfk, proof: ACTIVITIES[w.proof] ? w.proof : "", content: { ...w.content }, score: w.score == null ? "" : String(w.score), drawing: w.drawing || "" };
      tab = "add"; render(); window.scrollTo(0, 0); return;
    }
    viewing = w; render();
  } catch (e) { if (!handleAuth(e)) toast(friendly(e)); }
}

/* ---------- Rules and class ---------- */
function viewRules() { $("view").innerHTML = RULES_HTML; }
function viewClass() {
  $("view").innerHTML = `<div class="card banner"><div><b>${esc(home.class_name)}</b><div class="muted">Together we read ${home.class_minutes} ${home.class_minutes === 1 ? "minute" : "minutes"}!</div></div></div>
    <div class="card"><div class="people">${home.classmates.map(c => `<div class="person ${c.id === home.me.id ? "me" : ""}"><span class="face" style="background:${faceColor(c.name)}">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><div class="meta">${levelName(c.points)} · ★ ${c.stars}</div></div></div>`).join("")}</div></div>`;
}

if (token) loadHome(); else showCode();
