const app = $("app");
const QUESTIONS = [
  "Open the book to any page. Read me one sentence. What is happening here?",
  "Who is the main character or topic? Tell me one thing you learned about them.",
  "What problem shows up in this reading? How does it get solved?",
  "Show me your favorite page. Why did you choose it?",
  "What happened at the very beginning? What happened at the end?",
  "Find a new or tricky word in this reading. What do you think it means?",
  "What surprised you most? Show me where it happens.",
  "Would you tell a friend to read this? Give me two reasons from the reading."
];
const TABS = [["review", "Review", "review"], ["check", "Spot Check", "spot"], ["map", "Map", "map"], ["class", "My Class", "class"], ["rules", "Rules", "rules"]];
let token = store.get("sr_teacher"), data = null, tab = "review", spot = null, confirmKey = null, openId = null, openWork = null;

const studentName = id => (data.students.find(s => s.id === id) || {}).name || "Reader";
const subPoints = submissionPoints;

function showLogin(mode, error) {
  const setup = mode === "setup";
  app.innerHTML = `<h1 class="login-title">Summit Readers</h1>
    <form class="card" id="loginForm" style="width:min(100%,520px);justify-self:center">
      <h2>${setup ? "Create your password" : "Teacher sign-in"}</h2>
      <label for="lCode">Class code<input id="lCode" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(store.get("sr_code") || "")}" required></label>
      ${setup ? `<label for="lSetup">One-time setup code<input id="lSetup" type="text" autocomplete="off" spellcheck="false" required></label>` : ""}
      <label for="lPass">${setup ? "New password (at least 8 characters)" : "Password"}<input id="lPass" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required></label>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <button class="btn primary" type="submit">${setup ? "Create password and sign in" : "Sign in"}</button>
      <button class="btn link" type="button" id="swap">${setup ? "I already have a password" : "First time here? Use your setup code"}</button>
    </form>
    <p class="meta" style="color:#fff;text-align:center"><a href="index.html">Student sign-in</a></p>`;
  $("swap").addEventListener("click", () => showLogin(setup ? "login" : "setup"));
  $("loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const code = $("lCode").value.trim().toUpperCase();
    try {
      const r = setup ? await rpc("teacher_setup", { p_code: code, p_setup: $("lSetup").value.trim(), p_password: $("lPass").value })
        : await rpc("teacher_login", { p_code: code, p_password: $("lPass").value });
      if (r.error) { showLogin(mode, MESSAGES.bad_login); return; }
      token = r.token; store.set("sr_teacher", token); store.set("sr_code", code);
      await refresh();
    } catch (e) { showLogin(mode, friendly(e)); }
  });
}

function handleError(e) {
  if (e.message === "auth") { token = null; store.del("sr_teacher"); showLogin("login", MESSAGES.auth); return; }
  toast(friendly(e));
}
async function act(name, args) {
  try { await rpc(name, { p_token: token, ...args }); await refresh(); return true; }
  catch (e) { handleError(e); return false; }
}
async function refresh() {
  try { data = await rpc("teacher_state", { p_token: token }); render(); }
  catch (e) { handleError(e); }
}

function render() {
  const pending = data.submissions.filter(w => w.status === "pending").length;
  const approved = data.submissions.filter(w => w.status === "approved");
  if (!$("tabs")) {
    app.innerHTML = `<div class="top"><h1>Summit Readers</h1><div class="who"><div class="stats" id="stats"></div><button class="ghost" id="out">Log out</button></div></div>
      <nav class="tabs" role="tablist" aria-label="Sections" id="tabs"></nav>
      <div id="p-review" class="stack"></div>
      <div id="p-check" class="stack"></div>
      <div id="p-map" class="stack"></div>
      <div id="p-class" class="stack"><div class="card"><h2>Add a reader</h2><form id="readerForm" class="row"><label for="rName" style="flex:1 1 220px">First name<input id="rName" type="text" maxlength="30" required autocomplete="off"></label><button class="btn primary" type="submit">Add reader</button></form><p class="meta">Use first names only. If two readers share a name, add an initial.</p></div><div id="roster" class="stack"></div></div>
      <div id="p-rules" class="stack">${RULES_HTML}</div>`;
    $("out").addEventListener("click", async () => {
      try { await rpc("teacher_logout", { p_token: token }); } catch (e) {}
      token = null; store.del("sr_teacher"); showLogin("login");
    });
    $("readerForm").addEventListener("submit", async ev => {
      ev.preventDefault();
      if (await act("teacher_student_add", { p_name: $("rName").value })) { $("rName").value = ""; $("rName").focus(); }
    });
  }
  $("stats").innerHTML = `<span><b>${approved.reduce((n, w) => n + w.minutes, 0)}</b> minutes</span><span><b>${approved.length}</b> readings</span><span><b>${approved.filter(w => w.jfk).length}</b> for JFK Reads</span>`;
  $("tabs").innerHTML = TABS.map(([k, label, ic]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}">${icon(ic)}<span>${label}</span>${k === "review" && pending ? `<span class="count">${pending}</span>` : ""}</button>`).join("");
  TABS.forEach(([k]) => { $("p-" + k).hidden = k !== tab; });
  renderReview(); renderCheck(); renderMap(); renderRoster();
}

function entry(w, actions) {
  const isOpen = openId === w.id;
  return `<div class="work"><div><b>${esc(studentName(w.student_id))}</b> · ${esc(w.title)}
      <div class="meta">${esc(proofName(w.proof))}${w.proof === "achieve" ? " " + w.score + "%" : ""} · ${subPoints(w)} points${w.spot_passed ? " · Spot Check passed" : ""}</div>
      <label for="min-${esc(w.id)}" class="row" style="gap:8px;margin-top:4px">Minutes<input id="min-${esc(w.id)}" type="number" min="1" max="180" inputmode="numeric" data-minutes="${esc(w.id)}" value="${esc(w.minutes)}" style="width:96px"></label>
      <label class="check" for="jfk-${esc(w.id)}" style="min-height:36px"><input id="jfk-${esc(w.id)}" type="checkbox" data-jfk="${esc(w.id)}" ${w.jfk ? "checked" : ""}>Counts for JFK Reads</label></div>
    <div class="row">${w.proof === "teacher" ? "" : `<button class="btn small" data-act="open" data-id="${esc(w.id)}">${isOpen ? "Close" : "See work"}</button>`}${actions}</div>
    ${isOpen && openWork ? `<div style="flex:1 1 100%;display:grid;gap:10px">${workHtml(openWork)}</div>` : ""}</div>`;
}
const delBtn = w => `<button class="btn small danger" data-act="del" data-id="${esc(w.id)}">${confirmKey === "e:" + w.id ? "Tap again to delete" : "Delete"}</button>`;

function renderReview() {
  const by = s => data.submissions.filter(w => w.status === s);
  const sec = (title, list, empty, fn) => `<div class="card"><h2>${title}</h2>${list.length ? list.map(fn).join("") : `<p class="muted">${empty}</p>`}</div>`;
  const options = data.students.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  const keep = $("aStudent") ? { s: $("aStudent").value, t: $("aTitle").value, m: $("aMinutes").value, j: $("aJfk").checked, open: $("addBox").open } : null;
  $("p-review").innerHTML =
    sec("Waiting for you", by("pending"), "Nothing to review. Students' work lands here when they send it.", w => entry(w,
      `<button class="btn small primary" data-act="approve" data-id="${esc(w.id)}">Approve</button><button class="btn small" data-act="spot" data-id="${esc(w.id)}">Spot Check</button><button class="btn small" data-act="retry" data-id="${esc(w.id)}">Try again</button>${delBtn(w)}`)) +
    (by("retry").length ? sec("Reading it again", by("retry"), "", w => entry(w, `<button class="btn small" data-act="approve" data-id="${esc(w.id)}">Approve</button>${delBtn(w)}`)) : "") +
    sec("Recently approved", by("approved").slice(0, 15), "Approved readings appear here.", w => entry(w, `<button class="btn small" data-act="unapprove" data-id="${esc(w.id)}">Undo approval</button>`)) +
    `<details class="card" id="addBox"><summary>Add a reading by hand</summary>
      <p class="meta">For a student who has no device at home. It's approved right away and earns the minutes plus 10 activity points.</p>
      <form id="addForm" style="display:grid;gap:10px"><div class="fields">
        <label for="aStudent">Reader<select id="aStudent" required><option value="">Choose a reader</option>${options}</select></label>
        <label for="aTitle">Title<input id="aTitle" type="text" maxlength="120" required autocomplete="off"></label>
        <label for="aMinutes">Minutes<input id="aMinutes" type="number" min="1" max="180" inputmode="numeric" required></label></div>
        <label class="check" for="aJfk"><input id="aJfk" type="checkbox">Counts for JFK Reads</label>
        <div class="row"><button class="btn primary" type="submit">Add reading</button></div></form></details>`;
  if (keep) { $("aStudent").value = keep.s; $("aTitle").value = keep.t; $("aMinutes").value = keep.m; $("aJfk").checked = keep.j; $("addBox").open = keep.open; }
  $("addForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const ok = await act("teacher_add_reading", { p_student: $("aStudent").value, p_title: $("aTitle").value, p_minutes: Number($("aMinutes").value), p_jfk: $("aJfk").checked });
    if (ok) { $("aStudent").value = ""; $("aTitle").value = ""; $("aMinutes").value = ""; $("aJfk").checked = false; toast("Reading added."); }
  });
}

function renderCheck() {
  const w = spot && data.submissions.find(x => x.id === spot.id);
  if (!w || w.status === "approved") {
    const n = data.submissions.filter(x => x.status === "pending").length;
    $("p-check").innerHTML = `<div class="card"><h2>Spot Check</h2><p>Pick a reading at random and ask one question with the book open. Check about one reading in three, so nobody knows whose turn is next.</p>
      <div class="row"><button class="btn primary" data-act="pick" ${n ? "" : "disabled"}>Pick a reader</button><span class="muted">${n ? n + " waiting for you" : "No readings waiting for you"}</span></div></div>`;
    return;
  }
  $("p-check").innerHTML = `<div class="card"><h2>${esc(studentName(w.student_id))}: ${esc(w.title)}</h2>
    <p class="question">${esc(QUESTIONS[spot.q])}</p>
    <div class="row"><button class="btn primary" data-act="pass" data-id="${esc(w.id)}">Passed: approve, +3</button>
    <button class="btn" data-act="retry" data-id="${esc(w.id)}">Not yet: read again</button>
    <button class="btn" data-act="nextq">Another question</button></div></div>`;
}

function renderMap() {
  const groups = STOPS.map((s, i) => ({ s, readers: data.students.filter(r => stopIndex(r.points) === i) })).filter(g => g.readers.length);
  $("p-map").innerHTML = classMapHtml(data.students) + (groups.length ? `<div class="stops">${groups.map(g => `<div class="card"><h3>${g.s.name}</h3><ul class="plain" style="list-style:none;margin:0;padding:0;display:grid;gap:4px">${g.readers.map(r => `<li>${esc(r.name)} <span class="meta">★ ${r.readings}</span></li>`).join("")}</ul></div>`).join("")}</div>` : `<div class="card"><p>Add your readers in <b>My Class</b>. They start at the Trailhead.</p></div>`);
}

function renderRoster() {
  const link = new URL("index.html", location.href).href;
  const rows = data.students.map(s => `<tr><td>${esc(s.name)}</td><td class="pin">${esc(s.pin)}</td><td class="n">${s.points}</td><td class="n">${s.minutes}</td><td class="n">${s.readings}</td><td class="n">${s.jfk}</td>
    <td class="n"><div class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn small" data-act="newpin" data-id="${esc(s.id)}">${confirmKey === "p:" + s.id ? "Tap again" : "New PIN"}</button><button class="btn small danger" data-act="delstudent" data-id="${esc(s.id)}">${confirmKey === "s:" + s.id ? "Tap again" : "Remove"}</button></div></td></tr>`).join("");
  const keepName = $("cName") && document.activeElement === $("cName") ? $("cName").value : null;
  $("roster").innerHTML = `<div class="card"><h2>What students need</h2>
      <div class="fields"><div><span class="meta">Link for Seesaw</span><div class="break">${esc(link)}</div><button class="btn small" data-act="copy" data-text="${esc(link)}">Copy link</button></div>
      <div><span class="meta">Class code</span><div class="code">${esc(data.class.code)}</div></div></div>
      <form id="renameForm" class="row"><label for="cName" style="flex:1 1 220px">Class name<input id="cName" type="text" maxlength="40" value="${esc(keepName == null ? data.class.name : keepName)}" required autocomplete="off"></label><button class="btn" type="submit">Save name</button></form></div>
    <div class="card"><h2>My readers</h2><p class="note">Don't project this page. It shows every student's PIN.</p>
      ${rows ? `<div class="table-box"><table><tr><th>Reader</th><th>PIN</th><th class="n">Points</th><th class="n">Minutes</th><th class="n">Readings</th><th class="n">JFK Reads</th><th></th></tr>${rows}</table></div>` : `<p class="muted">No readers yet. Add your first reader above.</p>`}</div>`;
  $("renameForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (await act("teacher_class_rename", { p_name: $("cName").value })) toast("Class name saved.");
  });
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("[data-tab]");
  if (t) { tab = t.dataset.tab; confirmKey = null; render(); return; }
  const b = ev.target.closest("button[data-act]");
  if (!b) return;
  const { act: a, id } = b.dataset;
  const twoTap = key => { if (confirmKey === key) { confirmKey = null; return true; } confirmKey = key; render(); return false; };
  if (a === "approve") { if (await act("teacher_review", { p_id: id, p_status: "approved", p_spot: false })) toast("Approved. The reader moves up!"); }
  else if (a === "unapprove") await act("teacher_review", { p_id: id, p_status: "pending", p_spot: false });
  else if (a === "retry") { spot = null; if (await act("teacher_review", { p_id: id, p_status: "retry", p_spot: false })) toast("The student will see Read it again. No points lost."); }
  else if (a === "open") {
    if (openId === id) { openId = null; openWork = null; render(); return; }
    try { openWork = await rpc("teacher_submission_get", { p_token: token, p_id: id }); openId = id; render(); } catch (e) { handleError(e); }
  }
  else if (a === "spot") { spot = { id, q: Math.floor(Math.random() * QUESTIONS.length) }; tab = "check"; render(); }
  else if (a === "pick") {
    const list = data.submissions.filter(w => w.status === "pending");
    if (list.length) spot = { id: list[Math.floor(Math.random() * list.length)].id, q: Math.floor(Math.random() * QUESTIONS.length) };
    renderCheck();
  }
  else if (a === "nextq") { spot.q = (spot.q + 1) % QUESTIONS.length; renderCheck(); }
  else if (a === "pass") { spot = null; if (await act("teacher_review", { p_id: id, p_status: "approved", p_spot: true })) toast("Spot Check passed. +3"); }
  else if (a === "del") { if (twoTap("e:" + id)) await act("teacher_delete_submission", { p_id: id }); }
  else if (a === "delstudent") { if (twoTap("s:" + id)) await act("teacher_student_delete", { p_id: id }); }
  else if (a === "newpin") { if (twoTap("p:" + id)) await act("teacher_student_new_pin", { p_id: id }); }
  else if (a === "copy") {
    try { await navigator.clipboard.writeText(b.dataset.text); toast("Link copied."); } catch (e) { toast("Select the link and copy it."); }
  }
});
document.addEventListener("change", ev => {
  const j = ev.target.closest("input[data-jfk]");
  if (j) act("teacher_set_jfk", { p_id: j.dataset.jfk, p_jfk: j.checked });
  const m = ev.target.closest("input[data-minutes]");
  if (m) act("teacher_set_minutes", { p_id: m.dataset.minutes, p_minutes: Number(m.value) });
});
setInterval(() => {
  if (!token || !data || document.visibilityState !== "visible") return;
  const el = document.activeElement;
  if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
  refresh();
}, 30000);

if (token) refresh(); else showLogin("login");
