(function () {
  if (window.igAutoFollow) return;
  window.igAutoFollow = {
    intervalId: null,
    running: false,
    // settings: base interval, how many follow clicks per tick, scroll amount, and jitter options
    settings: { intervalMs: 3000, perTick: 1, scrollAmount: 300, randomize: false, jitterMs: 1000, clickGap: 350, filters: ['assignment','helper','exam','essay'] },
    // internal tracking for end-of-list detection
    _emptyRounds: 0,
    _maxEmptyRounds: 6,
  };

  function isFollowButton(btn) {
    if (!btn) return false;
    // ignore invisible/disabled buttons
    try {
      if (btn.disabled) return false;
      if (!(btn.offsetWidth || btn.offsetHeight || btn.getClientRects().length)) return false;
    } catch (e) {}
    const txt = (btn.innerText || '').trim();
    if (!txt) return false;
    const lower = txt.toLowerCase();
    if (lower.includes('follow') && !lower.includes('following') && !lower.includes('requested')) {
      return true;
    }
    return false;
  }

  function getCandidateButtons() {
    try {
      return Array.from(document.querySelectorAll('button')).filter(isFollowButton);
    } catch (e) {
      return [];
    }
  }

  function findScrollableContainer() {
    // cached
    try {
      if (window.igAutoFollow.scrollContainer && document.contains(window.igAutoFollow.scrollContainer)) {
        return window.igAutoFollow.scrollContainer;
      }

      // Prefer ancestor containers near a follow button
      const sampleBtn = document.querySelector('button');
      if (sampleBtn) {
        let el = sampleBtn;
        for (let i = 0; i < 12 && el; i++) {
          const style = getComputedStyle(el);
          if ((el.scrollHeight > el.clientHeight + 10) && (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay')) {
            window.igAutoFollow.scrollContainer = el;
            return el;
          }
          el = el.parentElement;
        }
      }

      // Fallback: find any descendant inside a dialog with scrollable area
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (const d of dialogs) {
        const candidates = d.querySelectorAll('*');
        for (const c of candidates) {
          try {
            const style = getComputedStyle(c);
            if ((c.scrollHeight > c.clientHeight + 10) && (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay')) {
              window.igAutoFollow.scrollContainer = c;
              return c;
            }
          } catch (_) {}
        }
      }

      // Last resort: document scrolling element
      window.igAutoFollow.scrollContainer = document.scrollingElement || document.documentElement;
      return window.igAutoFollow.scrollContainer;
    } catch (e) {
      return document.scrollingElement || document.documentElement;
    }
  }

  function getUsernameFromButton(btn) {
    // Traverse up a few levels looking for an anchor with a profile href
    let el = btn;
    for (let i = 0; i < 8 && el; i++) {
      if (el.querySelectorAll) {
        const anchors = el.querySelectorAll('a[href^="/"]');
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          // skip post links
          if (!href || href.includes('/p/')) continue;
          // extract username
          const parts = href.split('/').filter(Boolean);
          if (parts.length >= 1) {
            const name = parts[0];
            if (name && name.length > 0) return name;
          }
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function saveFollowed(username) {
    if (!username) return;
    try {
      chrome.storage.local.get({ followedAccounts: [] }, (res) => {
        const arr = res.followedAccounts || [];
        // avoid duplicate consecutive entries
        if (!arr.length || arr[0].username !== username) {
          arr.unshift({ username: username, ts: Date.now() });
          chrome.storage.local.set({ followedAccounts: arr });
        }
      });
    } catch (e) {
      // ignore storage errors
    }
  }

  function clickNext() {
    // choose from allowed candidates (non-blacklisted)
    const candidates = getCandidateButtons();
    if (!candidates.length) return; // no visible follow buttons; runTick will handle scrolling

    // helper to check blacklist
    function isBlacklisted(username, btn) {
      try {
        const filters = (window.igAutoFollow.settings && window.igAutoFollow.settings.filters) || [];
        if (!filters || !filters.length) return false;
        const lowFilters = filters.map(f => (f || '').toLowerCase()).filter(Boolean);
        if (username) {
          const u = username.toLowerCase();
          for (const f of lowFilters) if (u.includes(f)) return true;
        }
        if (btn && btn.closest) {
          let el = btn.closest('li, div') || btn.parentElement;
          for (let i = 0; i < 6 && el; i++) {
            try {
              const txt = (el.innerText || '').toLowerCase();
              for (const f of lowFilters) if (txt.includes(f)) return true;
            } catch (e) {}
            el = el.parentElement;
          }
        }
      } catch (e) {}
      return false;
    }

    let chosen = null;
    let chosenUsername = '';
    for (const b of candidates) {
      const uname = getUsernameFromButton(b) || '';
      if (!isBlacklisted(uname, b)) {
        chosen = b;
        chosenUsername = uname;
        break;
      }
    }

    if (!chosen) return; // all visible candidates filtered; let runTick attempt scrolling

    try {
      chosen.click();
      saveFollowed(chosenUsername || '');
    } catch (e) {}
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // run loop replaces setInterval to allow randomized delays between ticks
  function runTick() {
    if (!window.igAutoFollow.running) return;
    const s = window.igAutoFollow.settings;

    // execute perTick clicks sequentially with small gaps plus optional jitter
    for (let i = 0; i < s.perTick; i++) {
      const baseGap = s.clickGap || 300;
      let gap = baseGap * i;
      if (s.randomize) gap += randomBetween(-Math.min(baseGap / 2, s.jitterMs), Math.min(baseGap / 2, s.jitterMs));
      setTimeout(() => {
        try { clickNext(); } catch (_) {}
      }, Math.max(0, gap));
    }

    // After the perTick clicks have run, check if there are no candidate buttons left and scroll once.
    // We wait a little longer than the last clickGap to ensure DOM updates have settled.
    try {
      const afterDelay = (s.clickGap || 300) * Math.max(1, s.perTick) + 250;
      setTimeout(() => {
        try {
          if (!window.igAutoFollow.running) return;
          const remaining = getCandidateButtons();
          if (!remaining.length) {
            const container = findScrollableContainer();
            try {
              if (container && container !== document.scrollingElement && container !== document.documentElement) {
                container.scrollBy({ top: (s.scrollAmount || 300), behavior: 'smooth' });
              } else {
                window.scrollBy(0, (s.scrollAmount || 300));
              }
            } catch (e) {
              try { window.scrollBy(0, (s.scrollAmount || 300)); } catch (_) {}
            }
          }
        } catch (e) {}
      }, afterDelay);
    } catch (e) {}

    // schedule next tick with optional randomness
    let nextDelay = s.intervalMs || 3000;
    if (s.randomize && s.jitterMs) {
      nextDelay = Math.max(500, nextDelay + randomBetween(-s.jitterMs, s.jitterMs));
    }
    window.igAutoFollow.intervalId = setTimeout(runTick, nextDelay);
  }

  function start(intervalMs, perTick, options) {
    if (window.igAutoFollow.running) return;
    window.igAutoFollow.running = true;
    if (intervalMs) window.igAutoFollow.settings.intervalMs = intervalMs;
    if (perTick) window.igAutoFollow.settings.perTick = perTick;
    // merge options
    if (options && typeof options === 'object') {
      for (const k of Object.keys(options)) {
        window.igAutoFollow.settings[k] = options[k];
      }
    }
    // start the recursive tick loop
    runTick();
  }

  function stop() {
    if (window.igAutoFollow.intervalId) clearTimeout(window.igAutoFollow.intervalId);
    window.igAutoFollow.intervalId = null;
    window.igAutoFollow.running = false;
  }

  // messaging from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.command) return;
    if (msg.command === 'start') {
      start(msg.intervalMs, msg.perTick, msg.options);
      sendResponse({ status: 'started', settings: window.igAutoFollow.settings });
    } else if (msg.command === 'stop') {
      stop();
      sendResponse({ status: 'stopped' });
    } else if (msg.command === 'status') {
      sendResponse({ running: !!window.igAutoFollow.running, settings: window.igAutoFollow.settings });
    } else if (msg.command === 'getList') {
      chrome.storage.local.get({ followedAccounts: [] }, (res) => {
        sendResponse({ followedAccounts: res.followedAccounts || [] });
      });
      return true; // indicates async response
    }
    return true;
  });

  // expose simple API on window for debugging
  window.igAutoFollow.start = start;
  window.igAutoFollow.stop = stop;
})();
