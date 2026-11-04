const app = $("app");
let token = store.get("sr_student");
let home = null, login = { code: store.get("sr_code") || "", roster: null, student: null, pin: "", error: "" };
let ticking = null, wakeLock = null, confirmCancel = false;
let draft = null, painter = null;

function stopTimer() {
  clearInterval(ticking); ticking = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/* ---------- Sign in ---------- */
function showCode() {
  stopTimer();
  app.innerHTML = `<h1>Summit Readers</h1>
    <form class="sheet" id="codeForm">
      <h2>Hi, reader!</h2>
      <label for="code">Type your class code
        <input id="code" type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(login.code)}" required>
      </label>
      ${login.error ? `<p class="error" role="alert">${esc(login.error)}</p>` : ""}
      <button class="btn primary big" type="submit">Next</button>
    </form>
    <p class="meta"><a href="teacher.html">Teacher sign-in</a></p>`;
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
  app.innerHTML = `<h1>${esc(login.roster.class_name)}</h1>
    <div class="sheet">
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
  app.innerHTML = `<h1>Hi, ${esc(login.student.name)}!</h1>
    <div class="sheet">
      <h2 style="text-align:center">Type your PIN</h2>
      <div class="dots" role="img" aria-label="${login.pin.length} of 4 digits typed">${[0, 1, 2, 3].map(i => `<i class="${i < login.pin.length ? "on" : ""}"></i>`).join("")}</div>
      ${login.error ? `<p class="error" role="alert" style="text-align:center">${esc(login.error)}</p>` : ""}
      <div class="pad">${keys.map(k => k ? `<button data-k="${k}" aria-label="${k === "⌫" ? "Delete" : k}">${k}</button>` : "<span></span>").join("")}</div>
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
    token = r.token; store.set("sr_student", token); login.pin = ""; loadHome();
  } catch (e) { login.pin = ""; login.error = friendly(e); showPin(); }
}

async function logout() {
  const t = token; token = null; store.del("sr_student"); home = null; stopTimer();
  try { await rpc("student_logout", { p_token: t }); } catch (e) {}
  showCode();
}

function handleAuth(e) {
  if (e.message === "auth") { token = null; store.del("sr_student"); login.error = MESSAGES.auth; showCode(); return true; }
  return false;
}

/* ---------- Home ---------- */
async function loadHome() {
  stopTimer();
  try { home = await rpc("student_home", { p_token: token }); showHome(); }
  catch (e) {
    if (handleAuth(e)) return;
    app.innerHTML = `<h1>Summit Readers</h1><div class="sheet"><p class="error" role="alert">${esc(friendly(e))}</p><button class="btn primary" id="again">Try again</button></div>`;
    $("again").addEventListener("click", loadHome);
  }
}

function showHome() {
  const open = home.open, cta = !open ? "Start reading: 15 minutes" : open.elapsed >= READ_SECONDS ? "Do your activity" : "Keep reading";
  const pts = w => 10 + (w.teammate ? 2 : 0) + (w.spot_passed ? 3 : 0);
  const pill = w => w.status === "approved" ? `<span class="pill approved">Approved: ${pts(w)} points</span>` : w.status === "retry" ? `<span class="pill retry">Read it again</span>` : `<span class="pill pending">Waiting for your teacher</span>`;
  app.innerHTML = `<div class="top"><h1>Summit Readers</h1><div class="who"><span>${esc(home.me.name)}${home.me.team_name ? " · " + esc(home.me.team_name) : ""}</span><button class="btn small" id="out">Log out</button></div></div>
    <button class="btn primary big" id="go">${cta}</button>
    <div class="sheet you">
      <div><b>★ ${home.stars}</b><small>readings</small></div>
      <div><b>${home.points}</b><small>my points</small></div>
      <div><b style="font-size:1.35rem;line-height:1.75rem">${badgeFor(home.points)}</b><small>my badge</small></div>
    </div>
    ${mapHtml(home.board, home.me.team_id)}
    <div class="sheet"><h2>My work</h2>
      ${home.work.length ? home.work.map(w => `<div class="work"><div><b>${esc(w.title)}</b><div class="meta">${esc(PROOF_NAMES[w.proof])}</div></div>
        <div class="row">${pill(w)}${w.proof === "teacher" ? "" : `<button class="btn small" data-work="${esc(w.id)}">${w.status === "retry" ? "Fix it" : "Open"}</button>`}</div></div>`).join("") : `<p class="muted">Your work will appear here after your first reading.</p>`}
    </div>
    <details class="sheet"><summary>How to play</summary>${RULES_HTML}</details>`;
  $("out").addEventListener("click", logout);
  $("go").addEventListener("click", startReading);
  app.querySelectorAll("[data-work]").forEach(b => b.addEventListener("click", () => openWork(b.dataset.work)));
}

/* ---------- Timer ---------- */
async function startReading() {
  try {
    const r = await rpc("reading_start", { p_token: token });
    home.open = r;
    if (r.elapsed >= READ_SECONDS) startActivity(r.id); else showTimer(r);
  } catch (e) { if (!handleAuth(e)) toast(friendly(e)); }
}

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [660, 880, 990].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; g.gain.value = .12; o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * .18); o.stop(ctx.currentTime + i * .18 + .16);
    });
  } catch (e) {}
}

function showTimer(r) {
  stopTimer(); confirmCancel = false;
  const R = 90, C = 2 * Math.PI * R;
  app.innerHTML = `<div class="sheet timer">
      <h1>Keep reading!</h1>
      <div class="ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--soft)" stroke-width="16"/><circle id="arc" cx="100" cy="100" r="${R}" fill="none" stroke="var(--sun)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><div class="time" id="time" role="timer"></div></div>
      <p>Your timer keeps going even if you close this page. Come back when you finish.</p>
      <div class="row"><button class="btn" id="home">Go to my map</button><button class="btn danger" id="cancel">Stop and start over</button></div>
    </div>`;
  let base = r.elapsed, t0 = performance.now();
  const paint = () => {
    const el = base + (performance.now() - t0) / 1000, left = Math.max(0, READ_SECONDS - el), secs = Math.ceil(left);
    $("time").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    $("arc").setAttribute("stroke-dashoffset", C * (1 - Math.min(1, el / READ_SECONDS)));
    if (left <= 0) { stopTimer(); chime(); showTimeUp(r.id); }
  };
  paint();
  if (!ticking && $("time")) ticking = setInterval(paint, 1000);
  if (navigator.wakeLock) navigator.wakeLock.request("screen").then(l => { wakeLock = l; }).catch(() => {});
  $("home").addEventListener("click", loadHome);
  $("cancel").addEventListener("click", async () => {
    if (!confirmCancel) { confirmCancel = true; $("cancel").textContent = "Tap again to erase this timer"; return; }
    try { await rpc("reading_cancel", { p_token: token }); loadHome(); } catch (e) { if (!handleAuth(e)) toast(friendly(e)); }
  });
}
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !ticking || !token) return;
  try { const r = await rpc("reading_start", { p_token: token }); if (ticking) showTimer(r); } catch (e) {}
});

function showTimeUp(id) {
  app.innerHTML = `<div class="sheet timer pop"><h1>Time's up. Great reading!</h1><p>Now show what you read.</p><button class="btn primary big" id="next">Choose my activity</button></div>`;
  $("next").addEventListener("click", () => startActivity(id));
}

/* ---------- Activity ---------- */
const draftKey = id => "sr_draft_" + id;
function saveDraft() {
  if (!draft || !draft.readingId) return;
  readForm();
  const { content, proof, title, pages, teammate, jfk, score, drawing } = draft;
  store.set(draftKey(draft.readingId), JSON.stringify({ content, proof, title, pages, teammate, jfk, score, drawing }));
}
function startActivity(readingId) {
  stopTimer();
  let saved = {};
  try { saved = JSON.parse(store.get(draftKey(readingId))) || {}; } catch (e) {}
  draft = { readingId, submissionId: null, title: "", pages: "", teammate: false, jfk: false, proof: "", content: {}, score: "", drawing: "", ...saved };
  showActivity();
}

function showActivity(error) {
  const choices = [["map", "Story Map", "Graphic organizer for stories"], ["idea", "Main Idea", "Graphic organizer for nonfiction"], ["draw", "Draw", "Make a picture and explain it"], ["write", "Write", "Tell about it in your own words"], ["achieve", "Achieve3000", "Show your quiz score"]];
  app.innerHTML = `<div class="top"><h1>${draft.submissionId ? "Fix your work" : "Show what you read"}</h1><button class="btn small" id="leave">My map</button></div>
    <form id="work" class="sheet" novalidate>
      <div class="fields">
        <label for="wTitle">What did you read?<input id="wTitle" type="text" maxlength="120" autocomplete="off" value="${esc(draft.title)}"></label>
        <label for="wPages">Pages (optional)<input id="wPages" type="text" maxlength="40" autocomplete="off" placeholder="10 to 24" value="${esc(draft.pages)}"></label>
      </div>
      <label class="check" for="wTeam"><input id="wTeam" type="checkbox" ${draft.teammate ? "checked" : ""}>I read with a teammate</label>
      <label class="check" for="wJfk"><input id="wJfk" type="checkbox" ${draft.jfk ? "checked" : ""}>This is for JFK Reads</label>
      <h2>Choose your activity</h2>
      <div class="choices">${choices.map(c => `<button type="button" class="choice" data-proof="${c[0]}" aria-pressed="${draft.proof === c[0]}"><b>${c[1]}</b>${c[2]}</button>`).join("")}</div>
      <div id="editor" class="sheet" style="border:0;padding:0"></div>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <button class="btn primary big" type="submit" ${draft.proof ? "" : "hidden"}>Send to my teacher</button>
    </form>`;
  renderEditor();
  $("leave").addEventListener("click", () => { saveDraft(); painter = null; draft = null; loadHome(); });
  app.querySelectorAll("[data-proof]").forEach(b => b.addEventListener("click", () => {
    saveDraft(); draft.proof = b.dataset.proof; showActivity();
    app.querySelector(`[data-proof="${draft.proof}"]`).scrollIntoView({ block: "start" });
  }));
  $("work").addEventListener("input", saveDraft);
  $("work").addEventListener("submit", submitWork);
}

function renderEditor() {
  const ed = $("editor"), c = draft.content;
  painter = null;
  if (FIELDS[draft.proof]) {
    ed.innerHTML = `<div class="boxes">${FIELDS[draft.proof].map((f, i) => `<label class="box ${draft.proof === "map" && i === 4 || draft.proof === "idea" && i === 0 ? "wide" : ""}" style="--c:var(${f[3]})" for="f-${f[0]}"><span>${f[1]}</span><small>${f[2]}</small><textarea id="f-${f[0]}" data-field="${f[0]}" maxlength="2000">${esc(c[f[0]])}</textarea></label>`).join("")}</div>`;
  } else if (draft.proof === "write") {
    ed.innerHTML = `<label class="box" style="--c:var(--green)" for="f-text"><span>My writing</span><small>Write at least three sentences. These starters can help: This reading is about... The most interesting part was... because... I wonder...</small><textarea id="f-text" data-field="text" maxlength="2000" rows="8">${esc(c.text)}</textarea><small id="wc" aria-live="polite"></small></label>`;
    const count = () => { const n = ($("f-text").value.trim().match(/\S+/g) || []).length; $("wc").textContent = n >= 15 ? n + " words. Nice!" : n + " of 15 words"; };
    $("f-text").addEventListener("input", count); count();
  } else if (draft.proof === "achieve") {
    ed.innerHTML = `<div class="boxes"><label class="box" style="--c:var(--gold)" for="f-score"><span>My quiz score</span><small>75% or higher counts</small><input id="f-score" type="number" min="0" max="100" inputmode="numeric" value="${esc(draft.score)}"></label>
      <label class="box" style="--c:var(--blue)" for="f-learned"><span>I learned...</span><small>Write two new things you learned.</small><textarea id="f-learned" data-field="learned" maxlength="2000">${esc(c.learned)}</textarea></label></div>`;
  } else if (draft.proof === "draw") {
    ed.innerHTML = `<div class="draw-wrap"><div class="draw-tools" id="tools"></div><canvas class="paper" id="paper" width="1000" height="700" aria-label="Drawing space"></canvas></div>
      <label class="box" style="--c:var(--coral)" for="f-caption"><span>This picture shows...</span><small>Write one sentence.</small><textarea id="f-caption" data-field="caption" maxlength="2000">${esc(c.caption)}</textarea></label>`;
    painter = makePainter($("paper"), $("tools"), draft.drawing);
  } else {
    ed.innerHTML = "";
  }
}

function makePainter(canvas, tools, startImage) {
  const ctx = canvas.getContext("2d");
  const palette = ["#1b2a5b", "#e03131", "#f08c00", "#ffd43b", "#2f9e44", "#1971c2", "#9c36b5", "#8a5a2b"];
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
  tools.addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.color) { p.color = b.dataset.color; p.eraser = false; }
    if (b.dataset.size) p.size = Number(b.dataset.size);
    if (b.dataset.tool === "eraser") p.eraser = !p.eraser;
    if (b.dataset.tool === "undo" && p.undo.length) { ctx.putImageData(p.undo.pop(), 0, 0); p.drawn = p.undo.length > 0 || !!startImage; commit(); }
    if (b.dataset.tool === "clear") { snapshot(); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1000, 700); p.drawn = false; startImage = ""; commit(); }
    paintTools();
  });
  const snapshot = () => { p.undo.push(ctx.getImageData(0, 0, 1000, 700)); if (p.undo.length > 8) p.undo.shift(); };
  const commit = () => { draft.drawing = p.drawn ? canvas.toDataURL("image/jpeg", .75) : ""; saveDraft(); };
  const at = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * 1000 / r.width, (e.clientY - r.top) * 700 / r.height]; };
  let last = null;
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
  function stroke(a, b) {
    ctx.strokeStyle = p.eraser ? "#fff" : p.color; ctx.lineWidth = p.eraser ? p.size * 2 : p.size;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  return p;
}

function readForm() {
  if (!$("wTitle")) return;
  draft.title = $("wTitle").value; draft.pages = $("wPages").value;
  draft.teammate = $("wTeam").checked; draft.jfk = $("wJfk").checked;
  app.querySelectorAll("[data-field]").forEach(el => { draft.content[el.dataset.field] = el.value; });
  if ($("f-score")) draft.score = $("f-score").value;
}

async function submitWork(ev) {
  ev.preventDefault();
  readForm();
  if (!draft.proof) { showActivity("Choose your activity first."); return; }
  if (draft.proof === "draw" && !draft.drawing) { keepForm("Make your drawing first."); return; }
  const fieldsFor = FIELDS[draft.proof] ? FIELDS[draft.proof].map(f => f[0]) : { write: ["text"], draw: ["caption"], achieve: ["learned"] }[draft.proof];
  const content = {}; fieldsFor.forEach(k => { content[k] = (draft.content[k] || "").trim(); });
  const body = { title: draft.title.trim(), pages: draft.pages.trim(), teammate: draft.teammate, jfk: draft.jfk, proof: draft.proof, content };
  if (draft.proof === "draw") body.drawing = draft.drawing;
  if (draft.proof === "achieve") body.score = String(draft.score).trim();
  const btn = app.querySelector("button[type=submit]"); btn.disabled = true;
  try {
    if (draft.submissionId) await rpc("submission_resubmit", { p_token: token, p_id: draft.submissionId, p: body });
    else await rpc("submission_create", { p_token: token, p_reading: draft.readingId, p: body });
    if (draft.readingId) store.del(draftKey(draft.readingId));
    draft = null; painter = null;
    app.innerHTML = `<div class="sheet timer pop"><h1>Sent to your teacher!</h1><p>When your teacher approves it, your points count and your team moves up.</p><button class="btn primary big" id="next">Go to my map</button></div>`;
    $("next").addEventListener("click", loadHome);
  } catch (e) {
    btn.disabled = false;
    if (!handleAuth(e)) keepForm(friendly(e));
  }
}
// Shows a message without redrawing the form, so a drawing in progress stays on the page.
function keepForm(msg) {
  let el = $("workError");
  if (!el) { el = document.createElement("p"); el.id = "workError"; el.className = "error"; el.setAttribute("role", "alert"); app.querySelector("button[type=submit]").before(el); }
  el.textContent = msg;
}

/* ---------- Finished work ---------- */
async function openWork(id) {
  try {
    const w = await rpc("submission_get", { p_token: token, p_id: id });
    if (w.status === "retry") {
      draft = { readingId: null, submissionId: w.id, title: w.title, pages: w.pages, teammate: w.teammate, jfk: w.jfk, proof: w.proof, content: { ...w.content }, score: w.score == null ? "" : String(w.score), drawing: w.drawing || "" };
      showActivity(); return;
    }
    app.innerHTML = `<div class="top"><h1>${esc(w.title)}</h1><button class="btn small" id="back">My map</button></div>
      <div class="sheet"><h2>${esc(PROOF_NAMES[w.proof])}</h2>${workHtml(w)}</div>`;
    $("back").addEventListener("click", loadHome);
  } catch (e) { if (!handleAuth(e)) toast(friendly(e)); }
}

if (token) loadHome(); else showCode();
