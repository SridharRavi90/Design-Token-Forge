/* ════════════════════════════════════════════════════════════
   Design Token Forge — Shared Demo JS
   Nav dropdown, theme toggle, sidebar IntersectionObserver.
   Each page can set  window.DTF.onThemeChange = fn;
   to hook into theme switches (e.g. refresh an inspector).
   ════════════════════════════════════════════════════════════ */

window.DTF = window.DTF || { onThemeChange: null };

/* One-time migration: the legacy unscoped `dtf-saved-tokens` key was
   overwritten on every project visit, which caused cross-project
   bleed (visit project A, switch to project B whose scoped stash is
   empty, fall back to unscoped key which still holds A's tokens).
   Purge it once and forever; per-project keys (`dtf-saved-tokens-<id>`)
   are the only source of truth now. */
try {
  if (!localStorage.getItem('dtf-mig-unscoped-tokens-purged')) {
    localStorage.removeItem('dtf-saved-tokens');
    localStorage.setItem('dtf-mig-unscoped-tokens-purged', '1');
  }
} catch (e) {}

/* If a ?project=<id> param is on the URL (e.g. the editor's "Preview
   components" link, or any cross-page nav), promote it to the active
   project before the selector wires up. Demo pages already react to
   dtf-active-project on load, so this is enough to make the project
   travel across pages. */
(function () {
  try {
    var pid = new URLSearchParams(location.search).get('project');
    if (!pid) return;
    var prev = localStorage.getItem('dtf-active-project');
    localStorage.setItem('dtf-active-project', pid);
    // If this browser has never cached this project's tokens, the
    // "Inject Saved Color Tokens" block below would render with
    // package defaults forever. Schedule an apply once the selector
    // IIFE has installed window.DTF.applyProjectTokens.
    var hasCache = !!localStorage.getItem('dtf-saved-tokens-' + pid);
    if (!hasCache || prev !== pid) {
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (window.DTF && typeof window.DTF.applyProjectTokens === 'function') {
          clearInterval(iv);
          window.DTF.applyProjectTokens(pid);
        } else if (tries > 40) { clearInterval(iv); }
      }, 25);
    }
  } catch (e) {}
})();

/* ── Project Selector (injected into nav bar on every page) ── */
(function(){
  /* index.html, hub.html, and onboard.html have their own dedicated project
     bar (or no bar at all) — skip the project selector IIFE on those pages */
  var path = location.pathname;
  var filename = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
  if (filename === 'index.html' || filename === 'hub.html' || filename === 'onboard.html') return;

  /* Mount into the <dtf-topbar> left-crumb project slot when available,
     fall back to the right-side .nav-actions for any legacy bar. The
     web component may upgrade after this IIFE runs, so retry briefly. */
  function findMount() {
    return document.querySelector('dtf-topbar [data-slot="project"]')
        || document.querySelector('.nav-actions');
  }
  var nav = findMount();
  if (!nav) {
    var tries = 0;
    var iv = setInterval(function () {
      nav = findMount();
      if (nav) { clearInterval(iv); _mount(nav); }
      else if (++tries > 40) clearInterval(iv);
    }, 25);
    return;
  }
  _mount(nav);

  function _mount(nav) {

  var depth = (location.pathname.indexOf('/components/') !== -1) ? '..' : '.';

  /* ── Build DOM — pill chip (mock Option C) ── */
  var wrap = document.createElement('div');
  wrap.className = 'nav-project';
  var host = document.createElement('div');
  host.className = 'nav-project-host';
  var label = document.createElement('span');
  label.className = 'nav-project-label';
  label.textContent = 'Project';

  var ddWrap = document.createElement('div');
  ddWrap.className = 'nav-proj-wrap';
  var ddBtn = document.createElement('button');
  ddBtn.className = 'nav-proj-btn';
  ddBtn.type = 'button';
  ddBtn.setAttribute('aria-haspopup', 'listbox');
  ddBtn.setAttribute('aria-expanded', 'false');
  ddBtn.textContent = '…';
  var ddPanel = document.createElement('div');
  ddPanel.className = 'nav-proj-panel';
  ddWrap.appendChild(ddBtn);

  wrap.appendChild(label);
  wrap.appendChild(ddWrap);

  /* Inline rename + delete action buttons for the active project */
  var renActBtn = document.createElement('button');
  renActBtn.className = 'nav-project-action';
  renActBtn.type = 'button';
  renActBtn.title = 'Rename project';
  renActBtn.setAttribute('aria-label', 'Rename project');
  renActBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  renActBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var active = cachedList.find(function (p) { return p.id === currentId; });
    if (active) doRename(active);
  });

  var delActBtn = document.createElement('button');
  delActBtn.className = 'nav-project-action nav-project-del';
  delActBtn.type = 'button';
  delActBtn.title = 'Delete project';
  delActBtn.setAttribute('aria-label', 'Delete project');
  delActBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
  delActBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var active = cachedList.find(function (p) { return p.id === currentId; });
    if (active) doDelete(active);
  });

  wrap.appendChild(renActBtn);
  wrap.appendChild(delActBtn);

    /* The panel must live OUTSIDE .nav-project because that pill clips
      overflow to preserve rounded corners for inner zones. */
    host.appendChild(wrap);
    host.appendChild(ddPanel);

  /* If we're mounting into the legacy right-side .nav-actions, keep the
     old before-theme-toggle insertion. In the project slot we just append. */
  if (nav.classList.contains('nav-actions')) {
    var toggle = document.getElementById('themeToggle');
    if (toggle) nav.insertBefore(host, toggle);
    else nav.appendChild(host);
  } else {
    nav.appendChild(host);
  }

  /* ── State ── */
  var currentId = localStorage.getItem('dtf-active-project') || '';
  var panelOpen = false;
  var cachedList = []; /* last-known project list for switching */
  var authExpired = false;

  /* Catalyst user identity — set by auth-gate.js after Catalyst SDK resolves.
     The user_id (e.g. "60040413786") is the routing key used to build
     personalized paths like /{userId}/pearl/editor.html.
     Falls back to window.DTF_AUTH if sessionStorage hasn't been populated yet. */
  function _getCatalystUserId() {
    try {
      var uid = sessionStorage.getItem('dtf-catalyst-uid') || '';
      if (uid) return uid;
    } catch (_e) {}
    if (window.DTF_AUTH && window.DTF_AUTH.user) return window.DTF_AUTH.user.userId || '';
    return '';
  }

  /* Legacy GitHub API vars — kept as no-ops so existing call sites don't throw.
     Project CRUD (rename/delete) will be migrated to Catalyst DataStore API. */
  var ghApiBase = '';
  var ghToken = '';
  var ghHdrs = { 'Accept': 'application/json' };

  /* Set button text to active project name */
  function syncBtnLabel() {
    var active = cachedList.find(function(p){ return p.id === currentId; });
    ddBtn.textContent = active ? (active.name || active.id) : (currentId || '…');
  }

  /* Helper: check if a project entry belongs to the current user.
     Matches by ownerEmail first (most reliable), falls back to owner. */
  function _isMyProject(p) {
    var userEmail = _getCatalystEmail();
    if (!userEmail) return true; /* no identity — show all */
    if (p.ownerEmail && p.ownerEmail.toLowerCase() === userEmail) return true;
    if (!p.ownerEmail && p.owner) {
      var localPart = userEmail.split('@')[0].replace(/[.\-_]/g, '').toLowerCase();
      var ownerNorm = p.owner.replace(/[.\-_]/g, '').toLowerCase();
      return ownerNorm.indexOf(localPart) !== -1 || localPart.indexOf(ownerNorm) !== -1;
    }
    return false;
  }

  /* ── Visibility filter (owner + deleted) ── */
  function getVisibleProjects(list) {
    var deletedRaw = localStorage.getItem('dtf-deleted-projects');
    var deleted = [];
    try { deleted = JSON.parse(deletedRaw) || []; } catch(e) {}
    return list.filter(function(p) {
      return deleted.indexOf(p.id) === -1 && _isMyProject(p);
    });
  }

  /* ── Render items into panel ── */
  function renderPanel(list) {
    ddPanel.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'nav-proj-loading';
      empty.textContent = 'No projects';
      ddPanel.appendChild(empty);
      return;
    }

    /* Group: mine (always true here since list is pre-filtered) */
    var mine = list;
    var others = [];

    mine.forEach(function(proj) { ddPanel.appendChild(_buildRow(proj, true)); });

    if (others.length) {
      var sep = document.createElement('div');
      sep.className = 'nav-proj-sep';
      ddPanel.appendChild(sep);
      var groupLabel = document.createElement('div');
      groupLabel.className = 'nav-proj-group-label';
      groupLabel.textContent = 'Others\u2019 Projects';
      ddPanel.appendChild(groupLabel);
      others.forEach(function(proj) { ddPanel.appendChild(_buildRow(proj, false)); });
    }
  }

  function _buildRow(proj, isOwner) {
    var row = document.createElement('button');
    row.className = 'nav-proj-item' + (isOwner ? '' : ' nav-proj-item-muted');
    row.type = 'button';
    if (proj.id === currentId) row.setAttribute('data-active', '');

    var nameEl = document.createElement('span');
    nameEl.className = 'nav-proj-item-name';
    nameEl.textContent = proj.name || proj.id;
    row.appendChild(nameEl);

    if (isOwner) {
      /* Action buttons (rename + delete) — only for own projects */
      var actions = document.createElement('span');
      actions.className = 'nav-proj-item-actions';

      var renBtn = document.createElement('button');
      renBtn.className = 'nav-proj-item-act';
      renBtn.type = 'button';
      renBtn.title = 'Rename';
      renBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
      renBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        doRename(proj);
      });

      var delBtn = document.createElement('button');
      delBtn.className = 'nav-proj-item-act del';
      delBtn.type = 'button';
      delBtn.title = 'Delete';
      delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        doDelete(proj);
      });

      actions.appendChild(renBtn);
      actions.appendChild(delBtn);
      row.appendChild(actions);
    }

    /* Click row → switch project */
    row.addEventListener('click', function() {
      selectProject(proj.id);
      closePanel();
    });

    return row;
  }

  /* ── Fetch live projects from static projects.json filtered to current user ── */
  var pagesBase = depth + '/projects.json?_cb=' + Date.now();

  function _getCatalystEmail() {
    try {
      var email = sessionStorage.getItem('dtf-catalyst-email') || '';
      if (email) return email.toLowerCase();
    } catch (_e) {}
    if (window.DTF_AUTH && window.DTF_AUTH.user) return (window.DTF_AUTH.user.email || '').toLowerCase();
    return '';
  }

  function fetchLiveProjects(cb) {
    /* Catalyst auth: match projects by Zoho email (ownerEmail field in
       projects.json). Falls back to matching by owner (GitHub username)
       if ownerEmail is not set — backwards compat for older projects. */
    var userEmail = _getCatalystEmail();
    fetch(pagesBase, { cache: 'no-cache' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(list) {
        if (!list || !Array.isArray(list)) { cb([]); return; }
        if (!userEmail) {
          /* No email yet — show nothing until auth resolves. */
          cb([]);
          return;
        }
        /* Filter: match by ownerEmail first, then fall back to owner field */
        var mine = list.filter(function(p) {
          if (p.ownerEmail && p.ownerEmail.toLowerCase() === userEmail) return true;
          /* Legacy fallback: if no ownerEmail, keep the project if owner
             matches the email's local part (e.g. sridhar.ravi matches
             sridhar-ravi-2917) — loose heuristic, better than nothing. */
          if (!p.ownerEmail && p.owner) {
            var localPart = userEmail.split('@')[0].replace(/[.\-_]/g, '').toLowerCase();
            var ownerNorm = p.owner.replace(/[.\-_]/g, '').toLowerCase();
            return ownerNorm.indexOf(localPart) !== -1 || localPart.indexOf(ownerNorm) !== -1;
          }
          return false;
        });
        cb(mine);
      })
      .catch(function() { cb([]); });
  }

  function _fetchFromStatic(cb) {
    fetch(pagesBase, { cache: 'no-cache' }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(list){
        if (list && Array.isArray(list) && list.length) { cb(list); return; }
        _fetchFromApi(cb);
      }).catch(function(){ _fetchFromApi(cb); });
  }

  function _fetchFromApi(cb) {
    fetch(ghApiBase + '/contents/projects?ref=main&_cb=' + Date.now(), { headers: ghHdrs })
      .then(function(r){
        if (r.status === 401 || r.status === 403) {
          authExpired = true;
          try { sessionStorage.removeItem('dtf-auth-ok'); } catch (e) {}
          return [];
        }
        authExpired = false;
        return r.ok ? r.json() : null;
      })
      .then(function(dirs){
        if (!dirs || !Array.isArray(dirs)) { cb(null); return; }
        var projects = dirs.filter(function(d){ return d.type === 'dir'; });
        var results = []; var pending = projects.length;
        if (pending === 0) { cb([]); return; }
        projects.forEach(function(dir){
          fetch(ghApiBase + '/contents/projects/' + dir.name + '/config.json?ref=main', { headers: ghHdrs })
            .then(function(r){ return r.ok ? r.json() : null; })
            .then(function(file){
              if (file && file.content) {
                try {
                  var cfg = JSON.parse(atob(file.content.replace(/\n/g, '')));
                  results.push({ id: cfg.id || dir.name, name: cfg.name || dir.name, owner: cfg.owner || '' });
                } catch(e) { results.push({ id: dir.name, name: dir.name, owner: '' }); }
              }
            }).catch(function(){})
            .finally(function(){
              pending--;
              if (pending === 0) cb(results);
            });
        });
      }).catch(function(){ cb(null); });
  }

  /* ── Open / close panel ── */
  function openPanel() {
    panelOpen = true;
    ddPanel.setAttribute('data-open', '');
    /* Show loading state immediately */
    ddPanel.innerHTML = '';
    var loader = document.createElement('div');
    loader.className = 'nav-proj-loading';
    loader.textContent = 'Loading…';
    ddPanel.appendChild(loader);
    /* Fetch fresh list */
    fetchLiveProjects(function(list) {
      if (!panelOpen) return; /* closed before fetch completed */
      if (list && list.length) {
        /* Clean deleted */
        var remoteIds = list.map(function(p){ return p.id; });
        try {
          var delList = JSON.parse(localStorage.getItem('dtf-deleted-projects') || '[]');
          var cleaned = delList.filter(function(id){ return remoteIds.indexOf(id) !== -1; });
          if (cleaned.length !== delList.length) localStorage.setItem('dtf-deleted-projects', JSON.stringify(cleaned));
        } catch(e) {}
        /* Only keep the currently-active project if it's not in remote yet (just-created) */
        if (currentId && !list.some(function(p){ return p.id === currentId; })) {
          var localKnown = [];
          try { localKnown = JSON.parse(localStorage.getItem('dtf-known-projects') || '[]'); } catch(e) {}
          var activeLocal = localKnown.find(function(p){ return p.id === currentId; });
          if (activeLocal) list.push(activeLocal);
        }
        localStorage.setItem('dtf-known-projects', JSON.stringify(list));
        cachedList = list;
        var visible = getVisibleProjects(list);
        renderPanel(visible);
        syncBtnLabel();
      } else if (list !== null && list.length === 0) {
        var localList = [];
        try { localList = JSON.parse(localStorage.getItem('dtf-known-projects') || '[]'); } catch(e) {}
        if (localList.length > 0) {
          cachedList = localList;
          renderPanel(getVisibleProjects(localList));
        } else if (authExpired) {
          ddPanel.innerHTML = '';
          var expired = document.createElement('button');
          expired.type = 'button';
          expired.className = 'nav-proj-item';
          expired.textContent = 'Session expired — re-authenticate';
          expired.addEventListener('click', function () {
            if (typeof window.DtfAuthLogout === 'function') window.DtfAuthLogout();
            else window.location.reload();
          });
          ddPanel.appendChild(expired);
        } else {
          renderPanel([]);
        }
      } else {
        /* API failed — show cached */
        renderPanel(getVisibleProjects(cachedList));
      }
    });
  }

  function closePanel() {
    panelOpen = false;
    ddPanel.removeAttribute('data-open');
    ddBtn.setAttribute('aria-expanded', 'false');
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else {
      openPanel();
      ddBtn.setAttribute('aria-expanded', 'true');
    }
  }

  /* Toggle on button click */
  ddBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    togglePanel();
  });

  /* Make the PROJECT label a valid hit target too. */
  label.style.cursor = 'pointer';
  label.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePanel();
  });

  /* Close on outside click */
  document.addEventListener('click', function(e) {
    if (panelOpen && !host.contains(e.target)) closePanel();
  });

  /* Close on Escape */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && panelOpen) closePanel();
  });

  /* ── Select a project ── */
  function selectProject(newId) {
    if (!newId || newId === currentId) return;
    currentId = newId;
    localStorage.setItem('dtf-active-project', newId);
    syncBtnLabel();

    /* On deployed per-project sites, navigate to the other project's URL */
    var loc = location.pathname;
    var knownIds = cachedList.map(function(p) { return p.id; });
    var segments = loc.split('/');
    var demoIdx = segments.lastIndexOf('demo');
    if (demoIdx > 0) {
      var curSlug = segments[demoIdx - 1];
      if (curSlug && curSlug !== newId && knownIds.indexOf(curSlug) !== -1) {
        segments[demoIdx - 1] = newId;
        location.href = segments.join('/');
        return;
      }
    }
    _applyProjectTokens(newId);
  }

  /* ── Rename project (API call) ── */
  function doRename(proj) {
    var newName = prompt('Rename project:', proj.name || proj.id);
    if (!newName || newName === proj.name) return;
    if (!ghToken) {
      var token = prompt('Enter your GitHub personal access token (repo scope) to rename:');
      if (!token || !token.trim()) return;
      token = token.trim();
      localStorage.setItem('dtf-gh-pat', token);
      ghToken = token;
      ghHdrs = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
    }
    /* Fetch current config.json to get its SHA */
    var cfgPath = 'projects/' + proj.id + '/config.json';
    fetch(ghApiBase + '/contents/' + cfgPath + '?ref=main', { headers: ghHdrs })
      .then(function(r){ return r.ok ? r.json() : Promise.reject(r); })
      .then(function(file){
        var cfg = JSON.parse(atob(file.content.replace(/\n/g, '')));
        cfg.name = newName;
        var body = JSON.stringify({
          message: 'Rename project ' + proj.id + ' to ' + newName,
          content: btoa(JSON.stringify(cfg, null, 2)),
          sha: file.sha,
          branch: 'main'
        });
        return fetch(ghApiBase + '/contents/' + cfgPath, {
          method: 'PUT', headers: ghHdrs, body: body
        });
      })
      .then(function(r){
        if (!r.ok) return Promise.reject(r);
        proj.name = newName;
        /* Update localStorage */
        cachedList.forEach(function(p){ if(p.id === proj.id) p.name = newName; });
        localStorage.setItem('dtf-known-projects', JSON.stringify(cachedList));
        syncBtnLabel();
        renderPanel(getVisibleProjects(cachedList));
      })
      .catch(function(err){ alert('Rename failed. Check permissions.'); console.error(err); });
  }

  /* ── Delete project (API call) ── */
  function doDelete(proj) {
    var token = ghToken;
    if (!token) {
      token = prompt('To delete "' + (proj.name || proj.id) + '", enter your GitHub personal access token (repo scope):');
      if (!token || !token.trim()) return;
      token = token.trim();
      /* Save for this session */
      localStorage.setItem('dtf-gh-pat', token);
      ghToken = token;
      ghHdrs = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
    }
    var ghUser = localStorage.getItem('dtf-gh-user') || '';

    /* Only the project owner (or upstream admin) can delete */
    var projOwner = (proj.owner || '').toLowerCase();
    if (projOwner && ghUser.toLowerCase() !== projOwner && ghUser.toLowerCase() !== upstreamOwner.toLowerCase()) {
      alert('You cannot delete this project. It belongs to "' + (proj.owner) + '".');
      return;
    }

    if (!confirm('Delete project "' + (proj.name || proj.id) + '"? This cannot be undone.')) return;

    /* Immediately update UI (don't wait for API) */
    cachedList = cachedList.filter(function(p){ return p.id !== proj.id; });
    localStorage.setItem('dtf-known-projects', JSON.stringify(cachedList));
    var delList = [];
    try { delList = JSON.parse(localStorage.getItem('dtf-deleted-projects') || '[]'); } catch(e) {}
    if (delList.indexOf(proj.id) === -1) delList.push(proj.id);
    localStorage.setItem('dtf-deleted-projects', JSON.stringify(delList));
    renderPanel(getVisibleProjects(cachedList));
    if (currentId === proj.id) {
      var visible = getVisibleProjects(cachedList);
      if (visible.length) { selectProject(visible[0].id); }
      else { localStorage.removeItem('dtf-active-project'); window.location.href = 'onboard.html'; return; }
    }
    syncBtnLabel();

    /* Background: delete files from repo + write log */
    var dirPath = 'projects/' + proj.id;
    fetch(ghApiBase + '/contents/' + dirPath + '?ref=main', { headers: ghHdrs })
      .then(function(r){ return r.ok ? r.json() : Promise.reject(r); })
      .then(function(items){
        if (!Array.isArray(items)) items = [items];
        var delPromises = items.filter(function(f){ return f.type === 'file'; }).map(function(f){
          return fetch(ghApiBase + '/contents/' + f.path, {
            method: 'DELETE',
            headers: ghHdrs,
            body: JSON.stringify({ message: 'Delete ' + f.path + ' [by ' + ghUser + ']', sha: f.sha, branch: 'main' })
          });
        });
        return Promise.all(delPromises);
      })
      .then(function(){ return _appendDeletionLog(proj, ghUser); })
      .then(function(){ return _removeFromProjectsJson(proj.id); })
      .catch(function(err){ console.error('[DTF] Delete API failed:', err); });
  }

  /* ── Remove entry from projects.json in the repo ── */
  function _removeFromProjectsJson(projId) {
    return fetch(ghApiBase + '/contents/projects.json?ref=main', { headers: ghHdrs })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(file){
        if (!file || !file.content) return;
        var idx = [];
        try { idx = JSON.parse(atob(file.content.replace(/\n/g, ''))); } catch(e) { return; }
        var filtered = idx.filter(function(p){ return p.id !== projId; });
        if (filtered.length === idx.length) return; /* not in list */
        var body = JSON.stringify({
          message: 'Remove ' + projId + ' from projects.json',
          content: btoa(unescape(encodeURIComponent(JSON.stringify(filtered, null, 2) + '\n'))),
          sha: file.sha,
          branch: 'main'
        });
        return fetch(ghApiBase + '/contents/projects.json', { method: 'PUT', headers: ghHdrs, body: body });
      })
      .catch(function(e){ console.warn('[DTF] projects.json removal failed:', e); });
  }

  /* ── Append entry to projects/_log.json in the repo ── */
  function _appendDeletionLog(proj, user) {
    var logPath = 'projects/_log.json';
    return fetch(ghApiBase + '/contents/' + logPath + '?ref=main', { headers: ghHdrs })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(file){
        var log = [];
        if (file && file.content) {
          try { log = JSON.parse(atob(file.content.replace(/\n/g, ''))); } catch(e) { log = []; }
        }
        log.push({ action: 'delete', project: proj.id, name: proj.name || proj.id, owner: proj.owner || '', deletedBy: user, date: new Date().toISOString() });
        var body = { message: 'Log deletion of ' + proj.id + ' by ' + user, content: btoa(JSON.stringify(log, null, 2)), branch: 'main' };
        if (file && file.sha) body.sha = file.sha;
        return fetch(ghApiBase + '/contents/' + logPath, {
          method: 'PUT', headers: ghHdrs, body: JSON.stringify(body)
        });
      }).catch(function(e){ console.warn('[DTF] Deletion log write failed:', e); });
  }

  /* ── Initial load: populate from localStorage cache, then set button label ── */
  var knownRaw = localStorage.getItem('dtf-known-projects');
  try { cachedList = JSON.parse(knownRaw) || []; } catch(e) {}
  syncBtnLabel();

  /* Also do a background fetch on page load to validate active project still exists */
  fetchLiveProjects(function(list) {
    if (list && list.length) {
      var remoteIds = list.map(function(p){ return p.id; });
      try {
        var delList = JSON.parse(localStorage.getItem('dtf-deleted-projects') || '[]');
        var cleaned = delList.filter(function(id){ return remoteIds.indexOf(id) !== -1; });
        if (cleaned.length !== delList.length) localStorage.setItem('dtf-deleted-projects', JSON.stringify(cleaned));
      } catch(e) {}
      /* Only keep the currently-active project if it's not in remote yet (just-created) */
      if (currentId && !list.some(function(p){ return p.id === currentId; })) {
        var localKnown = [];
        try { localKnown = JSON.parse(localStorage.getItem('dtf-known-projects') || '[]'); } catch(e) {}
        var activeLocal = localKnown.find(function(p){ return p.id === currentId; });
        if (activeLocal) list.push(activeLocal);
      }
      cachedList = list;
      localStorage.setItem('dtf-known-projects', JSON.stringify(list));
      syncBtnLabel();
      /* If active project was deleted remotely, reset */
      if (currentId && !list.some(function(p){ return p.id === currentId; })) {
        var visible = getVisibleProjects(list);
        if (visible.length) selectProject(visible[0].id);
        else { window.location.href = 'onboard.html'; }
      }
    } else if (list !== null && list.length === 0) {
      var localList = [];
      try { localList = JSON.parse(localStorage.getItem('dtf-known-projects') || '[]'); } catch(e) {}
      if (!localList.length) { window.location.href = 'onboard.html'; }
    }
  });

  /* Helper: apply project tokens by swapping <style> and fetching config */
  var _pendingPid = null; /* guard against rapid switch race conditions */
  function _applyProjectTokens(pid) {
    // Opt-out for pages like onboard that must render with package
    // defaults regardless of active project.
    if (document.documentElement.getAttribute('data-no-project-theme') === '1') return;
    _pendingPid = pid;
    var cached = localStorage.getItem('dtf-saved-tokens-' + pid) || '';

    if (cached) {
      /* Show cached CSS immediately for fast render */
      _injectCSS(cached);
      localStorage.setItem('dtf-saved-tokens', cached);
      _notifyAndRefresh();
    }

    /* Fetch fresh CSS+config from server — but only apply file-based CSS
       if the user hasn't saved edits from Color System for this project. */
    var hasEdits = !!localStorage.getItem('dtf-color-config-' + pid);
    _fetchProjectAssets(pid, function(freshCSS) {
      if (_pendingPid !== pid) return; /* stale — user switched again */
      if (freshCSS && !hasEdits) {
        localStorage.setItem('dtf-saved-tokens-' + pid, freshCSS);
        localStorage.setItem('dtf-saved-tokens', freshCSS);
        if (freshCSS !== cached) {
          _injectCSS(freshCSS);
          _notifyAndRefresh();
        }
      } else if (!cached && !hasEdits) {
        var el = document.getElementById('dtfSavedTokens');
        if (el) el.textContent = '';
        _notifyAndRefresh();
      }
    });
  }

  /* Inject CSS into the dtfSavedTokens <style> element */
  function _injectCSS(css) {
    var el = document.getElementById('dtfSavedTokens');
    if (el) { el.textContent = css; }
    else {
      var s = document.createElement('style');
      s.id = 'dtfSavedTokens';
      s.textContent = css;
      document.head.appendChild(s);
    }
  }

  /* Fetch project config + CSS from server; calls done(assembledCSS or null) */
  function _fetchProjectAssets(pid, done) {
    var configPaths = [
      depth + '/projects/' + pid + '/config.json',  /* local dev */
      depth + '/' + pid + '/config.json'             /* deployed */
    ];

    /* Fetch config (always — may have changed) */
    _tryFetch(configPaths, function(cfgText) {
      if (cfgText) {
        /* Use a separate key so we don't overwrite color-system.html's edited state */
        localStorage.setItem('dtf-raw-config-' + pid, cfgText);
      }
      /* Fetch per-project CSS (primitives + semantic + surfaces) */
      var fetches = [
        { local: depth + '/projects/' + pid + '/primitives.css', deployed: depth + '/' + pid + '/packages/tokens/src/primitives.css' },
        { local: depth + '/projects/' + pid + '/semantic.css',   deployed: depth + '/' + pid + '/packages/tokens/src/semantic.css' },
        { local: depth + '/projects/' + pid + '/surfaces.css',   deployed: depth + '/' + pid + '/packages/tokens/src/surfaces.css' }
      ];
      var pending = fetches.length;
      var parts = [];
      fetches.forEach(function(f, idx) {
        _tryFetch([f.local, f.deployed], function(text) {
          if (text) parts[idx] = text;
          pending--;
          if (pending === 0) {
            var assembled = parts.filter(Boolean).join('\n');
            done(assembled || null);
          }
        });
      });
    });
  }

  /* Try multiple URL paths, call cb with first successful text (or null) */
  function _tryFetch(urls, cb) {
    if (!urls.length) { cb(null); return; }
    fetch(urls[0] + '?_cb=' + Date.now()).then(function(r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function(text) {
      cb(text);
    }).catch(function() {
      _tryFetch(urls.slice(1), cb);
    });
  }

  function _notifyAndRefresh() {
    if (typeof window.DTF.onThemeChange === 'function') {
      requestAnimationFrame(window.DTF.onThemeChange);
    }
  }

  // Expose so cross-IIFE bootstrap (URL-param promotion below)
  // can force a fresh fetch+apply when arriving from another page
  // for a project this browser has never cached.
  window.DTF.applyProjectTokens = _applyProjectTokens;

  } /* end _mount */
})();

/* ── Editor Live-Preview Broadcast ─────────────────────────────────
   Runs BEFORE "Inject Saved Color Tokens" so the MutationObserver is
   registered before #dtfSavedTokens is created.  MutationObserver
   callbacks are microtasks that run before any browser paint, so by
   the time the first frame renders the overlay is already last in
   <head> and live CSS wins — no flash of published colors. ── */
(function () {
  if (document.documentElement.getAttribute('data-no-project-theme') === '1') return;

  var STYLE_ID = 'ev2-live-preview-overlay';

  function activePid() {
    try { return localStorage.getItem('dtf-active-project') || ''; } catch (e) { return ''; }
  }

  function liveKey(pid) {
    return 'ev2-live-preview-' + (pid || '_');
  }

  function applyLiveCSS(css) {
    var el = document.getElementById(STYLE_ID);
    if (css) {
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
      }
      if (el.textContent !== css) el.textContent = css;
      /* Always move to the END of <head> so this overlay wins over
         any token <style> that an async fetch may have inserted after
         us (e.g. the dtfSavedTokens element created by _injectCSS
         when no cached tokens existed on page load). */
      if (document.head.lastChild !== el) document.head.appendChild(el);
    } else {
      if (el) el.textContent = '';
    }
  }

  /* Apply any in-flight live override on page load. */
  var _lastSeen = null; /* null = first run */
  var _lastPid  = '';

  function poll() {
    var pid = activePid();
    var css = '';
    try { css = localStorage.getItem(liveKey(pid)) || ''; } catch (e) {}

    /* If the project changed mid-session, reset so we re-apply. */
    if (pid !== _lastPid) { _lastSeen = null; _lastPid = pid; }

    if (css !== _lastSeen) {
      _lastSeen = css;
      applyLiveCSS(css);
    } else if (css) {
      /* CSS unchanged but something may have injected a style after
         our overlay — re-ensure it is last so it keeps winning. */
      var el = document.getElementById(STYLE_ID);
      if (el && document.head.lastChild !== el) document.head.appendChild(el);
    }
  }

  /* Run once immediately (handles page-load with an open editor). */
  poll();

  /* Poll every 400 ms — fast enough to feel instant, cheap on CPU.
     storage events aren't reliable on file:// so polling is the
     cross-protocol fallback that always works. */
  setInterval(poll, 400);

  /* MutationObserver: whenever anything is appended to <head> while
     live CSS is active, immediately push the overlay back to last so
     async token injections (dtfSavedTokens, font links, etc.) can
     never push our override off the top of the cascade.
     Microtask timing guarantees this fires BEFORE any browser paint. */
  if (window.MutationObserver) {
    new MutationObserver(function () {
      var el = document.getElementById(STYLE_ID);
      if (!el || !el.textContent) return; /* no live css */
      if (document.head.lastChild !== el) document.head.appendChild(el);
    }).observe(document.head, { childList: true });
  }

  /* Also keep the storage event listener as a fast path when served
     over HTTP (fires immediately without waiting for next poll tick). */
  window.addEventListener('storage', function (e) {
    var key = e.key || '';
    if (key.indexOf('ev2-live-preview-') !== 0) return;
    if (key !== liveKey(activePid())) return;
    poll();
  });
})();

/* ── Inject Saved Color Tokens (from Color System page) ── */
(function(){
  /* Pages that opt out of project-specific theming (e.g. onboard)
     must render with package defaults only — otherwise the active
     project's brand bleeds into wizard chrome. */
  if (document.documentElement.getAttribute('data-no-project-theme') === '1') return;
  /* Load project-specific tokens if an active project is set, else
     fall back to the legacy unscoped key. CRITICAL: when a project
     IS active but its scoped stash is empty, do NOT fall back to
     the unscoped key — that key gets overwritten on every project
     visit (see below) so it holds the LAST project's tokens, which
     would bleed across projects (e.g. visit a red-brand project,
     switch to Pearl whose stash hasn't been generated yet, and the
     fallback paints Pearl red). Empty scoped stash means "use
     package defaults" — the fresh fetch below will fill it in. */
  var activeProject = localStorage.getItem('dtf-active-project');
  var savedCSS = null;
  if (activeProject) {
    savedCSS = localStorage.getItem('dtf-saved-tokens-' + activeProject);
  } else {
    savedCSS = localStorage.getItem('dtf-saved-tokens');
  }
  if (savedCSS) {
    var style = document.createElement('style');
    style.id = 'dtfSavedTokens';
    style.textContent = savedCSS;
    document.head.appendChild(style);
  }

  /* Always fetch fresh config+CSS from server on page load.
     Show cached CSS immediately above for fast render, then update. */
  if (activeProject) {
    var depth = (location.pathname.indexOf('/components/') !== -1) ? '..' : '.';
    var cssFiles = ['primitives.css', 'semantic.css', 'surfaces.css'];

    /* Fetch config */
    fetch(cfgUrl).then(function(r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function(text) {
      /* Use a separate key so we don't overwrite color-system.html's edited state */
      localStorage.setItem('dtf-raw-config-' + activeProject, text);
      if (typeof window.DTF.onThemeChange === 'function') {
        requestAnimationFrame(window.DTF.onThemeChange);
      }
    }).catch(function() {});

    /* Fetch CSS files — only overwrite user's saved tokens if no color-system edits exist */
    var hasEditedConfig = !!localStorage.getItem('dtf-color-config-' + activeProject);
    if (!hasEditedConfig) {
      var pending = cssFiles.length;
      var parts = [];
      cssFiles.forEach(function(file, idx) {
        var url = depth + '/projects/' + activeProject + '/' + file + '?_cb=' + Date.now();
        fetch(url).then(function(r) {
          if (!r.ok) throw new Error(r.status);
          return r.text();
        }).then(function(text) {
          parts[idx] = text;
        }).catch(function() {}).finally(function() {
          pending--;
          if (pending === 0) {
            var assembled = parts.filter(Boolean).join('\n');
            if (assembled) {
              localStorage.setItem('dtf-saved-tokens-' + activeProject, assembled);
              /* Legacy unscoped key: kept in sync for back-compat with
                 any code that still reads it, but it is NOT consulted
                 when a project is active (see fallback note above). */
              localStorage.setItem('dtf-saved-tokens', assembled);
              var el = document.getElementById('dtfSavedTokens');
              if (el) { el.textContent = assembled; }
              else {
                var s = document.createElement('style');
                s.id = 'dtfSavedTokens';
                s.textContent = assembled;
                document.head.appendChild(s);
              }
              if (typeof window.DTF.onThemeChange === 'function') {
                requestAnimationFrame(window.DTF.onThemeChange);
              }
            }
          }
        });
      });
    }
  }
})();

/* ── Nav Dropdown — now handled by nav.js ── */

/* ── Theme Toggle (persisted across pages via localStorage) ── */
(function(){
  var STORAGE_KEY='dtf-theme';
  var html=document.documentElement;

  /* Restore saved preference on load. The toggle button itself is now
     part of <dtf-topbar> and may not exist yet when this IIFE runs —
     we look it up again on every state flip via getToggle(). */
  var saved=localStorage.getItem(STORAGE_KEY);
  if(saved==='dark') html.setAttribute('data-theme','dark');
  else html.removeAttribute('data-theme');

  function getToggle(){ return document.getElementById('themeToggle'); }
  function syncAria(){
    var t=getToggle(); if(!t) return;
    var isDark=html.getAttribute('data-theme')==='dark';
    t.setAttribute('aria-pressed', isDark?'true':'false');
    t.setAttribute('aria-label', isDark?'Switch to light theme':'Switch to dark theme');
  }
  syncAria();
  // <dtf-topbar> upgrades after this IIFE; re-sync once it lands.
  document.addEventListener('DOMContentLoaded', syncAria);
  setTimeout(syncAria, 0);

  document.addEventListener('click', function(e){
    var t=e.target.closest && e.target.closest('#themeToggle');
    if(!t) return;
    var isDark=html.getAttribute('data-theme')==='dark';
    if(isDark){ html.removeAttribute('data-theme'); localStorage.setItem(STORAGE_KEY,'light'); }
    else{ html.setAttribute('data-theme','dark'); localStorage.setItem(STORAGE_KEY,'dark'); }
    syncAria();
    if(typeof window.DTF.onThemeChange==='function'){
      requestAnimationFrame(window.DTF.onThemeChange);
    }
  });
})();

/* ── Sidebar IntersectionObserver ─────────────────────── */
(function(){
  var sideLinks=document.querySelectorAll('#sidebarNav a');
  var sectionEls=[];
  sideLinks.forEach(function(a){var t=document.querySelector(a.getAttribute('href'));if(t)sectionEls.push(t);});
  if(sectionEls.length&&window.IntersectionObserver){
    var obs=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        var link=document.querySelector('#sidebarNav a[href="#'+e.target.id+'"]');
        if(!link)return;
        if(e.isIntersecting)link.classList.add('active');
        else link.classList.remove('active');
      });
    },{rootMargin:'-100px 0px -60% 0px',threshold:0});
    sectionEls.forEach(function(s){obs.observe(s);});
  }

  /* ── Framework snippet tabs ──────────────────────── */
  document.addEventListener('click', function(e) {
    var tab = e.target.closest('.fw-snippet-tab');
    if (!tab) return;
    var container = tab.closest('.fw-snippet');
    if (!container) return;
    container.querySelectorAll('.fw-snippet-tab').forEach(function(t) { t.setAttribute('aria-selected', 'false'); });
    tab.setAttribute('aria-selected', 'true');
    container.querySelectorAll('.fw-snippet-code').forEach(function(c) { c.removeAttribute('data-active'); });
    var panel = container.querySelector('.fw-snippet-code[data-panel="' + tab.dataset.tab + '"]');
    if (panel) panel.setAttribute('data-active', '');
  });
})();

/* ── Reactive Framework Snippets ─────────────────────── */
/* Syncs code-snippet variant/size/shape values to the active pill-bar. */
(function(){
  var snippets = document.querySelectorAll('.fw-snippet-code');
  if (!snippets.length) return;

  /* Store original text as immutable template */
  snippets.forEach(function(el){ el.dataset.tpl = el.textContent; });

  function activeVal(axis){
    var el = document.querySelector('[data-ctrl-'+axis+'][aria-pressed="true"]');
    return el ? el.getAttribute('data-ctrl-'+axis) : '';
  }

  /* Boolean-like pill: true only when the "true" option is pressed */
  function isBoolPillActive(attr){
    var el = document.querySelector('[data-ctrl-'+attr+'="true"][aria-pressed="true"]');
    return !!el;
  }

  /* Toggle a line containing `needle` — strip when hide=true, restore from tpl when show */
  function toggleLine(text, needle, hide){
    if(hide) return text.replace(new RegExp('\\n[^\\n]*'+needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[^\\n]*','g'), '');
    return text;
  }

  /* Replace a hardcoded value for a given data attr in the HTML panel */
  function replaceHtmlAttr(text, attr, val){
    var re = new RegExp(attr+'="[^"]*"','g');
    return text.replace(re, attr+'="'+val+'"');
  }

  /* Replace the Vue ?? 'default' fallback */
  function replaceVueDefault(text, prop, val){
    var re = new RegExp("("+prop+"\\s*\\?\\?\\s*)'[^']*'","g");
    return text.replace(re, "$1'"+val+"'");
  }

  function sync(){
    var v = activeVal('variant');
    var s = activeVal('size');
    var h = activeVal('height');           /* textarea only */
    var rounded = isBoolPillActive('rounded');
    /* For toggle/checkbox/radio: variant "" = default (hide), "outlined" = show */
    var emptyVariant = (v === '');
    /* Does this page even have a variant bar? */
    var hasVariantBar = !!document.getElementById('variantBar');

    snippets.forEach(function(el){
      var t = el.dataset.tpl;
      var p = el.dataset.panel;

      if(p==='html'){
        /* Variant: update value or inject/strip for empty-default components */
        if(v) t = replaceHtmlAttr(t, 'data-variant', v);
        if(emptyVariant) t = t.replace(/\s*data-variant="[^"]*"/g, '');
        /* Size */
        t = replaceHtmlAttr(t, 'data-size', s);
        /* Height (textarea) */
        if(h) t = replaceHtmlAttr(t, 'data-height', h);
        /* Rounded: boolean toggle */
        if(rounded && t.indexOf('data-rounded') === -1){
          t = t.replace(/(data-size="[^"]*")/, '$1 data-rounded');
        } else if(!rounded){
          t = t.replace(/\s*data-rounded/g, '');
        }
        /* Variant inject for toggle/checkbox/radio HTML when "outlined" selected */
        if(v && hasVariantBar && t.indexOf('data-variant') === -1){
          t = t.replace(/(data-size="[^"]*")/, '$1 data-variant="'+v+'"');
        }

      } else if(p==='vue'){
        if(v) t = replaceVueDefault(t, 'variant', v);
        t = replaceVueDefault(t, 'size', s);
        if(h) t = replaceVueDefault(t, 'height', h);
        /* Conditional lines: hide when inactive */
        if(!rounded) t = toggleLine(t, ':data-rounded', true);
        /* For variant || undefined pattern (toggle/checkbox/radio): hide when empty */
        if(emptyVariant) t = toggleLine(t, ':data-variant', true);

      } else if(p==='react'){
        /* Conditional lines: hide when inactive */
        if(!rounded) t = toggleLine(t, 'data-rounded', true);
        if(emptyVariant) t = toggleLine(t, 'data-variant', true);
      }

      el.textContent = t;
    });
  }

  /* Defer to run after each page's own pill-bar click handler */
  ['variantBar','sizeBar','roundedBar','heightBar'].forEach(function(id){
    var bar = document.getElementById(id);
    if(bar) bar.addEventListener('click', function(e){
      if(e.target.closest('.pill')) setTimeout(sync, 0);
    });
  });
})();
