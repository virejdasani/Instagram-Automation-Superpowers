function queryActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs.length) return callback(null);
    callback(tabs[0]);
  });
}

function sendToContent(tabId, msg, cb) {
  chrome.tabs.sendMessage(tabId, msg, (resp) => {
    if (chrome.runtime.lastError) {
      const err = chrome.runtime.lastError.message || '';
      console.warn('sendMessage error', err);
      // If there's no receiver in the tab, try injecting the content script and retry once.
      if (err.includes('Could not establish connection') || err.includes('Receiving end does not exist')) {
        try {
          chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
            if (chrome.runtime.lastError) {
              console.warn('scripting.executeScript error', chrome.runtime.lastError.message);
              return cb && cb({ error: chrome.runtime.lastError.message });
            }
            // Retry sending the message after injecting the script
            chrome.tabs.sendMessage(tabId, msg, (resp2) => {
              if (chrome.runtime.lastError) {
                console.warn('sendMessage retry error', chrome.runtime.lastError.message);
                return cb && cb({ error: chrome.runtime.lastError.message });
              }
              cb && cb(resp2);
            });
          });
          return;
        } catch (e) {
          console.warn('inject+retry failed', e && e.message);
          return cb && cb({ error: e && e.message });
        }
      }
      return cb && cb({ error: err });
    }
    cb && cb(resp);
  });
}

function updateStatus() {
  queryActiveTab((tab) => {
    if (!tab) return;
    sendToContent(tab.id, { command: 'status' }, (resp) => {
      if (!resp) return;
      const runningFollow = !!resp.runningFollow;
      const runningUnfollow = !!resp.runningUnfollow;
      const anyRunning = runningFollow || runningUnfollow;
      const ind = document.getElementById('statusIndicator');
      if (ind) {
        if (runningFollow && runningUnfollow) ind.textContent = 'Running (Follow+Unfollow)';
        else if (runningFollow) ind.textContent = 'Running (Follow)';
        else if (runningUnfollow) ind.textContent = 'Running (Unfollow)';
        else ind.textContent = 'Stopped';
        ind.classList.toggle('running', anyRunning);
        ind.classList.toggle('stopped', !anyRunning);
      }
      const startBtn = document.getElementById('start');
      const stopBtn = document.getElementById('stop');
      const startUnfollowBtn = document.getElementById('startUnfollow');
      const stopUnfollowBtn = document.getElementById('stopUnfollow');
      if (startBtn && stopBtn) {
        startBtn.disabled = runningFollow;
        stopBtn.disabled = !runningFollow;
      }
      if (startUnfollowBtn && stopUnfollowBtn) {
        startUnfollowBtn.disabled = runningUnfollow;
        stopUnfollowBtn.disabled = !runningUnfollow;
      }
    });
  });
}

function refreshList() {
  chrome.storage.local.get({ followedAccounts: [] }, (res) => {
    const arr = (res.followedAccounts || []).slice().sort((a,b)=>b.ts - a.ts);
    const total = arr.length;
    document.getElementById('totalFollowed') && (document.getElementById('totalFollowed').innerText = total);
    document.getElementById('listCount') && (document.getElementById('listCount').innerText = total);

    const ul = document.getElementById('followedList');
    if (!ul) return;
    ul.innerHTML = '';
    for (const item of arr) {
      const li = document.createElement('li');
      const d = new Date(item.ts);
      const name = document.createElement('span');
      name.textContent = item.username;
      const t = document.createElement('time');
      t.dateTime = new Date(item.ts).toISOString();
      t.textContent = d.toLocaleString();
      li.appendChild(name);
      li.appendChild(t);
      ul.appendChild(li);
    }

    renderDailyBreakdown(arr);
  });
}

function formatDateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function renderDailyBreakdown(arr) {
  const map = {};
  for (const it of arr) {
    const key = formatDateKey(it.ts);
    map[key] = (map[key] || 0) + 1;
  }
  const entries = Object.keys(map).sort((a,b)=>b.localeCompare(a));
  const total = arr.length;
  const todayKey = formatDateKey(Date.now());
  const yesterdayKey = formatDateKey(Date.now() - 24*3600*1000);
  const todayCount = map[todayKey] || 0;
  const yesterdayCount = map[yesterdayKey] || 0;
  const totalEl = document.getElementById('totalFollowed');
  const todayEl = document.getElementById('todayCount');
  const yesterdayEl = document.getElementById('yesterdayCount');
  if (totalEl) totalEl.innerText = total;
  if (todayEl) todayEl.innerText = todayCount;
  if (yesterdayEl) yesterdayEl.innerText = yesterdayCount;

  const wrap = document.getElementById('dailyBreakdown');
  if (!wrap) return;
  if (!entries.length) {
    wrap.innerHTML = '<div class="muted">No activity recorded yet.</div>';
    return;
  }
  let html = '<div class="break-list">';
  for (const k of entries) {
    html += `<div class="break-item"><span class="date">${k}</span><span class="count">${map[k]}</span></div>`;
  }
  html += '</div>';
  wrap.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start');
  const stopBtn = document.getElementById('stop');
  const clearBtn = document.getElementById('clear');
  const scrollAmountInput = document.getElementById('scrollAmount');
  const randomizeInput = document.getElementById('randomize');
  const jitterInput = document.getElementById('jitterMs');
  const filterTermsInput = document.getElementById('filterTerms');
  const resetFiltersBtn = document.getElementById('resetFilters');
  const startUnfollowBtn = document.getElementById('startUnfollow');
  const stopUnfollowBtn = document.getElementById('stopUnfollow');

  // session counters (ephemeral per-popup session). Reset when Start is pressed.
  let sessionCount = 0;
  let sessionActive = false;
  const sessionEl = document.getElementById('sessionCount');
  function setSessionCount(n) {
    sessionCount = n || 0;
    if (sessionEl) sessionEl.innerText = sessionCount;
  }
  setSessionCount(0);

  startBtn.addEventListener('click', () => {
    const intervalMs = parseInt(document.getElementById('intervalMs').value, 10) || 3000;
    const perTick = parseInt(document.getElementById('perTick').value, 10) || 1;
    // gather options
    const options = {
      scrollAmount: parseInt(scrollAmountInput.value, 10) || 300,
      randomize: !!randomizeInput.checked,
      jitterMs: parseInt(jitterInput.value, 10) || 1000,
      filters: (filterTermsInput && filterTermsInput.value) ? filterTermsInput.value.split(',').map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase()) : ['assignment','helper','exam','essay'],
      clickGap: 350
    };
    // persist options
    chrome.storage.local.set({ autoFollowOptions: options });

    // reset session counter when starting
    setSessionCount(0);
    sessionActive = true;

    queryActiveTab((tab) => {
      if (!tab) return alert('No active tab');
      sendToContent(tab.id, { command: 'start', intervalMs, perTick, options }, (resp) => {
        updateStatus();
      });
    });
  });

  // Unfollow start/stop
  if (startUnfollowBtn) {
    startUnfollowBtn.addEventListener('click', () => {
      const intervalMs = parseInt(document.getElementById('intervalMs').value, 10) || 3000;
      const perTick = parseInt(document.getElementById('perTick').value, 10) || 1;
      const options = {
        scrollAmount: parseInt(scrollAmountInput.value, 10) || 300,
        randomize: !!randomizeInput.checked,
        jitterMs: parseInt(jitterInput.value, 10) || 1000
      };
      // store options and attempt to start unfollowing in the active tab
      chrome.storage.local.set({ autoUnfollowOptions: options });
      console.log('Starting unfollow with options', options);
      if (startUnfollowBtn) startUnfollowBtn.disabled = true;
      const statEl = document.getElementById('statusIndicator');
      if (statEl) { statEl.textContent = 'Starting Unfollow...'; statEl.classList.remove('stopped'); statEl.classList.add('running'); }
      const opMsg = document.getElementById('operationMsg');
      if (opMsg) opMsg.textContent = 'Injecting content script...';
      queryActiveTab((tab) => {
        if (!tab) {
          if (opMsg) opMsg.textContent = 'No active tab found.';
          alert('No active tab');
          if (startUnfollowBtn) startUnfollowBtn.disabled = false;
          if (statEl) { statEl.textContent = 'Stopped'; statEl.classList.remove('running'); statEl.classList.add('stopped'); }
          return;
        }
        // explicitly inject content.js first to ensure listener exists
        try {
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, () => {
            if (chrome.runtime.lastError) {
              const err = chrome.runtime.lastError.message || 'Unknown inject error';
              console.warn('scripting.executeScript error', err);
              if (opMsg) opMsg.textContent = 'Injection error: ' + err;
              alert('Could not inject content script: ' + err);
              if (startUnfollowBtn) startUnfollowBtn.disabled = false;
              if (statEl) { statEl.textContent = 'Stopped'; statEl.classList.remove('running'); statEl.classList.add('stopped'); }
              return;
            }
            if (opMsg) opMsg.textContent = 'Starting unfollow in page...';
            // now send start message
            sendToContent(tab.id, { command: 'startUnfollow', intervalMs, perTick, options }, (resp) => {
              if (!resp) {
                console.warn('startUnfollow: no response');
                if (opMsg) opMsg.textContent = 'No response from content script.';
                alert('No response from content script — ensure you have an Instagram tab open.');
                if (startUnfollowBtn) startUnfollowBtn.disabled = false;
                if (statEl) { statEl.textContent = 'Stopped'; statEl.classList.remove('running'); statEl.classList.add('stopped'); }
                return;
              }
              if (resp.error) {
                console.warn('startUnfollow error', resp.error);
                if (opMsg) opMsg.textContent = 'Error: ' + resp.error;
                alert('Error starting unfollow: ' + resp.error);
                if (startUnfollowBtn) startUnfollowBtn.disabled = false;
                if (statEl) { statEl.textContent = 'Stopped'; statEl.classList.remove('running'); statEl.classList.add('stopped'); }
                return;
              }
              console.log('startUnfollow response', resp);
              if (opMsg) opMsg.textContent = 'Unfollow started';
              updateStatus();
            });
          });
        } catch (e) {
          console.warn('inject failed', e && e.message);
          if (opMsg) opMsg.textContent = 'Injection failed: ' + (e && e.message);
          alert('Injection failed: ' + (e && e.message));
          if (startUnfollowBtn) startUnfollowBtn.disabled = false;
          if (statEl) { statEl.textContent = 'Stopped'; statEl.classList.remove('running'); statEl.classList.add('stopped'); }
        }
      });
    });
  }

  if (stopUnfollowBtn) {
    stopUnfollowBtn.addEventListener('click', () => {
      queryActiveTab((tab) => {
        if (!tab) return;
        sendToContent(tab.id, { command: 'stopUnfollow' }, (resp) => {
          updateStatus();
        });
      });
    });
  }

  stopBtn.addEventListener('click', () => {
    queryActiveTab((tab) => {
      if (!tab) return;
      sendToContent(tab.id, { command: 'stop' }, (resp) => {
        updateStatus();
        sessionActive = false;
      });
    });
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear followed accounts list?')) return;
    chrome.storage.local.set({ followedAccounts: [] }, () => {
      refreshList();
    });
  });

  // refresh UI
  refreshList();
  try { refreshUnfollowList(); } catch (e) {}
  updateStatus();

  // load saved options (including filters)
  chrome.storage.local.get({
    autoFollowOptions: { scrollAmount: 300, randomize: false, jitterMs: 1000, filters: ['assignment','helper','exam','essay'] },
    autoUnfollowOptions: { scrollAmount: 300, randomize: false, jitterMs: 1000, filterActive: false, filters: [] }
  }, (res) => {
    const o = res.autoFollowOptions || {};
    scrollAmountInput.value = o.scrollAmount || 300;
    randomizeInput.checked = !!o.randomize;
    jitterInput.value = o.jitterMs || 1000;
    const filters = o.filters || ['assignment','helper','exam','essay'];
    if (filterTermsInput) filterTermsInput.value = filters.join(',');

    const u = res.autoUnfollowOptions || {};
    // legacy: keep scroll/randomize/jitter if stored
    if (u.scrollAmount) scrollAmountInput.value = u.scrollAmount;
    if (typeof u.randomize !== 'undefined') randomizeInput.checked = !!u.randomize;
    if (u.jitterMs) jitterInput.value = u.jitterMs;
  });

  if (resetFiltersBtn && filterTermsInput) {
    resetFiltersBtn.addEventListener('click', () => {
      const defaults = ['assignment','helper','exam','essay'];
      filterTermsInput.value = defaults.join(',');
    });
  }

  // refresh unfollow list
  function refreshUnfollowList() {
    chrome.storage.local.get({ unfollowedAccounts: [] }, (res) => {
      const arr = (res.unfollowedAccounts || []).slice().sort((a,b)=>b.ts - a.ts);
      const total = arr.length;
      const countEl = document.getElementById('unfollowedListCount');
      if (countEl) countEl.innerText = total;
      const ul = document.getElementById('unfollowedList');
      if (!ul) return;
      ul.innerHTML = '';
      for (const item of arr) {
        const li = document.createElement('li');
        const d = new Date(item.ts);
        const name = document.createElement('span');
        name.textContent = item.username;
        const t = document.createElement('time');
        t.dateTime = new Date(item.ts).toISOString();
        t.textContent = d.toLocaleString();
        li.appendChild(name);
        li.appendChild(t);
        ul.appendChild(li);
      }
    });
  }

  // also poll for updates periodically
  setInterval(() => {
    refreshList();
    refreshUnfollowList();
    updateStatus();
  }, 2000);

  // wire up help toggle
  const helpBtn = document.getElementById('helpBtn');
  const helpPanel = document.getElementById('helpPanel');
  if (helpBtn && helpPanel) {
    helpBtn.addEventListener('click', () => {
      helpPanel.classList.toggle('hidden');
    });
  }

  // Manual panel toggle (hidden by default)
  const toggleManualBtn = document.getElementById('toggleManualBtn');
  const manualPanel = document.getElementById('manualPanel');
  if (toggleManualBtn && manualPanel) {
    toggleManualBtn.addEventListener('click', () => {
      const hidden = manualPanel.classList.toggle('hidden');
      toggleManualBtn.title = hidden ? 'Show manual add' : 'Hide manual add';
    });
  }

  // tiny info popups
  function removeInfoPopups() {
    const ex = document.querySelectorAll('.info-popup');
    ex.forEach(e => e.remove());
  }

  function showInfoPopup(btn, text) {
    removeInfoPopups();
    const rect = btn.getBoundingClientRect();
    const div = document.createElement('div');
    div.className = 'info-popup';
    div.textContent = text;
    document.body.appendChild(div);
    // position
    const left = Math.min(window.innerWidth - 180, rect.left + rect.width + 6);
    div.style.position = 'fixed';
    div.style.left = `${left}px`;
    div.style.top = `${rect.top + window.scrollY + rect.height + 6}px`;
    setTimeout(() => div.remove(), 4500);
  }

  const infoBtns = document.querySelectorAll('.tiny-info');
  infoBtns.forEach(b => {
    b.addEventListener('click', (ev) => {
      const t = b.getAttribute('data-info') || 'Info';
      showInfoPopup(b, t);
      ev.stopPropagation();
    });
  });

  // collapse/expand followed list
  const toggleList = document.getElementById('toggleList');
  const followedWrap = document.getElementById('followedListWrap');
  if (toggleList && followedWrap) {
    toggleList.addEventListener('click', () => {
      followedWrap.classList.toggle('hidden');
      toggleList.classList.toggle('open');
    });
  }

  // collapse/expand unfollowed list and clear history
  const toggleUnfollowList = document.getElementById('toggleUnfollowList');
  const unfollowedWrap = document.getElementById('unfollowedListWrap');
  const clearUnfollowedBtn = document.getElementById('clearUnfollowed');
  if (toggleUnfollowList && unfollowedWrap) {
    toggleUnfollowList.addEventListener('click', () => {
      unfollowedWrap.classList.toggle('hidden');
      toggleUnfollowList.classList.toggle('open');
    });
  }
  if (clearUnfollowedBtn) {
    clearUnfollowedBtn.addEventListener('click', () => {
      if (!confirm('Clear unfollowed accounts history?')) return;
      chrome.storage.local.set({ unfollowedAccounts: [] }, () => {
        refreshUnfollowList();
      });
    });
  }

  // daily breakdown toggle
  const toggleBreakdown = document.getElementById('toggleBreakdown');
  const breakdownWrap = document.getElementById('dailyBreakdown');
  if (toggleBreakdown && breakdownWrap) {
    toggleBreakdown.addEventListener('click', () => {
      const show = breakdownWrap.classList.toggle('hidden');
      toggleBreakdown.textContent = show ? 'Show daily breakdown' : 'Hide daily breakdown';
    });
  }

  // close info popup when clicking outside
  document.addEventListener('click', () => removeInfoPopups());

  // Manual add handlers
  const parseAddBtn = document.getElementById('parseAddBtn');
  const manualHtml = document.getElementById('manualHtml');
  const manualUsername = document.getElementById('manualUsername');
  const addUsernameBtn = document.getElementById('addUsernameBtn');
  const manualMsg = document.getElementById('manualMsg');

  function extractUsernameFromHtmlString(htmlString) {
    try {
      const temp = document.createElement('div');
      temp.innerHTML = htmlString;
      const anchors = temp.querySelectorAll('a[href]');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (!href) continue;
        if (href.includes('/p/') || href.includes('/explore/') || href.includes('/reel/')) continue;
        // /username/ or /username
        const m = href.match(/^\/([^\/?#]+)\/?$/);
        if (m) return m[1];
        const m2 = href.match(/instagram\.com\/([^\/?#]+)/);
        if (m2) return m2[1];
      }
      // fallback: look for data-username attributes or text like @username
      const usernameAttr = temp.querySelector('[data-username]');
      if (usernameAttr) return usernameAttr.getAttribute('data-username');
      const text = temp.textContent || '';
      const atMatch = text.match(/@([a-zA-Z0-9._]+)/);
      if (atMatch) return atMatch[1];
    } catch (e) {
      console.warn('extractUsernameFromHtmlString error', e);
    }
    return null;
  }

  function addToFollowed(username) {
    username = (username||'').trim().replace(/^@/,'');
    if (!username) {
      manualMsg.textContent = 'Invalid username';
      return;
    }
    chrome.storage.local.get({ followedAccounts: [] }, (res) => {
      const arr = res.followedAccounts || [];
      // dedupe
      if (arr.find(x => x.username && x.username.toLowerCase() === username.toLowerCase())) {
        manualMsg.textContent = 'Already in list';
        return refreshList();
      }
      arr.push({ username, ts: Date.now() });
      chrome.storage.local.set({ followedAccounts: arr }, () => {
        manualMsg.textContent = 'Added: ' + username;
        manualMsg.classList.add('manual-success');
        setTimeout(() => {
          manualMsg.textContent = '';
          manualMsg.classList.remove('manual-success');
        }, 2500);
        manualHtml.value = '';
        manualUsername.value = '';
        refreshList();
      });
    });
  }

  if (parseAddBtn) {
    parseAddBtn.addEventListener('click', () => {
      const html = manualHtml.value && manualHtml.value.trim();
      if (!html) {
        manualMsg.textContent = 'Paste outerHTML or provide a username';
        return;
      }
      const u = extractUsernameFromHtmlString(html);
      if (u) {
        addToFollowed(u);
      } else {
        manualMsg.textContent = 'Could not parse username from HTML';
      }
    });
  }

  if (addUsernameBtn) {
    addUsernameBtn.addEventListener('click', () => {
      const u = manualUsername.value && manualUsername.value.trim();
      if (!u) {
        manualMsg.textContent = 'Enter a username';
        return;
      }
      addToFollowed(u.replace(/^@/, ''));
    });
  }

  // (Live activity log removed) Manual Add remains hidden by default

  // Listen for followedAccounts changes and increment session counter when sessionActive
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    try {
      if (changes.followedAccounts) {
        const oldVal = changes.followedAccounts.oldValue || [];
        const newVal = changes.followedAccounts.newValue || [];
        if (sessionActive && newVal.length > oldVal.length) {
          const added = newVal.length - oldVal.length;
          setSessionCount(sessionCount + added);
        }
      }
      if (changes.unfollowedAccounts) {
        try { refreshUnfollowList(); } catch (e) {}
      }
    } catch (e) {
      console.warn('storage change handler error', e);
    }
  });
});
