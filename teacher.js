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
  const authSubmit = document.getElementById("auth-submit");
  const sessionMessage = document.getElementById("session-message");
  const TOKEN_KEY = "self-regulation-teacher-token";
  let supabaseClient;
  let isSignUp = false;
  let currentSessionId = null;
  let currentNickname = "";
  let refreshHandle = null;
  let heartbeatHandle = null;
  let teacherToken = sessionStorage.getItem(TOKEN_KEY) || "";

  function message(target, text, isError = true) {
    target.textContent = text || "";
    target.style.color = isError ? "#a33434" : "#24834b";
  }
  function rpc(name, args) {
    return supabaseClient.rpc(name, args);
  }
  function setTab(tab) {
    document.querySelectorAll(".tab").forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.getElementById("session-tab").hidden = tab !== "session";
    document.getElementById("results-tab").hidden = tab !== "results";
    document.getElementById("zones-tab").hidden = tab !== "zones";
    document.getElementById("resources-tab").hidden = tab !== "resources";
    if (tab === "results") refreshResults();
  }
  document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));
  document.querySelectorAll(".resource-tab").forEach(button => button.addEventListener("click", () => {
    const selected = button.dataset.resource;
    document.querySelectorAll(".resource-tab").forEach(tab => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.getElementById("books-resource").hidden = selected !== "books";
    document.getElementById("videos-resource").hidden = selected !== "videos";
  }));

  function setAuthMode(signUp) {
    isSignUp = signUp;
    authTitle.textContent = signUp ? "Create teacher account" : "Teacher sign in";
    authDescription.textContent = signUp ? "Choose any nickname and password." : "Sign in with your nickname and password.";
    authSubmit.textContent = signUp ? "Create account" : "Sign in";
    authModeToggle.textContent = signUp ? "Already have an account? Sign in" : "Need an account? Create one";
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
    const { data, error } = await rpc("teacher_current_session", { p_teacher_token: teacherToken });
    if (error) throw error;
    if (data && data.length) showActiveSession(data[0].id);
    else showNoSession();
  }

  function stopTimers() {
    if (refreshHandle) clearInterval(refreshHandle);
    if (heartbeatHandle) clearInterval(heartbeatHandle);
    refreshHandle = null;
    heartbeatHandle = null;
  }
  function showNoSession() {
    currentSessionId = null;
    document.getElementById("no-session").hidden = false;
    document.getElementById("active-session").hidden = true;
    document.getElementById("session-status").textContent = "No active session";
    document.getElementById("results-empty").hidden = false;
    document.getElementById("results-content").hidden = true;
    document.getElementById("participant-total").textContent = "0";
    stopTimers();
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
    stopTimers();
    refreshHandle = setInterval(refreshResults, 5000);
    heartbeatHandle = setInterval(async () => {
      if (!currentSessionId) return;
      const { data, error } = await rpc("teacher_keep_session_alive", {
        p_teacher_token: teacherToken, p_session_id: currentSessionId
      });
      if (error || data !== true) {
        showNoSession();
        message(sessionMessage, "This session expired after inactivity. Start a new session when ready.");
      }
    }, 60 * 1000);
  }

  async function refreshResults() {
    if (!currentSessionId || !supabaseClient) return;
    const { data, error } = await rpc("teacher_get_session_results", {
      p_teacher_token: teacherToken, p_session_id: currentSessionId
    });
    if (error) {
      if (error.code === "P0002" || error.code === "28000") {
        showNoSession();
        message(sessionMessage, "This session has ended or expired. Please sign in again if needed.");
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

  function enterDashboard(nickname) {
    currentNickname = nickname;
    authPanel.hidden = true;
    dashboard.hidden = false;
    document.getElementById("sign-out").hidden = false;
    document.querySelector(".header-app-link").hidden = false;
    document.getElementById("welcome-title").textContent = "Welcome, " + nickname;
    loadCurrentSession().catch(error => message(sessionMessage, error.message || "Could not load your session."));
  }

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    message(authMessage, "");
    authSubmit.disabled = true;
    try {
      const nickname = document.getElementById("auth-nickname").value.trim();
      const password = document.getElementById("auth-password").value;
      if (isSignUp) {
        const { data: token, error } = await rpc("register_teacher", {
          p_nickname: nickname, p_password: password
        });
        if (error) throw error;
        teacherToken = token;
        sessionStorage.setItem(TOKEN_KEY, teacherToken);
        sessionStorage.setItem("self-regulation-teacher-nickname", nickname);
        enterDashboard(nickname);
      } else {
        const { data, error } = await rpc("login_teacher", {
          p_nickname: nickname, p_password: password
        });
        if (error) throw error;
        teacherToken = data[0].login_token;
        sessionStorage.setItem(TOKEN_KEY, teacherToken);
        sessionStorage.setItem("self-regulation-teacher-nickname", data[0].teacher_nickname);
        enterDashboard(data[0].teacher_nickname);
      }
    } catch (error) {
      message(authMessage, error.message || "Unable to create account or sign in.");
    } finally {
      authSubmit.disabled = false;
    }
  });

  document.getElementById("start-session").addEventListener("click", async () => {
    const button = document.getElementById("start-session");
    button.disabled = true;
    message(sessionMessage, "");
    try {
      const { data, error } = await rpc("teacher_start_session", { p_teacher_token: teacherToken });
      if (error) throw error;
      showActiveSession(data);
    } catch (error) {
      message(sessionMessage, error.message || "Could not start a session.");
    } finally { button.disabled = false; }
  });

  document.getElementById("end-session").addEventListener("click", async () => {
    if (!currentSessionId || !window.confirm("End this session? All anonymous participation data for it will be permanently deleted.")) return;
    const { error } = await rpc("teacher_end_session", {
      p_teacher_token: teacherToken, p_session_id: currentSessionId
    });
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
    stopTimers();
    await rpc("teacher_sign_out", { p_teacher_token: teacherToken });
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem("self-regulation-teacher-nickname");
    teacherToken = "";
    currentNickname = "";
    currentSessionId = null;
    dashboard.hidden = true;
    document.getElementById("sign-out").hidden = true;
    document.querySelector(".header-app-link").hidden = true;
    authPanel.hidden = false;
    setAuthMode(false);
  });

  async function init() {
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) {
      message(authMessage, "Supabase could not be loaded. Please refresh this page.");
      return;
    }
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
    if (teacherToken) {
      try {
        const { data, error } = await rpc("teacher_current_session", { p_teacher_token: teacherToken });
        if (error) throw error;
        const nickname = sessionStorage.getItem("self-regulation-teacher-nickname") || "Teacher";
        enterDashboard(nickname);
        if (data && data.length) showActiveSession(data[0].id);
      } catch (_error) {
        sessionStorage.removeItem(TOKEN_KEY);
        teacherToken = "";
      }
    }
  }
  init();
})();
