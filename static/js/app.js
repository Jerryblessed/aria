/* ═══════════════════════════════════════════════════════════════════════
   ARIA Creative Storyteller — app.js
   ═══════════════════════════════════════════════════════════════════════ */

/* ── State ────────────────────────────────────────────────────────────── */
const S = {
  token:        localStorage.getItem("aria_token") || "",
  user:         JSON.parse(localStorage.getItem("aria_user") || "null"),
  history:      [],
  timeline:     [],
  storyCtx:     {},
  attachments:  [],
  activeTab:    "chat",
  presenting:   false,
  presIdx:      0,
  presTimer:    null,
  presAudio:    null,
  projectId:    null,
  projectName:  "Untitled Project",
  pendingJobs:  {},  // jid → {type, sceneIdx}
  capturedFrame:null, // {frame_id, source}
  resetToken:   new URLSearchParams(location.search).get("reset"),
  googleClientId: "",
};

/* ── DOM refs ─────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const q = s  => document.querySelector(s);

/* ── Toast ────────────────────────────────────────────────────────────── */
function toast(msg, type = "info", dur = 3200) {
  const el = document.createElement("div");
  el.className = `tn ${type}`;
  el.textContent = msg;
  $("toast").appendChild(el);
  setTimeout(() => el.remove(), dur);
}

/* ── Token helpers ────────────────────────────────────────────────────── */
function authHeaders() {
  return { "Content-Type": "application/json", "X-Token": S.token };
}
function saveSession(data) {
  S.token = data.token;
  S.user  = data.user;
  localStorage.setItem("aria_token", S.token);
  localStorage.setItem("aria_user",  JSON.stringify(S.user));
  renderUserBadge();
}
function clearSession() {
  S.token = ""; S.user = null;
  localStorage.removeItem("aria_token");
  localStorage.removeItem("aria_user");
  renderUserBadge();
}

/* ── Theme ────────────────────────────────────────────────────────────── */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("aria_theme", t);
  $("themeBtn").textContent = t === "dark" ? "☀" : "🌙";
}
(function initTheme() {
  applyTheme(localStorage.getItem("aria_theme") || "dark");
})();
$("themeBtn").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
$("umTheme").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  closeUserMenu();
});

/* ── User badge / menu ────────────────────────────────────────────────── */
function renderUserBadge() {
  const signed = !!(S.token && S.user);
  $("navSignInBtn").classList.toggle("hidden", signed);
  $("userBadge").classList.toggle("on", signed);
  if (signed) {
    const initials = (S.user.name || S.user.email || "U").slice(0, 2).toUpperCase();
    $("userInitial").textContent = initials;
    $("userName").textContent    = S.user.name || S.user.email || "";
    $("umEmail").textContent     = S.user.email || "";
    $("pBtn").style.display      = "flex";
  } else {
    $("pBtn").style.display = "none";
  }
}
function closeUserMenu() { $("userMenu").classList.remove("on"); }
$("userBadge").addEventListener("click", e => {
  e.stopPropagation();
  $("userMenu").classList.toggle("on");
});
document.addEventListener("click", e => {
  if (!$("userMenu").contains(e.target) && e.target !== $("userBadge")) closeUserMenu();
});
$("navSignInBtn").addEventListener("click", () => openAuthModal("login"));
$("umSignOut").addEventListener("click", () => { clearSession(); closeUserMenu(); toast("Signed out", "info"); });
$("umInterests").addEventListener("click", () => { closeUserMenu(); openInterestModal(); });
$("umProjects").addEventListener("click", () => { closeUserMenu(); openProjectsModal(); });
$("umRecordings").addEventListener("click", () => { closeUserMenu(); loadVoiceRecordings(); if (!$("voicePanel").classList.contains("on")) toggleVoicePanel(); $("vpRecs").classList.add("on"); });

/* ── Auth modal ───────────────────────────────────────────────────────── */
function openAuthModal(tab = "login") {
  $("authModal").classList.add("on");
  setAuthTab(tab);
  if (S.resetToken) showResetForm();
}
function closeAuthModal() {
  $("authModal").classList.remove("on");
  ["loginErr","regErr","forgotErr","resetErr"].forEach(id => { $(id).classList.remove("on"); $(id).textContent = ""; });
  ["forgotOk","resetOk"].forEach(id => { $(id).classList.remove("on"); });
}
function setAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("on", t.dataset.auth === tab));
  $("authLoginForm").style.display  = tab === "login" ? "" : "none";
  $("authRegForm").style.display    = tab === "register" ? "" : "none";
  $("authForgotForm").style.display = "none";
}
function showResetForm() {
  $("authLoginForm").style.display = "none";
  $("authRegForm").style.display   = "none";
  $("authForgotForm").style.display= "none";
  $("authResetForm").style.display = "";
}
$("authClose").addEventListener("click", closeAuthModal);
$("authModal").addEventListener("click", e => { if (e.target === $("authModal")) closeAuthModal(); });
document.querySelectorAll(".auth-tab").forEach(t => t.addEventListener("click", () => setAuthTab(t.dataset.auth)));
$("forgotLink").addEventListener("click", () => {
  $("authLoginForm").style.display = "none";
  $("authForgotForm").style.display = "";
});
$("backToLogin").addEventListener("click", () => setAuthTab("login"));

/* ── Email/password auth ──────────────────────────────────────────────── */
async function authPost(endpoint, body, errId, btnId) {
  const btn = $(btnId);
  btn.disabled = true;
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { showErr(errId, d.error || "Error"); return null; }
    return d;
  } catch (e) {
    showErr(errId, "Network error");
    return null;
  } finally { btn.disabled = false; }
}
function showErr(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
}

$("loginSubmit").addEventListener("click", async () => {
  const d = await authPost("/api/auth/login", { email: $("loginEmail").value.trim(), password: $("loginPw").value }, "loginErr", "loginSubmit");
  if (d) { saveSession(d); closeAuthModal(); toast(`Welcome back, ${d.user.name || d.user.email}!`, "ok"); }
});
$("regSubmit").addEventListener("click", async () => {
  const d = await authPost("/api/auth/register", { name: $("regName").value.trim(), email: $("regEmail").value.trim(), password: $("regPw").value }, "regErr", "regSubmit");
  if (d) { saveSession(d); closeAuthModal(); if (d.user.is_new) openInterestModal(); toast("Account created!", "ok"); }
});
$("forgotSubmit").addEventListener("click", async () => {
  $("forgotSubmit").disabled = true;
  const r = await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("forgotEmail").value.trim() }) });
  $("forgotSubmit").disabled = false;
  const d = await r.json();
  $("forgotOk").textContent = d.message || "Check your inbox!";
  $("forgotOk").classList.add("on");
});
$("resetSubmit").addEventListener("click", async () => {
  const d = await authPost("/api/auth/reset-password", { token: S.resetToken, password: $("resetPw").value }, "resetErr", "resetSubmit");
  if (d) {
    $("resetOk").textContent = d.message;
    $("resetOk").classList.add("on");
    history.replaceState({}, "", location.pathname);
    S.resetToken = null;
    setTimeout(() => { closeAuthModal(); setAuthTab("login"); }, 2000);
  }
});
// Enter key support
["loginPw","loginEmail"].forEach(id => {
  $(id) && $(id).addEventListener("keydown", e => { if (e.key === "Enter") $("loginSubmit").click(); });
});

/* ── Google Sign-In ───────────────────────────────────────────────────── */
async function initGoogleSignIn() {
  try {
    const r = await fetch("/api/config");
    const d = await r.json();
    S.googleClientId = d.google_client_id || "";
  } catch (_) {}
  if (!S.googleClientId) return;

  function handleGoogleCred(resp) {
    googleAuthWithToken(resp.credential);
  }
  window.handleGoogleCredential = handleGoogleCred;

  if (window.google && window.google.accounts) {
    google.accounts.id.initialize({ client_id: S.googleClientId, callback: handleGoogleCred, auto_select: false });
  }
}

async function googleAuthWithToken(id_token) {
  const btns = [$("googleSignInBtn"), $("googleRegBtn")];
  btns.forEach(b => b && (b.disabled = true));
  try {
    const r = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_token }) });
    const d = await r.json();
    if (!r.ok) { toast(d.error || "Google sign-in failed", "err"); return; }
    saveSession(d);
    closeAuthModal();
    toast(`Welcome${d.user.is_new ? "" : " back"}, ${d.user.name || d.user.email}!`, "ok");
    if (d.user.is_new) openInterestModal();
    loadTemplates();
  } catch (e) {
    toast("Google sign-in error", "err");
  } finally {
    btns.forEach(b => b && (b.disabled = false));
  }
}

function triggerGoogleSignIn() {
  if (!S.googleClientId) { toast("Google Sign-In not configured", "err"); return; }
  if (window.google && window.google.accounts) {
    google.accounts.id.prompt(n => {
      if (n.isNotDisplayed() || n.isSkippedMoment()) {
        google.accounts.id.renderButton(document.createElement("div"), { theme: "outline", size: "large" });
      }
    });
  }
}
$("googleSignInBtn").addEventListener("click", triggerGoogleSignIn);
$("googleRegBtn").addEventListener("click",    triggerGoogleSignIn);

/* ── Interest modal ───────────────────────────────────────────────────── */
const INTEREST_OPTIONS = [
  { id: "biblical",    icon: "✝️",  label: "Biblical / Faith" },
  { id: "parable",     icon: "📖",  label: "Parables" },
  { id: "redemption",  icon: "🌅",  label: "Redemption" },
  { id: "family",      icon: "👨‍👩‍👧", label: "Family" },
  { id: "children",    icon: "🧸",  label: "Children" },
  { id: "adventure",   icon: "⚔️",  label: "Adventure" },
  { id: "action",      icon: "🔥",  label: "Action" },
  { id: "mystery",     icon: "🔍",  label: "Mystery" },
  { id: "nature",      icon: "🌿",  label: "Nature" },
  { id: "documentary", icon: "🎬",  label: "Documentary" },
  { id: "journalism",  icon: "📰",  label: "Journalism" },
  { id: "education",   icon: "📚",  label: "Education" },
  { id: "marketing",   icon: "📣",  label: "Marketing" },
  { id: "social",      icon: "📱",  label: "Social Media" },
  { id: "fiction",     icon: "🪄",  label: "Fiction" },
  { id: "thriller",    icon: "😰",  label: "Thriller" },
];

function openInterestModal() {
  $("interestModal").classList.add("on");
  const sel = (S.user && S.user.interests) || [];
  const grid = $("intGrid");
  grid.innerHTML = "";
  INTEREST_OPTIONS.forEach(opt => {
    const chip = document.createElement("div");
    chip.className = "int-chip" + (sel.includes(opt.id) ? " sel" : "");
    chip.dataset.id = opt.id;
    chip.innerHTML = `<span class="int-chip-icon">${opt.icon}</span><span class="int-chip-label">${opt.label}</span>`;
    chip.addEventListener("click", () => {
      chip.classList.toggle("sel");
      const cnt = $("intGrid").querySelectorAll(".int-chip.sel").length;
      $("intCount").textContent = cnt;
      $("intDone").disabled = cnt === 0;
    });
    grid.appendChild(chip);
  });
  const cnt = sel.length;
  $("intCount").textContent = cnt;
  $("intDone").disabled = cnt === 0;
}
$("intDone").addEventListener("click", async () => {
  const interests = [...$("intGrid").querySelectorAll(".int-chip.sel")].map(c => c.dataset.id);
  if (S.token) {
    await fetch("/api/auth/interests", { method: "POST", headers: authHeaders(), body: JSON.stringify({ token: S.token, interests }) });
  }
  if (S.user) S.user.interests = interests;
  localStorage.setItem("aria_user", JSON.stringify(S.user));
  $("interestModal").classList.remove("on");
  loadTemplates();
  toast("Interests saved!", "ok");
});
$("interestModal").addEventListener("click", e => { if (e.target === $("interestModal")) $("interestModal").classList.remove("on"); });

/* ═══════════════════════════════════════════════════════════════════════
   TEMPLATES
   ═══════════════════════════════════════════════════════════════════════ */
async function loadTemplates() {
  const interests = (S.user && S.user.interests) || [];
  const qs = interests.length ? "?interests=" + interests.join(",") : "";
  try {
    const r = await fetch("/api/templates" + qs);
    const d = await r.json();
    renderTemplates(d.templates || []);
    renderInterestFilter(interests);
  } catch (_) {
    $("igGrid").innerHTML = `<div class="ig-load">Could not load templates.</div>`;
  }
}

function renderInterestFilter(active) {
  const bar = $("interestFilterBar");
  if (!active.length) { bar.classList.remove("on"); return; }
  bar.classList.add("on");
  bar.innerHTML = `<div class="ifchip active" data-filter="">All</div>` +
    active.map(i => {
      const opt = INTEREST_OPTIONS.find(o => o.id === i);
      return `<div class="ifchip" data-filter="${i}">${opt ? opt.icon + " " + opt.label : i}</div>`;
    }).join("");
  bar.querySelectorAll(".ifchip").forEach(chip => {
    chip.addEventListener("click", () => {
      bar.querySelectorAll(".ifchip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const f = chip.dataset.filter;
      document.querySelectorAll(".icard").forEach(card => {
        card.style.display = (!f || (card.dataset.interests || "").includes(f)) ? "" : "none";
      });
    });
  });
}

function renderTemplates(templates) {
  const grid = $("igGrid");
  if (!templates.length) { grid.innerHTML = `<div class="ig-load">No templates found.</div>`; return; }
  grid.innerHTML = templates.map(t => `
    <div class="icard" data-id="${t.id}" data-interests="${(t.interests||[]).join(",")}">
      <div class="icard-img-wrap">
        <img class="icard-img" src="${t.img}" alt="${t.title}" loading="lazy"/>
        <div class="anim-overlay anim-${t.animation || 'aurora-sweep'}"></div>
        ${t.badge ? `<div class="icard-badge${t.badge==='Live'?' live':''}">${t.badge}</div>` : ""}
      </div>
      <div class="icard-body">
        <div class="icard-tag">${t.tag}</div>
        <div class="icard-title">${t.emoji || ""} ${t.title}</div>
        <div class="icard-desc">${t.desc}</div>
        <button class="icard-btn">Use Template</button>
      </div>
    </div>`).join("");
  grid.querySelectorAll(".icard").forEach(card => {
    card.addEventListener("click", () => useTemplate(card.dataset.id));
  });
}

async function useTemplate(tid) {
  try {
    const r = await fetch(`/api/templates/${tid}`);
    const d = await r.json();
    const t = d.template;
    if (!t) return;
    hideInsGrid();
    showChatTab();
    setInputVal(t.prompt || `Create a story using the ${t.title} template.`);
    if (t.style_seed) S.storyCtx.style_seed = t.style_seed;
    showCtxBar(`Template: ${t.title}`);
    toast(`Template loaded: ${t.title}`, "ok");
    $("msgInput").focus();
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════════════════
   TABS & NAV
   ═══════════════════════════════════════════════════════════════════════ */
function showChatTab()     { setActiveTab("chat"); }
function showTimelineTab() { setActiveTab("timeline"); }

function setActiveTab(tab) {
  S.activeTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === tab));
  $("stream").classList.toggle("hide", tab !== "chat");
  $("tlPanel").classList.toggle("on", tab === "timeline");
}
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setActiveTab(t.dataset.tab)));

function showInsGrid()  { $("insGrid").classList.add("on"); $("splash").classList.add("gone"); }
function hideInsGrid()  { $("insGrid").classList.remove("on"); }
function showCtxBar(txt) { $("ctxBar").classList.add("on"); $("ctxTxt").textContent = txt; }
function hideCtxBar()    { $("ctxBar").classList.remove("on"); $("ctxTxt").textContent = ""; }
$("ctxClear").addEventListener("click", () => { hideCtxBar(); S.capturedFrame = null; });

/* ═══════════════════════════════════════════════════════════════════════
   CHAT
   ═══════════════════════════════════════════════════════════════════════ */
function setInputVal(v) { $("msgInput").value = v; updateSendBtn(); }

function updateSendBtn() {
  const hasText = $("msgInput").value.trim().length > 0;
  const hasAtt  = S.attachments.length > 0;
  $("sendBtn").style.display = (hasText || hasAtt) ? "flex" : "none";
}
$("msgInput").addEventListener("input", updateSendBtn);
$("msgInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$("sendBtn").addEventListener("click", sendMessage);

function appendMsg(role, content) {
  const div = document.createElement("div");
  div.className = `mb ${role}`;
  if (role === "aria") div.innerHTML = `<div class="albl">✦ ARIA</div>${escHtml(content)}`;
  else               div.textContent = content;
  $("stream").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return div;
}

function appendClarify(ariaMsg, questions) {
  const div = document.createElement("div");
  div.className = "mb aria clarify";
  div.innerHTML = `<div class="albl cq">✦ ARIA — Clarifying</div>${escHtml(ariaMsg)}` +
    (questions.length ? `<br/>${questions.map(q => `<span class="qdot">→</span> ${escHtml(q)}`).join("<br/>")}` : "");
  $("stream").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function appendTyping() {
  const div = document.createElement("div");
  div.className = "mb aria dots-anim";
  div.innerHTML = `<div class="albl">✦ ARIA</div>Thinking…`;
  $("stream").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return div;
}

async function sendMessage() {
  const msg = $("msgInput").value.trim();
  if (!msg && !S.attachments.length) return;

  hideInsGrid();
  hideSplash();
  showChatTab();

  if (msg) appendMsg("user", msg);
  S.history.push({ role: "user", content: msg });
  $("msgInput").value = "";
  updateSendBtn();

  const attachCopy = [...S.attachments];
  clearAttachments();

  const typingEl = appendTyping();
  try {
    const body = {
      message:       msg,
      history:       S.history,
      story_context: S.storyCtx,
      has_files:     attachCopy.length > 0,
      image_b64:     attachCopy.find(a => a.type === "image")?.b64 || "",
      frame_id:      S.capturedFrame?.frame_id || "",
      use_search:    true,
    };
    const r = await fetch("/api/chat", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6);
        if (raw === "[DONE]") break;
        try {
          const ev = JSON.parse(raw);
          if (ev.ok && ev.payload) handleAriaPayload(ev.payload, typingEl);
          else if (!ev.ok) { typingEl.textContent = ev.payload?.aria_message || "Something went wrong."; }
        } catch (_) {}
      }
    }
  } catch (err) {
    typingEl.innerHTML = `<div class="albl">✦ ARIA</div>Error: ${escHtml(err.message)}`;
  }
  S.capturedFrame = null;
  hideCtxBar();
}

function handleAriaPayload(p, typingEl) {
  const ariaMsg = p.aria_message || "";
  S.history.push({ role: "assistant", content: ariaMsg });

  if (p.story_context) S.storyCtx = { ...S.storyCtx, ...p.story_context };

  if (p.mode === "clarify") {
    typingEl.remove();
    appendClarify(ariaMsg, p.clarifying_questions || []);
    return;
  }

  typingEl.innerHTML = `<div class="albl">✦ ARIA</div>${escHtml(ariaMsg)}`;

  const item = p.timeline_item;
  if (!item) return;

  const sceneIdx = S.timeline.length;
  const scene = {
    id:           `scene_${Date.now()}_${sceneIdx}`,
    title:        item.title || `Scene ${sceneIdx + 1}`,
    narration:    item.narration || "",
    prompt:       item.generation_prompt || "",
    style_seed:   item.style_seed || S.storyCtx.style_seed || "",
    aspect_ratio: item.aspect_ratio || "16:9",
    text_overlay: item.text_overlay || "",
    sort_order:   item.sort_order ?? sceneIdx,
    duration:     item.duration_seconds || 8,
    media_type:   null, media_path: null, job_id: null, _prog: 0,
  };
  S.timeline.push(scene);
  renderTimeline();
  showTimelineTab();

  const mode = p.mode;
  if (mode === "generate_image" || mode === "generate_video") {
    const type = mode === "generate_image" ? "image" : "video";
    dispatchGenerate(sceneIdx, type);
  } else if (mode === "generate_text_scene") {
    scene.media_type = "text";
    renderTimeline();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   ATTACHMENTS
   ═══════════════════════════════════════════════════════════════════════ */
$("attachBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", e => {
  const files = [...e.target.files];
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = ev => {
      S.attachments.push({ name: f.name, type: f.type.startsWith("video") ? "video" : "image", b64: ev.target.result.split(",")[1], full: ev.target.result });
      renderAttachRow();
      updateSendBtn();
    };
    reader.readAsDataURL(f);
  });
  e.target.value = "";
});

function renderAttachRow() {
  const row = $("attachRow");
  if (!S.attachments.length) { row.style.display = "none"; return; }
  row.style.display = "flex";
  row.innerHTML = S.attachments.map((a, i) =>
    `<div class="att-item">
      ${a.type === "image" ? `<img src="${a.full}" alt="${a.name}"/>` : "🎬"}
      <span>${a.name.slice(0, 16)}</span>
      <span class="arm" data-i="${i}">✕</span>
    </div>`
  ).join("");
  row.querySelectorAll(".arm").forEach(el => {
    el.addEventListener("click", () => { S.attachments.splice(+el.dataset.i, 1); renderAttachRow(); updateSendBtn(); });
  });
}
function clearAttachments() { S.attachments = []; renderAttachRow(); updateSendBtn(); }

/* ═══════════════════════════════════════════════════════════════════════
   TIMELINE
   ═══════════════════════════════════════════════════════════════════════ */
function renderTimeline() {
  const panel = $("tlPanel");
  if (!S.timeline.length) { panel.innerHTML = `<div style="color:var(--mu3);font-size:.75rem;text-align:center;padding:30px">No scenes yet — chat with ARIA to generate your story</div>`; return; }
  panel.innerHTML = S.timeline.map((sc, i) => buildSceneCard(sc, i)).join("");
  panel.querySelectorAll(".tc").forEach((card, i) => {
    card.addEventListener("click", e => {
      if (e.target.closest(".tc-acts,.narr-edit,.edit-btns")) return;
      if (S.presenting) jumpToScene(i);
    });
  });
  panel.querySelectorAll("[data-scene-act]").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); handleSceneAct(btn.dataset.sceneAct, +btn.dataset.i); });
  });
  panel.querySelectorAll(".narr-edit").forEach(ta => {
    ta.addEventListener("input", () => { S.timeline[+ta.dataset.i].narration = ta.value; });
  });
  panel.querySelectorAll("[data-narr-save]").forEach(btn => {
    btn.addEventListener("click", () => saveNarrationEdit(+btn.dataset.narrSave));
  });
  panel.querySelectorAll("[data-narr-cancel]").forEach(btn => {
    btn.addEventListener("click", () => renderTimeline());
  });
}

function buildSceneCard(sc, i) {
  const done = sc.media_path && !sc.job_id;
  const gen  = !!sc.job_id;
  const err  = sc._error;
  const txt  = sc.media_type === "text";
  let badgeCls = "", badgeTxt = "";
  if (err)       { badgeCls = "err";  badgeTxt = "Error"; }
  else if (gen)  { badgeCls = "gen";  badgeTxt = sc.media_type === "video" ? "Generating Video…" : "Generating Image…"; }
  else if (done) { badgeCls = "done"; badgeTxt = sc.media_type === "video" ? "▶ Video Ready" : "✓ Image Ready"; }
  else if (txt)  { badgeCls = "txt";  badgeTxt = "✦ Text Scene"; }

  let thumb = "";
  if (gen) {
    thumb = `<div class="sk sk-img"></div><div class="prog-bar"><div class="prog-fill" style="width:${sc._prog||0}%"></div></div>`;
  } else if (done && sc.media_type === "image") {
    thumb = `<img class="tthumb" src="${sc.media_path}" loading="lazy"/>`;
  } else if (done && sc.media_type === "video") {
    thumb = `<video class="tthumb" src="${sc.media_path}" muted playsinline preload="none"></video>`;
  }

  return `<div class="tc${S.presIdx === i && S.presenting ? " presenting" : ""}" data-scene-i="${i}">
    <div class="tnum">${i + 1}</div>
    ${badgeTxt ? `<div class="tbadge ${badgeCls}">${badgeTxt}</div>` : ""}
    ${thumb}
    <div class="ttl">${escHtml(sc.title)}</div>
    <div class="tnarr">${escHtml(sc.narration)}</div>
    <textarea class="narr-edit" data-i="${i}" rows="3" style="display:none">${escHtml(sc.narration)}</textarea>
    <div class="edit-btns" style="display:none">
      <button class="ebtn save" data-narr-save="${i}">Save</button>
      <button class="ebtn cancel" data-narr-cancel="${i}">Cancel</button>
    </div>
    <div class="tc-acts">
      ${done ? `<button class="tact" data-scene-act="preview" data-i="${i}">👁 Preview</button>` : ""}
      <button class="tact" data-scene-act="edit-narr" data-i="${i}">✏ Narration</button>
      ${sc.prompt ? `<button class="tact" data-scene-act="regen" data-i="${i}">↻ Regenerate</button>` : ""}
      <button class="tact" data-scene-act="delete" data-i="${i}">🗑 Delete</button>
    </div>
  </div>`;
}

function handleSceneAct(act, i) {
  const sc = S.timeline[i];
  if (act === "preview")   { presentSingle(i); return; }
  if (act === "delete")    { S.timeline.splice(i, 1); renderTimeline(); return; }
  if (act === "regen")     { dispatchGenerate(i, sc.media_type || "image"); return; }
  if (act === "edit-narr") { toggleNarrEdit(i); return; }
}

function toggleNarrEdit(i) {
  const card = $("tlPanel").querySelector(`[data-scene-i="${i}"]`);
  if (!card) return;
  const ta   = card.querySelector(".narr-edit");
  const btns = card.querySelector(".edit-btns");
  const isOpen = ta.style.display !== "none";
  ta.style.display   = isOpen ? "none" : "";
  btns.style.display = isOpen ? "none" : "";
  if (!isOpen) { ta.value = S.timeline[i].narration; ta.focus(); }
}

async function saveNarrationEdit(i) {
  const sc = S.timeline[i];
  try {
    const r = await fetch("/api/narration/edit", { method: "POST", headers: authHeaders(), body: JSON.stringify({ mode: "ai", text: sc.narration, scene_title: sc.title }) });
    const d = await r.json();
    if (d.narration) sc.narration = d.narration;
  } catch (_) {}
  renderTimeline();
  toast("Narration updated", "ok");
}

/* ═══════════════════════════════════════════════════════════════════════
   GENERATION
   ═══════════════════════════════════════════════════════════════════════ */
async function dispatchGenerate(sceneIdx, type) {
  const sc = S.timeline[sceneIdx];
  sc._error = null;
  const payload = {
    prompt:          sc.prompt,
    aspect_ratio:    sc.aspect_ratio,
    style_seed:      sc.style_seed,
    duration:        sc.duration,
    reference_image: S.attachments.find(a => a.type === "image")?.b64 || "",
    frame_id:        S.capturedFrame?.frame_id || "",
    resolution:      "1K",
  };
  try {
    const r = await fetch(`/api/generate/${type}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    const d = await r.json();
    sc.job_id     = d.job_id;
    sc.media_type = type;
    renderTimeline();
    pollJob(d.job_id, sceneIdx);
  } catch (err) {
    sc._error = err.message;
    renderTimeline();
    toast(`Generation failed: ${err.message}`, "err");
  }
}

async function pollJob(jid, sceneIdx) {
  const poll = async () => {
    try {
      const r = await fetch(`/api/job/${jid}`);
      const d = await r.json();
      const sc = S.timeline[sceneIdx];
      if (!sc) return;
      sc._prog = d.progress || 0;
      if (d.status === "done") {
        sc.job_id     = null;
        sc.media_path = `/api/media/${jid}`;
        sc._prog      = 100;
        renderTimeline();
        toast(`✓ ${sc.title} ready`, "ok");
        return;
      }
      if (d.status === "error") {
        sc.job_id  = null;
        sc._error  = d.error || "Generation failed";
        renderTimeline();
        toast(`Error: ${sc._error}`, "err");
        return;
      }
      // Update progress bar without full re-render
      const card = $("tlPanel").querySelector(`[data-scene-i="${sceneIdx}"]`);
      if (card) { const pf = card.querySelector(".prog-fill"); if (pf) pf.style.width = sc._prog + "%"; }
      setTimeout(poll, 3000);
    } catch (_) { setTimeout(poll, 5000); }
  };
  setTimeout(poll, 2000);
}

/* ═══════════════════════════════════════════════════════════════════════
   PRESENTATION
   ═══════════════════════════════════════════════════════════════════════ */
$("pBtn").addEventListener("click", () => {
  if (!S.timeline.length) { toast("No scenes yet — generate some content first", "info"); return; }
  startPresentation();
});
$("stopPresBtn").addEventListener("click", stopPresentation);

function startPresentation(idx = 0) {
  S.presenting = true;
  S.presIdx    = idx;
  $("stage").classList.add("on");
  $("expPanel").classList.add("on");
  $("prgBar").classList.add("on");
  renderTimeline();
  showScene(idx);
}

function stopPresentation() {
  S.presenting = false;
  clearTimeout(S.presTimer);
  if (S.presAudio) { S.presAudio.pause(); S.presAudio = null; }
  $("stage").classList.remove("on");
  $("expPanel").classList.remove("on");
  $("prgBar").classList.remove("on");
  $("narr").classList.remove("on");
  renderTimeline();
}

function presentSingle(i) {
  startPresentation(i);
  clearTimeout(S.presTimer);
}

function jumpToScene(i) {
  clearTimeout(S.presTimer);
  if (S.presAudio) { S.presAudio.pause(); S.presAudio = null; }
  S.presIdx = i;
  showScene(i);
}

async function showScene(i) {
  const sc = S.timeline[i];
  if (!sc) { stopPresentation(); return; }
  S.presIdx = i;
  const pct = S.timeline.length > 1 ? (i / (S.timeline.length - 1)) * 100 : 100;
  $("prgFill").style.width = pct + "%";

  // Hide all media
  ["sImg","sVid","sTxt"].forEach(id => { $(id).style.display = "none"; });
  $("stageLoad").classList.add("on");

  const dur = (sc.duration || 8) * 1000;

  if (sc.media_path && sc.media_type === "image") {
    const img = $("sImg");
    img.src = sc.media_path;
    img.onload = () => { $("stageLoad").classList.remove("on"); img.style.display = "block"; };
    img.onerror = () => { $("stageLoad").classList.remove("on"); showTextScene(sc); };
  } else if (sc.media_path && sc.media_type === "video") {
    const vid = $("sVid");
    vid.src = sc.media_path;
    vid.style.display = "block";
    $("stageLoad").classList.remove("on");
  } else {
    $("stageLoad").classList.remove("on");
    showTextScene(sc);
  }

  // Narration
  if (sc.narration) {
    $("ntxt").textContent = sc.narration;
    $("narr").classList.add("on");
    await playNarration(sc.narration);
  } else {
    $("narr").classList.remove("on");
  }

  renderTimeline();
  S.presTimer = setTimeout(() => {
    const next = i + 1;
    if (next < S.timeline.length && S.presenting) showScene(next);
    else if (S.presenting) { $("narr").classList.remove("on"); }
  }, dur);
}

function showTextScene(sc) {
  $("sTxtContent").textContent = sc.title + (sc.narration ? "\n\n" + sc.narration : "");
  $("sTxt").style.display = "block";
}

async function playNarration(script) {
  if (S.presAudio) { S.presAudio.pause(); S.presAudio = null; }
  try {
    const r = await fetch("/api/narrate", { method: "POST", headers: authHeaders(), body: JSON.stringify({ script }) });
    const d = await r.json();
    if (d.audio) {
      const audio = new Audio(d.audio);
      S.presAudio = audio;
      await audio.play().catch(() => {});
    }
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════════════════════ */
$("expVidBtn").addEventListener("click", exportVideo);
$("expYtBtn").addEventListener("click",  exportYouTube);

async function exportVideo() {
  const items = S.timeline.filter(sc => sc.narration || sc.media_path).map(sc => ({
    title:       sc.title,
    narration:   sc.narration,
    media_path:  sc.media_path,
    media_type:  sc.media_type,
    duration:    sc.duration || 8,
  }));
  if (!items.length) { toast("Nothing to export", "err"); return; }

  const modal = $("videoExportModal");
  modal.classList.add("on");
  $("vexpDl").style.display  = "none";
  $("vexpErr").classList.remove("on");
  $("vexpPct").textContent   = "0%";
  $("vexpFill").style.width  = "0%";
  $("vexpMsg").textContent   = "Submitting…";

  try {
    const r = await fetch("/api/export/video", { method: "POST", headers: authHeaders(), body: JSON.stringify({ items }) });
    const d = await r.json();
    if (!d.job_id) throw new Error(d.error || "No job ID");
    pollExportJob(d.job_id);
  } catch (err) {
    $("vexpErr").textContent = err.message;
    $("vexpErr").classList.add("on");
  }
}

function pollExportJob(jid) {
  const poll = async () => {
    const r = await fetch(`/api/job/${jid}`);
    const d = await r.json();
    const pct = d.progress || 0;
    $("vexpPct").textContent  = pct + "%";
    $("vexpFill").style.width = pct + "%";
    $("vexpMsg").textContent  = d.status === "running" ? "Rendering…" : d.status === "done" ? "Done!" : d.status;
    if (d.status === "done") {
      $("vexpDl").style.display = "inline-block";
      $("vexpDl").onclick = () => { window.open(`/api/media/${jid}`, "_blank"); };
      $("vexpRing").style.animation = "none";
      return;
    }
    if (d.status === "error") {
      $("vexpErr").textContent = d.error || "Export failed";
      $("vexpErr").classList.add("on");
      return;
    }
    setTimeout(poll, 3000);
  };
  setTimeout(poll, 2000);
}
$("vexpClose").addEventListener("click", () => $("videoExportModal").classList.remove("on"));

async function exportYouTube() {
  const items = S.timeline.map(sc => ({ title: sc.title, narration: sc.narration }));
  try {
    const r = await fetch("/api/export/youtube", { method: "POST", headers: authHeaders(), body: JSON.stringify({ project_title: S.projectName, items }) });
    const d = await r.json();
    $("ytTitle").textContent        = d.title;
    $("ytDesc").textContent         = d.description;
    $("ytTags").textContent         = (d.tags || []).join(", ");
    $("ytInstructions").textContent = d.instructions;
    $("ytModal").classList.add("on");
  } catch (err) { toast("Error: " + err.message, "err"); }
}
$("ytClose").addEventListener("click",  () => $("ytModal").classList.remove("on"));
$("ytOpenBtn").addEventListener("click",() => window.open("https://studio.youtube.com", "_blank"));
$("ytModal").addEventListener("click",  e => { if (e.target === $("ytModal")) $("ytModal").classList.remove("on"); });

/* ═══════════════════════════════════════════════════════════════════════
   PROJECTS
   ═══════════════════════════════════════════════════════════════════════ */
$("projBtn").addEventListener("click", openProjectsModal);

function openProjectsModal() {
  if (!S.token) { openAuthModal(); toast("Sign in to manage projects", "info"); return; }
  $("projectsModal").classList.add("on");
  loadProjects();
}
$("projModalClose").addEventListener("click", () => $("projectsModal").classList.remove("on"));
$("projectsModal").addEventListener("click", e => { if (e.target === $("projectsModal")) $("projectsModal").classList.remove("on"); });

async function loadProjects() {
  $("projList").innerHTML = `<div class="proj-empty">Loading…</div>`;
  try {
    const r = await fetch("/api/projects", { headers: authHeaders() });
    const d = await r.json();
    renderProjectsList(d.projects || []);
  } catch (_) { $("projList").innerHTML = `<div class="proj-empty">Could not load projects.</div>`; }
}

function renderProjectsList(projects) {
  if (!projects.length) { $("projList").innerHTML = `<div class="proj-empty">No saved projects yet.<br/>Start a story and save it!</div>`; return; }
  $("projList").innerHTML = projects.map(p => {
    const sceneCount = (p.timeline || []).length;
    const date       = new Date((p.updated_at || 0) * 1000).toLocaleDateString();
    return `<div class="proj-item${p.id === S.projectId ? " active" : ""}" data-pid="${p.id}">
      <div class="proj-item-icon">📖</div>
      <div class="proj-item-info">
        <div class="proj-item-name" id="pname_${p.id}">${escHtml(p.name)}</div>
        <div class="proj-item-meta">${sceneCount} scene${sceneCount !== 1 ? "s" : ""} · ${date}</div>
      </div>
      <div class="proj-item-acts">
        <button class="pact" data-pact="load"  data-pid="${p.id}">Open</button>
        <button class="pact" data-pact="dup"   data-pid="${p.id}">Dup</button>
        <button class="pact del" data-pact="del" data-pid="${p.id}">Del</button>
      </div>
    </div>`;
  }).join("");
  $("projList").querySelectorAll("[data-pact]").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); handleProjectAct(btn.dataset.pact, btn.dataset.pid); });
  });
}

async function handleProjectAct(act, pid) {
  if (act === "load") { await loadProject(pid); $("projectsModal").classList.remove("on"); }
  if (act === "del")  { await deleteProject(pid); loadProjects(); }
  if (act === "dup")  { await duplicateProject(pid); loadProjects(); }
}

async function loadProject(pid) {
  const r = await fetch("/api/projects", { headers: authHeaders() });
  const d = await r.json();
  const p = (d.projects || []).find(x => x.id === pid);
  if (!p) return;
  S.timeline    = p.timeline || [];
  S.history     = p.history  || [];
  S.storyCtx    = p.story_context || {};
  S.projectId   = pid;
  S.projectName = p.name;
  hideInsGrid();
  showTimelineTab();
  renderTimeline();
  toast(`Loaded: ${p.name}`, "ok");
}

async function saveCurrentProject() {
  if (!S.token) { openAuthModal(); toast("Sign in to save projects", "info"); return; }
  const r = await fetch("/api/projects/save", {
    method: "POST", headers: authHeaders(),
    body: JSON.stringify({ id: S.projectId, name: S.projectName, timeline: S.timeline, history: S.history, story_context: S.storyCtx }),
  });
  const d = await r.json();
  if (d.id) { S.projectId = d.id; toast("Project saved!", "ok"); }
}

async function deleteProject(pid) {
  await fetch(`/api/projects/${pid}`, { method: "DELETE", headers: authHeaders() });
  if (pid === S.projectId) { S.projectId = null; S.projectName = "Untitled Project"; }
  toast("Project deleted", "info");
}

async function duplicateProject(pid) {
  const r = await fetch(`/api/projects/${pid}/duplicate`, { method: "POST", headers: authHeaders() });
  const d = await r.json();
  if (d.id) toast("Project duplicated", "ok");
}

$("projNewBtn").addEventListener("click", () => {
  S.timeline = []; S.history = []; S.storyCtx = {};
  S.projectId = null; S.projectName = "Untitled Project";
  $("projectsModal").classList.remove("on");
  renderTimeline();
  $("stream").innerHTML = "";
  showInsGrid();
  toast("New project started", "ok");
});
$("projSaveCurrentBtn").addEventListener("click", saveCurrentProject);

/* ═══════════════════════════════════════════════════════════════════════
   LIVE VOICE
   ═══════════════════════════════════════════════════════════════════════ */
let ws = null, audioCtx = null, micStream = null, micNode = null;
let cameraStream = null, screenStream = null;
let frameInterval = null;
let mediaRecorder = null, recChunks = [], recStart = null, recInterval = null;
let vpMinimized = false;

function toggleVoicePanel() {
  const panel = $("voicePanel");
  const isOn  = panel.classList.contains("on");
  if (!isOn) { panel.classList.add("on"); if (!ws || ws.readyState > 1) connectLive(); }
  else        { panel.classList.remove("on"); disconnectLive(); }
  $("liveBtn").classList.toggle("live-on", !isOn);
}
$("liveBtn").addEventListener("click", toggleVoicePanel);
$("vpClose").addEventListener("click", () => { $("voicePanel").classList.remove("on"); disconnectLive(); $("liveBtn").classList.remove("live-on"); });
$("vpMinBtn").addEventListener("click", () => {
  vpMinimized = !vpMinimized;
  $("voicePanel").classList.toggle("minimized", vpMinimized);
  $("vpMinBtn").textContent = vpMinimized ? "+" : "—";
});

function setVpStatus(msg) { $("vpStatus").textContent = msg; }

function connectLive() {
  setVpStatus("Connecting…");
  $("liveBtn").classList.add("connecting");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws/live`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    $("liveBtn").classList.remove("connecting");
    $("liveBtn").classList.add("live-on");
    setVpStatus("Connected — start speaking");
    startMic();
  };
  ws.onmessage = e => handleLiveMsg(JSON.parse(e.data));
  ws.onclose   = () => { setVpStatus("Disconnected"); $("liveBtn").classList.remove("live-on", "connecting"); stopMic(); };
  ws.onerror   = () => { setVpStatus("Connection error"); toast("Live connection failed", "err"); };
}

function disconnectLive() {
  stopMic();
  stopCamera();
  stopScreen();
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (ws) { ws.close(); ws = null; }
  $("liveBtn").classList.remove("live-on", "connecting");
}

function wsSend(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

async function startMic() {
  if (micStream) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    audioCtx  = new AudioContext({ sampleRate: 16000 });
    const src = audioCtx.createMediaStreamSource(micStream);
    await audioCtx.audioWorklet.addModule("data:application/javascript," + encodeURIComponent(`
      class PCMProc extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0][0];
          if (ch) this.port.postMessage(ch.slice());
          return true;
        }
      }
      registerProcessor("pcm-proc", PCMProc);
    `));
    micNode = new AudioWorkletNode(audioCtx, "pcm-proc");
    src.connect(micNode);
    micNode.port.onmessage = e => {
      const f32  = e.data;
      const i16  = new Int16Array(f32.length);
      for (let j = 0; j < f32.length; j++) i16[j] = Math.max(-32768, Math.min(32767, f32[j] * 32768));
      const b64  = btoa(String.fromCharCode(...new Uint8Array(i16.buffer)));
      wsSend({ audio: b64 });
      animWaveform(f32);
    };
  } catch (e) { setVpStatus("Mic error: " + e.message); }
}

function stopMic() {
  if (micNode)   { micNode.disconnect(); micNode = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx)  { audioCtx.close().catch(() => {}); audioCtx = null; }
  resetWaveform();
}

function animWaveform(f32) {
  const bars = $("vpWaveform").querySelectorAll(".vp-wb");
  const rms  = Math.sqrt(f32.reduce((s, v) => s + v * v, 0) / f32.length);
  const active = Math.round(rms * 80);
  bars.forEach((b, i) => b.classList.toggle("on", i < active));
}
function resetWaveform() { $("vpWaveform").querySelectorAll(".vp-wb").forEach(b => b.classList.remove("on")); }

/* ── Playback ─────────────────────────────────────────────────────────── */
let playCtx = null, playQueue = [], playBusy = false;

async function enqueueAudio(b64) {
  const bin  = atob(b64);
  const buf  = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  playQueue.push(buf);
  if (!playBusy) drainQueue();
}

async function drainQueue() {
  playBusy = true;
  if (!playCtx) playCtx = new AudioContext({ sampleRate: 24000 });
  while (playQueue.length) {
    const buf = playQueue.shift();
    const i16 = new Int16Array(buf);
    const f32 = new Float32Array(i16.length);
    for (let j = 0; j < i16.length; j++) f32[j] = i16[j] / 32768;
    const ab  = playCtx.createBuffer(1, f32.length, 24000);
    ab.copyToChannel(f32, 0);
    const src = playCtx.createBufferSource();
    src.buffer = ab;
    src.connect(playCtx.destination);
    await new Promise(res => { src.onended = res; src.start(); });
  }
  playBusy = false;
}

/* ── Live message handler ─────────────────────────────────────────────── */
function handleLiveMsg(msg) {
  if (msg.audio)   { enqueueAudio(msg.audio); animVpOrb("speaking"); }
  if (msg.status)  { setVpStatus(msg.status); }
  if (msg.interrupt) { playQueue = []; playBusy = false; if (playCtx) playCtx.close().then(() => { playCtx = null; }); }

  if (msg.video_echo || msg.mss_frame) {
    const src = msg.video_echo || msg.mss_frame;
    animVpOrb("listening");
    if ($("pipVideo").style.display !== "none") {
      const cv = document.createElement("canvas");
      const img = new Image();
      img.onload = () => { cv.width = img.width; cv.height = img.height; cv.getContext("2d").drawImage(img, 0, 0); };
      img.src = "data:image/jpeg;base64," + src;
    }
  }

  if (msg.screen_list) showScreenList(msg.screen_list);
  if (msg.tab_list)    showTabList(msg.tab_list);

  if (msg.tool) handleLiveTool(msg.tool);

  if (msg.captured_frame) {
    const cf = msg.captured_frame;
    S.capturedFrame = cf;
    showCapturedBanner(`${cf.source === "screen" ? "🖥" : "📷"} ${cf.source} frame captured`, cf.frame_id);
  }

  if (msg.send_frame_to_story) {
    const { frame_id, message } = msg.send_frame_to_story;
    S.capturedFrame = { frame_id };
    setInputVal(message);
    showCtxBar("📸 Using captured frame");
    sendMessage();
  }
}

function animVpOrb(state) {
  const orb = $("vpOrb");
  orb.className = "vp-orb " + state;
  setTimeout(() => { if (orb.className.includes(state)) orb.className = "vp-orb"; }, 3000);
}

function showCapturedBanner(txt, frameId) {
  $("capturedTxt").textContent = txt;
  $("capturedBanner").classList.add("on");
  $("capturedUseBtn").onclick = () => {
    showCtxBar("📸 Captured frame");
    hideCaptureBanner();
    $("msgInput").focus();
  };
}
function hideCaptureBanner() { $("capturedBanner").classList.remove("on"); }
$("capturedDismiss").addEventListener("click", () => { hideCaptureBanner(); S.capturedFrame = null; });
$("capturedUseBtn").addEventListener("click", () => {
  showCtxBar("📸 Using captured frame");
  hideCaptureBanner();
  $("msgInput").focus();
});

/* ── Live tool routing ────────────────────────────────────────────────── */
function handleLiveTool(tool) {
  const { id, name, args } = tool;
  let result = "ok";

  switch (name) {
    case "toggle_camera":
      if (args.enabled) startCamera().then(ok => wsSend({ tool_resp: { id, name, result: ok ? "Camera on" : "Camera failed" } }));
      else { stopCamera(); wsSend({ tool_resp: { id, name, result: "Camera off" } }); }
      return;
    case "list_screens":
      wsSend({ get_screens: true });
      wsSend({ tool_resp: { id, name, result: "Fetching screen list…" } });
      return;
    case "capture_screen":
      if (args.screen === "manual") startBrowserScreenShare(id, name);
      else { wsSend({ start_mss: args.screen }); wsSend({ tool_resp: { id, name, result: `Sharing monitor ${args.screen}` } }); }
      return;
    case "stop_screen":
      stopScreen();
      wsSend({ stop_mss: true });
      wsSend({ tool_resp: { id, name, result: "Screen sharing stopped" } });
      return;
    case "list_tabs":
      wsSend({ list_tabs: true });
      wsSend({ tool_resp: { id, name, result: "Fetching tabs…" } });
      return;
    case "switch_tab":
      wsSend({ switch_tab: args.index });
      result = `Switching to tab ${args.index}`;
      break;
    case "open_tab":
      wsSend({ open_tab: args.url });
      result = `Opening ${args.url}`;
      break;
    case "close_tab":
      wsSend({ close_tab: args.index });
      result = `Closing tab ${args.index}`;
      break;
    case "screenshot_tab":
      wsSend({ screenshot_tab: args.index ?? -1 });
      wsSend({ tool_resp: { id, name, result: "Screenshot requested" } });
      return;
    case "set_theme":
      applyTheme(args.theme || "dark");
      result = `Theme set to ${args.theme}`;
      break;
    case "set_view_mode":
      setViewMode(args.mode);
      result = `View mode: ${args.mode}`;
      break;
    case "start_recording":
      startRecording();
      result = "Recording started";
      break;
    case "stop_recording":
      stopRecording();
      result = "Recording stopped";
      break;
    case "aria_present":
      startPresentation();
      result = "Presenting";
      break;
    case "aria_stop_present":
      stopPresentation();
      result = "Stopped";
      break;
    case "aria_clear":
      S.timeline = []; renderTimeline();
      result = "Timeline cleared";
      break;
    case "aria_save_project":
      saveCurrentProject();
      result = "Saving project";
      break;
    case "aria_switch_tab":
      setActiveTab(args.tab);
      result = `Switched to ${args.tab}`;
      break;
    case "aria_open_projects":
      openProjectsModal();
      result = "Projects opened";
      break;
    case "aria_send_chat":
      setInputVal(args.message || "");
      setTimeout(() => sendMessage(), 100);
      result = "Sending to ARIA";
      break;
    case "aria_use_template":
      useTemplate(args.template_id);
      result = `Loading template ${args.template_id}`;
      break;
    default:
      result = "unknown tool";
  }
  wsSend({ tool_resp: { id, name, result } });
}

/* ── Screen / camera ──────────────────────────────────────────────────── */
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
    startFrameSend(cameraStream, "camera");
    $("vpc-camera").classList.add("active");
    $("vpc-camera").textContent = "📷 Camera On";
    setVpStatus("Camera active");
    return true;
  } catch (e) { setVpStatus("Camera error: " + e.message); return false; }
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  clearInterval(frameInterval); frameInterval = null;
  $("vpc-camera").classList.remove("active");
  $("vpc-camera").textContent = "📷 Camera";
  setViewMode("a");
}

async function startBrowserScreenShare(toolId, toolName) {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 } });
    startFrameSend(screenStream, "screen");
    wsSend({ tool_resp: { id: toolId, name: toolName, result: "Screen sharing started via browser" } });
    setVpStatus("Sharing screen");
    $("vpc-screen").classList.add("active");
    screenStream.getVideoTracks()[0].addEventListener("ended", () => stopScreen());
  } catch (e) {
    wsSend({ tool_resp: { id: toolId, name: toolName, result: "User cancelled screen share" } });
  }
}

function stopScreen() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  clearInterval(frameInterval); frameInterval = null;
  $("vpc-screen").classList.remove("active");
}

function startFrameSend(stream, source) {
  clearInterval(frameInterval);
  const track  = stream.getVideoTracks()[0];
  const reader = new ImageCapture(track);
  frameInterval = setInterval(async () => {
    try {
      const bmp    = await reader.grabFrame();
      const cv     = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
      cv.getContext("2d").drawImage(bmp, 0, 0, 640, 360);
      const b64    = cv.toDataURL("image/jpeg", 0.5).split(",")[1];
      wsSend({ video: b64 });
      updateVideoPreview(b64, source);
    } catch (_) {}
  }, 800);
}

function updateVideoPreview(b64, source) {
  const mode = document.querySelector(".vmode-btn.active")?.dataset.vmode || "a";
  if (mode === "a") return;
  const img  = new Image();
  img.onload = () => {
    const cv  = document.createElement("canvas");
    cv.width  = img.width; cv.height = img.height;
    cv.getContext("2d").drawImage(img, 0, 0);
    if (mode === "b") {
      const pip = $("pipContainer");
      pip.classList.add("on");
      const pv = $("pipVideo");
      const stream = cv.captureStream();
      if (pv.srcObject !== stream) pv.srcObject = stream;
      $("pipLabel").textContent = source;
    } else if (mode === "c") {
      const half = $("videoHalf");
      half.classList.add("on");
      $("right").classList.add("split-mode");
      const sv = $("splitVideo");
      const stream = cv.captureStream();
      if (sv.srcObject !== stream) sv.srcObject = stream;
      $("splitLabel").textContent = source;
    }
  };
  img.src = "data:image/jpeg;base64," + b64;
}

/* ── View modes ───────────────────────────────────────────────────────── */
function setViewMode(mode) {
  document.querySelectorAll(".vmode-btn").forEach(b => b.classList.toggle("active", b.dataset.vmode === mode));
  $("pipContainer").classList.toggle("on", mode === "b");
  $("videoHalf").classList.toggle("on", mode === "c");
  $("right").classList.toggle("split-mode", mode === "c");
  if (mode === "a") { $("pipContainer").classList.remove("on"); }
}
document.querySelectorAll(".vmode-btn").forEach(b => b.addEventListener("click", () => { setViewMode(b.dataset.vmode); wsSend({ tool_resp: { id: "vmode", name: "set_view_mode", result: b.dataset.vmode } }); }));

/* ── Screen / tab list UI ─────────────────────────────────────────────── */
function showScreenList(screens) {
  $("vpListTitle").textContent = "Select a monitor";
  $("vpListItems").innerHTML = screens.map(s =>
    `<div class="vpl-item" data-screen="${s.index}">
      <span class="vpl-badge">🖥</span>${s.label}
    </div>`).join("");
  $("vpListPanel").classList.add("on");
  $("vpListItems").querySelectorAll(".vpl-item").forEach(el => {
    el.addEventListener("click", () => {
      const idx = el.dataset.screen;
      if (idx === "manual") startBrowserScreenShare("screen-manual", "capture_screen");
      else wsSend({ start_mss: idx });
      $("vpListPanel").classList.remove("on");
    });
  });
}

function showTabList(tabs) {
  $("vpListTitle").textContent = "Browser Tabs";
  $("vpListItems").innerHTML = tabs.map(t =>
    `<div class="vpl-item" data-tab-i="${t.index}">
      <span class="vpl-badge${t.active ? " grn" : ""}">${t.index + 1}</span>${t.title.slice(0, 40)}
    </div>`).join("");
  $("vpListPanel").classList.add("on");
  $("vpListItems").querySelectorAll(".vpl-item").forEach(el => {
    el.addEventListener("click", () => { wsSend({ switch_tab: +el.dataset.tabI }); $("vpListPanel").classList.remove("on"); });
  });
}
$("vpListClose").addEventListener("click", () => $("vpListPanel").classList.remove("on"));

/* ── Controls ─────────────────────────────────────────────────────────── */
$("vpc-camera").addEventListener("click", () => { if (cameraStream) stopCamera(); else startCamera(); });
$("vpc-screen").addEventListener("click", () => { if (screenStream) stopScreen(); else startBrowserScreenShare("sc","capture_screen"); });
$("vpc-mute").addEventListener("click", () => {
  if (!micStream) return;
  const track = micStream.getAudioTracks()[0];
  track.enabled = !track.enabled;
  $("vpc-mute").classList.toggle("active", !track.enabled);
  $("vpc-mute").querySelector("svg + span, svg").nextSibling && null;
  $("vpc-mute").innerHTML = $("vpc-mute").innerHTML.replace(/Mic.*/,"Mic " + (track.enabled ? "On" : "Off"));
});
$("vpc-record").addEventListener("click", () => { if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording(); else startRecording(); });

/* ── Recording ────────────────────────────────────────────────────────── */
function startRecording() {
  const stream = cameraStream || screenStream;
  if (!stream) { toast("Enable camera or screen first", "info"); return; }
  recChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop = () => saveRecording();
  mediaRecorder.start(1000);
  recStart = Date.now();
  $("recIndicator").classList.add("on");
  $("vpc-record").classList.add("recording");
  recInterval = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $("recTime").textContent = String(Math.floor(s / 60)).padStart(2,"0") + ":" + String(s % 60).padStart(2,"0");
  }, 1000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  clearInterval(recInterval);
  $("recIndicator").classList.remove("on");
  $("vpc-record").classList.remove("recording");
}

async function saveRecording() {
  if (!recChunks.length) return;
  const blob = new Blob(recChunks, { type: "video/webm" });
  const duration = Math.round((Date.now() - recStart) / 1000);
  const reader   = new FileReader();
  reader.onload  = async ev => {
    const b64  = ev.target.result;
    const name = `ARIA_Recording_${Date.now()}.webm`;
    try {
      const r = await fetch("/api/recordings/save", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ data: b64, name, duration, token: S.token }),
      });
      const d = await r.json();
      if (d.ok) { toast("Recording saved!", "ok"); loadVoiceRecordings(); }
    } catch (_) { toast("Could not save recording", "err"); }
  };
  reader.readAsDataURL(blob);
}

async function loadVoiceRecordings() {
  if (!S.token) return;
  try {
    const r = await fetch("/api/recordings?limit=10", { headers: authHeaders() });
    const d = await r.json();
    const list = $("vpRecsList");
    $("vpRecs").classList.add("on");
    list.innerHTML = (d.recordings || []).slice(0, 6).map(rec => {
      const dur = rec.duration ? `${Math.floor(rec.duration / 60)}:${String(rec.duration % 60).padStart(2,"0")}` : "—";
      return `<div class="vp-rec-item">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${rec.name.slice(0,22)}</span>
        <span style="color:var(--mu3);font-size:.6rem">${dur}</span>
        <button class="vp-rec-play" onclick="window.open('${rec.url}','_blank')">▶</button>
        <a class="vp-rec-dl" href="${rec.url}" download="${rec.name}" target="_blank">⬇</a>
      </div>`;
    }).join("") || `<div style="color:var(--mu3);font-size:.65rem;padding:5px">No recordings yet</div>`;
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════════════════
   PROJECTS btn shortcut
   ═══════════════════════════════════════════════════════════════════════ */
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveCurrentProject(); }
});

/* ═══════════════════════════════════════════════════════════════════════
   MOBILE
   ═══════════════════════════════════════════════════════════════════════ */
$("sidebarToggle").addEventListener("click", () => {
  $("left").classList.toggle("mobile-open");
  $("leftOverlay").classList.toggle("on");
});
$("leftOverlay").addEventListener("click", () => {
  $("left").classList.remove("mobile-open");
  $("leftOverlay").classList.remove("on");
});

/* ═══════════════════════════════════════════════════════════════════════
   PiP DRAG
   ═══════════════════════════════════════════════════════════════════════ */
(function initPipDrag() {
  const pip = $("pipContainer");
  let dx = 0, dy = 0, dragging = false;
  pip.addEventListener("mousedown", e => {
    dragging = true; dx = e.clientX - pip.offsetLeft; dy = e.clientY - pip.offsetTop;
    pip.classList.add("dragging");
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    pip.style.right = "auto"; pip.style.bottom = "auto";
    pip.style.left  = (e.clientX - dx) + "px";
    pip.style.top   = (e.clientY - dy) + "px";
  });
  document.addEventListener("mouseup", () => { dragging = false; pip.classList.remove("dragging"); });
})();

/* ═══════════════════════════════════════════════════════════════════════
   SPLASH / GRID TRANSITIONS
   ═══════════════════════════════════════════════════════════════════════ */
function hideSplash() {
  const sp = $("splash");
  if (!sp.classList.contains("gone")) {
    sp.classList.add("fade-out");
    setTimeout(() => sp.classList.add("gone"), 800);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */
function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ═══════════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════════ */
async function init() {
  renderUserBadge();
  await initGoogleSignIn();

  // Validate existing session
  if (S.token) {
    try {
      const r = await fetch("/api/auth/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: S.token }) });
      if (r.ok) {
        const d = await r.json();
        S.user = d.user;
        localStorage.setItem("aria_user", JSON.stringify(S.user));
        renderUserBadge();
      } else { clearSession(); }
    } catch (_) {}
  }

  // Handle password reset
  if (S.resetToken) { openAuthModal("login"); return; }

  await loadTemplates();
  showInsGrid();
}

init();
