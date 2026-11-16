(() => {
  "use strict";
  const config = window.SELF_REGULATION_SUPABASE;
  const authPanel = document.getElementById("auth-panel");
  const dashboard = document.getElementById("dashboard");
  const authForm = document.getElementById("auth-form");
  const authTitle = document.getElementById("auth-title");
  const authDescription = document.getElementById("auth-description");
  const authMessage = document.getElementById("auth-message");
  const authModeToggle = document.getElementById("auth-mode-toggle");
  const displayNameWrap = document.getElementById("display-name-wrap");
  const authSubmit = document.getElementById("auth-submit");
  const sessionMessage = document.getElementById("session-message");
  let supabaseClient;
  let isSignUp = false;
  let currentSessionId = null;
  let refreshHandle = null;

  function message(target, text, isError = true) {
    target.textContent = text || "";
    target.style.color = isError ? "#a33434" : "#24834b";
  }
  function setTab(tab) {
    document.querySelectorAll(".tab").forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.getElementById("session-tab").hidden = tab !== "session";
    document.getElementById("results-tab").hidden = tab !== "results";
    if (tab === "results") refreshResults();
  }
  document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));

  function setAuthMode(signUp) {
    isSignUp = signUp;
    authTitle.textContent = signUp ? "Create teacher account" : "Teacher sign in";
    authDescription.textContent = signUp ? "Create an account using your school email address." : "Sign in to start and manage your classroom session.";
    authSubmit.textContent = signUp ? "Create account" : "Sign in";
    authModeToggle.textContent = signUp ? "Already have an account? Sign in" : "Need a teacher account? Create one";
    displayNameWrap.hidden = !signUp;
    document.getElementById("auth-password").autocomplete = signUp ? "new-password" : "current-password";
    message(authMessage, "");
  }
  authModeToggle.addEventListener("click", () => setAuthMode(!isSignUp));

  function renderQr(element, url) {
    element.replaceChildren();
    if (typeof QRCode === "undefined") {
      message(sessionMessage, "The QR-code library could not load. Please refresh the page.");
      return;
    }
    new QRCode(element, { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
  }

  async function loadCurrentSession() {
    const { data: userData } = await supabaseClient.auth.getUser();
    if (!userData.user) return;
    const { data, error } = await supabaseClient
      .from("sessions")
      .select("id,created_at,expires_at,ended_at")
      .eq("teacher_id", userData.user.id)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) showActiveSession(data.id);
    else showNoSession();
  }

  function showNoSession() {
    currentSessionId = null;
    document.getElementById("no-session").hidden = false;
    document.getElementById("active-session").hidden = true;
    document.getElementById("session-status").textContent = "No active session";
    document.getElementById("results-empty").hidden = false;
    document.getElementById("results-content").hidden = true;
    document.getElementById("participant-total").textContent = "0";
    if (refreshHandle) clearInterval(refreshHandle);
    refreshHandle = null;
  }

  function showActiveSession(sessionId) {
    currentSessionId = sessionId;
    document.getElementById("no-session").hidden = true;
    document.getElementById("active-session").hidden = false;
    document.getElementById("session-status").textContent = "Session active";
    const studentUrl = new URL("./", window.location.href);
    studentUrl.searchParams.set("session", sessionId);
    renderQr(document.getElementById("session-qr"), studentUrl.toString());
    document.getElementById("results-empty").hidden = true;
    document.getElementById("results-content").hidden = false;
    refreshResults();
    if (refreshHandle) clearInterval(refreshHandle);
    refreshHandle = setInterval(refreshResults, 5000);
  }

  async function refreshResults() {
    if (!currentSessionId || !supabaseClient) return;
    const { data, error } = await supabaseClient.rpc("get_session_results", { p_session_id: currentSessionId });
    if (error) {
      if (error.code === "P0002") {
        showNoSession();
        message(sessionMessage, "This session has ended or expired.");
      }
      return;
    }
    const counts = { blue: 0, green: 0, yellow: 0, red: 0 };
    (data || []).forEach(row => { counts[row.zone] = Number(row.student_count) || 0; });
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    document.getElementById("participant-total").textContent = String(total);
    document.getElementById("results-total").textContent = String(total);
    Object.entries(counts).forEach(([zone, count]) => {
      document.getElementById("count-" + zone).textContent = String(count);
      document.getElementById("bar-" + zone).style.width = total ? (count / total * 100) + "%" : "0%";
    });
  }

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    message(authMessage, "");
    authSubmit.disabled = true;
    try {
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      if (isSignUp) {
        const displayName = document.getElementById("display-name").value.trim();
        const { data, error } = await supabaseClient.auth.signUp({
          email, password, options: { data: { display_name: displayName || null } }
        });
        if (error) throw error;
        if (!data.session) {
          message(authMessage, "Account created. Check your school email to confirm it, then sign in.", false);
          setAuthMode(false);
        } else {
          await showDashboard(data.user);
        }
      } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await showDashboard(data.user);
      }
    } catch (error) {
      message(authMessage, error.message || "Unable to sign in.");
    } finally {
      authSubmit.disabled = false;
    }
  });

  async function showDashboard(user) {
    authPanel.hidden = true;
    dashboard.hidden = false;
    const name = user.user_metadata?.display_name || user.email || "Teacher";
    document.getElementById("welcome-title").textContent = "Welcome, " + name;
    try { await loadCurrentSession(); }
    catch (error) { message(sessionMessage, error.message || "Could not load your session."); }
  }

  document.getElementById("start-session").addEventListener("click", async () => {
    const button = document.getElementById("start-session");
    button.disabled = true;
    message(sessionMessage, "");
    try {
      const { data, error } = await supabaseClient.rpc("start_session");
      if (error) throw error;
      showActiveSession(data);
    } catch (error) {
      message(sessionMessage, error.message || "Could not start a session.");
    } finally { button.disabled = false; }
  });

  document.getElementById("end-session").addEventListener("click", async () => {
    if (!currentSessionId || !window.confirm("End this session? All anonymous participation data for it will be permanently deleted.")) return;
    const { error } = await supabaseClient.rpc("end_session", { p_session_id: currentSessionId });
    if (error) {
      message(sessionMessage, error.message || "Could not end the session.");
      return;
    }
    showNoSession();
    message(sessionMessage, "Session ended. Its participation data has been deleted.", false);
  });

  document.getElementById("fullscreen-qr").addEventListener("click", () => {
    if (!currentSessionId) return;
    const studentUrl = new URL("./", window.location.href);
    studentUrl.searchParams.set("session", currentSessionId);
    document.getElementById("qr-overlay").hidden = false;
    renderQr(document.getElementById("fullscreen-qr-code"), studentUrl.toString());
  });
  document.getElementById("close-fullscreen-qr").addEventListener("click", () => {
    document.getElementById("qr-overlay").hidden = true;
  });
  document.getElementById("sign-out").addEventListener("click", async () => {
    if (refreshHandle) clearInterval(refreshHandle);
    await supabaseClient.auth.signOut();
    dashboard.hidden = true;
    authPanel.hidden = false;
    setAuthMode(false);
  });

  async function init() {
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) {
      message(authMessage, "Supabase could not be loaded. Please refresh this page.");
      return;
    }
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) await showDashboard(data.session.user);
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        dashboard.hidden = true;
        authPanel.hidden = false;
      }
    });
  }
  init();
})();
