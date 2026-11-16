(() => {
  "use strict";
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session");
  if (!sessionId) return;

  const status = document.getElementById("student-session-status");
  if (status) {
    status.hidden = false;
    status.textContent = "You are connected to your class session.";
  }
  const config = window.SELF_REGULATION_SUPABASE;
  if (!config || !window.supabase?.createClient) {
    if (status) status.textContent = "This class session could not connect. Please ask your teacher for help.";
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey);
  const storageKey = "self-regulation-participant:" + sessionId;
  let participantToken = sessionStorage.getItem(storageKey);
  if (!participantToken) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    participantToken = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(storageKey, participantToken);
  }

  let lastSubmittedZone = null;
  window.submitStudentZone = async function(zone) {
    if (!["blue", "green", "yellow", "red"].includes(zone) || zone === lastSubmittedZone) return;
    if (status) status.textContent = "Sending your choice to your class session…";
    const { data, error } = await client.rpc("submit_zone", {
      p_session_id: sessionId,
      p_participant_token: participantToken,
      p_zone: zone
    });
    if (error || data !== true) {
      if (status) status.textContent = "This class session may have ended. Please check with your teacher.";
      return;
    }
    lastSubmittedZone = zone;
    if (status) status.textContent = "Your choice has been shared anonymously with your teacher.";
  };
})();
