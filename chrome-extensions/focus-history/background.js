// Focus History -- reports Chrome tab focus to Hammerspoon (chromebridge.lua)
// over a loopback websocket, and activates tabs when Hammerspoon asks.
//
// Why an extension at all: everything else has to *infer* which tab is active.
// Reading the window title and correlating it back through AppleScript looked
// workable and was wrong in a dozen small ways -- titles lag a tab switch, Chrome
// orders its windows differently from macOS, pages retitle continuously. Here the
// tab id arrives with the event that caused it.
//
// Note chrome.tabs ids are NOT AppleScript tab ids, so the focusing has to happen
// on this side too; Hammerspoon can't hand these ids to `chrome-preset focus-tab`.

const PORT = 27123;
const URL = `ws://127.0.0.1:${PORT}/focushistory`;
const RECONNECT_MS = 2000;

let socket = null;
let connecting = false;
let clientId = null;
let cachedLabel = null;

// Reports made while the socket is down, newest kept. Hammerspoon drops the
// connection on every reload -- and editing any config file reloads it -- so
// without this the tab you just switched to is silently lost and its window ends
// up recorded by Hammerspoon's fallback path under a different identity.
const queue = [];
const QUEUE_MAX = 20;

// A stable per-PROFILE identity. chrome.storage.local is profile-scoped, so each
// profile's copy of the extension gets its own id and keeps it across restarts.
// Hammerspoon has no other way to tell the copies apart: they share an extension
// id (same manifest key) and hs.httpserver reports nothing about who is
// connected. Set a friendly name from the service worker console with:
//   chrome.storage.local.set({label: "Personal"})
// Must never throw: it runs on the connect path, and an exception here would
// take down `hello` with it, leaving a working socket that reports no client.
// chrome.storage is unavailable if the extension was loaded before "storage"
// was in the manifest -- permission changes need a reload in chrome://extensions
// -- so fall back to an in-memory id rather than failing.
async function identity() {
  if (clientId) return { clientId, label: cachedLabel };
  try {
    const got = await chrome.storage.local.get(["clientId", "label"]);
    clientId = got.clientId;
    cachedLabel = got.label || null;
    if (!clientId) {
      clientId = crypto.randomUUID().slice(0, 8);
      await chrome.storage.local.set({ clientId });
    }
  } catch (e) {
    clientId = "mem-" + Math.random().toString(36).slice(2, 8);
    cachedLabel = null;
  }
  return { clientId, label: cachedLabel };
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
    return;
  }
  queue.push(payload);
  while (queue.length > QUEUE_MAX) queue.shift();
  connect();
}

// A window hosting a chrome-preset --app window reports type "app"; Hammerspoon
// records those as plain macOS windows, so tell it which kind this is rather than
// making it guess from the title (the guess that caused all the trouble before).
async function report(tabId, reason) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.active) return;
    const win = await chrome.windows.get(tab.windowId);
    if (!win.focused) return;   // background window retitling: not a focus change
    send({
      type: "tab",
      reason,
      // Attributes the report to a profile. Every report carries it because
      // Hammerspoon cannot ask: there is no reliable command channel to more
      // than one profile (see socket.onmessage).
      clientId,
      label: cachedLabel,
      tabId: tab.id,
      windowId: tab.windowId,
      windowType: win.type,     // "normal" | "popup" | "app" | "devtools"
      url: tab.url || "",
      title: tab.title || "",
    });
  } catch (e) {
    // Tab or window vanished between the event and the lookup; nothing to report.
  }
}

function connect() {
  // send() calls this opportunistically, so it must be safe to call at any time.
  if (connecting || (socket && socket.readyState === WebSocket.OPEN)) return;
  connecting = true;
  try {
    socket = new WebSocket(URL);
  } catch (e) {
    connecting = false;
    setTimeout(connect, RECONNECT_MS);
    return;
  }

  socket.onopen = async () => {
    connecting = false;
    // Drain first: these are older than the hello, but Hammerspoon only cares
    // about the newest state and dropping them loses tab switches outright.
    const backlog = queue.splice(0);
    for (const p of backlog) {
      try { socket.send(JSON.stringify(p)); } catch (e) { /* dropped */ }
    }
    const who = await identity();
    send({ type: "hello", version: chrome.runtime.getManifest().version, ...who });
    // Hammerspoon may have restarted and lost track of where we are.
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
      .then(tabs => { if (tabs[0]) report(tabs[0].id, "hello"); });
  };

  // This extension only ever REPORTS. It used to accept activate commands, but
  // hs.httpserver:send() reaches "the websocket client" -- singular -- so with
  // the extension loaded in several profiles a command only ever reached one of
  // them and the others sat out a timeout, which is what made focusing slow.
  // Hammerspoon focuses tabs through AppleScript instead, which reaches every
  // profile in the one Chrome process (and can raise the app, which no extension
  // API can). Reporting is unaffected: inbound messages from every profile
  // arrive fine, it is only the outbound direction that is limited to one.
  socket.onmessage = () => {};

  // Chrome suspends MV3 service workers when idle, but websocket traffic resets
  // the idle timer, so an active connection keeps this alive. Reconnecting on
  // close covers both a Hammerspoon reload and a worker that was torn down.
  socket.onclose = () => {
    connecting = false;
    socket = null;
    setTimeout(connect, RECONNECT_MS);
  };
  socket.onerror = () => { try { socket.close(); } catch (e) {} };
}

// Warm the id so tab reports can carry it from the first event onward.
identity();

chrome.tabs.onActivated.addListener(info => report(info.tabId, "activated"));

chrome.tabs.onUpdated.addListener((tabId, change) => {
  // Only title/url matter; ignore favicon, audible, discarded and friends. This
  // is the in-tab navigation case: Hammerspoon refreshes the existing entry
  // rather than adding one, because the tab id hasn't changed.
  if (change.title !== undefined || change.url !== undefined) report(tabId, "updated");
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId })
    .then(tabs => { if (tabs[0]) report(tabs[0].id, "window-focus"); })
    .catch(() => {});
});

connect();
