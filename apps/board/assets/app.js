const cards = new Map();
function card(rule) {
  let element = cards.get(rule.key);
  if (!element) {
    element = document.createElement("article");
    element.className = "card";
    element.innerHTML = '<h2></h2><p></p><div class="answer"></div><div class="track"><div class="fill"></div></div><div class="detail"></div>';
    cards.set(rule.key, element);
    document.querySelector("#cards").append(element);
  }
  const fired = (rule.queued || rule.done) && !element.dataset.fired;
  if (rule.queued || rule.done) element.dataset.fired = "true";
  element.className = `card ${rule.done ? "done" : rule.queued ? "queued" : ""} ${fired ? "fire" : ""}`;
  element.querySelector("h2").textContent = rule.label;
  element.querySelector("p").textContent = rule.text;
  element.querySelector(".answer").textContent = rule.done ? "ALERT ACCEPTED" : rule.queued ? "ALERT QUEUED · RETRYING DELIVERY" : rule.yes === null ? "UNKNOWN" : rule.yes ? "YES" : "NO";
  const progress = rule.done || rule.queued ? 1 : rule.hold ? Math.min(rule.held / rule.hold, 1) : 0;
  element.querySelector(".fill").style.width = `${progress * 100}%`;
  element.querySelector(".detail").textContent = `Yes in ${rule.yesCount} of the last ${rule.samples} · ${(rule.held / 1000).toFixed(1)} / ${rule.hold / 1000}s`;
}
async function refresh() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Board unavailable");
    const state = await response.json();
    document.querySelector("#sensor").textContent = state.temperature === null ? "Temperature unavailable" : `Room ${state.temperature.toFixed(1)}°C · heated above ${state.heatedAbove}°C`;
    document.querySelector("#model").textContent = state.model;
    document.querySelector("#error").textContent = state.error || "";
    const keys = new Set(state.questions.map(rule => rule.key));
    for (const [key, element] of cards) if (!keys.has(key)) { element.remove(); cards.delete(key); }
    state.questions.forEach(card);
    if (!state.questions.length) document.querySelector("#error").textContent = "No rules yet. Add one from your owner link.";
  } catch {
    document.querySelector("#error").textContent = "Connection lost. Live answers are unavailable.";
    for (const element of cards.values()) {
      element.querySelector(".answer").textContent = "UNKNOWN · DISCONNECTED";
      element.querySelector(".fill").style.width = "0%";
    }
  } finally { setTimeout(refresh, 1000); }
}
refresh();
