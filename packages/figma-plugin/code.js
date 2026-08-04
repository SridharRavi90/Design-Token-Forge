/* ═══════════════════════════════════════════════════════════════
   Design Token Forge — Figma Plugin (Live Sync Edition)
   Connects to DTF Sync Server for real-time token updates.
   Uses async Figma APIs for compatibility with Figma 2025+.
   ═══════════════════════════════════════════════════════════════ */

figma.showUI(__html__, { width: 480, height: 560 });

/* ── Real-time ledger refresh ──────────────────────────────────────
   Without this, deleting Button / Split Button from the canvas
   while the plugin is open didn't update the Components tab
   until the user switched away and back (tab-switch fires
   check-gen-prereqs; canvas deletions don't).

   Strategy: subscribe to documentchange, look for DELETE events,
   debounce 400ms, then ping the UI. UI responds by re-firing
   check-gen-prereqs so the liveness sweep can drop dead ledger
   entries. Cheap — we only forward the ping, not the diff itself. */
/* In-memory ledger tombstones — when the liveness sweep drops an
   entry because its component sets vanished, we keep the original
   entry here for 60s. Figma preserves node IDs across delete/undo,
   so if the user hits Cmd+Z within the window we can resurrect the
   ledger entry instead of forcing a fresh Build. After the window
   expires the tombstone is forgotten and the row stays NEW. */
var LEDGER_TOMBSTONES = {};        // key → { entry, droppedAt }
var LEDGER_TOMBSTONE_TTL_MS = 60 * 1000;

(function setupLedgerWatch(){
  var _ledgerPingTimer = null;
  function _schedulePing(){
    if (_ledgerPingTimer) return;
    _ledgerPingTimer = setTimeout(function(){
      _ledgerPingTimer = null;
      try { figma.ui.postMessage({ type: 'doc-changed' }); } catch (e) {}
    }, 400);
  }
  try {
    figma.on('documentchange', function(ev){
      var changes = (ev && ev.documentChanges) || [];
      for (var i = 0; i < changes.length; i++){
        var c = changes[i];
        /* DELETE_CHANGE always invalidates ledger. CREATE/PROPERTY changes
           on COMPONENT_SET also matter (component re-added, renamed). */
        if (c.type === 'DELETE'){ _schedulePing(); return; }
        if ((c.type === 'CREATE' || c.type === 'PROPERTY_CHANGE') &&
            c.node && c.node.type === 'COMPONENT_SET'){
          _schedulePing(); return;
        }
      }
    });
  } catch (e) { /* documentchange not supported in this Figma — skip */ }
})();

/* Restore last user-chosen panel size (set via drag handle in UI). */
(async function restorePanelSize(){
  try {
    var saved = await figma.clientStorage.getAsync('dtf-panel-size');
    if (saved && typeof saved.width === 'number' && typeof saved.height === 'number'){
      figma.ui.resize(Math.max(360, saved.width), Math.max(420, saved.height));
    }
  } catch (e) { /* first run or storage blocked — ignore */ }
})();

var CODE_VERSION = '2026-06-18-dark-mode';

/* ── Icon preview layout constants ─────────────────────────────────
   Single source of truth for the Primitives showcase preview box
   and the chevron component set it contains. All creation paths,
   reuse paths, and repair paths call applyIconPreviewLayout() /
   applyChevronSetLayout() — changing a value here propagates to
   all three paths automatically, preventing drift. */
var ICON_PREVIEW_LAYOUT = {
  padding:      22,   /* uniform padding inside the dashed preview box */
  itemSpacing:  16,   /* gap between icon-placeholder and chevron set, and between chevrons */
  counterAlign: 'CENTER'
};
var CHEVRON_SET_LAYOUT = {
  itemSpacing:  16,   /* gap between the 4 direction variants */
  padding:      0     /* zero — set height must equal component height (20px) for CENTER to work */
};

function applyIconPreviewLayout(frame) {
  frame.layoutMode            = 'HORIZONTAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.counterAxisAlignItems = ICON_PREVIEW_LAYOUT.counterAlign;
  frame.itemSpacing           = ICON_PREVIEW_LAYOUT.itemSpacing;
  frame.paddingLeft = frame.paddingRight = ICON_PREVIEW_LAYOUT.padding;
  frame.paddingTop  = frame.paddingBottom = ICON_PREVIEW_LAYOUT.padding;
}

function applyChevronSetLayout(set) {
  set.layoutMode            = 'HORIZONTAL';
  set.counterAxisAlignItems = 'CENTER';
  set.primaryAxisSizingMode = 'AUTO';
  set.counterAxisSizingMode = 'AUTO';
  set.itemSpacing           = CHEVRON_SET_LAYOUT.itemSpacing;
  set.paddingLeft = set.paddingRight = CHEVRON_SET_LAYOUT.padding;
  set.paddingTop  = set.paddingBottom = CHEVRON_SET_LAYOUT.padding;
}

/* Known structural comp-size variables required by the component
   generators. Used by Step 2c (Build) AND by check-gen-prereqs
   auto-heal so a missing required variable gets recreated without
   the user having to click Build first. */
var REQUIRED_COMPSIZE_VARS = [
  { name: 'button/icon wrapper padding L', defaultVal: 8 },
  { name: 'button/icon wrapper padding R', defaultVal: 8 },
  { name: 'button/icon pad', defaultVal: 8 },
  { name: 'button/icon container',        defaultVal: 18 },
  { name: 'button/radius-rounded', defaultVal: 9999 },
  { name: 'split-button/chevron/padding', defaultVal: 8 },
  { name: 'split-button/chevron/size',    defaultVal: 16 },
  /* Icon Button — square component, separate from button/* scale.
     defaultVal = base-mode values; token sync fills in all per-density
     values from icon-button.tokens.css. Without these entries the Build
     step silently skips bindings (variable not found) and the icon falls
     back to the placeholder's intrinsic size (20px). */
  { name: 'icon-button/size',            defaultVal: 36 },
  { name: 'icon-button/icon container',  defaultVal: 18 },
  /* Menu Button — auto-created when token sync hasn't run yet.
     Values match the base-density row in menu-button.tokens.css. */
  { name: 'menu-button/height',         defaultVal: 36 },
  { name: 'menu-button/padding-x',      defaultVal: 12 },
  { name: 'menu-button/padding-x-icon', defaultVal: 10 },
  { name: 'menu-button/chevron-pe',     defaultVal: 8  },
  { name: 'menu-button/gap',            defaultVal: 4  },
  { name: 'menu-button/icon-size',      defaultVal: 18 },
  { name: 'menu-button/chevron-size',   defaultVal: 14 },
  { name: 'menu-button/font-size',      defaultVal: 14 },
  { name: 'menu-button/radius',         defaultVal: 6  },
  { name: 'menu-button/radius-rounded', defaultVal: 9999 },
  /* Toggle — pill radius is a constant (9999). Other toggle vars are per-density and
     managed by the sync pipeline. They use createOnly:true so Generate auto-heals
     (creates with base-mode fallback) when Update Variables hasn't been run yet, but
     does NOT overwrite values that the sync server already set per-density. */
  { name: 'toggle/radius',               defaultVal: 9999 },
  { name: 'toggle/track-w',              defaultVal: 40,   createOnly: true },
  { name: 'toggle/track-h',              defaultVal: 24,   createOnly: true },
  { name: 'toggle/thumb-size',           defaultVal: 20,   createOnly: true },
  { name: 'toggle/thumb-inset',          defaultVal: 2,    createOnly: true },
  { name: 'toggle/thumb-x-on',          defaultVal: 18,   createOnly: true },
  { name: 'toggle/radius-square',        defaultVal: 5,    createOnly: true },
  { name: 'toggle/thumb-radius-square',  defaultVal: 3,    createOnly: true },
  /* Focus ring frame dimensions — constant (non-per-density). */
  { name: 'button/focus-ring-gap',    defaultVal: 4  },
  { name: 'button/focus-ring-width',  defaultVal: 2  },
  /* Focus ring corner radius — per-density, VARIABLE_ALIAS to primitives-numbers.
     String modeVals = Figma variable path in primitives-numbers collection.
     micro/tiny: spacing/8  |  small/base: spacing/10  |  medium/large: spacing/12
     big/huge: spacing/14   |  mega: spacing/16         |  ultra: spacing/18 */
  { name: 'button/focus-ring-radius', defaultVal: 10, modeVals: {
    micro: 'spacing/8',  tiny: 'spacing/8',
    small: 'spacing/10', base: 'spacing/10',
    medium: 'spacing/12', large: 'spacing/12',
    big: 'spacing/14',  huge: 'spacing/14',
    mega: 'spacing/16', ultra: 'spacing/18'
  } },
  /* Focus ring frame height — per-density = button-height + 2*gap (4px each side).
     Used by the ABSOLUTE-positioned ring overlay in the plugin generator.
     spacing/52 doesn't exist in primitives → large mode uses literal 52. */
  { name: 'button/focus-ring-height', defaultVal: 44, modeVals: {
    micro: 'spacing/32', tiny: 'spacing/36',
    small: 'spacing/40', base: 'spacing/44',
    medium: 'spacing/48', large: 52,
    big: 'spacing/56',  huge: 'spacing/64',
    mega: 'spacing/72', ultra: 'spacing/80'
  } }
];
log('code.js loaded — version ' + CODE_VERSION);

/* ── Stable hash helpers ────────────────────────────────
   Used by the component ledger (W1+) to fingerprint blueprints and
   token bindings. NOT cryptographic — just a stable deterministic
   short string so the editor / Builder pill can detect drift.
   FNV-1a 32-bit, output as 8 lowercase hex chars.
   See docs/architecture/component-builder/
   component-ledger-and-safe-rebuild.md §6. */
function dtfHash32(s) {
  var str = String(s == null ? '' : s);
  var h = 0x811c9dc5 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  var hex = h.toString(16);
  while (hex.length < 8) hex = '0' + hex;
  return hex;
}
/* Deterministic JSON stringify — sorts object keys at every level so
   key-order doesn't influence the hash. Tolerates functions (writes
   '<fn>') and circular structures (writes '<cycle>'). */
function dtfStableStringify(value) {
  var seen = [];
  function ser(v) {
    if (v === null || v === undefined) return JSON.stringify(v);
    if (typeof v === 'function') return '"<fn>"';
    if (typeof v !== 'object')   return JSON.stringify(v);
    if (seen.indexOf(v) >= 0)    return '"<cycle>"';
    seen.push(v);
    var out;
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var parts = [];
      for (var i = 0; i < v.length; i++) parts.push(ser(v[i]));
      out = '[' + parts.join(',') + ']';
    } else {
      var keys = Object.keys(v).sort();
      var kparts = [];
      for (var k = 0; k < keys.length; k++) {
        kparts.push(JSON.stringify(keys[k]) + ':' + ser(v[keys[k]]));
      }
      out = '{' + kparts.join(',') + '}';
    }
    seen.pop();
    return out;
  }
  return ser(value);
}

/* ── URL migration via clientStorage (reliable, not blocked like localStorage) ── */
(async function() {
  try {
    var url = await figma.clientStorage.getAsync('dtf-server-url');
    if (url && url.toLowerCase().indexOf('sridharravi90.github.io') !== -1) {
      url = 'https://sridhar-ravi-2917.github.io/Design-Token-Forge';
      await figma.clientStorage.setAsync('dtf-server-url', url);
    }
    if (url && url.toLowerCase().indexOf('sridhar-ravi-2917.github.io') !== -1) {
      url = 'https://sridhar-ravi-2917.github.io/Design-Token-Forge';
      await figma.clientStorage.setAsync('dtf-server-url', url);
    }
    if (!url) {
      url = 'https://sridhar-ravi-2917.github.io/Design-Token-Forge';
      await figma.clientStorage.setAsync('dtf-server-url', url);
    }
    figma.ui.postMessage({ type: 'set-server-url', url: url });
  } catch (e) { /* clientStorage unavailable — UI will use its own default */ }
})();

/* ── Restore persisted GitHub credentials on startup ────────────
   PAT + username live in figma.clientStorage (account-scoped, survives
   plugin reloads and Figma restarts). localStorage from the iframe is
   unreliable in Figma’s sandbox so we don’t rely on it for the secret.   */
(async function() {
  try {
    var ghUser    = await figma.clientStorage.getAsync('dtf-gh-username');
    var ghPat     = await figma.clientStorage.getAsync('dtf-gh-pat');
    var bearerTok = await figma.clientStorage.getAsync('dtf-bearer-token');
    figma.ui.postMessage({
      type: 'creds-restored',
      username:     ghUser     || '',
      pat:          ghPat      || '',
      bearerToken:  bearerTok  || ''
    });
  } catch (e) { /* clientStorage unavailable — user will have to re-auth */ }
})();

/* ── Component Builder access ───────────────────────────
   The component builder is available to ALL plugin users.
   We still emit a user-info message (used for telemetry / logging)
   but `authorized` is always true. Removed the historical owner-id
   + name-substring gate (kept the plugin private to one developer).
   Reintroducing a gate? Put the check here and flip `authorized`. */
function sendUserInfo() {
  try {
    var currentUser = figma.currentUser || null;
    var name = currentUser && currentUser.name ? currentUser.name : '';
    var id   = currentUser && currentUser.id   ? currentUser.id   : '';
    if (currentUser) {
      log('Current user: ' + name + ' (id: ' + id + ')');
    }
    figma.ui.postMessage({ type: 'user-info', name: name, id: id, authorized: true });
  } catch (e) {
    log('User check failed: ' + e.message);
    /* Still authorize — UI gate is no longer a security boundary. */
    figma.ui.postMessage({ type: 'user-info', name: '', id: '', authorized: true });
  }
}
/* Send after a short delay so the UI listener is ready */
setTimeout(sendUserInfo, 300);

/* ── Helpers ──────────────────────────────────────────────── */

function hexToRGB(hex) {
  var h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255
  };
}

/* Inverse of hexToRGB — used to round-trip Figma color values back
   into the hex strings that tokens.json stores. Preserves alpha
   when present. */
function rgbToHex(rgb) {
  if (!rgb) return '';
  function ch(v) {
    var n = Math.round((v || 0) * 255);
    if (n < 0) n = 0; if (n > 255) n = 255;
    var s = n.toString(16);
    return s.length === 1 ? '0' + s : s;
  }
  var hex = '#' + ch(rgb.r) + ch(rgb.g) + ch(rgb.b);
  if (rgb.a !== undefined && rgb.a < 1) hex += ch(rgb.a);
  return hex;
}

function toFigmaValue(raw, type) {
  if (type === 'COLOR') return hexToRGB(raw);
  if (type === 'FLOAT')  return parseFloat(raw) || 0;
  return String(raw);
}

function log(msg) {
  console.log('[DTF] ' + msg);
}

/* ── Scan for existing DTF collections ───────────────────── */

var DTF_PREFIXES = ['T0 ', 'T1 ', 'T2 ', 'T3 ', 'DTF /'];
var DTF_EXACT_NAMES = ['primitives-numbers', 'comp size', 'Typography Scale', 'Typography'];

function isDTFCollection(name) {
  for (var p = 0; p < DTF_PREFIXES.length; p++) {
    if (name.indexOf(DTF_PREFIXES[p]) === 0) return true;
  }
  for (var e = 0; e < DTF_EXACT_NAMES.length; e++) {
    if (name === DTF_EXACT_NAMES[e]) return true;
  }
  return false;
}

async function findDTFCollections() {
  var all = await figma.variables.getLocalVariableCollectionsAsync();
  /* Group by name so duplicates (e.g. multiple 'Typography Scale' from
     past runs where the collection was not recognised) can be deduplicated.
     Keep the instance with the most variables — most likely the canonical one. */
  var byName = {};
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    if (!isDTFCollection(c.name)) continue;
    var prev = byName[c.name];
    if (!prev || c.variableIds.length > prev.variableIds.length) {
      byName[c.name] = c;
    } else {
      log('Duplicate collection ignored: "' + c.name + '" (kept the one with more vars)');
    }
  }
  return Object.values(byName);
}

/* ── Build lookup of existing DTF variables ──────────────── */

async function buildExistingLookup() {
  var cols = await findDTFCollections();
  var colMap = {};   // collectionName => { collection, modeMap, varMap }
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i];
    var modeMap = {};
    for (var m = 0; m < c.modes.length; m++) {
      modeMap[c.modes[m].name] = c.modes[m].modeId;
    }
    var varMap = {};  // varName => figma Variable
    for (var j = 0; j < c.variableIds.length; j++) {
      var v = await figma.variables.getVariableByIdAsync(c.variableIds[j]);
      if (v) varMap[v.name] = v;
    }
    colMap[c.name] = { collection: c, modeMap: modeMap, varMap: varMap };
  }
  return colMap;
}

/* ── Persistent variable ID map — tracks Figma IDs across renames ── */

function loadIdMap() {
  var raw = figma.root.getPluginData('dtf-id-map');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function saveIdMap(map) {
  figma.root.setPluginData('dtf-id-map', JSON.stringify(map));
}

/* Apply renames to ID map keys (pure data transform, no Figma API calls) */
function applyRenamesToIdMap(renames, idMap) {
  if (!renames || typeof renames !== 'object') return 0;
  var entries = Object.entries(renames);
  var count = 0;
  for (var i = 0; i < entries.length; i++) {
    var oldSuffix = '::' + entries[i][0];
    var newSuffix = '::' + entries[i][1];
    var keys = Object.keys(idMap);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].endsWith(oldSuffix)) {
        var prefix = keys[k].slice(0, -oldSuffix.length);
        var newKey = prefix + newSuffix;
        /* If the new key already exists (duplicate from a previous partial sync),
           prefer the original variable being renamed — it has component bindings */
        if (idMap[newKey]) {
          log('idMap rename: overwriting duplicate key ' + newKey + ' (old id=' + idMap[newKey] + ' → keeping id=' + idMap[keys[k]] + ')');
        }
        idMap[newKey] = idMap[keys[k]];
        delete idMap[keys[k]];
        count++;
      }
    }
  }
  return count;
}

/* ── Remove orphan variables not present in token data ──── */

async function removeOrphans(data, stats) {
  /* Build set of expected variable names per collection */
  var expectedByCol = {};
  for (var ci = 0; ci < data.collections.length; ci++) {
    var col = data.collections[ci];
    var nameSet = {};
    for (var vi = 0; vi < col.variables.length; vi++) {
      nameSet[col.variables[vi].name] = true;
    }
    expectedByCol[col.name] = nameSet;
  }

  var removed = 0;
  var dtfCols = await findDTFCollections();
  for (var i = 0; i < dtfCols.length; i++) {
    var c = dtfCols[i];
    var expected = expectedByCol[c.name];
    if (!expected) continue; /* Only clean collections we're syncing */
    var colVarIds = c.variableIds.slice(); /* snapshot — avoids mutation issues */
    for (var j = 0; j < colVarIds.length; j++) {
      var v = await figma.variables.getVariableByIdAsync(colVarIds[j]);
      if (v && !expected[v.name]) {
        log('Removing orphan: ' + c.name + ' / ' + v.name);
        try { v.remove(); removed++; } catch (e) {
          log('Failed to remove orphan ' + v.name + ': ' + e.message);
          stats.errors.push('Remove orphan ' + v.name + ': ' + e.message);
        }
      }
    }
  }
  return removed;
}

/* ── Sync all collections — update-in-place, preserving IDs */

async function syncAll(data) {
  var stats = { collections: 0, variables: 0, aliases: 0, updated: 0, created: 0, renamed: 0, orphansRemoved: 0, errors: [] };

  log('syncAll start — code version ' + CODE_VERSION);
  log('Renames in data: ' + (data.renames ? Object.keys(data.renames).length : 0));
  log('Collections in data: ' + data.collections.length);

  /* Load persistent ID map and apply renames to its keys */
  var idMap = loadIdMap();
  var idMapSize = Object.keys(idMap).length;
  log('idMap loaded with ' + idMapSize + ' entries');

  var existing = await buildExistingLookup();
  var existingColNames = Object.keys(existing);
  var existingVarTotal = 0;
  for (var evi = 0; evi < existingColNames.length; evi++) {
    existingVarTotal += Object.keys(existing[existingColNames[evi]].varMap).length;
  }

  /* If no variables exist but idMap has stale entries, clear it —
     those IDs point to deleted variables and cause wasted async lookups */
  if (existingVarTotal === 0 && idMapSize > 0) {
    log('Clearing stale idMap (' + idMapSize + ' entries) — no variables exist in Figma');
    idMap = {};
  }

  if (data.renames) {
    var renameCount = applyRenamesToIdMap(data.renames, idMap);
    /* applyRenamesToIdMap only transforms idMap KEYS — it does NOT
       rename any actual Figma variable. The visual rename happens in
       Pass 0 below. Keeping this as stats.renamed would double-count
       (or worse — show a non-zero count when Pass0 silently failed).
       Track it separately for debugging. */
    stats.idMapRenamed = renameCount;
    log('idMap renames applied: ' + renameCount + ' keys transformed');
  }

  /* Build inverse rename map: newName → oldName for fallback lookup */
  var inverseRenames = {};
  if (data.renames) {
    var renameKeys = Object.keys(data.renames);
    for (var ri = 0; ri < renameKeys.length; ri++) {
      inverseRenames[data.renames[renameKeys[ri]]] = renameKeys[ri];
    }
  }

  var existing = await buildExistingLookup();
  var existingColNames = Object.keys(existing);
  log('Existing DTF collections in Figma: ' + (existingColNames.length > 0 ? existingColNames.join(', ') : '(none)') + ' — ' + existingVarTotal + ' total vars');
  for (var eli = 0; eli < existingColNames.length; eli++) {
    var elName = existingColNames[eli];
    var elVarCount = Object.keys(existing[elName].varMap).length;
    log('  ' + elName + ': ' + elVarCount + ' variables');
  }

  /* ── Pass 0: DIRECT PRE-SYNC RENAME ────────────────────────────────
     Bypass all lookup logic — iterate actual Figma variables in each
     collection and rename any that match a renames entry directly.
     This guarantees renames happen regardless of idMap/varMap state. */
  if (data.renames && Object.keys(data.renames).length > 0) {
    var directRenames = 0;
    var attemptedRenames = 0;
    var renameFailures = [];   /* {old, new, reason} */
    var allDTFCols = await findDTFCollections();
    for (var dri = 0; dri < allDTFCols.length; dri++) {
      var drCol = allDTFCols[dri];
      var drVarIds = drCol.variableIds.slice();
      for (var drvi = 0; drvi < drVarIds.length; drvi++) {
        var drVar = await figma.variables.getVariableByIdAsync(drVarIds[drvi]);
        if (!drVar) continue;
        var newName = data.renames[drVar.name];
        if (newName) {
          attemptedRenames++;
          var oldName = drVar.name;
          /* Check if another variable already has the target name */
          for (var drdi = 0; drdi < drVarIds.length; drdi++) {
            if (drdi === drvi) continue;
            var drDup = await figma.variables.getVariableByIdAsync(drVarIds[drdi]);
            if (drDup && drDup.name === newName) {
              log('Pass0: removing blocker ' + newName + ' (id=' + drDup.id + ')');
              try { drDup.remove(); } catch (dre) { log('Pass0 remove failed: ' + dre.message); }
            }
          }
          log('Pass0 RENAME: ' + oldName + ' → ' + newName + ' (id=' + drVar.id + ')');
          try {
            drVar.name = newName;
            if (drVar.name === newName) {
              directRenames++;
              /* Update idMap to reflect new name */
              idMap[drCol.name + '::' + newName] = drVar.id;
            } else {
              var stuckReason = 'name property did not update (got "' + drVar.name + '" instead of "' + newName + '")';
              log('Pass0 WARN: ' + stuckReason);
              renameFailures.push({ old: oldName, new: newName, reason: stuckReason });
            }
          } catch (drErr) {
            log('Pass0 ERROR renaming ' + oldName + ': ' + drErr.message);
            renameFailures.push({ old: oldName, new: newName, reason: drErr.message });
            stats.errors.push('Pass0 rename ' + oldName + ' → ' + newName + ': ' + drErr.message);
          }
        }
      }
    }
    log('Pass0 direct renames: ' + directRenames + ' applied / ' + attemptedRenames + ' attempted');
    stats.renamed = directRenames;
    stats.renameAttempted = attemptedRenames;
    stats.renameFailures = renameFailures;

    /* Loud surfacing: if we attempted renames but NONE stuck, the user
       was seeing "Renamed" badges forever with no Figma effect. Push
       a synthetic error so the UI's error summary fires. */
    if (attemptedRenames > 0 && directRenames === 0) {
      stats.errors.push('Rename failed: ' + attemptedRenames + ' variable(s) matched the rename map but none could be renamed. First: ' +
        (renameFailures[0] ? (renameFailures[0].old + ' → ' + renameFailures[0].new + ' (' + renameFailures[0].reason + ')') : '(no detail)'));
    }

    /* Rebuild existing lookup since names changed */
    if (directRenames > 0) {
      existing = await buildExistingLookup();
    }
  }

  /* Pass 1: Create/update collections, modes, and variables.
     Build a lookup so aliases can be resolved in pass 2. */
  var varLookup = {}; // "CollectionName::VarPath" => figma Variable obj
  var pendingAliases = []; // { variable, modeId, ref }

  for (var ci = 0; ci < data.collections.length; ci++) {
    var col = data.collections[ci];
    try {
      var collection, modeMap;
      var ex = existing[col.name];

      if (ex) {
        /* ─── Reuse existing collection ─── */
        collection = ex.collection;
        modeMap = ex.modeMap;

        /* Ensure all required modes exist */
        for (var mi = 0; mi < col.modes.length; mi++) {
          if (!modeMap[col.modes[mi]]) {
            try {
              var newModeId = collection.addMode(col.modes[mi]);
              modeMap[col.modes[mi]] = newModeId;
            } catch (modeErr) {
              stats.errors.push('Mode ' + col.modes[mi] + ' in ' + col.name + ': ' + modeErr.message);
              log('Mode limit hit: ' + col.modes[mi] + ' — ' + modeErr.message);
            }
          }
        }

        /* Reorder modes to match server order if different */
        try {
          var desiredModeIds = [];
          for (var mri = 0; mri < col.modes.length; mri++) {
            if (modeMap[col.modes[mri]]) desiredModeIds.push(modeMap[col.modes[mri]]);
          }
          if (desiredModeIds.length > 1) {
            var currentOrder = collection.modes.map(function(m) { return m.modeId; });
            var needsReorder = false;
            for (var coi = 0; coi < desiredModeIds.length; coi++) {
              if (currentOrder[coi] !== desiredModeIds[coi]) { needsReorder = true; break; }
            }
            if (needsReorder) {
              /* Figma doesn't have reorderModes — rebuild: remove extra modes,
                 but only if the first mode is wrong (most common case).
                 Use removeMode + addMode to shift order. */
              log('Mode order mismatch in ' + col.name + ' — current first: ' +
                collection.modes[0].name + ', desired first: ' + col.modes[0]);
            }
          }
        } catch (reorderErr) {
          log('Mode reorder check failed: ' + reorderErr.message);
        }
      } else {
        /* ─── Create new collection ─── */
        collection = figma.variables.createVariableCollection(col.name);
        modeMap = {};
        var firstModeId = collection.modes[0].modeId;
        collection.renameMode(firstModeId, col.modes[0]);
        modeMap[col.modes[0]] = firstModeId;

        for (var mi2 = 1; mi2 < col.modes.length; mi2++) {
          try {
            var newMId = collection.addMode(col.modes[mi2]);
            modeMap[col.modes[mi2]] = newMId;
          } catch (modeErr2) {
            stats.errors.push('Mode ' + col.modes[mi2] + ' in ' + col.name + ': ' + modeErr2.message);
            log('Mode limit hit: ' + col.modes[mi2] + ' — ' + modeErr2.message);
          }
        }
      }
      stats.collections++;

      if (col.hiddenFromPublishing) {
        collection.hiddenFromPublishing = true;
      }

      for (var vi = 0; vi < col.variables.length; vi++) {
        var v = col.variables[vi];
        var resolvedType = null;
        if (v.type === 'COLOR')  resolvedType = 'COLOR';
        if (v.type === 'FLOAT')  resolvedType = 'FLOAT';
        if (v.type === 'STRING') resolvedType = 'STRING';
        if (!resolvedType) continue;

        try {
          var variable;
          var tokenKey = col.name + '::' + v.name;
          var existingVar = null;

          /* 1. Try ID map — finds variable even after renames */
          if (idMap[tokenKey]) {
            try {
              var byId = await figma.variables.getVariableByIdAsync(idMap[tokenKey]);
              if (byId) {
                if (byId.name !== v.name) {
                  /* Before renaming, remove any duplicate with the target name
                     to prevent naming conflicts (mirrors Step 2 logic) */
                  if (ex) {
                    var dupById = ex.varMap[v.name];
                    if (dupById && dupById.id !== byId.id) {
                      log('Step1: removing duplicate ' + v.name + ' (id=' + dupById.id + ') before renaming ' + byId.name);
                      try { dupById.remove(); stats.orphansRemoved++; } catch (de) {
                        log('Failed to remove duplicate: ' + de.message);
                      }
                    }
                  }
                  log('ID-match rename: ' + byId.name + ' → ' + v.name);
                  byId.name = v.name;
                  /* Verify rename actually took effect */
                  if (byId.name === v.name) {
                    existingVar = byId;
                    stats.renamed++;
                  } else {
                    log('WARN: rename did not take effect for ' + v.name + ' (still ' + byId.name + ')');
                    /* Clear idMap entry so Steps 2/3 can find it */
                    delete idMap[tokenKey];
                  }
                } else {
                  /* Name already matches — use as-is */
                  existingVar = byId;
                }
              }
            } catch (idErr) {
              log('Step1 error for ' + v.name + ': ' + (idErr.message || idErr));
              /* DO NOT set existingVar — let Steps 2/3 handle it */
              delete idMap[tokenKey];
            }
          }

          /* 2. Rename path: find variable by OLD name, rename it in-place
                (preserves original Figma ID + component bindings).
                If a duplicate already exists with the NEW name, delete it. */
          if (!existingVar && ex && inverseRenames[v.name]) {
            var oldName = inverseRenames[v.name];
            var original = ex.varMap[oldName];
            if (original) {
              /* Delete any duplicate that was created with the new name */
              var dup = ex.varMap[v.name];
              if (dup && dup.id !== original.id) {
                log('Removing duplicate: ' + v.name + ' (id=' + dup.id + ') — keeping original ' + oldName);
                try { dup.remove(); stats.orphansRemoved++; } catch (de) {
                  log('Failed to remove duplicate ' + v.name + ': ' + de.message);
                }
              }
              log('Rename in-place: ' + oldName + ' → ' + v.name);
              original.name = v.name;
              existingVar = original;
              stats.renamed++;
            }
          }

          /* 3. Fallback: match by current name in collection */
          if (!existingVar && ex) {
            existingVar = ex.varMap[v.name];
          }

          if (existingVar) {
            /* ─── Update existing variable in-place ─── */
            variable = existingVar;
            stats.updated++;
          } else {
            /* ─── Create new variable ─── */
            variable = figma.variables.createVariable(v.name, collection, resolvedType);
            stats.created++;
          }

          /* Track Figma variable ID for future syncs */
          idMap[tokenKey] = variable.id;

          varLookup[col.name + '::' + v.name] = variable;

          if (Array.isArray(v.scopes)) {
            try {
              variable.scopes = v.scopes;
            } catch (scopeErr) {
              log('Scope error on ' + v.name + ': ' + scopeErr.message);
            }
          }

          var modeNames = Object.keys(v.values);
          for (var ki = 0; ki < modeNames.length; ki++) {
            var modeName = modeNames[ki];
            var mId = modeMap[modeName];
            if (!mId) continue;
            var rawVal = v.values[modeName];

            if (rawVal && typeof rawVal === 'object' && rawVal.type === 'VARIABLE_ALIAS') {
              pendingAliases.push({ variable: variable, modeId: mId, ref: rawVal });
            } else {
              variable.setValueForMode(mId, toFigmaValue(rawVal, resolvedType));
            }
          }
          stats.variables++;
        } catch (ve) {
          stats.errors.push(v.name + ': ' + ve.message);
        }
      }
    } catch (ce) {
      stats.errors.push('Collection ' + col.name + ': ' + ce.message);
    }
  }

  /* Pass 2: Resolve alias references now that all variables exist */
  for (var ai = 0; ai < pendingAliases.length; ai++) {
    var pa = pendingAliases[ai];
    var lookupKey = pa.ref.collection + '::' + pa.ref.name;
    var target = varLookup[lookupKey];
    if (target) {
      try {
        var alias = figma.variables.createVariableAlias(target);
        pa.variable.setValueForMode(pa.modeId, alias);
        stats.aliases++;
      } catch (ae) {
        stats.errors.push('Alias ' + pa.ref.name + ': ' + ae.message);
      }
    } else {
      stats.errors.push('Alias target not found: ' + lookupKey);
    }
  }

  /* Pass 2.5: Verify variable names — force-fix any that didn't rename correctly.
     This is a safety net for edge cases where byId.name = newName silently fails. */
  var nameFixes = 0;
  for (var nci = 0; nci < data.collections.length; nci++) {
    var ncol = data.collections[nci];
    for (var nvi = 0; nvi < ncol.variables.length; nvi++) {
      var nv = ncol.variables[nvi];
      var nKey = ncol.name + '::' + nv.name;
      var nVar = varLookup[nKey];
      if (nVar && nVar.name !== nv.name) {
        log('Pass2.5 force-rename: ' + nVar.name + ' → ' + nv.name);
        try {
          /* Find and remove any variable blocking the target name */
          var dtfCols2 = await findDTFCollections();
          for (var dci = 0; dci < dtfCols2.length; dci++) {
            if (dtfCols2[dci].name === ncol.name) {
              for (var dvi = 0; dvi < dtfCols2[dci].variableIds.length; dvi++) {
                var blocker = await figma.variables.getVariableByIdAsync(dtfCols2[dci].variableIds[dvi]);
                if (blocker && blocker.name === nv.name && blocker.id !== nVar.id) {
                  log('Pass2.5: removing blocker ' + nv.name + ' (id=' + blocker.id + ')');
                  blocker.remove();
                }
              }
              break;
            }
          }
          nVar.name = nv.name;
          nameFixes++;
        } catch (nfe) {
          log('Pass2.5 rename failed for ' + nv.name + ': ' + nfe.message);
          stats.errors.push('Force-rename ' + nv.name + ': ' + nfe.message);
        }
      }
    }
  }
  if (nameFixes > 0) {
    log('Pass2.5: fixed ' + nameFixes + ' variable names');
    stats.renamed += nameFixes;
  }

  /* Pass 2.7: Remove duplicate empty collections — can form when two concurrent
     syncAll calls both find a collection missing and both create one. Keep the
     one with the most variables; delete any empty duplicates by name. */
  try {
    var allColsDup = await figma.variables.getLocalVariableCollectionsAsync();
    var seenColNames = {};
    for (var dci = 0; dci < allColsDup.length; dci++) {
      var dc = allColsDup[dci];
      if (!seenColNames[dc.name]) {
        seenColNames[dc.name] = dc;
      } else {
        /* Duplicate name: delete whichever is empty; if both empty, delete the newer one */
        var existing2 = seenColNames[dc.name];
        var toDelete = (dc.variableIds.length === 0) ? dc :
                       (existing2.variableIds.length === 0) ? existing2 : null;
        if (toDelete) {
          try { toDelete.remove(); log('Pass2.7: removed empty duplicate collection "' + toDelete.name + '" id=' + toDelete.id); }
          catch (dce) { log('Pass2.7: could not remove duplicate: ' + dce.message); }
          /* Keep the non-empty one */
          if (toDelete === existing2) seenColNames[dc.name] = dc;
        }
      }
    }
  } catch (e27) { log('Pass2.7 error (non-fatal): ' + e27.message); }

  /* Pass 3: Remove orphan variables not in token data */
  stats.orphansRemoved = await removeOrphans(data, stats);
  if (stats.orphansRemoved > 0) {
    log('Removed ' + stats.orphansRemoved + ' orphan variable(s)');
  }

  /* Pass 3.5: Force-remove CSS-origin font vars from primitives-numbers.
     These were exported before buildExtras() gained CSS_FONT_SKIP and now
     persist as orphans in Figma. removeOrphans() SHOULD catch them, but as
     an explicit safety net we delete them by name here so they can never
     re-appear in the primitives-numbers variable panel.
     Vars to purge: font/family  font/family-sans  font/family-mono */
  try {
    var CSS_FONT_PURGE = { 'font/family': true, 'font/family-sans': true, 'font/family-mono': true };
    var primNumsCol5 = null;
    var allCols35 = await figma.variables.getLocalVariableCollectionsAsync();
    for (var ci35 = 0; ci35 < allCols35.length; ci35++) {
      if (allCols35[ci35].name === 'primitives-numbers') { primNumsCol5 = allCols35[ci35]; break; }
    }
    if (primNumsCol5) {
      var ids35 = primNumsCol5.variableIds.slice();
      for (var vi35 = 0; vi35 < ids35.length; vi35++) {
        var v35 = await figma.variables.getVariableByIdAsync(ids35[vi35]);
        if (v35 && CSS_FONT_PURGE[v35.name]) {
          try { v35.remove(); stats.orphansRemoved++; log('Pass3.5: removed CSS-origin var: ' + v35.name); }
          catch (e35) { log('Pass3.5: could not remove ' + v35.name + ': ' + e35.message); }
        }
      }
    }
  } catch (e3) { log('Pass3.5 error (non-fatal): ' + e3.message); }

  /* Persist updated ID map (prune stale entries) */
  var validKeys = {};
  for (var vci = 0; vci < data.collections.length; vci++) {
    var vc = data.collections[vci];
    for (var vvi = 0; vvi < vc.variables.length; vvi++) {
      validKeys[vc.name + '::' + vc.variables[vvi].name] = true;
    }
  }
  var staleKeys = Object.keys(idMap);
  for (var ski = 0; ski < staleKeys.length; ski++) {
    if (!validKeys[staleKeys[ski]]) delete idMap[staleKeys[ski]];
  }
  saveIdMap(idMap);

  /* Final diagnostic: check for any remaining old-name variables */
  if (data.renames) {
    var oldNames = Object.keys(data.renames);
    var remaining = [];
    var finalCols = await findDTFCollections();
    for (var fci = 0; fci < finalCols.length; fci++) {
      var fc = finalCols[fci];
      for (var fvi = 0; fvi < fc.variableIds.length; fvi++) {
        var fv = await figma.variables.getVariableByIdAsync(fc.variableIds[fvi]);
        if (fv && data.renames[fv.name]) {
          remaining.push(fc.name + '/' + fv.name);
        }
      }
    }
    if (remaining.length > 0) {
      log('WARNING: ' + remaining.length + ' variables still have old names after sync:');
      for (var rmi = 0; rmi < Math.min(remaining.length, 10); rmi++) {
        log('  ' + remaining[rmi]);
      }
      stats.errors.push(remaining.length + ' variables failed to rename (check console)');
    } else {
      log('✓ All renames verified — no old names remain');
    }
  }

  /* Pass 4: Post-sync verification — ensure variables actually exist.
     If stats say we created/updated N variables but Figma has 0,
     something went silently wrong. Log and report it. */
  var verifyCols = await findDTFCollections();
  var verifyTotal = 0;
  for (var vfi = 0; vfi < verifyCols.length; vfi++) {
    verifyTotal += verifyCols[vfi].variableIds.length;
  }
  log('Post-sync verification: ' + verifyTotal + ' variables in ' + verifyCols.length + ' collections');
  if (verifyTotal === 0 && stats.variables > 0) {
    log('ERROR: sync reported ' + stats.variables + ' variables but Figma has 0 — variables may not have persisted');
    stats.errors.push('Sync created ' + stats.variables + ' variables but verification found 0 — try re-syncing');
  }
  stats.variables = verifyTotal; /* Use actual Figma count, not theoretical */

  /* Pass 5: Sync Typography collection font-family variables to match
     primitives-numbers font/family-headline/-body/-code.
     Runs on every Update Variables so a font change is immediately live
     without needing to regenerate components.
     Also self-heals the legacy font-family/primary → font-family/body rename. */
  try {
    var typoSyncCols = await figma.variables.getLocalVariableCollectionsAsync();
    var typoSyncCol = null;
    for (var tsc = 0; tsc < typoSyncCols.length; tsc++) {
      var tc = typoSyncCols[tsc].name;
      if (tc === 'Typography' || tc === 'DTF Typography') {
        typoSyncCol = typoSyncCols[tsc];
        break;
      }
    }
    if (typoSyncCol) {
      var typoModeId5 = typoSyncCol.modes[0].modeId;
      var primNumsVars2 = await buildCollectionVarMap('primitives-numbers');

      /* Build a lookup of existing Typography vars */
      var typoVars5 = {};
      for (var tvi5 = 0; tvi5 < typoSyncCol.variableIds.length; tvi5++) {
        var tv5 = await figma.variables.getVariableByIdAsync(typoSyncCol.variableIds[tvi5]);
        if (tv5) typoVars5[tv5.name] = tv5;
      }

      /* Self-heal: rename font-family/primary → font-family/body if needed */
      if (typoVars5['font-family/primary'] && !typoVars5['font-family/body']) {
        try {
          typoVars5['font-family/primary'].name = 'font-family/body';
          typoVars5['font-family/body'] = typoVars5['font-family/primary'];
          delete typoVars5['font-family/primary'];
          log('Pass5: renamed font-family/primary → font-family/body');
        } catch (rnErr) { log('Pass5 rename failed: ' + rnErr.message); }
      }

      /* Sync each role — set as VariableAlias pointing to primitives-numbers
         so Typography/font-family/* are a single source of truth, not a copy. */
      var p5Roles = [
        { typoName: 'font-family/headline', primName: 'font/family-headline' },
        { typoName: 'font-family/body',     primName: 'font/family-body' },
        { typoName: 'font-family/code',     primName: 'font/family-code' }
      ];
      for (var p5i = 0; p5i < p5Roles.length; p5i++) {
        var p5r = p5Roles[p5i];
        var p5pv = primNumsVars2[p5r.primName];
        if (!p5pv) continue;

        var p5tv = typoVars5[p5r.typoName];
        if (p5tv) {
          /* Check if already aliased to the correct target */
          var p5cur = p5tv.valuesByMode[typoModeId5];
          var alreadyAliased = p5cur && p5cur.type === 'VARIABLE_ALIAS' && p5cur.id === p5pv.id;
          if (!alreadyAliased) {
            try {
              p5tv.setValueForMode(typoModeId5, figma.variables.createVariableAlias(p5pv));
              log('Pass5: ' + p5r.typoName + ' → alias to ' + p5r.primName);
            } catch (e) { log('Pass5 alias failed: ' + e.message); }
          } else {
            log('Pass5: ' + p5r.typoName + ' already aliased to ' + p5r.primName);
          }
        } else {
          /* Variable doesn't exist yet — create it as an alias to primitives-numbers */
          try {
            var p5new = figma.variables.createVariable(p5r.typoName, typoSyncCol, 'STRING');
            p5new.setValueForMode(typoModeId5, figma.variables.createVariableAlias(p5pv));
            log('Pass5: created ' + p5r.typoName + ' aliased to ' + p5r.primName);
          } catch (p5ce) { log('Pass5 create ' + p5r.typoName + ' failed: ' + p5ce.message); }
        }
      }
    }
  } catch (typoSyncErr) {
    log('Pass5 typography sync error (non-fatal): ' + typoSyncErr.message);
  }

  return stats;
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENT GENERATOR — builds Figma ComponentSets from blueprints
   ═══════════════════════════════════════════════════════════════ */

/* Build a variable lookup map for a named collection */
async function buildCollectionVarMap(collectionName) {
  var allCols = await figma.variables.getLocalVariableCollectionsAsync();
  var map = {};
  for (var i = 0; i < allCols.length; i++) {
    if (allCols[i].name !== collectionName) continue;
    for (var j = 0; j < allCols[i].variableIds.length; j++) {
      var v = await figma.variables.getVariableByIdAsync(allCols[i].variableIds[j]);
      if (v) map[v.name] = v;
    }
    break;
  }
  return map;
}

/* Bind a color variable to a node's fills or strokes */
function setPaintBoundToVariable(node, paintField, variable) {
  var paint = { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1, visible: true };
  try {
    paint = figma.variables.setBoundVariableForPaint(paint, 'color', variable);
  } catch (e) {
    /* Fallback: manual boundVariables reference */
    paint.boundVariables = { color: { type: 'VARIABLE_ALIAS', id: variable.id } };
  }
  node[paintField] = [paint];
  if (variable && variable.id) _recordBoundVarId(variable.id, variable.name);
}

/* Try to bind a variable to a numeric/boolean node property */
async function tryBindVar(node, field, variable) {
  if (!variable) return false;
  try {
    node.setBoundVariable(field, variable);
    if (variable.id) _recordBoundVarId(variable.id, variable.name);
    return true;
  } catch (e) {
    log('bindVar failed: ' + field + ' on ' + node.name + ' — ' + e.message);
    return false;
  }
}

/* ──────────────────────────────────────────────────────────────────
   ICON COLOR REBINDER — Path C (auto-heal on sync)

   Why this exists:
   When a designer swaps the Icon/Placeholder instance for an icon
   from any external library (Lucide, Phosphor, hand-drawn, etc.),
   the swapped icon's inner vectors carry LITERAL SOLID paints. Figma
   does NOT propagate the button's content-color variable binding
   into a swapped instance's descendants, so every button that uses
   that icon paints with the icon's hardcoded color (usually black).

   Strategy — mirror the variant's TEXT binding onto its ICON:
   Every button variant has its text element bound to the role-correct
   on-component color (e.g. brand/oncomponent-content/default on a
   Brand/Filled variant, content/default on a Neutral/Outlined one).
   We walk each variant, read the text's color binding, and apply the
   SAME binding to every vector inside the icon instance — both fills
   and strokes. This way:
     - stroke-based icons (Lucide) → recolored via strokes
     - fill-based icons (Phosphor solid, Material) → recolored via fills
     - icons with both → both bound
     - per-role accuracy → automatic, no spec lookup needed

   Also rebinds the Icon/Placeholder master itself to T2 default/
   content/default as a baseline (used when the icon is shown
   standalone, e.g. in the primitives showcase).

   Idempotent. Skips already-bound paints, gradients, images. Reports
   counts and warnings. Safe to re-run on every sync. */
async function rebindIconPlaceholderPaints() {
  var report = { scanned: 0, rebound: 0, placeholders: 0, variantsTouched: 0, warnings: [] };
  try {
    await figma.loadAllPagesAsync();
    var collections = await figma.variables.getLocalVariableCollectionsAsync();
    var t2 = null;
    for (var ci = 0; ci < collections.length; ci++) {
      if (collections[ci].name === 'T2 Surface Context Tokens') { t2 = collections[ci]; break; }
    }
    if (!t2) return report;
    var defaultContentVar = null;
    for (var vi = 0; vi < t2.variableIds.length; vi++) {
      var v = await figma.variables.getVariableByIdAsync(t2.variableIds[vi]);
      if (v && v.name === 'default/content/default') { defaultContentVar = v; break; }
    }
    if (!defaultContentVar) return report;

    /* Helper: bind both fills and strokes on `node` to `variable`,
       preserving paint properties (visibility, opacity). Only acts on
       SOLID paints that are visible. If `forceOverGenericNeutral` is
       true, also overrides existing bindings to the generic neutral
       content var — this lets the variant pass replace a too-generic
       binding with the role-correct one. */
    function bindPaints(node, variable, why, forceOverGenericNeutral) {
      ['fills', 'strokes'].forEach(function(field) {
        if (!(field in node)) return;
        var paints = node[field];
        if (paints === figma.mixed || !Array.isArray(paints) || paints.length === 0) return;
        var changed = false;
        var next = [];
        for (var pi = 0; pi < paints.length; pi++) {
          var paint = paints[pi];
          report.scanned++;
          if (!paint || paint.visible === false) { next.push(paint); continue; }
          if (paint.type !== 'SOLID') {
            if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL' ||
                paint.type === 'GRADIENT_ANGULAR' || paint.type === 'GRADIENT_DIAMOND' ||
                paint.type === 'IMAGE' || paint.type === 'VIDEO') {
              report.warnings.push(node.name + '.' + field + ': ' + paint.type + ' (' + why + ')');
            }
            next.push(paint); continue;
          }
          var alreadyBound = paint.boundVariables && paint.boundVariables.color;
          if (alreadyBound) {
            /* Skip unless we're allowed to override the generic neutral
               and this binding IS the generic neutral. */
            if (!forceOverGenericNeutral) { next.push(paint); continue; }
            if (paint.boundVariables.color.id !== defaultContentVar.id) { next.push(paint); continue; }
            if (variable.id === defaultContentVar.id) { next.push(paint); continue; }
            /* fall through — replace with role variable */
          }
          try {
            next.push(figma.variables.setBoundVariableForPaint(paint, 'color', variable));
            report.rebound++;
            changed = true;
          } catch (e) {
            report.warnings.push(node.name + '.' + field + ': bind failed — ' + e.message);
            next.push(paint);
          }
        }
        if (changed) {
          try { node[field] = next; }
          catch (e) { report.warnings.push(node.name + '.' + field + ': assign failed — ' + e.message); }
        }
      });
    }

    /* PASS 1 — Icon/Placeholder master: baseline binding to neutral
       content color. Used for standalone display (primitives showcase). */
    var placeholders = figma.root.findAll(function(n) {
      return n.type === 'COMPONENT' &&
             (n.name === 'Icon/Placeholder' || n.name === 'DTF/Icon/Placeholder');
    });
    report.placeholders = placeholders.length;
    for (var p = 0; p < placeholders.length; p++) {
      var ph = placeholders[p];
      bindPaints(ph, defaultContentVar, 'placeholder root', false);
      var phDesc = ph.findAll(function() { return true; });
      for (var dp = 0; dp < phDesc.length; dp++) bindPaints(phDesc[dp], defaultContentVar, 'placeholder descendant', false);
    }

    /* PASS 2 — Button variants: derive the role-correct content color
       and bind every icon vector to it. Two strategies, in order:
         (a) MIRROR FROM TEXT: read the variant's text fill binding and
             reuse it. Works for Button + Split Button with labels.
         (b) DERIVE FROM CONTAINER: for icon-only buttons (no text),
             search the variant subtree for a bound paint whose
             variable name matches a known surface pattern, then map
             to its on-color counterpart in the same collection:
               (any)/component/bg-(state)        -> oncomponent-content/default
               (any)/container/border-(state)    -> oncontainer-content/default
               (any)/component/bg-pressed        -> oncomponent-content/default
             Falls back to default/content/default if nothing found. */
    var allT3Vars = {};
    var t3 = null;
    for (var ci2 = 0; ci2 < collections.length; ci2++) {
      if (collections[ci2].name === 'T3 Status Context Tokens') { t3 = collections[ci2]; break; }
    }
    if (t3) {
      for (var tvi = 0; tvi < t3.variableIds.length; tvi++) {
        var tv = await figma.variables.getVariableByIdAsync(t3.variableIds[tvi]);
        if (tv) allT3Vars[tv.name] = tv;
      }
    }

    function deriveOnColorVar(sourceVarName) {
      /* sourceVarName like "component/bg-default" (T3 context-relative)
         or "brand/component/bg-default" (T2 role-prefixed). Strip the
         tail and map to on-* counterpart. */
      if (!sourceVarName) return null;
      var target = null;
      if (/component\/bg-/.test(sourceVarName)) {
        target = sourceVarName.replace(/component\/bg-[^/]+$/, 'oncomponent-content/default');
      } else if (/container\/border-/.test(sourceVarName)) {
        target = sourceVarName.replace(/container\/border-[^/]+$/, 'oncontainer-content/default');
      } else if (/container\/bg-/.test(sourceVarName)) {
        target = sourceVarName.replace(/container\/bg-[^/]+$/, 'oncontainer-content/default');
      }
      if (!target) return null;
      /* Try T3 first (context-relative names), then any collection. */
      if (allT3Vars[target]) return allT3Vars[target];
      return null;
    }

    var btnSets = figma.root.findAll(function(n) {
      return n.type === 'COMPONENT_SET' &&
             (/^Button\b/.test(n.name) || /^Split Button\b/.test(n.name) || /^Menu Button\b/.test(n.name));
    });
    for (var bs = 0; bs < btnSets.length; bs++) {
      var set = btnSets[bs];
      var variants = set.children;
      for (var vIdx = 0; vIdx < variants.length; vIdx++) {
        var variant = variants[vIdx];
        if (variant.type !== 'COMPONENT') continue;

        /* Strategy A — mirror text */
        var roleVar = null;
        var textNodes = variant.findAll(function(n) { return n.type === 'TEXT'; });
        for (var tx = 0; tx < textNodes.length; tx++) {
          var f = textNodes[tx].fills;
          if (Array.isArray(f) && f[0] && f[0].boundVariables && f[0].boundVariables.color) {
            try {
              var rv = await figma.variables.getVariableByIdAsync(f[0].boundVariables.color.id);
              if (rv) { roleVar = rv; break; }
            } catch (e) {}
          }
        }

        /* Strategy B — derive from container paint */
        if (!roleVar) {
          var allBound = variant.findAll(function(n) {
            var fs = (n.fills && Array.isArray(n.fills)) ? n.fills : [];
            var ss = (n.strokes && Array.isArray(n.strokes)) ? n.strokes : [];
            for (var i = 0; i < fs.length; i++) if (fs[i] && fs[i].boundVariables && fs[i].boundVariables.color) return true;
            for (var j = 0; j < ss.length; j++) if (ss[j] && ss[j].boundVariables && ss[j].boundVariables.color) return true;
            return false;
          });
          for (var ab = 0; ab < allBound.length && !roleVar; ab++) {
            var node = allBound[ab];
            var paintGroups = [node.fills, node.strokes];
            for (var pg = 0; pg < paintGroups.length && !roleVar; pg++) {
              var pp = paintGroups[pg];
              if (!Array.isArray(pp)) continue;
              for (var pi2 = 0; pi2 < pp.length && !roleVar; pi2++) {
                if (!pp[pi2] || !pp[pi2].boundVariables || !pp[pi2].boundVariables.color) continue;
                try {
                  var srcV = await figma.variables.getVariableByIdAsync(pp[pi2].boundVariables.color.id);
                  if (srcV) {
                    var derived = deriveOnColorVar(srcV.name);
                    if (derived) roleVar = derived;
                  }
                } catch (e) {}
              }
            }
          }
        }

        /* Strategy C — fallback by set role.
           - Neutral sets ("Button / Neutral / ..."): use T2 default/
             content/default. T3 has no "neutral" mode, so binding to
             T3 content/default would resolve to the brand role (its
             collection default) and paint Neutral icons green/red/etc.
           - Role sets (Brand, Status, etc.): use T3 content/default,
             which resolves per the variant's T3 mode. This is the
             correct fallback for Ghost / Outlined / Secondary /
             Tertiary types where the container has no role-tinted
             chrome to derive from. */
        if (!roleVar) {
          var isNeutralSet = /\bNeutral\b/i.test(set.name);
          if (isNeutralSet) {
            roleVar = defaultContentVar;
          } else if (allT3Vars['content/default']) {
            roleVar = allT3Vars['content/default'];
          }
        }

        /* Strategy D — T2 surface-inverse fallback when T3 collection is absent.
           For non-neutral filled Brand/semantic variants (e.g. Primary, where
           T3/oncomponent-content/default is needed but T3 doesn't exist yet),
           set surface-inverse T2 mode on each "Icon wrapper cont" frame so the
           inherited T2/default/content/default resolves to near-white instead
           of the default dark-on-bright value. Only fires when allT3Vars is
           completely empty (T3 collection entirely missing, not just a gap). */
        if (!roleVar && Object.keys(allT3Vars).length === 0 && t2) {
          var _isNeutralD = /\bNeutral\b/i.test(set.name);
          if (!_isNeutralD) {
            var _invModeId = null;
            for (var _tmd = 0; _tmd < t2.modes.length; _tmd++) {
              if (t2.modes[_tmd].name === 'surface-inverse') { _invModeId = t2.modes[_tmd].modeId; break; }
            }
            if (_invModeId) {
              var _iwNodes = variant.findAll(function(n) { return n.name === 'Icon wrapper cont'; });
              var _iwSet = false;
              for (var _iwi = 0; _iwi < _iwNodes.length; _iwi++) {
                try {
                  _iwNodes[_iwi].setExplicitVariableModeForCollection(t2, _invModeId);
                  _iwSet = true;
                } catch (_iwE) { /* ghost node mode set failed — skip */ }
              }
              if (_iwSet) roleVar = defaultContentVar;
            }
          }
        }

        if (!roleVar) continue;

        /* Apply to every vector-shape descendant inside icon instances
           (excluding chevron, which the generator already binds). */
        var iconInsts = variant.findAll(function(n) {
          return n.type === 'INSTANCE' && !/chevron/i.test(n.name);
        });
        var touched = false;
        for (var ii = 0; ii < iconInsts.length; ii++) {
          var leaves = iconInsts[ii].findAll(function(n) {
            return n.type === 'VECTOR' || n.type === 'STAR' || n.type === 'ELLIPSE' ||
                   n.type === 'POLYGON' || n.type === 'RECTANGLE' || n.type === 'LINE' ||
                   n.type === 'BOOLEAN_OPERATION';
          });
          for (var lf = 0; lf < leaves.length; lf++) {
            var before = report.rebound;
            bindPaints(leaves[lf], roleVar, 'variant: ' + variant.name, true);
            if (report.rebound > before) touched = true;
          }
        }
        if (touched) report.variantsTouched++;
      }
    }
  } catch (err) {
    report.warnings.push('rebinder error: ' + err.message);
  }
  return report;
}

/* M5/V2 — per-build set of variable IDs we actually bound. Reset at
   the start of each generateComponentFromBlueprint() invocation; read
   at Step 9 to record the precise binding surface for THIS component
   in the ledger. Lets the Builder pill avoid false positives when a
   sync only added or removed variables this component doesn't use.

   V3 — also captures the variable NAME at bind time so the Builder
   pill can show a human-readable list when bindings break (variables
   deleted/recreated lose their name in Figma; the ledger keeps it). */
var _boundIdsForBuild = null;
var _boundNamesForBuild = null;
function _recordBoundVarId(id, name){
  if (_boundIdsForBuild) _boundIdsForBuild[id] = 1;
  if (_boundNamesForBuild && name && !_boundNamesForBuild[id]) _boundNamesForBuild[id] = name;
}

/* ══════════════════════════════════════════════════════════════
   TOGGLE BLUEPRINT — Track + Thumb Architecture
   ──────────────────────────────────────────────────────────────
   kind: 'track-thumb' — root frame IS the track.

   Two Tier-1 master components (one per shape):
     Switch        — Pill track  (toggle/radius = 9999)
     Switch Square — Square track (toggle/radius-square = 8px)

   Both masters use auto-layout HORIZONTAL HUG:
     [LabelOn (HUG)] [Thumb (FIXED layout-child)] [LabelOff (HUG)]
   Track expands to fit labels + thumb — no fixed-width clipping.
   Thumb stays centered; state = fill change + label opacity swap.

   Three families:
     Filled   — neutral grey off → SUCCESS green on
     Outlined — transparent + border off → success green on
     Danger   — neutral grey off → danger red on

   Off-Focus / On-Focus always use T3 brand mode so the focus ring
   is the universal blue indicator (never red, even in Danger family).
   ══════════════════════════════════════════════════════════════ */

var TOGGLE_BLUEPRINT = {
  name: 'Switch',
  targetPage: '☑️ Selection Controls',
  kind: 'track-thumb',
  unified: true,            /* collapse 4 masters into ONE "Switch" component set with
                               Pill=On|Off + Label=On|Off boolean variant axes */
  skipRounded: true,        /* shape is per-master (not a Rounded= variant axis) */
  labeledAxis:  false,      /* labeling is per-master (not a Label= variant axis in old sense) */
  singleFamily: true,       /* display name = master name only (unused when unified:true) */
  radiusRoundedPath: 'toggle/radius', /* pill (9999) — used when masterCfg.isRounded */
  legacyOwners: ['Toggle'], /* old BP.name — ensures old Toggle/... sets are cleaned up */
  legacySectionNames: [     /* old section names to clean up on next generate */
    'Switch \u2014 Tier 1 / Masters',
    'Switch \u2014 Tier 2 / Variants'
  ],
  ledgerKey: 'toggle',      /* registry key the UI reads; must not change with BP.name */
  description: 'Binary on/off switch. Pill=On/Off (shape), Label=On/Off (track label). Types: Fill, Outline. ON state defaults to success green — switch T3 collection mode on any instance to brand, danger, warning, etc.',

  /* Grid layout override — toggle components are 40×24px (vs button 120×36px).
     colSpacing=88: "Off-Disabled" header label is ~77px at 11pt — needs 88px to
     prevent overlap. rowSpacing=40: 24px component + 16px gap for readable rows. */
  gridLayout: { colSpacing: 104, rowSpacing: 52, componentW: 72, componentH: 28 },

  /* FOUR masters build the 64-variant unified set.
     pill:true  → Pill=On  → pill track+thumb (toggle/radius = 9999).
     label:true → Label=On → HUG track with ON/OFF text label inside.
     Each master contributes 2-type × 8-state = 16 variants to the shared set. */
  masters: {
    'Switch': {
      pill: false, label: false,
      thumbXVar: 'toggle/thumb-inset',
      isRounded: false,
      isLabeled: false
    },
    'Switch / Pill': {
      pill: true, label: false,
      thumbXVar:      'toggle/thumb-inset',
      isRounded:      true,
      isLabeled:      false,
      rootRadiusPath: 'toggle/radius',   /* pill track  — 9999 */
      thumbRadiusPath:'toggle/radius'    /* circle thumb — 9999 */
    },
    'Switch / Labeled': {
      pill: false, label: true,
      thumbXVar: 'toggle/thumb-inset',
      isRounded: false,
      isLabeled: true
    },
    'Switch / Pill / Labeled': {
      pill: true, label: true,
      thumbXVar:      'toggle/thumb-inset',
      isRounded:      true,
      isLabeled:      true,
      rootRadiusPath: 'toggle/radius',   /* pill track  — 9999 */
      thumbRadiusPath:'toggle/radius'    /* circle thumb — 9999 */
    }
  },

  /* comp-size variable paths.
     Track uses toggle/radius-square (8px); thumb uses toggle/thumb-radius-square (6px = 8−inset).
     Rounded=True rebinds both to toggle/radius (9999) via radiusRoundedPath / thumbRadiusPath. */
  sizeBindings: {
    root: {
      width:             'toggle/track-w',
      height:            'toggle/track-h',
      topLeftRadius:     'toggle/radius-square',
      topRightRadius:    'toggle/radius-square',
      bottomLeftRadius:  'toggle/radius-square',
      bottomRightRadius: 'toggle/radius-square'
    },
    /* thumb uses toggle/thumb-radius-square (6px = track 8px − inset 2px).
       Concentric radius: the thumb corner curve nests inside the track corner
       — they share the same visual centre, not the same raw number. */
    thumb: {
      width:             'toggle/thumb-size',
      height:            'toggle/thumb-size',
      topLeftRadius:     'toggle/thumb-radius-square',
      topRightRadius:    'toggle/thumb-radius-square',
      bottomLeftRadius:  'toggle/thumb-radius-square',
      bottomRightRadius: 'toggle/thumb-radius-square'
    },
    thumbY: 'toggle/thumb-inset'
  },

  families: {
    /* ONE family — "Success" — two surface types (Fill, Outline).
       This mirrors the button's Brand family: defaults to success green ON,
       but designers can switch the T3 collection mode on any INSTANCE
       (Design panel → variable collections → T3 Status Context Tokens)
       to brand, danger, warning, info, or neutral — no extra component sets needed.

       OFF track always uses T2 neutral tokens (project-agnostic grey).
       ON track uses T3 success mode by default — switchable per instance. */
    'Success': {
      types:  ['Fill', 'Outline'],
      states: ['Off', 'Off-Hover', 'Off-Focus', 'Off-Disabled',
               'On',  'On-Hover',  'On-Focus',  'On-Disabled'],
      stateOverrides: {
        /* ── FILL — solid grey track off → semantic fill on ────────── */
        'Fill': {
          'Off':          { fill: 'default/component/bg-pressed' },
          'Off-Hover':    { fill: 'default/component/bg-pressed' },
          /* Off-Focus ring: T2 outline (same neutral indicator as button Neutral family) */
          'Off-Focus':    { fill: 'default/component/bg-pressed',
                            stroke: 'default/component/outline-default', strokeWeight: 2 },
          'Off-Disabled': { fill: 'default/component/bg-pressed', componentOpacity: 0.5 },
          'On':           { t3Mode: 'success', fill: { t3: 'component/bg-default' },
                            thumbXOverride: 'toggle/thumb-x-on' },
          'On-Hover':     { t3Mode: 'success', fill: { t3: 'component/bg-hover' },
                            thumbXOverride: 'toggle/thumb-x-on' },
          'On-Focus':     { t3Mode: 'success', fill: { t3: 'component/bg-default' },
                            stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                            thumbXOverride: 'toggle/thumb-x-on' },
          'On-Disabled':  { t3Mode: 'success', fill: { t3: 'component/bg-default' },
                            componentOpacity: 0.5, thumbXOverride: 'toggle/thumb-x-on' }
        },
        /* ── OUTLINE — transparent + border off → semantic fill on ── */
        'Outline': {
          /* Resting Off states: 1px T2 outline — track shape with no semantic color.
             Focus state bumps to 2px (same as Fill Off-Focus) — keyboard signal
             via weight, not color. No T3 in any Off state: the toggle is off,
             no semantic role has been engaged yet. */
          'Off':          { stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Off-Hover':    { fill: 'default/component/bg-hover',
                            stroke: 'default/component/outline-hover', strokeWeight: 1 },
          'Off-Focus':    { stroke: 'default/component/outline-default', strokeWeight: 2 },
          'Off-Disabled': { stroke: 'default/component/outline-default', strokeWeight: 1,
                            componentOpacity: 0.5 },
          'On':           { t3Mode: 'success', fill: { t3: 'component/bg-default' },
                            thumbXOverride: 'toggle/thumb-x-on' },
          'On-Hover':     { t3Mode: 'success', fill: { t3: 'component/bg-hover' },
                            thumbXOverride: 'toggle/thumb-x-on' },
          'On-Focus':     { t3Mode: 'success', fill: { t3: 'component/bg-default' },
                            stroke: { t3: 'component/outline-default' }, strokeWeight: 1,
                            thumbXOverride: 'toggle/thumb-x-on' },
          'On-Disabled':  { t3Mode: 'success', fill: { t3: 'component/bg-default' },
                            componentOpacity: 0.5, thumbXOverride: 'toggle/thumb-x-on' }
        }
      }
    }
  }
};

/* ══════════════════════════════════════════════════════════════
   BUTTON BLUEPRINT — Two-Tier Master/Instance Architecture
   ──────────────────────────────────────────────────────────────
   TIER 1 — Master components: own structure + spacing (comp-size vars)
   TIER 2 — Variant components: contain master instances, own color/state
   ══════════════════════════════════════════════════════════════ */

var BUTTON_BLUEPRINT = {
  name: 'Button',
  targetPage: '🔘 Buttons',
  usesIconPrimitives: true,  /* migrates DTF-PRIMITIVES section to target page */
  singleFamily: true,       /* all families merge into one set per master — preserves "Text Button" set names */
  description: 'A multi-purpose button supporting 4 structures (Filled, Outlined, Ghost, Fill & Outline), 10 density sizes, icon + text slots, and full state coverage. Uses comp-size variables for spacing and T2/T3 context tokens for color.',

  /* Master component layouts (TIER 1)
     Each master defines: slots, rootPAlign, and slot-specific overrides.
     ─────────────────────────────────────────────────────────────────────────
     Smart padding model:
       - Each wrapper only owns its OUTER-EDGE padding.
       - Inner edges are always 0 — root itemSpacing (gap var) handles spacing.
       - When a wrapper is the ONLY slot, it owns BOTH L and R.
       - Padding binding is auto-derived from slot position (first→padL, last→padR).
  */
  masters: {
    'Icon + Text': {
      slots: ['iconWrapper', 'textWrapper'],
      rootPAlign: 'MIN',
      iconWrapperPAlign: 'MIN'
    },
    'Text Button': {
      slots: ['textWrapper'],
      rootPAlign: 'MIN'
    },
    'Icon Button': {
      slots: ['iconWrapper'],
      rootPAlign: 'CENTER',
      iconWrapperPAlign: 'CENTER'
    }
  },

  /* comp-size variable paths bound on master components.
     Padding bindings are per-edge so the generator can pick L, R, or both
     depending on the slot's position in the master. */
  sizeBindings: {
    root: {
      height:           'button/default/height',
      topLeftRadius:    'button/default/radius',
      topRightRadius:   'button/default/radius',
      bottomLeftRadius: 'button/default/radius',
      bottomRightRadius:'button/default/radius'
    },
    iconWrapperPadL:      'button/default/icon wrapper padding L',
    iconWrapperPadR:      'button/default/icon wrapper padding R',
    iconPad:              'button/default/icon pad',
    textWrapperPadL:      'button/default/text wrapper padding L',
    textWrapperPadR:      'button/default/text wrapper padding R',
    icon: {
      width:  'button/default/icon container',
      height: 'button/default/icon container'
    },
    text: {
      fontSize: 'button/default/font-size'
    }
  },

  /* comp-size bindings for the Icon Button master specifically.
     Icon Button is a SQUARE (width = height = size). It uses
     icon-button/* variables from icon-button.tokens.css so that:
       - base: size=36px, icon=18px → 9px effective padding all sides
       - small: size=32px, icon=16px → 8px effective padding all sides
     Compare: sizeBindings.root only has height + uses btn icon-size (16px)
     which made the Figma frame non-square (32×36) with non-uniform padding. */
  iconBtnSizeBindings: {
    root: {
      width:            'icon-button/default/size',
      height:           'icon-button/default/size',
      topLeftRadius:    'button/default/radius',
      topRightRadius:   'button/default/radius',
      bottomLeftRadius: 'button/default/radius',
      bottomRightRadius:'button/default/radius'
    },
    iconPad:              'button/default/icon pad',
    icon: {
      width:  'icon-button/default/icon container',
      height: 'icon-button/default/icon container'
    }
  },

  /* Default content color applied in master (T2 Surface Context) */
  masterContentColor: 'default/content/default',

  /* ── Families ──────────────────────────────────────────────
     Each family produces its own component set per master.
     - Neutral: structural variants on T2 surface context (theme-aware greys).
     - Brand:   semantic variants on T3 status context, locked to 'brand' mode
                (uses the project's brand palette via T3 → T1 alias chain).

     stateOverrides format:
       String values  = T2 Surface Context path.
       { t3: path }   = T3 Status Context path (resolved in family.t3Mode).
     ─────────────────────────────────────────────────────────── */
  families: {
    'Neutral': {
      types:  ['Filled', 'Outlined', 'Ghost', 'Fill & Outline'],
      states: ['Default', 'Hover', 'Pressed', 'Selected', 'Focus', 'Disabled'],
      stateOverrides: {
        'Filled': {
          'Default':  { fill: 'default/component/bg-default' },
          'Hover':    { fill: 'default/component/bg-hover' },
          'Pressed':  { fill: 'default/component/bg-pressed' },
          /* Selected on Filled = "stuck pressed" in brand-mode. Don't tint with
             container/bg (weakens already-solid surface, kills white-on-tint text).
             Use brand component/bg-pressed + on-component text + brand outline ring. */
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'component/bg-pressed' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Focus':    { fill: 'default/component/bg-default', focusRing: true },
          'Disabled': { fill: 'default/component/bg-default', componentOpacity: 0.3 }
        },
        'Outlined': {
          'Default':  { stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Hover':    { fill: 'default/component/bg-hover',   stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Pressed':  { fill: 'default/component/bg-pressed', stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Focus':    { stroke: 'default/component/outline-default', strokeWeight: 1, focusRing: true },
          'Disabled': { stroke: 'default/component/outline-default', strokeWeight: 1, componentOpacity: 0.3 }
        },
        'Ghost': {
          'Default':  { text: 'default/content/default', icon: 'default/content/default' },
          'Hover':    { fill: 'default/component/bg-hover',   fillFallback: { r: 0.91, g: 0.91, b: 0.91 },
                        text: 'default/content/default', icon: 'default/content/default' },
          'Pressed':  { fill: 'default/component/bg-pressed', fillFallback: { r: 0.85, g: 0.85, b: 0.85 },
                        text: 'default/content/default', icon: 'default/content/default' },
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Focus':    { t3Mode: 'brand', focusRing: true,
                        text: 'default/content/default', icon: 'default/content/default' },
          'Disabled': { componentOpacity: 0.3, text: 'default/content/default', icon: 'default/content/default' }
        },
        'Fill & Outline': {
          'Default':  { fill: 'default/component/bg-default', stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Hover':    { fill: 'default/component/bg-hover',   stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Pressed':  { fill: 'default/component/bg-pressed', stroke: 'default/component/outline-default', strokeWeight: 1 },
          /* Selected = same as Filled: solid baseline → bg-pressed + on-component text. */
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'component/bg-pressed' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Focus':    { fill: 'default/component/bg-default', stroke: 'default/component/outline-default', strokeWeight: 1, focusRing: true },
          'Disabled': { fill: 'default/component/bg-default', stroke: 'default/component/outline-default', strokeWeight: 1, componentOpacity: 0.3 }
        }
      }
    },

    /* ── BRAND FAMILY ──────────────────────────────────────────
       4 semantic variants, all bound to T3 collection's 'brand' mode.
       Maps to real-world button hierarchies:
         Filled   = high-emphasis, solid brand fill, white text    (Call-to-Action)
         Outlined = brand border + brand text, no fill at rest   (Confirm / next-tier action)
         Tonal    = container/brand tonal fill, brand text        (Quiet emphasis)
         Ghost    = no chrome, brand text                         (Inline / minimal)
       ────────────────────────────────────────────────────────── */
    'Brand': {
      types:  ['Brand Filled', 'Brand Outlined', 'Brand Tonal', 'Ghost'],
      states: ['Default', 'Hover', 'Pressed', 'Selected', 'Focus', 'Disabled'],
      t3Mode: 'brand',
      stateOverrides: {
        'Brand Filled': {
          'Default':  { fill: { t3: 'component/bg-default' },
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Hover':    { fill: { t3: 'component/bg-hover' },
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Pressed':  { fill: { t3: 'component/bg-pressed' },
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Selected': { fill: { t3: 'component/bg-pressed' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Focus':    { fill: { t3: 'component/bg-default' }, focusRing: true,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Disabled': { fill: { t3: 'component/bg-default' }, componentOpacity: 0.3,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } }
        },
        'Brand Outlined': {
          'Default':  { stroke: { t3: 'component/outline-default' }, strokeWeight: 1,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Hover':    { fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-hover' }, strokeWeight: 1,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Pressed':  { fill: { t3: 'container/hover' }, stroke: { t3: 'component/outline-pressed' }, strokeWeight: 1,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Selected': { fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Focus':    { stroke: { t3: 'component/outline-default' }, strokeWeight: 1, focusRing: true,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Disabled': { stroke: { t3: 'component/outline-default' }, strokeWeight: 1, componentOpacity: 0.3,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } }
        },
        'Brand Tonal': {
          'Default':  { fill: { t3: 'container/bg' },
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Hover':    { fill: { t3: 'container/hover' },
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Pressed':  { fill: { t3: 'container/pressed' },
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Selected': { fill: { t3: 'container/hover' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Focus':    { fill: { t3: 'container/bg' }, focusRing: true,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Disabled': { fill: { t3: 'container/bg' }, componentOpacity: 0.3,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } }
        },
        'Ghost': {
          'Default':  { text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Hover':    { fill: { t3: 'container/bg' },
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Pressed':  { fill: { t3: 'container/hover' },
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Selected': { fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Focus':    { focusRing: true,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Disabled': { componentOpacity: 0.3,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } }
        }
      }
    }
  }
};

/* ══════════════════════════════════════════════════════════════
   SPLIT BUTTON BLUEPRINT — Wrapper + Button-Instance Architecture
   ──────────────────────────────────────────────────────────────
   Per multi-zone-model.md (Q1–Q7), refined for Option B (button reuse):
     Q1: nested zones inside a wrapper (action [= button instance] + chevron)
     Q3: divider rendered as a 1px LEFT-edge stroke on the chevron zone
         (no sibling node, no thickness var)
     Q4: outer corners owned by wrapper; clipsContent=true clips the inner
         button-instance corners flush
     Q5: Rounded boolean variant axis only
     Q6: ALL action-zone tokens INHERIT from button (the action zone IS a
         button instance — single source of truth, automatic propagation).
         STRUCTURAL tokens OWNED by split-button:
           - split-button/chevron/padding  (chevron zone padding)
           - split-button/chevron/size       (chevron icon container)
     Q7: ~6 component-level reactions per type (Default↔Hover, Default↔Pressed)

   Each split-button master = HORIZONTAL frame containing:
     [button-instance (action)] · [chevron zone with leftStroke = divider]

   The action zone is an INSTANCE of one of the 3 button masters:
     'Text + Chevron'         → instance of button 'Text Button'
     'Icon + Text + Chevron'  → instance of button 'Icon + Text'
     'Icon + Chevron'         → instance of button 'Icon Button'

   Variant overrides apply fill/stroke to BOTH the button instance AND the
   chevron zone (so both halves stay visually unified). The chevron zone's
   leftStroke is bound to the separator color and is independent of the
   variant's main fill/stroke.
   ══════════════════════════════════════════════════════════════ */

var SPLIT_BUTTON_BLUEPRINT = {
  name: 'Split Button',
  targetPage: '🔘 Buttons',
  usesIconPrimitives: true,  /* migrates DTF-PRIMITIVES section to target page */
  singleFamily: true,       /* all families merge into one set per master */
  description: 'A two-zone action+menu button. Action zone is a button-master instance (inherits all button tokens). Trigger zone (chevron) opens a menu. Divider = 1px stroke between zones.',

  /* Discriminator: tells the generator to use wrapper-with-button-instance
     master construction. Variant overrides apply to the wrapper itself —
     fills naturally show through the transparent button-instance and
     chevron-zone children, so both halves stay color-unified. */
  kind: 'wrapper-with-button-instance',

  /* Master shapes — each maps to an existing button master used as the
     action zone. The chevron zone is implicit and always present. */
  masters: {
    'Text + Chevron': {
      buttonMaster: 'Text Button'
    },
    'Icon + Text + Chevron': {
      buttonMaster: 'Icon + Text'
    },
    'Icon + Chevron': {
      buttonMaster: 'Icon Button'
    }
  },

  /* comp-size variable paths for STRUCTURAL tokens (split-button-owned).
     Action-zone bindings are NOT here — they come from the button instance
     automatically. Only the chevron zone needs explicit bindings. */
  sizeBindings: {
    /* Wrapper root: height + 4 outer corners INHERIT from button. */
    root: {
      height:           'button/default/height',
      topLeftRadius:    'button/default/radius',
      topRightRadius:   'button/default/radius',
      bottomLeftRadius: 'button/default/radius',
      bottomRightRadius:'button/default/radius'
    },
    /* Chevron zone — STRUCTURAL, owned. Symmetric padding around chevron. */
    chevronWrapperPadL:   'split-button/chevron/padding',
    chevronWrapperPadR:   'split-button/chevron/padding',
    chevron: {
      width:  'split-button/chevron/size',
      height: 'split-button/chevron/size'
    }
  },

  /* Default content color applied to chevron icon (T2 Surface Context).
     The button instance carries its own content color from button master. */
  masterContentColor: 'default/content/default',

  /* Divider color binding strategy.
     Bound as the chevron zone's LEFT stroke (strokeLeftWeight=1).
     Neutral family → T2 'default/component/separator'.
     Brand   family → T3 'component/separator' (resolved in family.t3Mode). */
  dividerColor: {
    t2: 'default/component/separator',
    t3: 'component/separator'
  },

  /* ── Families ──────────────────────────────────────────────
     Mirror BUTTON_BLUEPRINT's families exactly so split-button has
     visual + state parity with button.

  /* ── Families ──────────────────────────────────────────────
     Per-zone state variants (Option B).

     The state axis has 8 values that combine action-zone and trigger-zone
     state independently:

       Default          → both zones rest
       Action Hover     → action zone hover,  trigger rest
       Action Pressed   → action zone pressed, trigger rest
       Trigger Hover    → action rest, trigger zone hover
       Trigger Pressed  → action rest, trigger zone pressed
       Selected         → both zones selected (whole component is "on")
       Focus            → both zones rest, wrapper gets focus ring stroke
       Disabled         → both zones rest, wrapper gets opacity 0.3

     Per type, we declare semantic state SPECS (rest / hover / pressed /
     selected / focus / disabled). The generator expands each spec to
     per-zone overrides at variant time. This keeps the data tight and
     authoring per-type painless.

     A spec entry shape:
       { fill, stroke, strokeWeight, text, icon }   ← applied per zone
       wrapper: { stroke, strokeWeight, componentOpacity, fill } ← applied to wrapper
     ─────────────────────────────────────────────────────────── */
  states: ['Default', 'Action Hover', 'Action Pressed', 'Trigger Hover', 'Trigger Pressed', 'Selected', 'Focus', 'Disabled'],

  families: {
    'Neutral': {
      types: ['Filled', 'Outlined', 'Ghost', 'Fill & Outline'],
      typeSpecs: {
        'Filled': {
          rest:     { fill: 'default/component/bg-default' },
          hover:    { fill: 'default/component/bg-hover' },
          pressed:  { fill: 'default/component/bg-pressed' },
          /* Selected on a Filled button = "stuck pressed" in brand-mode.
             Don't tint with container/bg — that visually weakens an already
             solid-coloured button and makes white-on-tint text invisible.
             Use brand component/bg-pressed for the fill, brand on-component
             text, plus a brand outline ring as the selection cue. */
          selected: { t3Mode: 'brand',
                      fill: { t3: 'component/bg-pressed' }, text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { fill: 'default/component/bg-default',
                      wrapper: { focusRing: true } },
          disabled: { fill: 'default/component/bg-default',
                      wrapper: { componentOpacity: 0.3 } }
        },
        'Outlined': {
          rest:     {},
          hover:    { fill: 'default/component/bg-hover' },
          pressed:  { fill: 'default/component/bg-pressed' },
          selected: { t3Mode: 'brand',
                      fill: { t3: 'container/bg' }, text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { wrapper: { focusRing: true } },
          disabled: { wrapper: { stroke: 'default/component/outline-default', strokeWeight: 1, componentOpacity: 0.3 } },
          wrapperBase: { stroke: 'default/component/outline-default', strokeWeight: 1 }
        },
        'Ghost': {
          rest:     {},
          hover:    { fill: 'default/component/bg-hover' },
          pressed:  { fill: 'default/component/bg-pressed' },
          selected: { t3Mode: 'brand',
                      fill: { t3: 'container/bg' }, text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { wrapper: { focusRing: true } },
          disabled: { wrapper: { componentOpacity: 0.3 } }
        },
        'Fill & Outline': {
          rest:     { fill: 'default/component/bg-default' },
          hover:    { fill: 'default/component/bg-hover' },
          pressed:  { fill: 'default/component/bg-pressed' },
          /* Selected on Fill&Outline = same logic as Filled: solid-coloured
             baseline, so use brand bg-pressed + on-component text + brand
             outline ring (the wrapperBase outline is replaced by the
             stronger 2px brand ring for the duration of Selected). */
          selected: { t3Mode: 'brand',
                      fill: { t3: 'component/bg-pressed' }, text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { fill: 'default/component/bg-default',
                      wrapper: { focusRing: true } },
          disabled: { fill: 'default/component/bg-default',
                      wrapper: { stroke: 'default/component/outline-default', strokeWeight: 1, componentOpacity: 0.3 } },
          wrapperBase: { stroke: 'default/component/outline-default', strokeWeight: 1 }
        }
      }
    },

    'Brand': {
      types: ['Brand Filled', 'Brand Outlined', 'Brand Tonal', 'Ghost'],
      t3Mode: 'brand',
      typeSpecs: {
        'Brand Filled': {
          rest:     { fill: { t3: 'component/bg-default' }, text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          hover:    { fill: { t3: 'component/bg-hover' },   text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          pressed:  { fill: { t3: 'component/bg-pressed' }, text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          /* Selected = "stuck pressed": solid brand fill, on-component text, 2px brand ring. */
          selected: { fill: { t3: 'component/bg-pressed' }, text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { fill: { t3: 'component/bg-default' }, text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' },
                      wrapper: { focusRing: true } },
          disabled: { fill: { t3: 'component/bg-default' }, text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' },
                      wrapper: { componentOpacity: 0.3 } }
        },
        'Brand Outlined': {
          rest:     { text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          hover:    { fill: { t3: 'container/bg' },    text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          pressed:  { fill: { t3: 'container/hover' }, text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          /* Selected = rest baseline + 2px ring. Don't shift the fill
             (would collide with divider since both zones share the token). */
          selected: { text: { t3: 'content/default' }, icon: { t3: 'content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { text: { t3: 'content/default' }, icon: { t3: 'content/default' },
                      wrapper: { focusRing: true } },
          disabled: { text: { t3: 'content/default' }, icon: { t3: 'content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 1, componentOpacity: 0.3 } },
          wrapperBase: { stroke: { t3: 'component/outline-default' }, strokeWeight: 1 }
        },
        'Brand Tonal': {
          rest:     { fill: { t3: 'container/bg' },     text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          hover:    { fill: { t3: 'container/hover' },  text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          pressed:  { fill: { t3: 'container/pressed' }, text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          /* Selected = rest baseline + 2px ring (avoids divider collision). */
          selected: { fill: { t3: 'container/bg' }, text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { fill: { t3: 'container/bg' },     text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' },
                      wrapper: { focusRing: true } },
          disabled: { fill: { t3: 'container/bg' },     text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' },
                      wrapper: { componentOpacity: 0.3 } }
        },
        'Ghost': {
          rest:     { text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          hover:    { fill: { t3: 'container/bg' },    text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          pressed:  { fill: { t3: 'container/hover' }, text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          /* Selected = rest baseline (transparent) + 2px ring. */
          selected: { text: { t3: 'content/default' }, icon: { t3: 'content/default' },
                      wrapper: { stroke: { t3: 'component/outline-default' }, strokeWeight: 2 } },
          focus:    { text: { t3: 'content/default' }, icon: { t3: 'content/default' },
                      wrapper: { focusRing: true } },
          disabled: { text: { t3: 'content/default' }, icon: { t3: 'content/default' },
                      wrapper: { componentOpacity: 0.3 } }
        }
      }
    }
  }
};

/* ══════════════════════════════════════════════════════════════
   MENU BUTTON BLUEPRINT — Single-zone Disclosure Button
   ──────────────────────────────────────────────────────────────
   A button that ALWAYS opens a dropdown menu. Unlike split-button
   (two independent zones), menu-button is ONE unified zone:
     [icon? | text | chevron]

   Layout strategy: wrapper-based padding (same architecture as button).
     Each wrapper owns its outer-edge air; root itemSpacing stays 0.
       iconWrapperPadL  = padding-x  (leading edge)
       iconWrapperPadR  = gap        (space icon → text)
       textWrapperPadR  = gap        (space text → chevron)
       chevronWrapperPadR = chevron-pe (trailing edge after chevron)
   Root carries only height + radius. No root-level padding or itemSpacing binding.

   Three masters:
     'Icon + Text + Chevron' — optional leading icon with label
     'Text + Chevron'        — text only (most common)
     'Icon + Chevron'        — compact icon-only trigger (no label)

   Families, types, and state overrides are IDENTICAL to button:
   same T2/T3 color model, same state axis, same Rounded boolean axis.
   ══════════════════════════════════════════════════════════════ */
var MENU_BUTTON_BLUEPRINT = {
  name: 'Menu Button',
  targetPage: '🔘 Buttons',
  usesIconPrimitives: true,  /* migrates DTF-PRIMITIVES section to target page */
  singleFamily: true,       /* all families merge into one set per master */
  description: 'A single-zone disclosure button that opens a dropdown menu. Supports icon + text + chevron, text + chevron, and compact icon + chevron layouts, 10 density sizes, all structural and semantic variants.',

  masters: {
    'Icon + Text + Chevron': {
      slots: ['iconWrapper', 'textWrapper', 'chevronSlot'],
      rootPAlign: 'MIN',
      iconWrapperPAlign: 'MIN'
    },
    'Text + Chevron': {
      slots: ['textWrapper', 'chevronSlot'],
      rootPAlign: 'MIN'
    },
    'Icon + Chevron': {
      slots: ['iconWrapper', 'chevronSlot'],
      rootPAlign: 'MIN',
      iconWrapperPAlign: 'MIN'
    }
  },

  /* Wrapper-based padding — mirrors button/split-button architecture.
     Root holds height + radius only; wrappers own their outer-edge air.
     Figma's setBoundVariable reliably supports paddingLeft/Right on frames;
     itemSpacing binding is unreliable and intentionally avoided here. */
  sizeBindings: {
    root: {
      height:            'menu-button/height',
      topLeftRadius:     'menu-button/radius',
      topRightRadius:    'menu-button/radius',
      bottomLeftRadius:  'menu-button/radius',
      bottomRightRadius: 'menu-button/radius'
    },
    /* Leading icon wrapper: padL = padding-x-icon (tighter when icon present), padR = gap (space to text). */
    iconWrapperPadL:    'menu-button/padding-x-icon',
    iconWrapperPadR:    'menu-button/gap',
    /* Text wrapper: padL when first slot (text-only master) = padding-x; padR = gap (space to chevron). */
    textWrapperPadL:    'menu-button/padding-x',
    textWrapperPadR:    'menu-button/gap',
    /* Chevron slot wrapper: padR = chevron-pe (trailing right edge). */
    chevronWrapperPadR: 'menu-button/chevron-pe',
    icon: {
      width:  'menu-button/icon-size',
      height: 'menu-button/icon-size'
    },
    text: {
      fontSize: 'menu-button/font-size'
    },
    chevronSlot: {
      width:  'menu-button/chevron-size',
      height: 'menu-button/chevron-size'
    }
  },

  /* Comp-size variable path for the Rounded=True pill variant. */
  radiusRoundedPath: 'menu-button/radius-rounded',

  /* Tell the generator to use the shared chevron icon set for chevronSlot
     instances (creates it if split-button hasn't run first). */
  usesChevron: true,

  masterContentColor: 'default/content/default',

  /* ── Families ───────────────────────────────────────────────
     Identical to BUTTON_BLUEPRINT — same T2 Neutral + T3 Brand
     families, same types, same state overrides. Menu-button is
     conceptually a button that always triggers a dropdown.
     ─────────────────────────────────────────────────────────── */
  families: {
    'Neutral': {
      types:  ['Filled', 'Outlined', 'Ghost', 'Fill & Outline'],
      states: ['Default', 'Hover', 'Pressed', 'Selected', 'Focus', 'Disabled'],
      stateOverrides: {
        'Filled': {
          'Default':  { fill: 'default/component/bg-default' },
          'Hover':    { fill: 'default/component/bg-hover' },
          'Pressed':  { fill: 'default/component/bg-pressed' },
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'component/bg-pressed' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Focus':    { fill: 'default/component/bg-default', focusRing: true },
          'Disabled': { fill: 'default/component/bg-default', componentOpacity: 0.3 }
        },
        'Outlined': {
          'Default':  { stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Hover':    { fill: 'default/component/bg-hover',   stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Pressed':  { fill: 'default/component/bg-pressed', stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Focus':    { stroke: 'default/component/outline-default', strokeWeight: 1, focusRing: true },
          'Disabled': { stroke: 'default/component/outline-default', strokeWeight: 1, componentOpacity: 0.3 }
        },
        'Ghost': {
          'Default':  { text: 'default/content/default', icon: 'default/content/default' },
          'Hover':    { fill: 'default/component/bg-hover',   fillFallback: { r: 0.91, g: 0.91, b: 0.91 },
                        text: 'default/content/default', icon: 'default/content/default' },
          'Pressed':  { fill: 'default/component/bg-pressed', fillFallback: { r: 0.85, g: 0.85, b: 0.85 },
                        text: 'default/content/default', icon: 'default/content/default' },
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Focus':    { t3Mode: 'brand', focusRing: true,
                        text: 'default/content/default', icon: 'default/content/default' },
          'Disabled': { componentOpacity: 0.3, text: 'default/content/default', icon: 'default/content/default' }
        },
        'Fill & Outline': {
          'Default':  { fill: 'default/component/bg-default', stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Hover':    { fill: 'default/component/bg-hover',   stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Pressed':  { fill: 'default/component/bg-pressed', stroke: 'default/component/outline-default', strokeWeight: 1 },
          'Selected': { t3Mode: 'brand',
                        fill: { t3: 'component/bg-pressed' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Focus':    { fill: 'default/component/bg-default', stroke: 'default/component/outline-default', strokeWeight: 1, focusRing: true },
          'Disabled': { fill: 'default/component/bg-default', stroke: 'default/component/outline-default', strokeWeight: 1, componentOpacity: 0.3 }
        }
      }
    },

    'Brand': {
      types:  ['Brand Filled', 'Brand Outlined', 'Brand Tonal', 'Ghost'],
      states: ['Default', 'Hover', 'Pressed', 'Selected', 'Focus', 'Disabled'],
      t3Mode: 'brand',
      stateOverrides: {
        'Brand Filled': {
          'Default':  { fill: { t3: 'component/bg-default' },
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Hover':    { fill: { t3: 'component/bg-hover' },
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Pressed':  { fill: { t3: 'component/bg-pressed' },
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Selected': { fill: { t3: 'component/bg-pressed' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Focus':    { fill: { t3: 'component/bg-default' }, focusRing: true,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } },
          'Disabled': { fill: { t3: 'component/bg-default' }, componentOpacity: 0.3,
                        text: { t3: 'oncomponent-content/default' }, icon: { t3: 'oncomponent-content/default' } }
        },
        'Brand Outlined': {
          'Default':  { stroke: { t3: 'component/outline-default' }, strokeWeight: 1,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Hover':    { fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-hover' }, strokeWeight: 1,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Pressed':  { fill: { t3: 'container/hover' }, stroke: { t3: 'component/outline-pressed' }, strokeWeight: 1,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Selected': { fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Focus':    { stroke: { t3: 'component/outline-default' }, strokeWeight: 1, focusRing: true,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Disabled': { stroke: { t3: 'component/outline-default' }, strokeWeight: 1, componentOpacity: 0.3,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } }
        },
        'Brand Tonal': {
          'Default':  { fill: { t3: 'container/bg' },
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Hover':    { fill: { t3: 'container/hover' },
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Pressed':  { fill: { t3: 'container/pressed' },
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Selected': { fill: { t3: 'container/hover' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Focus':    { fill: { t3: 'container/bg' }, focusRing: true,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } },
          'Disabled': { fill: { t3: 'container/bg' }, componentOpacity: 0.3,
                        text: { t3: 'oncontainer-content/default' }, icon: { t3: 'oncontainer-content/default' } }
        },
        'Ghost': {
          'Default':  { text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Hover':    { fill: { t3: 'container/bg' },
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Pressed':  { fill: { t3: 'container/hover' },
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Selected': { fill: { t3: 'container/bg' }, stroke: { t3: 'component/outline-default' }, strokeWeight: 2,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Focus':    { focusRing: true,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } },
          'Disabled': { componentOpacity: 0.3,
                        text: { t3: 'content/default' }, icon: { t3: 'content/default' } }
        }
      }
    }
  }
};

/* ── Component Generator Engine (Two-Tier Architecture) ──── */

/* Resolve a color spec to a Figma variable.
   String = T2 Surface Context path.
   { t3: path } = T3 Status Context path. */
function resolveColorSpec(spec, t2Map, t3Map) {
  if (!spec) return null;
  if (typeof spec === 'string') return t2Map[spec] || null;
  if (spec.t3) return t3Map[spec.t3] || null;
  return null;
}

/* Strip wrapper-only props from a spec entry, leaving only zone-applicable
   keys (fill / stroke / strokeWeight / text / icon). */
function zoneSlice(spec) {
  if (!spec) return {};
  var out = {};
  if (spec.fill         !== undefined) out.fill         = spec.fill;
  if (spec.stroke       !== undefined) out.stroke       = spec.stroke;
  if (spec.strokeWeight !== undefined) out.strokeWeight = spec.strokeWeight;
  if (spec.text         !== undefined) out.text         = spec.text;
  if (spec.icon         !== undefined) out.icon         = spec.icon;
  return out;
}

/* Expand a type's semantic state specs (rest/hover/pressed/selected/focus/disabled)
   into the 8-state per-zone override matrix used by the variant loop.
   Result shape: { [type]: { [stateName]: { action, trigger, wrapper } } }. */
function expandTypeSpecsToZoneOverrides(typeSpecs, stateNames) {
  var result = {};
  var typeNames = Object.keys(typeSpecs);
  for (var ti = 0; ti < typeNames.length; ti++) {
    var typeName = typeNames[ti];
    var spec = typeSpecs[typeName];
    var rest     = zoneSlice(spec.rest);
    var hover    = zoneSlice(spec.hover);
    var pressed  = zoneSlice(spec.pressed);
    var selected = zoneSlice(spec.selected);
    var focus    = zoneSlice(spec.focus);
    var disabled = zoneSlice(spec.disabled);
    /* wrapperBase = type-default wrapper props (e.g. Outlined always
       has a stroke on the wrapper regardless of state). */
    var wrapBase = spec.wrapperBase || null;
    function wrap(stateSpec) {
      var w = {};
      if (wrapBase) {
        if (wrapBase.stroke       !== undefined) w.stroke       = wrapBase.stroke;
        if (wrapBase.strokeWeight !== undefined) w.strokeWeight = wrapBase.strokeWeight;
      }
      if (stateSpec && stateSpec.wrapper) {
        var sw = stateSpec.wrapper;
        if (sw.stroke           !== undefined) w.stroke           = sw.stroke;
        if (sw.strokeWeight     !== undefined) w.strokeWeight     = sw.strokeWeight;
        if (sw.componentOpacity !== undefined) w.componentOpacity = sw.componentOpacity;
        if (sw.fill             !== undefined) w.fill             = sw.fill;
        if (sw.focusRing        !== undefined) w.focusRing        = sw.focusRing;
      }
      return w;
    }
    result[typeName] = {
      'Default':         { action: rest,     trigger: rest,     wrapper: wrap(null) },
      'Action Hover':    { action: hover,    trigger: rest,     wrapper: wrap(null) },
      'Action Pressed':  { action: pressed,  trigger: rest,     wrapper: wrap(null) },
      'Trigger Hover':   { action: rest,     trigger: hover,    wrapper: wrap(null) },
      'Trigger Pressed': { action: rest,     trigger: pressed,  wrapper: wrap(null) },
      'Selected':        { action: selected, trigger: selected, wrapper: wrap(spec.selected),
                           t3Mode: spec.selected && spec.selected.t3Mode },
      'Focus':           { action: rest,     trigger: rest,     wrapper: wrap(spec.focus) },
      'Disabled':        { action: rest,     trigger: rest,     wrapper: wrap(spec.disabled) }
    };
  }
  /* Filter out states that have nothing to render (defensive — should not
     happen given the matrix above always sets something). */
  for (var tn in result) {
    if (!result.hasOwnProperty(tn)) continue;
    var stateMap = result[tn];
    for (var sn in stateMap) {
      if (!stateMap.hasOwnProperty(sn)) continue;
      var st = stateMap[sn];
      if (!st.action && !st.trigger && !st.wrapper) delete stateMap[sn];
    }
  }
  return result;
}

async function generateComponentFromBlueprint(blueprint) {
  var stats = { components: 0, bindings: 0, reactions: 0, errors: [] };
  /* Reset per-build bound-id collector. setPaintBoundToVariable,
     tryBindVar, and tryBindStroke push into this; Step 9 hashes
     it to produce a precise tokensHash for this component only.
     Names collector (V3) feeds boundNames{} into the ledger so the
     Builder pill can render "X, Y, Z were removed" when bindings
     break (deleted variables lose their name in Figma). */
  _boundIdsForBuild = {};
  _boundNamesForBuild = {};
  var BP = blueprint;

  /* M4 — read the safe-rebuild feature flag. When ON, the plugin tries
     to preserve the COMPONENT_SET node id (and therefore its library
     `key`) across rebuilds by appending new variants into the existing
     set instead of delete+create. Default OFF for back-compat.
     See docs/architecture/component-builder/
     component-ledger-and-safe-rebuild.md §10/M4. */
  /* Safe rebuild is the safe default (was opt-in via flag). The legacy
     delete+recreate path is still reachable for diagnostic use by
     explicitly setting `dtf-safe-rebuild` = '0'. */
  var SAFE_REBUILD = true;
  try {
    var _srRaw = figma.root.getPluginData('dtf-safe-rebuild');
    if (_srRaw === '0') SAFE_REBUILD = false;
    /* '', '1' or unset all mean ON — the new default. */
  } catch (e) { /* ignore */ }
  log('Gen mode: ' + (SAFE_REBUILD ? 'SAFE_REBUILD (preserve set ids)' : 'legacy (full recreate)'));

  /* ── Step 1: Font loading deferred — see Step 2b below ─── */
  var fontName = null;
  var fontNameBold = null;

  /* ── Step 2: Build variable lookup maps ────────────────── */
  log('Gen: loading variable lookups…');
  figma.ui.postMessage({ type: 'gen-progress', text: 'Loading variables…' });

  var compSizeVars = await buildCollectionVarMap('comp size');
  var t2Vars = await buildCollectionVarMap('T2 Surface Context Tokens');
  var t3Vars = await buildCollectionVarMap('T3 Status Context Tokens');
  /* T1 is needed for T3 alias repair — loaded once, used in the repair block */
  var _t1VarsForRepair = await buildCollectionVarMap('T1 Color Tokens');

  /* ── Step 2c: Focus Ring color helper ───────────────────────────────
     Focus ring is applied as two DROP_SHADOW effects directly on the
     button master INSTANCE inside each Focus variant — no separate ring
     frame component is created or inserted.

     Why instance (not a ring frame overlay):
       • The instance already has the correct cornerRadius bound to the
         button’s own radius variable — shadow shape matches exactly.
       • No layoutPositioning / FILL-sizing / insertChild ordering issues.
       • No orphaned master components cluttering the canvas.

     Effect stack (same as CSS outline-offset:4px; outline:2px solid):
       effects[0]  white  spread=4  → 4px white gap  (on top)
       effects[1]  brand  spread=6  → 2px brand ring (behind)            */
  var _frColorVar = (_t1VarsForRepair && _t1VarsForRepair['focus/ring-color']) || null;

  /* Focus ring gap, stroke-width, and corner-radius from comp-size variables (no hardcoded 4/2/10). */
  var _frgapVar    = (compSizeVars && compSizeVars['button/focus-ring-gap'])    || null;
  var _frwidthVar  = (compSizeVars && compSizeVars['button/focus-ring-width'])  || null;
  var _frradiusVar = (compSizeVars && compSizeVars['button/focus-ring-radius']) || null;
  /* Per-density ring frame height (= button-height + 2*gap). Bound to the
     ABSOLUTE overlay ring frame so the vertical gap adapts per density. */
  var _frHeightVar = (compSizeVars && compSizeVars['button/focus-ring-height']) || null;
  var _frgap   = 4; /* fallback = CSS --focus-outline-offset */
  var _frwidth = 2; /* fallback = CSS --focus-outline-width  */
  if (_frgapVar && _frgapVar.valuesByMode) {
    var _frgM = Object.keys(_frgapVar.valuesByMode)[0];
    if (_frgM && typeof _frgapVar.valuesByMode[_frgM] === 'number') _frgap = _frgapVar.valuesByMode[_frgM];
  }
  if (_frwidthVar && _frwidthVar.valuesByMode) {
    var _frwM = Object.keys(_frwidthVar.valuesByMode)[0];
    if (_frwM && typeof _frwidthVar.valuesByMode[_frwM] === 'number') _frwidth = _frwidthVar.valuesByMode[_frwM];
  }

  /* Reads the first-mode hex of a T1 variable; returns fallback on alias/error. */
  function _frReadColor(variable, fallback) {
    if (!variable) return fallback;
    try {
      var _modes = Object.keys(variable.valuesByMode || {});
      if (_modes.length) {
        var _v = variable.valuesByMode[_modes[0]];
        if (_v && typeof _v.r === 'number') return { r: _v.r, g: _v.g, b: _v.b, a: 1 };
      }
    } catch (e) {}
    return fallback;
  }

  /* Cleanup: remove orphaned mc / Focus Ring / * master components and
     their containing sections from previous generator runs that used
     the ring-frame overlay approach (now abandoned). */
  (function _cleanupOldRingMasters() {
    try {
      var _oldFR = figma.currentPage.findAll(function(n) {
        return n.type === 'COMPONENT' && n.name.indexOf('mc / Focus Ring /') === 0;
      });
      for (var _oi = 0; _oi < _oldFR.length; _oi++) {
        try { _oldFR[_oi].remove(); } catch(e) {}
      }
      var _oldSec = figma.currentPage.findAll(function(n) {
        return n.type === 'SECTION' &&
               (n.name === 'Masters / Focus Ring' || n.name === 'Focus Ring');
      });
      for (var _si = 0; _si < _oldSec.length; _si++) {
        try { _oldSec[_si].remove(); } catch(e) {}
      }
    } catch(e) { log('Focus Ring cleanup failed: ' + e.message); }
  })();
  /* Masters are created lazily on first Focus variant — see focusRing handlers below. */



  /* ── Step 2a: Normalize legacy T2 variable names ────────────
     Older project files have T2 vars named `default/component/bg` and
     `default/component/outline` (no -default suffix). The blueprint's
     state-Default overrides reference `…-default` to be symmetric with
     `-hover`/`-pressed`. Rename in-place (preserves variable IDs and all
     bindings) so legacy files self-heal on every plugin run. */
  var t2Aliases = [
    { from: 'default/component/bg',      to: 'default/component/bg-default' },
    { from: 'default/component/outline', to: 'default/component/outline-default' }
  ];
  for (var ai2 = 0; ai2 < t2Aliases.length; ai2++) {
    var fromName = t2Aliases[ai2].from;
    var toName = t2Aliases[ai2].to;
    if (t2Vars[fromName] && !t2Vars[toName]) {
      try {
        t2Vars[fromName].name = toName;
        t2Vars[toName] = t2Vars[fromName];
        delete t2Vars[fromName];
        log('Renamed T2 var: ' + fromName + ' → ' + toName);
        stats.bindings++;
      } catch (rne) {
        log('Failed to rename T2 var ' + fromName + ': ' + rne.message);
      }
    }
  }


  /* ── Step 2b: Normalize legacy T3 variable names ────────────────────────
     Older project files have T3 vars named `component/bg` and
     `component/outline` (no -default suffix). Rename in-place so that
     { t3: 'component/bg-default' } and T3 alias repair both work. */
  var t3Aliases = [
    { from: 'component/bg',      to: 'component/bg-default' },
    { from: 'component/outline', to: 'component/outline-default' }
  ];
  for (var ai3 = 0; ai3 < t3Aliases.length; ai3++) {
    var t3from = t3Aliases[ai3].from;
    var t3to   = t3Aliases[ai3].to;
    if (t3Vars[t3from] && !t3Vars[t3to]) {
      try {
        t3Vars[t3from].name = t3to;
        t3Vars[t3to] = t3Vars[t3from];
        delete t3Vars[t3from];
        log('Renamed T3 var: ' + t3from + ' \u2192 ' + t3to);
        stats.bindings++;
      } catch (rne3) {
        log('Failed to rename T3 var ' + t3from + ': ' + rne3.message);
      }
    }
  }

  var csCount = Object.keys(compSizeVars).length;
  var t2Count = Object.keys(t2Vars).length;
  var t3Count = Object.keys(t3Vars).length;
  log('Variables: ' + csCount + ' comp-size, ' + t2Count + ' T2, ' + t3Count + ' T3');

  /* T3 guard — Brand/semantic families need T3 for icon/text color bindings.
     If T3 is absent (user hasn't run Update Variables), emit a clear error
     immediately so the user knows why Brand icons will be incorrectly colored. */
  if (t3Count === 0) {
    var _t3Needed = false;
    var _t3FamKeys = Object.keys(BP.families || {});
    for (var _t3fi = 0; _t3fi < _t3FamKeys.length; _t3fi++) {
      if (BP.families[_t3FamKeys[_t3fi]].t3Mode) { _t3Needed = true; break; }
    }
    if (_t3Needed) {
      stats.errors.push(
        'T3 Status Context Tokens collection not found — Brand/semantic icon & text colors were not bound. ' +
        'Run \u201cSync \u2192 Update Variables\u201d first, then rebuild to fix icon colors.'
      );
    }
  }

  /* ── Step 2b: Create/find Typography variable collection ─── */
  figma.ui.postMessage({ type: 'gen-progress', text: 'Setting up typography variables…' });
  var typoVars = {};
  var typoCol = null;
  var typoColName = 'Typography';
  var allColsTypo = await figma.variables.getLocalVariableCollectionsAsync();
  for (var tci = 0; tci < allColsTypo.length; tci++) {
    if (allColsTypo[tci].name === typoColName || allColsTypo[tci].name === 'DTF Typography') {
      typoCol = allColsTypo[tci];
      if (typoCol.name !== typoColName) {
        typoCol.name = typoColName;
        log('Renamed collection DTF Typography → Typography');
      }
      break;
    }
  }
  if (!typoCol) {
    typoCol = figma.variables.createVariableCollection(typoColName);
    log('Created typography collection: ' + typoColName);
  }
  var typoModeId = typoCol.modes[0].modeId;

  /* Read the project's configured font family from primitives-numbers/font/family-headline
     (set by Update Variables from the project's typographyConfig). Falls back to
     system defaults if Update Variables hasn't been run yet. */
  var configuredFamilyHeadline = 'Inter';
  var configuredFamilyBody = 'Inter';
  var configuredFamilyCode = 'SF Mono';
  try {
    var primNumsMap = await buildCollectionVarMap('primitives-numbers');
    function readFamilyFromVar(varName, fallback) {
      var v = primNumsMap[varName];
      if (!v) return fallback;
      var keys = Object.keys(v.valuesByMode);
      if (keys.length === 0) return fallback;
      var val = v.valuesByMode[keys[0]];
      return (typeof val === 'string' && val && !val.startsWith('var(')) ? val : fallback;
    }
    configuredFamilyHeadline = readFamilyFromVar('font/family-headline', configuredFamilyHeadline);
    configuredFamilyBody     = readFamilyFromVar('font/family-body',     configuredFamilyBody);
    configuredFamilyCode     = readFamilyFromVar('font/family-code',     configuredFamilyCode);
  } catch (e) { /* keep defaults */ }
  log('Typography: headline=' + configuredFamilyHeadline + ', body=' + configuredFamilyBody + ', code=' + configuredFamilyCode);

  /* Define typography tokens: font sizes and font weights */
  var TYPO_DEFS = [
    /* Font sizes (FLOAT) */
    { name: 'font-size/xs',   type: 'FLOAT', value: 10 },
    { name: 'font-size/sm',   type: 'FLOAT', value: 11 },
    { name: 'font-size/base', type: 'FLOAT', value: 14 },
    { name: 'font-size/md',   type: 'FLOAT', value: 16 },
    { name: 'font-size/lg',   type: 'FLOAT', value: 20 },
    { name: 'font-size/xl',   type: 'FLOAT', value: 24 },
    { name: 'font-size/2xl',  type: 'FLOAT', value: 32 },
    /* Line heights (FLOAT — px values) */
    { name: 'line-height/tight',  type: 'FLOAT', value: 16 },
    { name: 'line-height/base',   type: 'FLOAT', value: 20 },
    { name: 'line-height/relaxed', type: 'FLOAT', value: 24 },
    { name: 'line-height/loose',  type: 'FLOAT', value: 32 },
    /* Letter spacing (FLOAT — px) */
    { name: 'letter-spacing/tight',  type: 'FLOAT', value: -0.2 },
    { name: 'letter-spacing/normal', type: 'FLOAT', value: 0 },
    { name: 'letter-spacing/wide',   type: 'FLOAT', value: 0.5 },
    /* Font families (STRING) — three roles, sourced from primitives-numbers.
       Matches the Typography Scale collection: heading types → headline font,
       body/label/caption types → body font, code types → code font. */
    { name: 'font-family/headline', type: 'STRING', value: configuredFamilyHeadline },
    { name: 'font-family/body',     type: 'STRING', value: configuredFamilyBody },
    { name: 'font-family/code',     type: 'STRING', value: configuredFamilyCode },
    /* Font style (STRING) — for binding to text nodes */
    { name: 'font-style/default', type: 'STRING', value: 'Regular' },
    { name: 'font-style/bold', type: 'STRING', value: 'Bold' }
  ];

  /* Load existing vars in the collection */
  for (var tvl = 0; tvl < typoCol.variableIds.length; tvl++) {
    var tvVar = await figma.variables.getVariableByIdAsync(typoCol.variableIds[tvl]);
    if (tvVar) typoVars[tvVar.name] = tvVar;
  }

  /* Self-heal: rename legacy font-family/primary → font-family/body in-place.
     This preserves the variable ID so any existing component text bindings
     (which reference the variable by ID) survive the rename. */
  if (typoVars['font-family/primary'] && !typoVars['font-family/body']) {
    try {
      typoVars['font-family/primary'].name = 'font-family/body';
      typoVars['font-family/body'] = typoVars['font-family/primary'];
      delete typoVars['font-family/primary'];
      log('Renamed Typography/font-family/primary → font-family/body (ID preserved)');
    } catch (rne) { log('Rename font-family/primary failed: ' + rne.message); }
  }

  /* Create missing, update existing */
  for (var tdi = 0; tdi < TYPO_DEFS.length; tdi++) {
    var td = TYPO_DEFS[tdi];
    if (typoVars[td.name]) {
      /* Update in place — preserve ID */
      try { typoVars[td.name].setValueForMode(typoModeId, td.value); } catch (e) {}
    } else {
      try {
        var tv = figma.variables.createVariable(td.name, typoCol, td.type);
        tv.setValueForMode(typoModeId, td.value);
        typoVars[td.name] = tv;
      } catch (tve) {
        log('Failed to create typo var ' + td.name + ': ' + tve.message);
      }
    }
  }
  log('Typography vars: ' + Object.keys(typoVars).length + ' in ' + typoColName);

  /* ── Step 1 (deferred): Load font from typography variable ── */
  var primaryFamily = configuredFamilyBody || 'Inter'; /* used for component text nodes */
  var defaultStyle = 'Regular';
  var boldStyle = 'Bold';
  if (typoVars['font-style/default']) {
    try {
      var styVal = typoVars['font-style/default'].valuesByMode;
      var styKeys = Object.keys(styVal);
      if (styKeys.length > 0 && typeof styVal[styKeys[0]] === 'string') {
        defaultStyle = styVal[styKeys[0]];
      }
    } catch (e) { /* keep default */ }
  }
  if (typoVars['font-style/bold']) {
    try {
      var boldVal = typoVars['font-style/bold'].valuesByMode;
      var boldKeys = Object.keys(boldVal);
      if (boldKeys.length > 0 && typeof boldVal[boldKeys[0]] === 'string') {
        boldStyle = boldVal[boldKeys[0]];
      }
    } catch (e) { /* keep default */ }
  }
  log('Typography: family=' + primaryFamily + ', style=' + defaultStyle + '/' + boldStyle);

  fontName = { family: primaryFamily, style: defaultStyle };
  fontNameBold = { family: primaryFamily, style: boldStyle };
  try {
    await figma.loadFontAsync(fontName);
  } catch (e) {
    log('Font load failed for ' + primaryFamily + ' ' + defaultStyle + ', trying Inter');
    try {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      fontName = { family: 'Inter', style: 'Regular' };
      fontNameBold = { family: 'Inter', style: 'Regular' };
    } catch (e2) {
      stats.errors.push('Cannot load font: ' + primaryFamily + ' or Inter');
      return stats;
    }
  }
  try {
    await figma.loadFontAsync(fontNameBold);
  } catch (e) {
    fontNameBold = fontName;
  }

  if (t2Count === 0) {
    stats.errors.push('No T2 Surface Context Tokens found — run token sync first');
    return stats;
  }
  if (csCount === 0) {
    stats.errors.push('No comp size variables found — run token sync first');
    return stats;
  }

  /* ── Step 2b: Alias comp-size variable names ───────────────
     Different files use different naming conventions:
       Writer Handhelds: button/height          (2 segments)
       PDF Editor:       button/default/height  (3 segments)
     Create aliases so the blueprint works in either file.       */
  var csKeys = Object.keys(compSizeVars);
  for (var cki = 0; cki < csKeys.length; cki++) {
    var csName = csKeys[cki];
    var csParts = csName.split('/');
    if (csParts.length === 2) {
      /* button/height → also register as button/default/height */
      var aliasLong = csParts[0] + '/default/' + csParts[1];
      if (!compSizeVars[aliasLong]) compSizeVars[aliasLong] = compSizeVars[csName];
    } else if (csParts.length === 3) {
      /* button/default/height → also register as button/height */
      var aliasShort = csParts[0] + '/' + csParts[2];
      if (!compSizeVars[aliasShort]) compSizeVars[aliasShort] = compSizeVars[csName];
    }
  }

  /* ── Step 2c: Create missing comp-size variables ───────────
     Some files may not have all the variables the blueprint needs.
     Create them in the comp size collection with sensible defaults.
     NOTE: list is module-level (REQUIRED_COMPSIZE_VARS) so prereq
     auto-heal can also create missing entries without waiting for
     a full Build. */
  var requiredVars = REQUIRED_COMPSIZE_VARS;

  var allCols = await figma.variables.getLocalVariableCollectionsAsync();
  var csCol = allCols.find(function(c) { return c.name === 'comp size'; });

  if (csCol) {
    var csModeId = csCol.modes[0].modeId;
    /* All mode IDs in the comp-size collection. Plugin-created variables
       MUST set a value for every mode — Figma's setValueForMode only
       writes one mode at a time, and any unset mode defaults to type-zero
       (0 for FLOAT). Without this loop, `button/radius-rounded` (9999)
       only resolved to the pill value in the first comp-size mode (base);
       in tiny/small/medium/large/etc the rounded variants resolved to 0
       — visibly square pills at non-base sizes. */
    var csAllModeIds = csCol.modes.map(function(m) { return m.modeId; });

    /* Build a primitives-numbers lookup once so string modeVals entries can be
       written as VARIABLE_ALIAS refs (e.g. 'spacing/8' → alias to primitives-numbers/spacing/8)
       rather than literal numbers.  Falls back to numeric if the variable isn't found. */
    var _csReqPrimMap = {};
    try { _csReqPrimMap = await buildCollectionVarMap('primitives-numbers'); } catch (_pme) {}

    /* Helper: resolve a single modeVals entry (number = literal, string = alias path). */
    function _resolveReqModeVal(modeVal, fallbackNum) {
      if (typeof modeVal === 'number') return modeVal;
      if (typeof modeVal === 'string') {
        var _pv = _csReqPrimMap[modeVal];
        if (_pv) return { type: 'VARIABLE_ALIAS', id: _pv.id };
        /* Alias not found — extract numeric suffix as literal fallback (e.g. 'spacing/8' → 8) */
        var _nSuffix = parseFloat(modeVal.split('/').pop());
        return isNaN(_nSuffix) ? fallbackNum : _nSuffix;
      }
      return fallbackNum;
    }

    /* Helper: are two setValueForMode values equivalent? Avoids unnecessary writes. */
    function _reqValEq(a, b) {
      if (a === b) return true;
      if (a && b && typeof a === 'object' && typeof b === 'object') return a.id === b.id;
      return false;
    }
    for (var rvi = 0; rvi < requiredVars.length; rvi++) {
      var reqName    = requiredVars[rvi].name;
      var reqVal     = requiredVars[rvi].defaultVal;
      var createOnly = !!requiredVars[rvi].createOnly; /* if true: create only, never overwrite */
      /* Build both 2-segment and 3-segment forms of the name so
         blueprint lookups using either convention find the variable.
         For 'button/*' vars the 3-segment form inserts '/default/'.
         For other groups (e.g. 'icon-button/*') we do the same. */
      var reqParts = reqName.split('/');
      var longName = reqParts.length === 2
        ? reqParts[0] + '/default/' + reqParts[1]
        : reqName;                                   /* already 3-segment or more */
      var existing = compSizeVars[reqName] || compSizeVars[longName];
      if (existing) {
        /* createOnly entries must never overwrite: the sync server already
           wrote per-density values. Just ensure both name forms are in the map. */
        if (createOnly) {
          if (!compSizeVars[reqName])  compSizeVars[reqName]  = existing;
          if (!compSizeVars[longName]) compSizeVars[longName] = existing;
          continue;
        }
        /* Ensure both short and long forms are in the map so the master
           creation loop can find the variable regardless of which form
           it uses in sizeBindings / iconBtnSizeBindings. */
        if (!compSizeVars[reqName])  compSizeVars[reqName]  = existing;
        if (!compSizeVars[longName]) compSizeVars[longName] = existing;
        /* Variable already exists — enforce canonical value ONLY for modes
           where the current value is a plain literal that differs from the
           default. If a mode's value is a VARIABLE_ALIAS (i.e. the sync
           server already bound it to a primitives-numbers token), DO NOT
           touch it. Otherwise we'd clobber the proper per-mode aliases
           with our literal fallback. Also fill in any mode that has no
           value yet (undefined → would resolve to 0). */
        var _rModeVals = requiredVars[rvi].modeVals || null;
        for (var emi = 0; emi < csAllModeIds.length; emi++) {
          var emModeId = csAllModeIds[emi];
          /* Resolve per-mode target: use modeVals map when present, else flat defaultVal. */
          var _emModeName = _rModeVals && csCol.modes[emi] ? csCol.modes[emi].name.toLowerCase() : null;
          var _emRawVal   = (_rModeVals && _emModeName && _rModeVals[_emModeName] !== undefined)
            ? _rModeVals[_emModeName] : reqVal;
          var _emTargetVal = _resolveReqModeVal(_emRawVal, reqVal);
          try {
            var curVal = existing.valuesByMode && existing.valuesByMode[emModeId];
            if (_reqValEq(curVal, _emTargetVal)) continue; /* already correct */
            existing.setValueForMode(emModeId, _emTargetVal);
            log('Updated ' + reqName + ' [mode ' + emi + ']: → ' +
              (typeof _emTargetVal === 'object' ? 'alias(' + _emTargetVal.id + ')' : _emTargetVal));
            stats.bindings++;
          } catch (uve) {
            log('Failed to update variable ' + reqName + ' (mode ' + emi + '): ' + uve.message);
          }
        }
      } else {
        try {
          var newVar = figma.variables.createVariable(reqName, csCol, 'FLOAT');
          /* Set value for EVERY mode so the variable resolves correctly
             across the entire comp-size scale. Without this, any mode
             beyond modes[0] silently resolves to 0.
             Use per-mode modeVals map when present (strings → VARIABLE_ALIAS). */
          var _nvModeVals = requiredVars[rvi].modeVals || null;
          for (var nmi = 0; nmi < csAllModeIds.length; nmi++) {
            var _nvModeName = _nvModeVals && csCol.modes[nmi] ? csCol.modes[nmi].name.toLowerCase() : null;
            var _nvRawVal   = (_nvModeVals && _nvModeName && _nvModeVals[_nvModeName] !== undefined)
              ? _nvModeVals[_nvModeName] : reqVal;
            var _nvVal = _resolveReqModeVal(_nvRawVal, reqVal);
            try { newVar.setValueForMode(csAllModeIds[nmi], _nvVal); } catch (e) {}
          }
          compSizeVars[reqName] = newVar;
          /* Also create 2-segment ↔ 3-segment alias so blueprint lookups
             using either form (e.g. 'icon-button/size' or
             'icon-button/default/size') resolve to the same variable. */
          compSizeVars[longName] = newVar;
          log('Created missing variable: ' + reqName + ' = ' + reqVal + ' (across ' + csAllModeIds.length + ' modes)');
          stats.bindings++;
        } catch (cve) {
          log('Failed to create variable ' + reqName + ': ' + cve.message);
        }
      }
    }
  }

  log('Comp-size vars after aliasing: ' + Object.keys(compSizeVars).length);

  /* ── Step 3: Find or create the target page for this blueprint ──────────── */
  var _targetPageName = BP.targetPage || 'Components';
  var page = null;
  for (var pi = 0; pi < figma.root.children.length; pi++) {
    if (figma.root.children[pi].name === _targetPageName) {
      page = figma.root.children[pi];
      break;
    }
  }
  if (!page) {
    page = figma.createPage();
    page.name = _targetPageName;
  }
  await figma.setCurrentPageAsync(page);

  /* ── Step 3b: Migrate owned nodes from other pages → target page ──────
     When BP.targetPage changes (e.g. file had old 'Components' page),
     sections/sets owned by this blueprint that are on a DIFFERENT page are
     moved here BEFORE priorSnapshot is built, so SAFE_REBUILD finds and
     reuses them (preserving their Figma library key). Moving a node to a
     new parent in Figma preserves its internal ID and key. */
  try {
    await figma.loadAllPagesAsync();
    for (var _mpi = 0; _mpi < figma.root.children.length; _mpi++) {
      var _mp = figma.root.children[_mpi];
      if (_mp.id === page.id) continue; /* skip the target page itself */
      var _mpCandidates = [];
      try {
        /* Find ALL nodes on this page owned by the current blueprint,
         and (when BP.usesIconPrimitives) also shared DTF-PRIMITIVES. */
        _mpCandidates = _mp.findAll(function(n) {
          try {
            var _owner = n.getPluginData && n.getPluginData('dtf-owner');
            return _owner === BP.name ||
                   (BP.usesIconPrimitives && _owner === 'DTF-PRIMITIVES');
          } catch(e) { return false; }
        });
      } catch(_mfe) {}
      /* Only move DIRECT children of the page — child nodes travel with
         their parent automatically. Avoids double-moving nested sets. */
      for (var _mni = 0; _mni < _mpCandidates.length; _mni++) {
        var _mn = _mpCandidates[_mni];
        if (_mn && !_mn.removed && _mn.parent && _mn.parent.id === _mp.id) {
          try {
            page.appendChild(_mn);
            log('Migrated "' + _mn.name + '" from page "' + _mp.name + '" \u2192 "' + page.name + '"');
          } catch(_mve) { log('Migrate failed for "' + (_mn.name || '?') + '": ' + _mve.message); }
        }
      }
    }
  } catch(_mpe) { log('Page migration pass failed: ' + _mpe.message); }

  /* ── Step 3c: Delete DTF-PRIMITIVES orphans on non-target pages ──────
     After migration, any DTF-PRIMITIVES direct children still on pages
     OTHER than the target page are duplicates (e.g. ones Toggle created
     before the cross-page lookup fix). Remove them so the canvas stays
     clean. Only runs for blueprints that own icon primitives. */
  if (BP.usesIconPrimitives) {
    try {
      for (var _dopi = 0; _dopi < figma.root.children.length; _dopi++) {
        var _dop = figma.root.children[_dopi];
        if (_dop.id === page.id) continue;
        var _dopOrphans = [];
        try {
          _dopOrphans = _dop.findAll(function(n) {
            try { return n.getPluginData && n.getPluginData('dtf-owner') === 'DTF-PRIMITIVES'; } catch(e) { return false; }
          });
        } catch(e) {}
        for (var _doni = 0; _doni < _dopOrphans.length; _doni++) {
          var _don = _dopOrphans[_doni];
          if (_don && !_don.removed && _don.parent && _don.parent.id === _dop.id) {
            try { _don.remove(); log('Removed DTF-PRIMITIVES orphan from "' + _dop.name + '": ' + _don.name); } catch(e) {}
          }
        }
      }
    } catch(_dope) { log('DTF-PRIMITIVES orphan cleanup failed: ' + _dope.message); }
  }

  /* W2 — stamp the Components page so renames don't create duplicates
     on next Build. See docs/architecture/component-builder/
     component-ledger-and-safe-rebuild.md §11.5. Write-only today;
     §10/M4 lookup chain will consume it. */
  try {
    if (page.setPluginData) {
      page.setPluginData('dtf-page', 'components');
      page.setPluginData('dtf-generated', '1');
    }
  } catch (e) { /* ignore */ }

  /* ── Owner stamp helpers ─────────────────────────────────
     Every node we create gets stamped with pluginData. Cleanup only
     removes nodes carrying our own stamp — protects user-built nodes
     that happen to share a name prefix with our blueprint (e.g. a
     hand-built "Button" component-set or a "Button Library" section). */
  function ownedByThisBP(node) {
    if (!node || !node.getPluginData) return false;
    var owner = node.getPluginData('dtf-owner');
    if (owner === BP.name) return true;
    /* Also match legacy owner names so renamed BPs clean up their old sets. */
    var legacyOwners = BP.legacyOwners || [];
    for (var _li = 0; _li < legacyOwners.length; _li++) {
      if (owner === legacyOwners[_li]) return true;
    }
    return false;
  }
  function stampOwner(node) {
    if (node && node.setPluginData) {
      node.setPluginData('dtf-owner', BP.name);
      node.setPluginData('dtf-generated', '1');
    }
  }
  /* Expose for the rest of generateComponentFromBlueprint */
  BP.__stampOwner = stampOwner;

  /* ── Step 4: Clean up existing ───────────────────────────
     IMPORTANT: only remove things specific to the CURRENT blueprint.
     For wrapper-with-button-instance kinds (split-button), do NOT touch
     button-owned items (masters, icon placeholder, button section) —
     they are dependencies. */
  var isWrapperKind = (BP.kind === 'wrapper-with-button-instance');
  /* Set of master names this BP will generate — used to identify
     section ownership for legacy unprefixed sections. */
  var ourMasterFullNames = {};
  var _ourMasterKeys = Object.keys(BP.masters || {});
  for (var _omk = 0; _omk < _ourMasterKeys.length; _omk++) {
    ourMasterFullNames['mc / ' + _ourMasterKeys[_omk]] = true;
  }
  /* Helper: does a section contain any of our masters? */
  function sectionOwnedByThisBP(node) {
    if (!node.findOne) return false;
    var hit = node.findOne(function(n) {
      return (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && ourMasterFullNames[n.name];
    });
    return !!hit;
  }

  /* W1 — snapshot the prior Build's identity surface BEFORE cleanup
     destroys it. Captured here, attached to stats, and emitted to the
     ledger at Step 9 so the timestamp UI / diff engine has a record of
     what was just invalidated. Read-only; behaviour-neutral.
     See docs/architecture/component-builder/
     component-ledger-and-safe-rebuild.md §11.5 (W1). */
  function snapshotComponentSet(cs) {
    var snap = {
      nodeId:     cs.id,
      name:       cs.name,
      libraryKey: (cs.key || null),
      variants:   {},   /* named coordinate → variant nodeId */
      properties: {}    /* prop name → { defId, type } */
    };
    try {
      var defs = cs.componentPropertyDefinitions || {};
      var defKeys = Object.keys(defs);
      for (var di = 0; di < defKeys.length; di++) {
        var dk = defKeys[di];
        var def = defs[dk] || {};
        /* Figma stores defId-with-suffix as the object key (e.g.
           "Size#1234:0"). The bare prop name is everything before '#'. */
        var bareName = dk.indexOf('#') >= 0 ? dk.slice(0, dk.indexOf('#')) : dk;
        snap.properties[bareName] = { defId: dk, type: def.type || 'UNKNOWN' };
      }
    } catch (pe) { /* ignore */ }
    try {
      var kids = cs.children || [];
      for (var vi = 0; vi < kids.length; vi++) {
        var v = kids[vi];
        if (v && v.type === 'COMPONENT') {
          /* Variant name is the named coordinate
             ("Type=primary, State=Default, Rounded=False"). */
          snap.variants[v.name] = v.id;
        }
      }
    } catch (ve) { /* ignore */ }
    return snap;
  }

  var priorSnapshot = {
    capturedAt: new Date().toISOString(),
    pageId:     page.id,
    pageName:   page.name,
    componentSets: []
  };
  try {
    /* W1 fix — walk the WHOLE page tree, not just top-level children.
       Component-sets are nested inside sections in every real DTF
       file ("Tier 2 — Variants" section wraps them), so a
       page.children-only pass missed every set. */
    var _allSets = [];
    try {
      _allSets = page.findAllWithCriteria({ types: ['COMPONENT_SET'] }) || [];
    } catch (_fwe) { /* fall back to shallow scan */
      for (var _psk = 0; _psk < page.children.length; _psk++) {
        if (page.children[_psk].type === 'COMPONENT_SET') _allSets.push(page.children[_psk]);
      }
    }
    for (var _psi = 0; _psi < _allSets.length; _psi++) {
      var _psc = _allSets[_psi];
      try {
        if (ownedByThisBP(_psc)) {
          priorSnapshot.componentSets.push(snapshotComponentSet(_psc));
        }
      } catch (_pscErr) { /* stale ref — skip */ }
    }
  } catch (pse) { /* ignore */ }

  /* M4 — resolve which prior COMPONENT_SETs are still alive so we can
     reuse them. Keyed by set name (which is also setDisplayName at
     rebuild time). Only populated when SAFE_REBUILD is on. Any failure
     during lookup downgrades that specific entry to "not reusable" —
     never blocks the build. */
  var reuseSetByName = {};
  if (SAFE_REBUILD) {
    for (var _rsi = 0; _rsi < priorSnapshot.componentSets.length; _rsi++) {
      var _rs = priorSnapshot.componentSets[_rsi];
      if (!_rs || !_rs.nodeId) continue;
      try {
        var _resolved = await figma.getNodeByIdAsync(_rs.nodeId);
        if (!_resolved || _resolved.removed) continue;
        if (_resolved.type !== 'COMPONENT_SET') continue;
        /* Owner check is wrapped because getPluginData can throw on
           rare proxy/orphan handles. */
        var _owns = false;
        try { _owns = ownedByThisBP(_resolved); } catch (_oe) { _owns = false; }
        if (!_owns) continue;
        reuseSetByName[_rs.name] = _resolved;
      } catch (rse) {
        log('SAFE_REBUILD lookup of ' + _rs.nodeId + ' failed: ' + rse.message);
      }
    }
    log('SAFE_REBUILD reusable sets: ' + Object.keys(reuseSetByName).length);
  }

  /* Build a secondary lookup keyed by dtf-set-id plugin data (stable
     master-level identity). This survives ANY setDisplayName / singleFamily /
     section-rename change — the semantic ID is stamped once and persists
     on the node even after renames. Falls back gracefully when sets have
     no stamp (first generate with new code simply adds the stamp). */
  var reuseSetBySemanticId = {};
  if (SAFE_REBUILD) {
    try {
      var _semSets = page.findAllWithCriteria({ types: ['COMPONENT_SET'] }) || [];
      for (var _ssi = 0; _ssi < _semSets.length; _ssi++) {
        try {
          var _sid = _semSets[_ssi].getPluginData('dtf-set-id');
          if (!_sid || _semSets[_ssi].removed) continue;
          var _semCurr = reuseSetBySemanticId[_sid];
          if (!_semCurr || _semCurr.removed) {
            reuseSetBySemanticId[_sid] = _semSets[_ssi];
          } else {
            /* Conflict: two sets share the same semId (common during singleFamily
               migration where old per-family sets and the new merged set all carry
               'dtf::BP::mName'). Prefer the set whose parent is a SECTION over a
               page-root orphan — section-contained = active/current;
               page-root = rescued-in-progress or leftover orphan.
               If both are sections or both are page-root, keep first (stable). */
            var _candInSection = (_semSets[_ssi].parent && _semSets[_ssi].parent.type === 'SECTION');
            var _currInSection = (_semCurr.parent && _semCurr.parent.type === 'SECTION');
            if (_candInSection && !_currInSection) {
              reuseSetBySemanticId[_sid] = _semSets[_ssi];
            }
          }
        } catch(e) {}
      }
      log('SAFE_REBUILD semantic IDs: ' + Object.keys(reuseSetBySemanticId).length);
    } catch(_siE) {}
  }

  /* W3 — emit a single warn line per Build summarising what's about
     to be invalidated. Free telemetry for the milestone-2 read path. */
  if (priorSnapshot.componentSets.length > 0) {
    try {
      var _invSets    = priorSnapshot.componentSets.length;
      var _invVars    = 0;
      var _invProps   = 0;
      var _invKeys    = 0;
      for (var _isi = 0; _isi < priorSnapshot.componentSets.length; _isi++) {
        var _is = priorSnapshot.componentSets[_isi];
        _invVars  += Object.keys(_is.variants).length;
        _invProps += Object.keys(_is.properties).length;
        if (_is.libraryKey) _invKeys++;
      }
      console.warn(
        '[DTF Build] About to invalidate identifiers for "' + BP.name + '":\n' +
        '  component-sets: ' + _invSets + '\n' +
        '  variant ids:    ' + _invVars + '\n' +
        '  property defs:  ' + _invProps + '\n' +
        '  library keys:   ' + _invKeys + ' (consumers will break)\n' +
        '  Prior snapshot kept in dtf-component-versions[' +
        BP.name.toLowerCase() + '].priorSnapshot.'
      );
    } catch (we) { /* ignore */ }
  }

  /* ── Capture prior column X BEFORE cleanup deletes our sections ──
     Sections owned by this BP are removed unconditionally below, so any
     PAGE_X scan that runs AFTER cleanup will never find them.
     Record the leftmost X of our existing sections now so we can
     rebuild the presentation column in-place instead of shifting right. */
  /* Exact names used by createSection() for this BP's presentation sections.
     Used as a name-based fallback to catch old sections that were built before
     stampOwner() was added to createSection() — those have no dtf-owner at all
     and would otherwise look like foreign content to the foreignMaxX scan. */
  var _bpSectionNames = [
    BP.name + ' \u2014 Overview',
    /* Current section names */
    'Masters / ' + BP.name,            /* non-unified masterSec */
    'Variants / ' + BP.name,           /* non-unified variantSec */
    '_' + BP.name + ' \u2014 Internal', /* unified masterSec (hidden) */
    BP.name,                            /* unified variantSec */
    /* Legacy names (pre-rename) — cleaned up on next generate */
    BP.name + ' \u2014 Tier 1 / Masters',
    BP.name + ' \u2014 Tier 2 / Variants'
  ];
  /* Also clean up any BP-declared legacy section names (e.g. old Tier 1/2 names
     that existed before the unified refactor). */
  var _legacySectionNames = BP.legacySectionNames || [];
  for (var _lsni = 0; _lsni < _legacySectionNames.length; _lsni++) {
    _bpSectionNames.push(_legacySectionNames[_lsni]);
  }
  /* Also catch sections built under legacy BP names (e.g. "Toggle —
     Overview" when BP.name is now "Switch"). These have no dtf-owner
     plugin data (pre-stampOwner builds) so plugin-data checks miss them;
     adding legacy names here lets the _namedAsBP fallback catch them. */
  var _legacyNames = BP.legacyOwners || [];
  for (var _lni = 0; _lni < _legacyNames.length; _lni++) {
    _bpSectionNames.push(_legacyNames[_lni] + ' \u2014 Overview');
    _bpSectionNames.push(_legacyNames[_lni] + ' \u2014 Tier 1 / Masters');
    _bpSectionNames.push(_legacyNames[_lni] + ' \u2014 Tier 2 / Variants');
  }
  var _priorColumnX = null;
  for (var _priorScan = 0; _priorScan < page.children.length; _priorScan++) {
    var _ps = page.children[_priorScan];
    if (!_ps) continue;
    if (_ps.type !== 'SECTION' && _ps.type !== 'FRAME') continue;
    var _psOwned = false;
    try { _psOwned = (_ps.getPluginData('dtf-owner') === BP.name); } catch(e) {}
    /* Name-based fallback: old sections (pre-stampOwner) carry the BP name
       in their section name but have no dtf-owner pluginData. */
    var _psNamedAsBP = (_bpSectionNames.indexOf(_ps.name) >= 0);
    if (_psOwned || _psNamedAsBP) {
      if (_priorColumnX === null || (_ps.x || 0) < _priorColumnX) _priorColumnX = (_ps.x || 0);
    }
  }
  if (_priorColumnX !== null) log('Pre-cleanup: captured prior column X = ' + _priorColumnX);

  for (var ci2 = page.children.length - 1; ci2 >= 0; ci2--) {
    var child = page.children[ci2];
    if (!child) continue;
    /* Whole-iteration guard. Any access on a stale handle (e.g. a
       descendant orphaned by a sibling's earlier removal) would throw
       'in get_name: The node with id "X:Y" does not exist'. Treat
       any such failure as "not ours, skip". */
    try {
    /* SHARED PRIMITIVES GUARD — Icon/Placeholder, Icon/Chevron, and the
       'DTF — Primitives' showcase section belong to ALL blueprints.
       Per-BP cleanup must never touch them. Check this FIRST before
       any removal logic below. */
    if (child.getPluginData && child.getPluginData('dtf-owner') === 'DTF-PRIMITIVES') {
      continue;
    }
    /* Remove DTF sections (contain all presentation).
       For wrapper kinds, only remove sections that mention THIS BP name
       (avoids deleting the button section that hosts our dependencies).
       Also catch legacy unprefixed sections (Tier 1 — Masters, Tier 2 —
       Variants, Icon Primitive) that belong to THIS BP, identified by
       containing one of our masters. */
    if ((child.type === 'SECTION' || child.type === 'FRAME')) {
      var legacyName = (child.name === 'Tier 1 \u2014 Masters' ||
                        child.name === 'Tier 2 \u2014 Variants' ||
                        child.name === 'Icon Primitive');
      /* SAFE removal rule: must carry our stamp, OR be a legacy-named
         section that demonstrably contains one of OUR masters, OR match
         the exact BP-prefixed names we use (fallback for old builds that
         pre-date the stampOwner() call in createSection). */
      var _namedAsBP = (_bpSectionNames.indexOf(child.name) >= 0);
      var matchesBP = ownedByThisBP(child) ||
                      (legacyName && sectionOwnedByThisBP(child)) ||
                      _namedAsBP;
      if (matchesBP) {
        /* M4 SAFE_REBUILD — component sets live INSIDE sections.
           Removing a section also destroys all nested children, which
           defeats SAFE_REBUILD: the sets in reuseSetByName get deleted
           before the reuse check below can fire, so their .removed===true
           and combineAsVariants creates new IDs → all placed instances detach.
           Fix: move every reusable set out to the page root BEFORE removing
           the section. The set survives cleanup; later the build loop will
           reparent it into the new section via variantSec.section.appendChild(). */
        if (SAFE_REBUILD && child.findAll) {
          try {
            var _rescueSets = child.findAll(function(n) {
              if (n.type !== 'COMPONENT_SET') return false;
              /* Primary: name-based rescue */
              if (reuseSetByName[n.name] !== undefined && reuseSetByName[n.name].id === n.id) return true;
              /* Fallback: semantic-ID rescue — survives singleFamily/naming changes.
                 ID check is MANDATORY: when two old per-family sets share the same
                 semId (singleFamily migration), only rescue the EXACT registered one.
                 Rescuing both causes permanent orphan accumulation on page root. */
              try {
                var _rSemId = n.getPluginData('dtf-set-id');
                return !!(_rSemId && reuseSetBySemanticId[_rSemId] &&
                          reuseSetBySemanticId[_rSemId].id === n.id &&
                          !reuseSetBySemanticId[_rSemId].removed);
              } catch(_rse) { return false; }
            });
            for (var _ri = 0; _ri < _rescueSets.length; _ri++) {
              page.appendChild(_rescueSets[_ri]);
              log('SAFE_REBUILD: rescued "' + _rescueSets[_ri].name + '" from section before removal');
            }
          } catch (_re) {
            log('SAFE_REBUILD rescue scan failed: ' + (_re && _re.message));
          }
        }
        child.remove();
        log('Removed existing section: ' + child.name);
        continue;
      }
    }
    /* Remove legacy loose nodes from older versions */
    if (child.name === 'Master/ Buttons/ ' + BP.name) {
      child.remove(); continue;
    }
    if (child.type === 'COMPONENT_SET' && ownedByThisBP(child)) {
      /* M4 — skip removal of any set we plan to reuse. Its old children
         will be pruned later, after the new variants have been appended,
         so the SET's node.id and library key survive.
         singleFamily: use semId+ID match instead of name match — old per-family
         sets carry the same semId as the reuseTarget but have DIFFERENT names
         (e.g. 'Button / Neutral / Icon + Text' vs 'Icon + Text'). Name-based
         check would skip them even though they'll never be reused, causing
         orphan accumulation. Only the EXACT registered set (ID match) is kept. */
      if (SAFE_REBUILD) {
        if (BP.singleFamily) {
          var _sfChildSemId = '';
          try { _sfChildSemId = child.getPluginData('dtf-set-id'); } catch(_sfcse) {}
          if (_sfChildSemId && reuseSetBySemanticId[_sfChildSemId] &&
              reuseSetBySemanticId[_sfChildSemId].id === child.id &&
              !reuseSetBySemanticId[_sfChildSemId].removed) {
            continue; /* exact reuseTarget for this master — keep */
          }
          /* Not the registered reuseTarget: orphaned per-family set — remove. */
          try { child.remove(); } catch(_sfOre) {} continue;
        }
        /* Non-singleFamily: existing name-based check. */
        if (reuseSetByName[child.name] && reuseSetByName[child.name].id === child.id) {
          continue;
        }
      }
      child.remove(); continue;
    }
    if (child.type === 'TEXT' && (child.name.indexOf('MASTER ') === 0 || child.name.indexOf('VARIANT ') === 0 || child.name === 'Icon Primitive' || child.name.indexOf('DTF-') === 0) &&
        (ownedByThisBP(child) || child.getPluginData('dtf-generated') === '1')) {
      child.remove(); continue;
    }
    } catch (_cleanupErr) {
      log('Cleanup skipped stale child at index ' + ci2 + ': ' + (_cleanupErr && _cleanupErr.message));
      continue;
    }
  }

  /* ── Presentation helpers ──────────────────────────────── */

  /* Resolve system colors from T2/T3 tokens instead of hardcoding.
     Falls back to hardcoded values if variables missing (e.g. first-run). */

  /* Helper: resolve a variable's current value for a given mode,
     following VariableAlias chains up to 5 levels deep */
  async function resolveVarColor(v, modeId) {
    if (!v || !modeId) return null;
    var current = v;
    for (var depth = 0; depth < 5; depth++) {
      try {
        var val = current.valuesByMode[modeId];
        if (!val) return null;
        if (val.type === 'VARIABLE_ALIAS') {
          /* Follow the alias to the referenced variable */
          current = await figma.variables.getVariableByIdAsync(val.id);
          if (!current) return null;
          /* Use the first mode of the referenced variable's collection */
          var refCol = await figma.variables.getVariableCollectionByIdAsync(current.variableCollectionId);
          if (refCol && refCol.modes && refCol.modes.length > 0) {
            modeId = refCol.modes[0].modeId;
          } else {
            return null;
          }
          continue;
        }
        if (typeof val.r === 'number') return { r: val.r, g: val.g, b: val.b };
      } catch (e) { return null; }
    }
    return null;
  }

  /* Find T2 collection + modes for presentation binding */
  var t2Col = null, t2Modes = {};
  var t1Col = null, t1Modes = {};
  var t3Col = null, t3Modes = {};
  var presColls = await figma.variables.getLocalVariableCollectionsAsync();
  for (var pci = 0; pci < presColls.length; pci++) {
    var pcol = presColls[pci];
    if (pcol.name === 'T1 Color Tokens') {
      t1Col = pcol;
      for (var pmi0 = 0; pmi0 < pcol.modes.length; pmi0++) {
        t1Modes[pcol.modes[pmi0].name] = pcol.modes[pmi0].modeId;
      }
    }
    if (pcol.name === 'T2 Surface Context Tokens') {
      t2Col = pcol;
      for (var pmi = 0; pmi < pcol.modes.length; pmi++) {
        t2Modes[pcol.modes[pmi].name] = pcol.modes[pmi].modeId;
      }
    }
    if (pcol.name === 'T3 Status Context Tokens') {
      t3Col = pcol;
      /* ── Migration: rename legacy 'primary' mode → 'brand' ──
         The system was unified around 'brand' as the canonical role.
         If a file still has a 'primary' mode (or both 'primary' and
         'brand'), normalize to 'brand' in-place to preserve all
         existing component bindings (variable mode IDs survive).      */
      try {
        var hasPrimary = pcol.modes.some(function(m) { return m.name === 'primary'; });
        var hasBrand   = pcol.modes.some(function(m) { return m.name === 'brand'; });
        if (hasPrimary && !hasBrand) {
          /* Simple rename: 'primary' → 'brand' (mode ID preserved) */
          for (var rmi = 0; rmi < pcol.modes.length; rmi++) {
            if (pcol.modes[rmi].name === 'primary') {
              pcol.renameMode(pcol.modes[rmi].modeId, 'brand');
              log("T3 mode migration: renamed 'primary' → 'brand'");
              break;
            }
          }
        } else if (hasPrimary && hasBrand) {
          /* Both exist — keep 'primary' (it's the live one with bindings)
             rename it to 'brand-new' temporarily, drop the stale 'brand'
             mode, then rename 'brand-new' → 'brand'. This preserves IDs. */
          var primaryMode = pcol.modes.find(function(m) { return m.name === 'primary'; });
          var brandMode   = pcol.modes.find(function(m) { return m.name === 'brand'; });
          pcol.renameMode(primaryMode.modeId, '__brand_tmp__');
          try { pcol.removeMode(brandMode.modeId); } catch (_e) {}
          pcol.renameMode(primaryMode.modeId, 'brand');
          log("T3 mode migration: dropped stale 'brand', promoted 'primary' → 'brand'");
        }
      } catch (mige) {
        log('T3 mode migration warning: ' + mige.message);
      }
      /* Re-read modes after potential rename */
      for (var pmi2 = 0; pmi2 < pcol.modes.length; pmi2++) {
        t3Modes[pcol.modes[pmi2].name] = pcol.modes[pmi2].modeId;
      }
    }
  }
  log('Presentation: T2 modes = ' + Object.keys(t2Modes).join(', '));
  log('Presentation: T3 modes = ' + Object.keys(t3Modes).join(', '));

  /* ── T3 alias repair ─────────────────────────────────────────────────────
     Bootstrap builds may have written literal hex values into T3 brand/success
     modes, severing the T1 alias chain. Re-wire as VARIABLE_ALIAS → T1.
     Does NOT touch neutral mode — not used; user deleted it.               */
  (function() {
    if (!t3Col) return;
    var _repairProps = [
      'component/bg-default', 'component/bg-hover', 'component/bg-pressed',
      'component/outline-default', 'component/outline-hover'
    ];
    var _repairRoles = ['brand', 'success'];
    for (var _ri = 0; _ri < _repairRoles.length; _ri++) {
      var _role  = _repairRoles[_ri];
      var _modeId = t3Modes[_role];
      if (!_modeId) continue;
      for (var _pi = 0; _pi < _repairProps.length; _pi++) {
        var _t3path = _repairProps[_pi];
        var _t3v    = t3Vars[_t3path];
        if (!_t3v) continue;
        var _t1name = 'semantic/' + _role + '/' + _t3path.replace('/', '-');
        var _t1v = _t1VarsForRepair ? _t1VarsForRepair[_t1name] : null;
        if (!_t1v) continue;
        try {
          _t3v.setValueForMode(_modeId, figma.variables.createVariableAlias(_t1v));
          log('T3 alias repaired: ' + _t3path + ' [' + _role + '] → ' + _t1name);
        } catch(e) { log('T3 alias repair fail: ' + _t3path + '/' + _role + ': ' + e.message); }
      }
    }
  })();

  /* Resolve presentation colors from system tokens */
  var brightModeId  = t2Modes['surface-bright'] || t2Modes['surface-base'] || null;
  var inverseModeId = t2Modes['surface-inverse'] || null;
  var brandModeId = t3Modes['brand'] || null;

  /* Surface-bright resolved values (for cards, labels, dividers) */
  var COLOR_SURFACE_BG = (await resolveVarColor(t2Vars['default/surfaces/bg'], brightModeId))    || { r: 1, g: 1, b: 1 };
  var COLOR_HEADING  = (await resolveVarColor(t2Vars['default/content/strong'], brightModeId))    || { r: 0.12, g: 0.12, b: 0.15 };
  var COLOR_BODY     = (await resolveVarColor(t2Vars['default/content/default'], brightModeId))   || { r: 0.35, g: 0.35, b: 0.40 };
  var COLOR_DIMMED   = (await resolveVarColor(t2Vars['default/content/subtle'], brightModeId))    || { r: 0.55, g: 0.55, b: 0.60 };
  var COLOR_FAINT    = (await resolveVarColor(t2Vars['default/content/faint'], brightModeId))     || { r: 0.70, g: 0.72, b: 0.75 };
  var COLOR_CARD_BG  = (await resolveVarColor(t2Vars['default/surfaces/subtle'], brightModeId))   || { r: 0.965, g: 0.969, b: 0.976 };
  var COLOR_HEADER_BG = (await resolveVarColor(t2Vars['default/surfaces/strong'], brightModeId))  || { r: 0.933, g: 0.937, b: 0.949 };
  var COLOR_DIVIDER  = (await resolveVarColor(t2Vars['default/surfaces/separator'], brightModeId)) || { r: 0.88, g: 0.89, b: 0.91 };
  var COLOR_OUTLINE  = (await resolveVarColor(t2Vars['default/surfaces/outline'], brightModeId))  || { r: 0.84, g: 0.85, b: 0.87 };
  var COLOR_CM_BG    = (await resolveVarColor(t2Vars['default/component/bg'], brightModeId))      || { r: 0.96, g: 0.97, b: 0.98 };

  /* Accent from T3 primary */
  var COLOR_ACCENT   = (await resolveVarColor(t3Vars['component/bg-default'], brandModeId))     || { r: 0.22, g: 0.42, b: 0.95 };
  var COLOR_PRIMARY_CT = (await resolveVarColor(t3Vars['content/default'], brandModeId))        || { r: 0.17, g: 0.36, b: 0.89 };
  var COLOR_ON_COMP  = (await resolveVarColor(t3Vars['oncomponent-content/default'], brandModeId)) || { r: 1, g: 1, b: 1 };
  var COLOR_PRIMARY_CONTAINER = (await resolveVarColor(t3Vars['container/bg'], brandModeId))    || { r: 0.92, g: 0.95, b: 1 };

  /* Surface-inverse resolved values (for hero dark background) */
  var COLOR_HERO_BG  = (await resolveVarColor(t2Vars['default/surfaces/bg'], inverseModeId))       || { r: 0.09, g: 0.09, b: 0.12 };
  var COLOR_HERO_TEXT = (await resolveVarColor(t2Vars['default/content/strong'], inverseModeId))    || { r: 1, g: 1, b: 1 };
  var COLOR_HERO_SUB  = (await resolveVarColor(t2Vars['default/content/subtle'], inverseModeId))   || { r: 0.70, g: 0.72, b: 0.78 };
  var COLOR_HERO_FAINT = (await resolveVarColor(t2Vars['default/content/faint'], inverseModeId))   || { r: 0.45, g: 0.47, b: 0.52 };
  var COLOR_HERO_DIV  = (await resolveVarColor(t2Vars['default/surfaces/separator'], inverseModeId)) || { r: 0.20, g: 0.20, b: 0.25 };
  var COLOR_HERO_CARD = (await resolveVarColor(t2Vars['default/surfaces/subtle'], inverseModeId))  || { r: 0.14, g: 0.14, b: 0.18 };
  var COLOR_WHITE    = { r: 1, g: 1, b: 1 };  /* Fixed white — kept as utility */

  /* Success color for tier-2 accent */
  var COLOR_SUCCESS  = (await resolveVarColor(t3Vars['component/bg-default'], t3Modes['success'] || null)) || { r: 0.18, g: 0.62, b: 0.42 };
  var COLOR_SUCCESS_CT = (await resolveVarColor(t3Vars['content/default'], t3Modes['success'] || null)) || { r: 0.04, g: 0.51, b: 0.15 };
  var COLOR_SUCCESS_CONTAINER = (await resolveVarColor(t3Vars['container/bg'], t3Modes['success'] || null)) || { r: 0.82, g: 1, b: 0.82 };

  log('Presentation colors resolved from ' + (brightModeId ? 'system tokens' : 'fallback values'));
  log('Token check — HEADING: r=' + COLOR_HEADING.r.toFixed(2) + ' ACCENT: r=' + COLOR_ACCENT.r.toFixed(2) + ' HERO_BG: r=' + COLOR_HERO_BG.r.toFixed(2));
  log('HERO detail — inverseModeId=' + inverseModeId + ' BG=#' + [COLOR_HERO_BG.r,COLOR_HERO_BG.g,COLOR_HERO_BG.b].map(function(c){return Math.round(c*255).toString(16).padStart(2,'0');}).join('') + ' CARD=#' + [COLOR_HERO_CARD.r,COLOR_HERO_CARD.g,COLOR_HERO_CARD.b].map(function(c){return Math.round(c*255).toString(16).padStart(2,'0');}).join('') + ' t2subtle=' + (t2Vars['default/surfaces/subtle']?'found':'MISSING'));

  /* Helper: safely bind a node's fill to a T2/T3 variable. Returns true on success. */
  function tryBindFill(node, varObj) {
    if (!varObj) return false;
    try { setPaintBoundToVariable(node, 'fills', varObj); return true; }
    catch (e) { return false; }
  }
  /* Helper: safely bind a node's stroke to a variable */
  function tryBindStroke(node, varObj) {
    if (!varObj) return false;
    try {
      node.strokes = [figma.variables.setBoundVariableForPaint(
        { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1, visible: true },
        'color', varObj
      )];
      if (varObj.id) _recordBoundVarId(varObj.id, varObj.name);
      return true;
    } catch (e) { return false; }
  }

  function createLabel(text, size, bold, color) {
    var label = figma.createText();
    label.fontName = bold ? fontNameBold : fontName;
    label.characters = text;
    label.fontSize = size;
    label.fills = [{ type: 'SOLID', color: color || COLOR_HEADING }];
    label.textAutoResize = 'WIDTH_AND_HEIGHT';
    return label;
  }

  /** Create a styled card frame with auto-layout, background, and rounded corners.
      Pass opts.width to get a fixed-width card that hugs height. */
  function createCard(opts) {
    var card = figma.createFrame();
    card.name = opts.name || 'Card';
    card.layoutMode = opts.direction || 'VERTICAL';
    card.cornerRadius = opts.radius !== undefined ? opts.radius : 12;
    card.paddingLeft = opts.padX || 24;
    card.paddingRight = opts.padX || 24;
    card.paddingTop = opts.padY || 20;
    card.paddingBottom = opts.padY || 20;
    card.itemSpacing = opts.gap || 12;
    card.fills = [{ type: 'SOLID', color: opts.fill || COLOR_CARD_BG }];
    card.clipsContent = false;
    if (opts.stroke) {
      card.strokes = [{ type: 'SOLID', color: opts.stroke }];
      card.strokeWeight = 1;
      card.strokeAlign = 'INSIDE';
    }
    /* Sizing: if width given → fixed width, hug height.
       For VERTICAL layout: counter axis = width, primary axis = height.
       For HORIZONTAL layout: primary axis = width, counter axis = height. */
    if (opts.width) {
      if ((opts.direction || 'VERTICAL') === 'VERTICAL') {
        card.counterAxisSizingMode = 'FIXED';
        card.primaryAxisSizingMode = 'AUTO';
      } else {
        card.primaryAxisSizingMode = 'FIXED';
        card.counterAxisSizingMode = 'AUTO';
      }
      card.resize(opts.width, 1);
    } else {
      card.primaryAxisSizingMode = 'AUTO';
      card.counterAxisSizingMode = 'AUTO';
    }
    card.layoutSizingHorizontal = opts.hSize || 'HUG';
    card.layoutSizingVertical = 'HUG';
    return card;
  }

  /** Create a horizontal divider line */
  function createDivider(width) {
    var line = figma.createFrame();
    line.name = 'divider';
    line.resize(width || 1120, 1);
    line.fills = [{ type: 'SOLID', color: COLOR_DIVIDER }];
    return line;
  }

  /** Create a styled badge / chip */
  function createBadge(text, bgColor, textColor) {
    var badge = figma.createFrame();
    badge.name = 'badge-' + text.toLowerCase().replace(/\s+/g, '-');
    badge.layoutMode = 'HORIZONTAL';
    badge.primaryAxisSizingMode = 'AUTO';
    badge.counterAxisSizingMode = 'AUTO';
    badge.layoutSizingHorizontal = 'HUG';
    badge.layoutSizingVertical = 'HUG';
    badge.cornerRadius = 6;
    badge.paddingLeft = 10;
    badge.paddingRight = 10;
    badge.paddingTop = 4;
    badge.paddingBottom = 4;
    badge.fills = [{ type: 'SOLID', color: bgColor || COLOR_CARD_BG }];
    var badgeLabel = createLabel(text, 11, true, textColor || COLOR_BODY);
    badge.appendChild(badgeLabel);
    return badge;
  }

  /** Create a Figma section — uses surface-bg token color.
      Returns { section, innerX, innerY } */
  /* Shadow effect for section containers */
  var SECTION_SHADOW = {
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.06 },
    offset: { x: 0, y: 4 },
    radius: 16,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL'
  };
  var SECTION_SHADOW_SUBTLE = {
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.03 },
    offset: { x: 0, y: 1 },
    radius: 4,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL'
  };

  /** Create a styled section — a FRAME with rounded corners, shadow, and token-bound fill.
      Returns { section: <frame>, innerX, innerY } */
  function createSection(name, sectionWidth, ownerOverride) {
    var sw = sectionWidth || 1200;
    var frame = figma.createFrame();
    frame.name = name;
    frame.resize(sw, 100);
    frame.cornerRadius = 16;
    frame.fills = [{ type: 'SOLID', color: COLOR_SURFACE_BG }];
    frame.effects = [SECTION_SHADOW, SECTION_SHADOW_SUBTLE];
    frame.clipsContent = false;
    frame.strokes = [{ type: 'SOLID', color: COLOR_OUTLINE }];
    frame.strokeWeight = 1;
    frame.strokeAlign = 'INSIDE';

    /* Bind fill + stroke to variables */
    tryBindFill(frame, t2Vars['default/surfaces/bg']);
    tryBindStroke(frame, t2Vars['default/surfaces/outline']);
    if (t2Col && brightModeId) {
      try { frame.setExplicitVariableModeForCollection(t2Col, brightModeId); } catch (e) {}
    }
    /* Set T1 Light explicitly so designers can toggle this frame to Dark mode
       via the Figma Variables panel — without an explicit T1 binding the mode
       is not surfaced as switchable in the UI. */
    if (t1Col) {
      var _t1LightId = t1Modes['Light'] || t1Modes['light'] || null;
      if (_t1LightId) { try { frame.setExplicitVariableModeForCollection(t1Col, _t1LightId); } catch (e) {} }
    }

    /* Stamp owner so cleanup on next run can safely remove this.
       Pass ownerOverride to mark a section as shared across BPs
       (e.g. 'DTF-PRIMITIVES' for the icon/chevron showcase). */
    if (ownerOverride && frame.setPluginData) {
      frame.setPluginData('dtf-owner', ownerOverride);
      frame.setPluginData('dtf-generated', '1');
    } else {
      stampOwner(frame);
    }

    return { section: frame, innerX: 40, innerY: 40 };
  }

  /* ── Layout cursor — tracks Y position on the page ─────── */
  var PAGE_X = 100;
  var SECTION_GAP = 60;
  /* Section width adapts to the widest variant set: 8-state split-button
     needs more room than 6-state button. Formula mirrors the variant grid:
     ROW_LABEL_WIDTH(100) + padX*2(40) + (colCount-1)*colSpacing(155) + 120
     extras + innerX*2(80) margin. Round up for headroom. */
  var _maxStatesForLayout = (BP.states && BP.states.length) || 6;
  for (var _flk = 0; _flk < Object.keys(BP.families || {}).length; _flk++) {
    var _flf = BP.families[Object.keys(BP.families)[_flk]];
    if (_flf.states && _flf.states.length > _maxStatesForLayout) _maxStatesForLayout = _flf.states.length;
  }
  var SECTION_W = Math.max(1200, 100 + 40 + (_maxStatesForLayout - 1) * 155 + 120 + 80);
  var CARD_W = SECTION_W - 80; /* card width inside sections */
  var cursorY = 100;

  /* Determine PAGE_X for the BP column.
     Priority 1: prior column X captured before cleanup (rebuild in-place).
     Priority 2: shift right past foreign (non-BP-owned) content.
     Priority 3: default PAGE_X = 100. */
  var PAGE_MARGIN = 200;
  if (_priorColumnX !== null) {
    PAGE_X = _priorColumnX;
    log('Rebuilding in-place at X = ' + PAGE_X);
  } else {
    var foreignMaxX = null;
    for (var pcx = 0; pcx < page.children.length; pcx++) {
      var pc = page.children[pcx];
      if (pc.type !== 'SECTION' && pc.type !== 'FRAME' && pc.type !== 'COMPONENT' && pc.type !== 'COMPONENT_SET') continue;
      var isForeign = true;
      try { if (pc.getPluginData('dtf-owner') === BP.name || pc.getPluginData('dtf-owner') === 'DTF-PRIMITIVES') isForeign = false; } catch(e) {}
      if (isForeign) {
        var rightEdge = (pc.x || 0) + (pc.width || 0);
        if (foreignMaxX === null || rightEdge > foreignMaxX) foreignMaxX = rightEdge;
      }
    }
    if (foreignMaxX !== null && foreignMaxX > PAGE_X) {
      PAGE_X = foreignMaxX + PAGE_MARGIN;
      log('Foreign content detected (max X = ' + foreignMaxX + '). Shifting new layout to X = ' + PAGE_X);
    }
  }

  /* ── Reserve a left column for the shared Primitives section ──
     Primitives is a single shared showcase rendered once per page. If
     it doesn't exist yet on the page, THIS BP run will create it. We
     reserve a column on the LEFT for it so the BP's own column (Hero →
     Tier 1 → Tier 2) flows uninterrupted to the right of it.
     If a primitives section already exists on the page, existingMaxX
     above has already shifted past it — no extra reservation needed. */
  var PRIMITIVES_COL_W = 540; /* generous fixed width for the shared column */

  /* Cross-page primitive lookup — searches all loaded pages, preferring
     the current (target) page. figma.loadAllPagesAsync() was already
     called in Step 3b so all pages are in memory. Using this for every
     primitive lookup prevents Toggle (and future non-button blueprints)
     from creating redundant icon copies just because their target page
     is different from the page where primitives were originally built. */
  function _findPrimAcrossPages(predicate) {
    try { var _lc = page.findOne(predicate); if (_lc) return _lc; } catch(e) {}
    for (var _fpI = 0; _fpI < figma.root.children.length; _fpI++) {
      var _fpPg = figma.root.children[_fpI];
      if (_fpPg.id === page.id) continue;
      try { var _fpR = _fpPg.findOne(predicate); if (_fpR) return _fpR; } catch(e) {}
    }
    return null;
  }

  var primitivesAlreadyOnPage = _findPrimAcrossPages(function(n) {
    return (n.type === 'SECTION' || n.type === 'FRAME') &&
           n.getPluginData && n.getPluginData('dtf-owner') === 'DTF-PRIMITIVES';
  });
  /* X at which the primitives section will be placed (captured BEFORE
     we shift PAGE_X past it). Used later when we actually create the
     section. Null means: don't reposition / use the existing section. */
  var primitivesPlanX = null;
  if (!primitivesAlreadyOnPage) {
    primitivesPlanX = PAGE_X;
    PAGE_X = PAGE_X + PRIMITIVES_COL_W + PAGE_MARGIN;
    log('Reserved primitives column at X = ' + primitivesPlanX + '; BP column shifted to X = ' + PAGE_X);
  }

  /* Pre-compute master names for use in hero section stats */
  var masterNames = Object.keys(BP.masters);

  /* ── Step 5a: Create Icon placeholder component ─────────
     A tiny 20×20 component with a vector child that scales.
     This lives on the page and acts as the INSTANCE_SWAP default.
     Users swap it with their own icon library components.

     For wrapper-with-button-instance kinds (split-button), reuse the
     existing placeholder created by the button generator — instances of
     button masters reference it by ID and we must not orphan them. */
  figma.ui.postMessage({ type: 'gen-progress', text: 'Building icon placeholder…' });

  /* Icon/Placeholder is a SHARED primitive used by every blueprint as
     the INSTANCE_SWAP target. Always reuse if it already exists on the
     page (no per-BP gating) — this avoids redundant placeholder
     components and keeps the shared primitives showcase coherent. */
  var iconPlaceholder = null;
  var iconPlaceholderCreated = false;
  iconPlaceholder = _findPrimAcrossPages(function(n) {
    return n.type === 'COMPONENT' && (n.name === 'Icon/Placeholder' || n.name === 'DTF/Icon/Placeholder');
  });
  if (iconPlaceholder) {
    log('Reusing existing icon placeholder: ' + iconPlaceholder.id);
    /* Rebind star fill — variable ID may have changed after a sync. */
    var _starVec = iconPlaceholder.findOne(function(n) { return n.type === 'STAR'; });
    if (_starVec) {
      var _starColorVar = t2Vars[BP.masterContentColor];
      if (_starColorVar) {
        setPaintBoundToVariable(_starVec, 'fills', _starColorVar);
      }
    }
  }
  if (!iconPlaceholder) {
    iconPlaceholderCreated = true;
    iconPlaceholder = figma.createComponent();
    iconPlaceholder.name = 'Icon/Placeholder';
    stampOwner(iconPlaceholder);
    iconPlaceholder.description =
      'Default icon used by every Button master as the INSTANCE_SWAP target.\n\n' +
      'REPLACE THIS with your own icon component (Lucide, Phosphor, Material Symbols, ' +
      'or your in-house icon library) by swapping the "Icon" property on any button instance.\n\n' +
      '── Two things to know about imported icons ──\n\n' +
      'COLOR. Figma does not propagate the button\u2019s content-color binding into a swapped ' +
      'instance\u2019s descendants. Most imported icons ship with literal black paints, so ' +
      'buttons can\u2019t recolor them. DTF auto-heals this: every time you run "Update Variables", ' +
      'the plugin rebinds any unbound SOLID paint inside Icon/Placeholder to ' +
      'T2 / default/content/default. Gradients and image fills are skipped and reported.\n\n' +
      'SIZE. The button\u2019s comp-size variables drive the slot\u2019s outer dimensions, but the ' +
      'icon only scales with the slot if its inner vectors use constraints: SCALE. Most icon ' +
      'libraries default to MIN/CENTER constraints and will not resize. For consistent sizing, ' +
      'either use icons authored with SCALE constraints, or normalise yours once: select the ' +
      'icon component, set its inner vectors\u2019 constraints to "Scale" (both axes), and ensure ' +
      'the component frame is square (e.g. 20\u00d720).';
    iconPlaceholder.resize(20, 20);
    iconPlaceholder.clipsContent = true;
    iconPlaceholder.fills = [];
    /* No auto-layout — matches reference icon component (layoutMode NONE) */

    /* Create a simple vector shape as visual placeholder */
    var iconStar = figma.createStar();
    iconStar.name = 'Vector';
    iconStar.resize(15, 15);
    iconStar.x = 2.5;
    iconStar.y = 2.5;
    iconStar.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
    /* Fill with content color */
    var iconContentVar = t2Vars[BP.masterContentColor];
    if (iconContentVar) {
      setPaintBoundToVariable(iconStar, 'fills', iconContentVar);
      stats.bindings++;
    }
    iconPlaceholder.appendChild(iconStar);
    /* Mark as shared primitive (not BP-owned) so per-BP cleanup
       never removes it. */
    if (iconPlaceholder.setPluginData) {
      iconPlaceholder.setPluginData('dtf-owner', 'DTF-PRIMITIVES');
      iconPlaceholder.setPluginData('dtf-generated', '1');
    }
    /* Don't append to page yet — will go inside section */
    log('Created icon placeholder component: ' + iconPlaceholder.id);
  }

  /* ── Chevron icon component set (split-button only) ──
     A 4-direction chevron icon set: Down (default), Up, Left, Right.
     Designers can swap direction via the variant property — useful
     for split-button menus that flip the chevron when the menu is
     open (Down → Up), or RTL/right-aligned menus (Right → Left).
     Reuses if present from a prior run.

     Returns: chevronIcon = the Down variant COMPONENT (for backward
     compatibility with downstream consumers that need a single
     COMPONENT id), and chevronIconSet = the parent COMPONENT_SET. */
  var chevronIcon = null;
  var chevronIconSet = null;
  var chevronCreated = false;
  /* Always look for an existing chevron set across ALL BPs — it's a
     shared primitive. Either wrapper-kind (split-button) or any BP
     that sets usesChevron=true (menu-button) is allowed to CREATE
     the set if it is missing. */
  chevronIconSet = _findPrimAcrossPages(function(n) {
    return n.type === 'COMPONENT_SET' && n.name === 'Icon/Chevron';
  });
  if (BP.kind === 'wrapper-with-button-instance' || BP.usesChevron) {
    /* Detect a broken / zero-size / wrong-arity set from a prior run and
       force recreation. Without this, a stale empty set keeps getting
       reused and the showcase preview keeps showing nothing. */
    if (chevronIconSet) {
      var brokenChev = (chevronIconSet.children.length !== 4) ||
                       (chevronIconSet.width < 1) || (chevronIconSet.height < 1);
      if (brokenChev) {
        log('Stale Icon/Chevron set detected (children=' + chevronIconSet.children.length + ' size=' + chevronIconSet.width + 'x' + chevronIconSet.height + '); recreating.');
        try { chevronIconSet.remove(); } catch (e) {}
        chevronIconSet = null;
      }
    }
    if (chevronIconSet) {
      chevronIcon = chevronIconSet.children.find(function(c) {
        return c.type === 'COMPONENT' && c.variantProperties && c.variantProperties.Direction === 'Down';
      }) || chevronIconSet.children[0];
      /* Repair layout in case the set was created by an older plugin
         version without auto-layout, or got squished to 0×0 by a prior
         resize attempt. Without this, the showcase preview shows an
         empty selection box. */
      try {
        applyChevronSetLayout(chevronIconSet);
        var _repairPaths = {
          Down:  'M 5 7.5 L 10 12.5 L 15 7.5',
          Up:    'M 5 12.5 L 10 7.5 L 15 12.5',
          Left:  'M 12.5 5 L 7.5 10 L 12.5 15',
          Right: 'M 7.5 5 L 12.5 10 L 7.5 15'
        };
        for (var rci = 0; rci < chevronIconSet.children.length; rci++) {
          var rc = chevronIconSet.children[rci];
          try { rc.layoutSizingHorizontal = 'FIXED'; rc.layoutSizingVertical = 'FIXED'; } catch (e) {}
          try { if (rc.width !== 20 || rc.height !== 20) rc.resize(20, 20); } catch (e) {}
          /* Repair vector paths to centred geometry.
             IMPORTANT: resize to 20×20 and reset to (0,0) FIRST so that
             the path coordinates (0..20 space) are interpreted in the
             full canvas, not accumulated on top of the shrunken bounds. */
          try {
            var _dir = rc.variantProperties && rc.variantProperties.Direction;
            if (_dir && _repairPaths[_dir]) {
              var _vec = rc.findOne(function(n) { return n.type === 'VECTOR'; });
              if (_vec) {
                _vec.resize(20, 20);
                _vec.x = 0; _vec.y = 0;
                _vec.vectorPaths = [{ windingRule: 'NONE', data: _repairPaths[_dir] }];
                /* Always rebind stroke color — variable ID may have changed
                   after a sync (rename churn creates new var IDs). Without this,
                   the chevron reverts to a literal black stroke on every rebuild. */
                _vec.fills = [];
                _vec.strokes = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }];
                _vec.strokeWeight = 1.75;
                _vec.strokeCap = 'ROUND';
                _vec.strokeJoin = 'ROUND';
                var _repairColorVar = t2Vars[BP.masterContentColor];
                if (_repairColorVar) {
                  setPaintBoundToVariable(_vec, 'strokes', _repairColorVar);
                }
              }
            }
          } catch (e) {}
        }
      } catch (e) { log('Chevron set layout repair skipped: ' + e.message); }
      log('Reusing existing chevron icon set: ' + chevronIconSet.id);
    } else {
      /* Path data for each direction. Apex centred at x=9 / y=9
         Each path spans 10px centred in the 20px frame:
         Down/Up: x=5..15 (apex x=10), y=7.5..12.5 → left=5, right=5, top=7.5, bottom=7.5.
         Left/Right: y=5..15 (apex y=10), x=7.5..12.5 → same symmetric margins. */
      var chevronPaths = {
        Down:  'M 5 7.5 L 10 12.5 L 15 7.5',
        Up:    'M 5 12.5 L 10 7.5 L 15 12.5',
        Left:  'M 12.5 5 L 7.5 10 L 12.5 15',
        Right: 'M 7.5 5 L 12.5 10 L 7.5 15'
      };
      chevronCreated = true;
      var chevronVariants = [];
      var chevronDirections = ['Down', 'Up', 'Left', 'Right'];
      for (var cdi = 0; cdi < chevronDirections.length; cdi++) {
        var dir = chevronDirections[cdi];
        var compNode = figma.createComponent();
        compNode.name = 'Direction=' + dir;
        compNode.resize(20, 20);
        compNode.clipsContent = true;
        compNode.fills = [];
        try {
          var chevVec = figma.createVector();
          chevVec.name = 'Vector';
          chevVec.x = 0; chevVec.y = 0;
          chevVec.resize(20, 20);
          chevVec.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
          chevVec.vectorPaths = [{ windingRule: 'NONE', data: chevronPaths[dir] }];
          chevVec.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
          chevVec.strokeWeight = 1.75;
          chevVec.strokeCap = 'ROUND';
          chevVec.strokeJoin = 'ROUND';
          chevVec.fills = [];
          var chevColorVar = t2Vars[BP.masterContentColor];
          if (chevColorVar) {
            setPaintBoundToVariable(chevVec, 'strokes', chevColorVar);
            stats.bindings++;
          }
          compNode.appendChild(chevVec);
        } catch (cve) {
          log('Chevron ' + dir + ' vector creation failed: ' + cve.message);
        }
        chevronVariants.push(compNode);
      }
      try {
        chevronIconSet = figma.combineAsVariants(chevronVariants, page);
        chevronIconSet.name = 'Icon/Chevron';
        /* Shared primitive — use shared owner stamp so per-BP cleanup
           never removes it. */
        if (chevronIconSet.setPluginData) {
          chevronIconSet.setPluginData('dtf-owner', 'DTF-PRIMITIVES');
          chevronIconSet.setPluginData('dtf-generated', '1');
        }
        chevronIconSet.description = 'Directional chevron icon (Down / Up / Left / Right). Default = Down. Used by Split Button triggers; flip to Up for active/open state.';
        /* Auto-layout the variant grid so it presents cleanly. */
        try {
          applyChevronSetLayout(chevronIconSet);
          for (var ncv = 0; ncv < chevronIconSet.children.length; ncv++) {
            try {
              chevronIconSet.children[ncv].layoutSizingHorizontal = 'FIXED';
              chevronIconSet.children[ncv].layoutSizingVertical = 'FIXED';
            } catch (e) {}
          }
        } catch (e) { /* combineAsVariants may already auto-layout */ }
        chevronIcon = chevronVariants[0]; /* Down */
        log('Created chevron icon set with 4 directions: ' + chevronIconSet.id + ' size=' + chevronIconSet.width + 'x' + chevronIconSet.height);
      } catch (cse) {
        log('Chevron combineAsVariants failed: ' + cse.message);
        /* Fall back to single Down component if combine fails */
        chevronIcon = chevronVariants[0];
        chevronIcon.name = 'Icon/Chevron Down';
        for (var cvi = 1; cvi < chevronVariants.length; cvi++) {
          try { chevronVariants[cvi].remove(); } catch (e) {}
        }
        chevronIconSet = null;
      }
    }
  }
  /* Resolve which icon to use as the trigger's default child.
     Always the Down chevron variant (or fallback placeholder).
     For blueprints that use a chevronSlot (e.g. menu-button) but are
     NOT wrapper-with-button-instance, reuse the existing chevron set
     (created by split-button earlier, or present from a prior build). */
  if (!chevronIcon && (BP.usesChevron || BP.kind === 'wrapper-with-button-instance') && chevronIconSet) {
    chevronIcon = chevronIconSet.children.find(function(c) {
      return c.type === 'COMPONENT' && c.variantProperties && c.variantProperties.Direction === 'Down';
    }) || chevronIconSet.children[0] || null;
  }
  var triggerIconComp = chevronIcon || iconPlaceholder;

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     PRESENTATION: Page Header — Hero Card (absolute positioning)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  var headerSec = createSection(BP.name + ' — Overview', SECTION_W);

  /* Hero — plain frame, NO auto-layout. All children positioned manually. */
  var HERO_PAD = 40;
  var HERO_INNER_W = CARD_W - HERO_PAD * 2;
  var heroBg = figma.createFrame();
  heroBg.name = 'hero';
  heroBg.resize(CARD_W, 320);
  heroBg.fills = [{ type: 'SOLID', color: COLOR_HERO_BG }];
  heroBg.cornerRadius = 16;
  heroBg.clipsContent = false;

  var hy = 36; /* Y cursor inside hero */

  /* Title */
  var heroTitle = createLabel(BP.name.charAt(0).toUpperCase() + BP.name.slice(1), 32, true, COLOR_HERO_TEXT);
  heroBg.appendChild(heroTitle);
  heroTitle.x = HERO_PAD; heroTitle.y = hy;

  /* Version badge */
  var versionBadge = createBadge(CODE_VERSION, COLOR_ACCENT, COLOR_ON_COMP);
  heroBg.appendChild(versionBadge);
  versionBadge.x = HERO_PAD + heroTitle.width + 16; versionBadge.y = hy + 8;
  hy += 46;

  /* Subtitle */
  var heroSub = createLabel('Two-tier component architecture with full design token binding', 16, false, COLOR_HERO_SUB);
  heroBg.appendChild(heroSub);
  heroSub.x = HERO_PAD; heroSub.y = hy;
  hy += 30;

  /* Divider */
  var heroDivider = createDivider(HERO_INNER_W);
  heroDivider.fills = [{ type: 'SOLID', color: COLOR_HERO_DIV }];
  heroBg.appendChild(heroDivider);
  heroDivider.x = HERO_PAD; heroDivider.y = hy;
  hy += 16;

  /* Stat badges — aggregate counts across all families.
     Tolerate both blueprint shapes: legacy flat (family.states) or
     wrapper-with-zones (BP.states at root, no family.states). */
  var _famNames = Object.keys(BP.families || {});
  var _totalTypes = 0, _totalStates = 0, _maxStates = 0;
  var _rootStatesLen = (BP.states && BP.states.length) || 0;
  for (var _fi = 0; _fi < _famNames.length; _fi++) {
    var _f = BP.families[_famNames[_fi]];
    _totalTypes += (_f.types && _f.types.length) || 0;
    var _famStLen = (_f.states && _f.states.length) || _rootStatesLen;
    if (_famStLen > _maxStates) _maxStates = _famStLen;
  }
  _totalStates = _maxStates;
  var statBadges = [
    createBadge('Tier 1: ' + masterNames.length + ' Masters', COLOR_HERO_CARD, COLOR_HERO_SUB),
    createBadge('Tier 2: ' + _famNames.length + ' Families \u00b7 ' + _totalTypes + ' Types \u00d7 up to ' + _totalStates + ' States', COLOR_HERO_CARD, COLOR_HERO_SUB),
    createBadge('Token-bound', COLOR_HERO_CARD, COLOR_SUCCESS)
  ];
  var bx = HERO_PAD;
  for (var sbi = 0; sbi < statBadges.length; sbi++) {
    heroBg.appendChild(statBadges[sbi]);
    statBadges[sbi].x = bx; statBadges[sbi].y = hy;
    bx += statBadges[sbi].width + 12;
  }
  hy += statBadges[0].height + 20;

  /* Architecture info boxes (side by side) */
  var INFO_W = Math.floor((HERO_INNER_W - 56) / 2);
  var INFO_H = 84;

  var t1Box = figma.createFrame();
  t1Box.name = 'tier1-info'; t1Box.resize(INFO_W, INFO_H); t1Box.cornerRadius = 10;
  t1Box.fills = [{ type: 'SOLID', color: COLOR_HERO_CARD }]; t1Box.clipsContent = false;
  var t1l1 = createLabel('TIER 1 \u2014 MASTERS', 11, true, COLOR_ACCENT);
  t1Box.appendChild(t1l1); t1l1.x = 20; t1l1.y = 14;
  var t1l2 = createLabel('Structure \u00b7 Spacing \u00b7 Sizing', 13, false, COLOR_HERO_SUB);
  t1Box.appendChild(t1l2); t1l2.x = 20; t1l2.y = 34;
  var t1l3 = createLabel('Bound to comp-size variables', 11, false, COLOR_HERO_FAINT);
  t1Box.appendChild(t1l3); t1l3.x = 20; t1l3.y = 56;
  heroBg.appendChild(t1Box); t1Box.x = HERO_PAD; t1Box.y = hy;

  var arrowNode = createLabel('\u2192', 24, true, COLOR_HERO_FAINT);
  heroBg.appendChild(arrowNode);
  arrowNode.x = HERO_PAD + INFO_W + 16; arrowNode.y = hy + 26;

  var t2Box = figma.createFrame();
  t2Box.name = 'tier2-info'; t2Box.resize(INFO_W, INFO_H); t2Box.cornerRadius = 10;
  t2Box.fills = [{ type: 'SOLID', color: COLOR_HERO_CARD }]; t2Box.clipsContent = false;
  var t2l1 = createLabel('TIER 2 \u2014 VARIANTS', 11, true, COLOR_SUCCESS);
  t2Box.appendChild(t2l1); t2l1.x = 20; t2l1.y = 14;
  var t2l2 = createLabel('Color \u00b7 State \u00b7 Interactions', 13, false, COLOR_HERO_SUB);
  t2Box.appendChild(t2l2); t2l2.x = 20; t2l2.y = 34;
  var t2l3 = createLabel('Token-bound fills, strokes, content', 11, false, COLOR_HERO_FAINT);
  t2Box.appendChild(t2l3); t2l3.x = 20; t2l3.y = 56;
  heroBg.appendChild(t2Box); t2Box.x = HERO_PAD + INFO_W + 48; t2Box.y = hy;

  hy += INFO_H + 36;
  heroBg.resize(CARD_W, hy); /* Resize hero to exact computed height */

  /* ── Bind hero fills to actual T2/T3 variables (live theme response) ── */
  var t1DarkModeId = t1Modes['Dark'] || t1Modes['dark'] || null;

  if (t2Col && inverseModeId) {
    try {
      /* Set mode on the hero container itself */
      heroBg.setExplicitVariableModeForCollection(t2Col, inverseModeId);
      if (t1Col && t1DarkModeId) {
        try { heroBg.setExplicitVariableModeForCollection(t1Col, t1DarkModeId); } catch (e) {}
      }

      /* Bind FRAME fills only — text nodes already use statically-resolved
         colors (COLOR_HERO_TEXT etc.) which are correct from resolveVarColor.
         Variable bindings on text nodes cause Figma to fall back to the default
         mode value (surface-bright → black text) when the T2 variable has no
         surface-inverse value populated yet (i.e. before Update Variables).
         Each child frame also needs the explicit surface-inverse (+ T1 Dark)
         mode so that setBoundVariableForPaint resolves the correct token value
         at binding time — without it the static fill.color shows as #000000. */
      tryBindFill(heroBg, t2Vars['default/surfaces/bg']);

      /* t1Box (tier1 info card) */
      try { t1Box.setExplicitVariableModeForCollection(t2Col, inverseModeId); } catch (e) {}
      if (t1Col && t1DarkModeId) { try { t1Box.setExplicitVariableModeForCollection(t1Col, t1DarkModeId); } catch (e) {} }
      tryBindFill(t1Box, t2Vars['default/surfaces/subtle']);

      /* t2Box (tier2 info card) */
      try { t2Box.setExplicitVariableModeForCollection(t2Col, inverseModeId); } catch (e) {}
      if (t1Col && t1DarkModeId) { try { t2Box.setExplicitVariableModeForCollection(t1Col, t1DarkModeId); } catch (e) {} }
      tryBindFill(t2Box, t2Vars['default/surfaces/subtle']);

      /* stat badges */
      for (var sbBind = 0; sbBind < statBadges.length; sbBind++) {
        try { statBadges[sbBind].setExplicitVariableModeForCollection(t2Col, inverseModeId); } catch (e) {}
        if (t1Col && t1DarkModeId) { try { statBadges[sbBind].setExplicitVariableModeForCollection(t1Col, t1DarkModeId); } catch (e) {} }
        tryBindFill(statBadges[sbBind], t2Vars['default/surfaces/subtle']);
      }

      /* divider */
      try { heroDivider.setExplicitVariableModeForCollection(t2Col, inverseModeId); } catch (e) {}
      if (t1Col && t1DarkModeId) { try { heroDivider.setExplicitVariableModeForCollection(t1Col, t1DarkModeId); } catch (e) {} }
      tryBindFill(heroDivider, t2Vars['default/surfaces/separator']);

      log('Hero: bound frame fills to T2 inverse surface variables');
    } catch (heroBindErr) {
      log('Hero binding skipped: ' + heroBindErr.message);
    }
  }
  /* Bind T3 accent elements on hero — only frame fills, not text nodes */
  if (t3Col && brandModeId) {
    try {
      heroBg.setExplicitVariableModeForCollection(t3Col, brandModeId);
      /* version badge bg is a frame — bind it */
      try { versionBadge.setExplicitVariableModeForCollection(t3Col, brandModeId); } catch (e) {}
      tryBindFill(versionBadge, t3Vars['component/bg-default']);
    } catch (e) {}
  }
  if (t3Col && t3Modes['success']) {
    try {
      t2Box.setExplicitVariableModeForCollection(t3Col, t3Modes['success']);
      statBadges[2].setExplicitVariableModeForCollection(t3Col, t3Modes['success']);
    } catch (e) {}
  }

  /* ── Bind hero TEXT node fills to T2/T3 content variables ────────────
     Each text node needs its OWN explicit mode set before the fill is
     bound — setBoundVariableForPaint resolves at the node's own mode
     context, not the parent frame's inherited mode. */
  if (t2Col && inverseModeId) {
    var _bht = function(node, t3ModeId, varObj) {
      if (!node || !varObj) return;
      try {
        node.setExplicitVariableModeForCollection(t2Col, inverseModeId);
        if (t1Col && t1DarkModeId) { try { node.setExplicitVariableModeForCollection(t1Col, t1DarkModeId); } catch(e) {} }
        if (t3Col && t3ModeId)     { try { node.setExplicitVariableModeForCollection(t3Col, t3ModeId); } catch(e) {} }
        tryBindFill(node, varObj);
      } catch(e) {}
    };
    /* T2 surface-inverse content tokens */
    _bht(heroTitle,  null,              t2Vars['default/content/strong']);
    _bht(heroSub,    null,              t2Vars['default/content/subtle']);
    _bht(arrowNode,  null,              t2Vars['default/content/faint']);
    _bht(t1l2,       null,              t2Vars['default/content/subtle']);
    _bht(t1l3,       null,              t2Vars['default/content/faint']);
    _bht(t2l2,       null,              t2Vars['default/content/subtle']);
    _bht(t2l3,       null,              t2Vars['default/content/faint']);
    /* Stat badge label nodes (children[0] is the TEXT inside each badge frame) */
    if (statBadges[0] && statBadges[0].children[0]) _bht(statBadges[0].children[0], null,               t2Vars['default/content/subtle']);
    if (statBadges[1] && statBadges[1].children[0]) _bht(statBadges[1].children[0], null,               t2Vars['default/content/subtle']);
    /* T3 brand text: tier-1 heading + version badge label */
    if (t3Col && brandModeId) {
      _bht(t1l1,  brandModeId,  t3Vars['content/default']);
      if (versionBadge && versionBadge.children[0]) _bht(versionBadge.children[0], brandModeId, t3Vars['oncomponent-content/default']);
    }
    /* T3 success text: tier-2 heading + token-bound badge label */
    if (t3Col && t3Modes['success']) {
      _bht(t2l1, t3Modes['success'], t3Vars['content/default']);
      if (statBadges[2] && statBadges[2].children[0]) _bht(statBadges[2].children[0], t3Modes['success'], t3Vars['content/default']);
    }
    log('Hero: bound text fills to T2/T3 content variables');
  }

  /* Place hero in section */
  headerSec.section.appendChild(heroBg);
  heroBg.x = headerSec.innerX;
  heroBg.y = headerSec.innerY;

  /* Meta footer */
  var metaNode = createLabel('Generated by Design Token Forge', 11, false, COLOR_DIMMED);
  headerSec.section.appendChild(metaNode);
  metaNode.x = headerSec.innerX;
  metaNode.y = headerSec.innerY + heroBg.height + 12;
  tryBindFill(metaNode, t2Vars['default/content/subtle']);

  var headerH = headerSec.innerY + heroBg.height + 12 + 18 + 32;
  try { headerSec.section.resize(SECTION_W, headerH); } catch (e) {}
  page.appendChild(headerSec.section);
  headerSec.section.x = PAGE_X;
  headerSec.section.y = cursorY;
  cursorY += headerH + SECTION_GAP;

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     PRESENTATION: Shared Primitives showcase

     Icon/Placeholder and Icon/Chevron are common to ALL blueprints.
     The showcase section is rendered ONCE per page (stamped
     'DTF-PRIMITIVES'); subsequent BP runs find the existing section
     and skip re-rendering — eliminating per-BP redundancy.

     If the section exists AND a new chevron was created in THIS run,
     the chevron set is appended into the existing preview without
     rebuilding the rest of the section.
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  var SHARED_PRIMITIVES_SECTION_NAME = 'Primitives';
  /* Legacy name (pre-rename) — still detected so old files don't end
     up with duplicate sections after this update. */
  var LEGACY_PRIMITIVES_SECTION_NAME = 'DTF \u2014 Primitives';
  var existingPrimitivesSection = _findPrimAcrossPages(function(n) {
    return (n.type === 'SECTION' || n.type === 'FRAME') &&
           (n.name === SHARED_PRIMITIVES_SECTION_NAME ||
            n.name === LEGACY_PRIMITIVES_SECTION_NAME) &&
           n.getPluginData && n.getPluginData('dtf-owner') === 'DTF-PRIMITIVES';
  });
  /* Normalize legacy name on this run. */
  if (existingPrimitivesSection && existingPrimitivesSection.name === LEGACY_PRIMITIVES_SECTION_NAME) {
    try { existingPrimitivesSection.name = SHARED_PRIMITIVES_SECTION_NAME; } catch (e) {}
  }

  if (existingPrimitivesSection && !iconPlaceholderCreated && !chevronCreated) {
    /* Nothing new to add — skip re-rendering. This BP's column starts
       directly with the hero/Tier sections, parallel to the existing
       primitives section. */
    log('Reusing shared primitives showcase: ' + existingPrimitivesSection.id);

    /* Repair: ensure the icon-usage-note has the correct spacing/padding
       (fixes sections created before the gap fix was deployed). */
    try {
      var repairNote = existingPrimitivesSection.findOne(function(n) {
        return n.name === 'icon-usage-note';
      });
      if (repairNote) {
        if (repairNote.itemSpacing !== 10) repairNote.itemSpacing = 10;
        if (repairNote.paddingTop !== 8)   repairNote.paddingTop  = 8;
        if (repairNote.paddingBottom !== 8) repairNote.paddingBottom = 8;
      }
      /* Repair: ensure icPreview aligns its children to CENTER (cross-axis
         centering so the iconPlaceholder and chevron set are vertically
         aligned when they differ in height). */
      var repairPreview = existingPrimitivesSection.findOne(function(n) {
        return n.name === 'icon-preview';
      });
      if (repairPreview) { applyIconPreviewLayout(repairPreview); }
    } catch (repErr) { log('Primitives repair skipped: ' + repErr.message); }
  } else if (existingPrimitivesSection && chevronCreated && chevronIconSet) {
    /* Append the newly-created chevron set into the existing showcase
       preview, then resize the showcase + card to fit. The card is
       auto-layout (vertical), so it hugs the preview's new height
       automatically. We only need to refresh the section bounds. */
    try {
      var existingPreview = existingPrimitivesSection.findOne(function(n) {
        return n.name === 'icon-preview';
      });
      var existingCard = existingPrimitivesSection.findOne(function(n) {
        return n.name === 'icon-card';
      });
      if (existingPreview) {
        existingPreview.appendChild(chevronIconSet);
        try { chevronIconSet.layoutSizingHorizontal = 'FIXED'; chevronIconSet.layoutSizingVertical = 'FIXED'; } catch (e) {}
        applyIconPreviewLayout(existingPreview);
        /* Card is auto-layout HUG; it now reflects the new preview size.
           Grow the section frame to fit the card. */
        if (existingCard) {
          var nIY = 40, nIX = 40, nPad = 32;
          var newSecW = Math.max(existingPrimitivesSection.width, nIX + existingCard.width + nPad);
          var newSecH = Math.max(existingPrimitivesSection.height, nIY + existingCard.height + nPad);
          try { existingPrimitivesSection.resize(newSecW, newSecH); } catch (e) {}
        }
        /* Repair gap fix on iconNote if needed. */
        var repNote2 = existingPrimitivesSection.findOne(function(n) { return n.name === 'icon-usage-note'; });
        if (repNote2) {
          if (repNote2.itemSpacing !== 10) repNote2.itemSpacing = 10;
          if (repNote2.paddingTop !== 8)   repNote2.paddingTop  = 8;
          if (repNote2.paddingBottom !== 8) repNote2.paddingBottom = 8;
        }
        log('Appended chevron set into existing primitives showcase.');
      }
    } catch (appErr) {
      log('Failed to append chevron into existing showcase: ' + appErr.message);
    }
  } else {
  var iconSec = createSection(SHARED_PRIMITIVES_SECTION_NAME, 480, 'DTF-PRIMITIVES');

  /* Card background — auto-layout (VERTICAL, HUG) so it always wraps
     its content. Previously the card had a fixed resize(400, 160) and
     then we manually grew it after the chevron set was appended; that
     math was fragile and the dashed preview ended up extending past
     the card border. Auto-layout hug guarantees the card is exactly
     the size of (title + desc + preview + paddings). */
  var iconCard = figma.createFrame();
  iconCard.name = 'icon-card';
  iconCard.cornerRadius = 12;
  iconCard.fills = [{ type: 'SOLID', color: COLOR_CARD_BG }];
  iconCard.strokes = [{ type: 'SOLID', color: COLOR_OUTLINE }];
  iconCard.strokeWeight = 1; iconCard.strokeAlign = 'INSIDE';
  iconCard.clipsContent = false;
  iconCard.layoutMode = 'VERTICAL';
  iconCard.primaryAxisSizingMode = 'AUTO';   /* hug height */
  iconCard.counterAxisSizingMode = 'AUTO';   /* hug width  */
  iconCard.counterAxisAlignItems = 'MIN';
  iconCard.itemSpacing = 16;
  iconCard.paddingLeft = 24; iconCard.paddingRight = 24;
  iconCard.paddingTop = 20;  iconCard.paddingBottom = 24;

  var icTitle = createLabel('Icon Primitive', 16, true, COLOR_HEADING);
  iconCard.appendChild(icTitle);
  var icDesc = createLabel('Default INSTANCE_SWAP target.\nReplace with your icon library.', 12, false, COLOR_BODY);
  iconCard.appendChild(icDesc);

  /* Icon preview box — auto-layout so it hugs whatever children we
     append (placeholder alone, or placeholder + 4-direction chevron set). */
  var icPreview = figma.createFrame();
  icPreview.name = 'icon-preview';
  applyIconPreviewLayout(icPreview);
  icPreview.cornerRadius = 8;
  icPreview.fills = [{ type: 'SOLID', color: COLOR_SURFACE_BG }];
  icPreview.strokes = [{ type: 'SOLID', color: COLOR_OUTLINE }];
  icPreview.strokeWeight = 1; icPreview.strokeAlign = 'INSIDE';
  icPreview.dashPattern = [4, 4];
  icPreview.clipsContent = false;
  iconCard.appendChild(icPreview);
  /* Preview hugs its own children — no manual x/y; parent auto-layout
     positions it below desc with itemSpacing=16. */
  try { icPreview.layoutSizingHorizontal = 'HUG'; icPreview.layoutSizingVertical = 'HUG'; } catch (e) {}
  icPreview.appendChild(iconPlaceholder);
  try { iconPlaceholder.layoutSizingHorizontal = 'FIXED'; iconPlaceholder.layoutSizingVertical = 'FIXED'; } catch (e) {}

  /* If a chevron icon set was created (split-button generation), place it
     beside the placeholder. Auto-layout on both preview AND card means
     no manual resize math is needed — everything hugs. */
  if (chevronIconSet) {
    icPreview.appendChild(chevronIconSet);
    try { chevronIconSet.layoutSizingHorizontal = 'FIXED'; chevronIconSet.layoutSizingVertical = 'FIXED'; } catch (e) {}
  } else if (chevronIcon && chevronIcon !== iconPlaceholder) {
    /* Fallback path when combineAsVariants failed — single chevron component */
    icPreview.appendChild(chevronIcon);
    try { chevronIcon.layoutSizingHorizontal = 'FIXED'; chevronIcon.layoutSizingVertical = 'FIXED'; } catch (e) {}
  }

  iconSec.section.appendChild(iconCard);
  iconCard.x = iconSec.innerX;
  iconCard.y = iconSec.innerY;

  /* Designer-facing usage note — placed as a sibling BELOW the icon
     card (inside the Primitives section). Plain text block, no card
     chrome, so it reads like a caption rather than a second tile.
     Width matches the icon card so the column stays tidy. */
  var iconNote = figma.createFrame();
  iconNote.name = 'icon-usage-note';
  iconNote.fills = [];
  iconNote.strokes = [];
  iconNote.layoutMode = 'VERTICAL';
  iconNote.itemSpacing = 10;
  iconNote.paddingTop = 8; iconNote.paddingBottom = 8;
  /* resize() must come BEFORE sizing-mode assignments — calling resize()
     after AUTO implicitly resets primaryAxisSizingMode to FIXED, leaving
     the frame permanently at 10 px and clipping all children. */
  iconNote.resize(iconCard.width, 10);
  iconNote.primaryAxisSizingMode = 'AUTO';   /* hug height — set AFTER resize */
  iconNote.counterAxisSizingMode = 'FIXED';  /* width stays fixed */
  var icNoteTitle = createLabel('Bring your own icons', 13, true, COLOR_HEADING);
  var icNoteBody = createLabel(
    'Drop any icon library into this file (Lucide, Phosphor, Material\u2026) or publish from a team library. Swap Icon/Placeholder for your icon \u2014 colors bind automatically when the DTF plugin opens.',
    12, false, COLOR_BODY
  );
  try { icNoteBody.lineHeight = { value: 150, unit: 'PERCENT' }; } catch (e) {}
  var icNoteRule = createLabel(
    'One rule: flatten the icon (\u2318E) before swapping. Keeps the weight consistent across every button size.',
    12, false, COLOR_BODY
  );
  try { icNoteRule.lineHeight = { value: 150, unit: 'PERCENT' }; } catch (e) {}
  iconNote.appendChild(icNoteTitle);
  iconNote.appendChild(icNoteBody);
  iconNote.appendChild(icNoteRule);
  try { icNoteTitle.layoutAlign = 'STRETCH'; icNoteTitle.textAutoResize = 'HEIGHT'; } catch (e) {}
  try { icNoteBody.layoutAlign = 'STRETCH'; icNoteBody.textAutoResize = 'HEIGHT'; } catch (e) {}
  try { icNoteRule.layoutAlign = 'STRETCH'; icNoteRule.textAutoResize = 'HEIGHT'; } catch (e) {}
  /* Re-assert AUTO after children are appended so Figma measures real height
     before we read iconNote.height for the section resize below. */
  iconNote.primaryAxisSizingMode = 'AUTO';
  iconSec.section.appendChild(iconNote);
  iconNote.x = iconCard.x;
  iconNote.y = iconCard.y + iconCard.height + 24;

  /* Bind icon card to surface-bright tokens */
  if (t2Col && brightModeId) {
    try {
      iconCard.setExplicitVariableModeForCollection(t2Col, brightModeId);
      tryBindFill(iconCard, t2Vars['default/surfaces/subtle']);
      tryBindStroke(iconCard, t2Vars['default/surfaces/outline']);
      tryBindFill(icTitle, t2Vars['default/content/strong']);
      tryBindFill(icDesc, t2Vars['default/content/default']);
      tryBindFill(icPreview, t2Vars['default/surfaces/bg']);
      tryBindStroke(icPreview, t2Vars['default/surfaces/outline']);
      iconNote.setExplicitVariableModeForCollection(t2Col, brightModeId);
      tryBindFill(icNoteTitle, t2Vars['default/content/strong']);
      tryBindFill(icNoteBody, t2Vars['default/content/default']);
      tryBindFill(icNoteRule, t2Vars['default/content/default']);
    } catch (icBindErr) {
      log('Icon card binding skipped: ' + icBindErr.message);
    }
  }
  var iconSecH = iconSec.innerY + iconCard.height + 24 + iconNote.height + 32;
  /* Section width grows to fit the card (which may have been widened to
     accommodate the chevron variant set). */
  var iconSecW = Math.max(480, iconSec.innerX + iconCard.width + 32);
  try { iconSec.section.resize(iconSecW, iconSecH); } catch (e) {}
  page.appendChild(iconSec.section);
  /* Place primitives in its own LEFT column (reserved earlier as
     primitivesPlanX), anchored to the page top. The BP column has
     already been shifted past this column, so its Hero/Tier sections
     render alongside the primitives column rather than below it. */
  iconSec.section.x = (primitivesPlanX !== null) ? primitivesPlanX : 100;
  iconSec.section.y = 100;
  /* cursorY is NOT advanced — Hero/Tier sections continue in the
     BP column. */
  } /* end shared-primitives-section creation branch */

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     PRESENTATION: Tier 1 — Master Components (absolute positioning)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  figma.ui.postMessage({ type: 'gen-progress', text: 'Building master components…' });

  var masterSec = createSection(
    BP.unified ? '_' + BP.name + ' \u2014 Internal' : 'Masters / ' + BP.name,
    SECTION_W);

  /* Header bar — plain frame with absolute text */
  var mHeaderBar = figma.createFrame();
  mHeaderBar.name = 'tier1-header';
  mHeaderBar.resize(CARD_W, 96);
  mHeaderBar.cornerRadius = 0;
  mHeaderBar.fills = [];
  mHeaderBar.clipsContent = false;

  var mhBadge = createBadge('TIER 1', COLOR_PRIMARY_CONTAINER, COLOR_PRIMARY_CT);
  mHeaderBar.appendChild(mhBadge); mhBadge.x = 0; mhBadge.y = 8;
  var mhTitle = createLabel('Master Components', 26, true, COLOR_HEADING);
  mHeaderBar.appendChild(mhTitle); mhTitle.x = 0; mhTitle.y = 38;
  var mhDesc = createLabel('Structure + spacing \u00b7 Bound to comp-size variables \u00b7 No color (inherited from Tier 2)', 12, false, COLOR_BODY);
  mHeaderBar.appendChild(mhDesc); mhDesc.x = 0; mhDesc.y = 74;

  masterSec.section.appendChild(mHeaderBar);
  mHeaderBar.x = masterSec.innerX;
  mHeaderBar.y = masterSec.innerY;

  /* Bind master header to surface-bright tokens */
  if (t2Col && brightModeId) {
    try {
      mHeaderBar.setExplicitVariableModeForCollection(t2Col, brightModeId);
      tryBindFill(mhTitle, t2Vars['default/content/strong']);
      tryBindFill(mhDesc, t2Vars['default/content/default']);
    } catch (mhBindErr) {
      log('Master header binding skipped: ' + mhBindErr.message);
    }
  }
  /* Bind tier-1 badge to primary container tokens */
  if (t3Col && brandModeId) {
    try {
      mhBadge.setExplicitVariableModeForCollection(t3Col, brandModeId);
      tryBindFill(mhBadge, t3Vars['container/bg']);
      /* Bind badge label text */
      if (mhBadge.children.length > 0) tryBindFill(mhBadge.children[0], t3Vars['content/default']);
    } catch (e) {}
  }

  var masterFrame = figma.createFrame();
  masterFrame.name = BP.name + ' / Masters';
  masterFrame.fills = [];
  masterFrame.resize(600, 80);
  masterFrame.clipsContent = false;

  var masterComponents = {};
  /* masterNames already defined before hero section */

  /* Look up existing button masters by name on the Components page.
     Required for wrapper-with-button-instance kind (split-button reuses
     button masters as its action zone). Empty when generating button itself. */
  var buttonMasters = {};
  if (BP.kind === 'wrapper-with-button-instance') {
    var pageNodes = page.findAll(function(n) {
      return n.type === 'COMPONENT' && n.name && n.name.indexOf('mc / ') === 0;
    });
    for (var bmi = 0; bmi < pageNodes.length; bmi++) {
      buttonMasters[pageNodes[bmi].name.replace(/^mc \/ /, '')] = pageNodes[bmi];
    }
    log('Found ' + pageNodes.length + ' existing button masters: ' + Object.keys(buttonMasters).join(', '));
  }

  var _masterCursorX = 0; /* running x-offset, advances by each master's actual width */
  for (var mi = 0; mi < masterNames.length; mi++) {
    var masterName = masterNames[mi];
    var masterCfg = BP.masters[masterName];
    var slots = masterCfg.slots;

    /* ── Wrapper-with-button-instance branch (split-button) ──────
       Build a wrapper master that hosts a button-master instance + a
       chevron zone. Skips the slot-based construction below. */
    if (BP.kind === 'wrapper-with-button-instance') {
      var btnMasterName = masterCfg.buttonMaster;
      var btnMaster = buttonMasters[btnMasterName];
      if (!btnMaster) {
        var errMsg = 'Cannot build "' + masterName + '": button master "' + btnMasterName + '" not found. Generate Button component first.';
        log(errMsg);
        stats.errors.push(errMsg);
        continue;
      }

      /* Create wrapper master */
      var sbMaster = figma.createComponent();
      sbMaster.name = 'mc / ' + masterName;
      stampOwner(sbMaster);
      sbMaster.description = BP.description || '';
      sbMaster.resize(140, 32);
      sbMaster.layoutMode = 'HORIZONTAL';
      sbMaster.counterAxisAlignItems = 'CENTER';
      sbMaster.primaryAxisAlignItems = 'MIN';
      sbMaster.layoutSizingHorizontal = 'HUG';
      sbMaster.layoutSizingVertical = 'FIXED';
      sbMaster.fills = [];                /* color comes from variant */
      sbMaster.clipsContent = true;       /* clip inner zones at outer rounded corners (Q4) */
      sbMaster.itemSpacing = 0;
      sbMaster.paddingLeft = 0;
      sbMaster.paddingRight = 0;
      sbMaster.paddingTop = 0;
      sbMaster.paddingBottom = 0;

      /* Bind root size variables (height, 4 outer corners) */
      var sbRootBinds = BP.sizeBindings.root;
      var sbRootKeys = Object.keys(sbRootBinds);
      for (var sbrk = 0; sbrk < sbRootKeys.length; sbrk++) {
        var sbrv = compSizeVars[sbRootBinds[sbRootKeys[sbrk]]];
        if (sbrv) {
          await tryBindVar(sbMaster, sbRootKeys[sbrk], sbrv);
          stats.bindings++;
        }
      }

      /* ── Action zone: instance of the existing button master ──
         Same ordering rule as trigger: append first, then set sizing. */
      var actionInst = btnMaster.createInstance();
      actionInst.name = 'Action';
      /* Strip the button instance's stroke/fill so the wrapper's
         variant overrides become the visible color (single source). */
      try { actionInst.fills = []; } catch (e) {}
      try { actionInst.strokes = []; } catch (e) {}
      sbMaster.appendChild(actionInst);
      try { actionInst.layoutSizingHorizontal = 'HUG'; } catch (e) {}
      try { actionInst.layoutSizingVertical   = 'FIXED'; } catch (e) {}

      /* ── Trigger zone: chevron icon in a small frame with leftStroke = divider ──
         IMPORTANT: do NOT set layoutSizingVertical/Horizontal here — must be
         applied AFTER appendChild to parent, otherwise FIXED captures the
         default 100px height. We also bind 'height' explicitly to the
         button height token as a defensive measure. */
      var triggerZone = figma.createFrame();
      triggerZone.name = 'Trigger';
      triggerZone.layoutMode = 'HORIZONTAL';
      triggerZone.counterAxisAlignItems = 'CENTER';
      triggerZone.primaryAxisAlignItems = 'CENTER';
      triggerZone.fills = [];
      triggerZone.itemSpacing = 0;
      triggerZone.clipsContent = false;
      /* Pre-resize to button-default height so initial dimensions are sane
         before sizing modes are applied post-append. */
      triggerZone.resize(28, 32);

      /* Bind trigger zone padding */
      var triggerPadVar = compSizeVars[BP.sizeBindings.chevronWrapperPadL];
      if (triggerPadVar) {
        await tryBindVar(triggerZone, 'paddingLeft',  triggerPadVar);
        await tryBindVar(triggerZone, 'paddingRight', triggerPadVar);
        stats.bindings += 2;
      }

      /* Divider = 1px LEFT stroke on the trigger zone.
         Bind to T2 separator at master level. Brand-family variants will
         REBIND this stroke to the T3 separator at variant time so the
         divider tracks the variant's palette context. */
      var sepVar = t2Vars[BP.dividerColor.t2];
      if (sepVar) {
        setPaintBoundToVariable(triggerZone, 'strokes', sepVar);
        triggerZone.strokeWeight = 0;
        try {
          triggerZone.strokeLeftWeight   = 1;
          triggerZone.strokeRightWeight  = 0;
          triggerZone.strokeTopWeight    = 0;
          triggerZone.strokeBottomWeight = 0;
        } catch (e) { log('Per-edge stroke not supported: ' + e.message); }
        triggerZone.strokeAlign = 'INSIDE';
        stats.bindings++;
      }

      /* Chevron icon — instance of the icon placeholder.
         Same ordering rule: append first, then set FIXED sizing + bind size. */
      var chevronInst = triggerIconComp.createInstance();
      chevronInst.name = 'Chevron';
      triggerZone.appendChild(chevronInst);
      try { chevronInst.layoutSizingHorizontal = 'FIXED'; } catch (e) {}
      try { chevronInst.layoutSizingVertical   = 'FIXED'; } catch (e) {}
      var chevBinds = BP.sizeBindings.chevron;
      var chevKeys = Object.keys(chevBinds);
      for (var ck = 0; ck < chevKeys.length; ck++) {
        var chv = compSizeVars[chevBinds[chevKeys[ck]]];
        if (chv) {
          await tryBindVar(chevronInst, chevKeys[ck], chv);
          stats.bindings++;
        }
      }

      /* Append trigger zone to wrapper, THEN apply sizing + bind height. */
      sbMaster.appendChild(triggerZone);
      try { triggerZone.layoutSizingHorizontal = 'HUG'; } catch (e) {}
      try { triggerZone.layoutSizingVertical   = 'FIXED'; } catch (e) {}
      /* Defensive height bind: ensure trigger height tracks button height
         even if FIXED sizing somehow captured a stale value. */
      var btnHeightVar = compSizeVars[BP.sizeBindings.root.height];
      if (btnHeightVar) {
        await tryBindVar(triggerZone, 'height', btnHeightVar);
        stats.bindings++;
      }


      /* Component property: expose chevron as INSTANCE_SWAP so designers can
         replace it with a different icon (e.g. dots, ellipsis). */
      try {
        var chevSwapKey = sbMaster.addComponentProperty('Chevron icon', 'INSTANCE_SWAP', triggerIconComp.id);
        chevronInst.componentPropertyReferences = { mainComponent: chevSwapKey };
      } catch (e) { log('Chevron INSTANCE_SWAP property failed: ' + e.message); }

      /* Place into masterFrame and section */
      masterFrame.appendChild(sbMaster);
      sbMaster.x = mi * 360;
      sbMaster.y = 0;

      var sbMasterLabel = createLabel(masterName, 13, true, COLOR_HEADING);
      masterSec.section.appendChild(sbMasterLabel);
      sbMasterLabel.x = masterSec.innerX + mi * 360;
      sbMasterLabel.y = masterSec.innerY + mHeaderBar.height + 24;
      tryBindFill(sbMasterLabel, t2Vars['default/content/strong']);

      var sbMasterBadge = createBadge('action + chevron', COLOR_CM_BG, COLOR_DIMMED);
      masterSec.section.appendChild(sbMasterBadge);
      sbMasterBadge.x = masterSec.innerX + mi * 360 + sbMasterLabel.width + 12;
      sbMasterBadge.y = masterSec.innerY + mHeaderBar.height + 22;
      tryBindFill(sbMasterBadge, t2Vars['default/component/bg']);
      if (sbMasterBadge.children.length > 0) tryBindFill(sbMasterBadge.children[0], t2Vars['default/content/subtle']);

      masterComponents[masterName] = sbMaster;
      log('Created split-button master: ' + masterName + ' (action=' + btnMasterName + ')');
      continue; /* skip the slot-based construction below */
    }

    /* ── Track-Thumb branch (kind: 'track-thumb', e.g. Toggle) ──────────────
       Root frame IS the track: fixed-size pill, layoutMode=NONE, clips content.
       Thumb is an absolutely-positioned circle child.
       sizeBindings.root   → track frame dimensions + radius
       sizeBindings.thumb  → thumb dimensions + radius
       sizeBindings.thumbY → Y centering offset (comp-size var)
       masterCfg.thumbXVar → X off-position offset (comp-size var) */
    if (BP.kind === 'track-thumb') {
      /* isLabeled masters don't need a physical master component — labeled
         variants are built directly in the variant loop (no instance of a
         master). Register null and skip all master-section work. */
      if (masterCfg.isLabeled) {
        masterComponents[masterName] = null;
        continue;
      }
      var ttMaster = figma.createComponent();
      ttMaster.name = 'mc / ' + masterName;
      stampOwner(ttMaster);
      ttMaster.description = BP.description || '';

      /* Default dimensions (base mode values; variables override at render) */
      var ttW = 40, ttH = 24;
      ttMaster.resize(ttW, ttH);
      ttMaster.layoutMode = 'NONE';       /* absolute positioning for thumb */
      ttMaster.clipsContent = true;       /* thumb stays within track bounds */
      ttMaster.fills = [];                /* fill comes from variant override */
      ttMaster.strokes = [];

      /* Bind track frame dimensions and radius to comp-size variables */
      var ttRootBinds = BP.sizeBindings.root;
      var ttRootKeys = Object.keys(ttRootBinds);
      for (var ttrk = 0; ttrk < ttRootKeys.length; ttrk++) {
        var ttrv = compSizeVars[ttRootBinds[ttRootKeys[ttrk]]];
        if (ttrv) { await tryBindVar(ttMaster, ttRootKeys[ttrk], ttrv); stats.bindings++; }
      }

      /* Thumb — absolutely positioned circle */
      var ttThumb = figma.createFrame();
      ttThumb.name = 'Thumb';
      ttThumb.resize(20, 20); /* default base; variables override */
      ttThumb.layoutMode = 'NONE';
      ttThumb.cornerRadius = 9999;
      /* Fixed white fill (--color-fixed-white; immune to theme changes) */
      ttThumb.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
      ttThumb.strokes = [];
      /* Drop shadow — elevated thumb appearance matching reference design.
         Two-layer shadow: soft ambient + tighter directional lift. */
      ttThumb.effects = [
        { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.22 },
          offset: { x: 0, y: 2 }, radius: 6, spread: 0, visible: true, blendMode: 'NORMAL' },
        { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.10 },
          offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true, blendMode: 'NORMAL' }
      ];

      /* Bind thumb width + height only — skip individual corner radius keys.
         CORNER_RADIUS-scoped bindings on the thumb silently block x/y binding
         (same mechanism as the ON master track issue). Bind position first,
         cornerRadius last. */
      var ttThumbBinds = BP.sizeBindings.thumb;
      var ttThumbKeys = Object.keys(ttThumbBinds);
      var _ttCRKeys = { topLeftRadius:1, topRightRadius:1, bottomLeftRadius:1, bottomRightRadius:1 };
      for (var tthk = 0; tthk < ttThumbKeys.length; tthk++) {
        var _tthKey = ttThumbKeys[tthk];
        if (_ttCRKeys[_tthKey]) continue; /* radius bound uniformly after x/y below */
        var tthv = compSizeVars[ttThumbBinds[_tthKey]];
        if (tthv) { await tryBindVar(ttThumb, _tthKey, tthv); stats.bindings++; }
      }

      /* Track corner radius — on the track frame, not the thumb. */
      if (masterCfg.rootRadiusPath) {
        var ttRootRadVar = compSizeVars[masterCfg.rootRadiusPath];
        if (ttRootRadVar) {
          var ttRRKeys = ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'];
          for (var trrk = 0; trrk < ttRRKeys.length; trrk++) {
            if (await tryBindVar(ttMaster, ttRRKeys[trrk], ttRootRadVar)) stats.bindings++;
          }
        }
      }

      /* Append thumb and bind position BEFORE cornerRadius.
         Binding order is critical: x/y fail when the same frame already has
         CORNER_RADIUS-scoped variable bindings. Set position first, radius last. */
      ttMaster.appendChild(ttThumb);
      ttThumb.x = 2; /* literal fallback — overridden by variable binding below */
      ttThumb.y = 2;
      var ttThumbXVar = masterCfg.thumbXVar && compSizeVars[masterCfg.thumbXVar];
      var ttThumbYVar = BP.sizeBindings.thumbY && compSizeVars[BP.sizeBindings.thumbY];
      if (ttThumbXVar) { await tryBindVar(ttThumb, 'x', ttThumbXVar); stats.bindings++; }
      if (ttThumbYVar) { await tryBindVar(ttThumb, 'y', ttThumbYVar); stats.bindings++; }

      /* Thumb cornerRadius (uniform) — bound last so x/y bindings are uncontested.
         Square: toggle/thumb-radius-square. Pill: toggle/radius (9999). */
      var _ttThCRV = masterCfg.thumbRadiusPath
          ? compSizeVars[masterCfg.thumbRadiusPath]
          : compSizeVars[ttThumbBinds['topLeftRadius']];
      if (_ttThCRV) { await tryBindVar(ttThumb, 'cornerRadius', _ttThCRV); stats.bindings++; }

      /* Place into master frame section */
      masterFrame.appendChild(ttMaster);
      ttMaster.x = _masterCursorX;
      ttMaster.y = 0;

      var ttMasterLabel = createLabel(masterName, 13, true, COLOR_HEADING);
      masterSec.section.appendChild(ttMasterLabel);
      ttMasterLabel.x = masterSec.innerX + _masterCursorX;
      ttMasterLabel.y = masterSec.innerY + mHeaderBar.height + 24;
      tryBindFill(ttMasterLabel, t2Vars['default/content/strong']);

      var ttMasterBadge = createBadge('track \u00b7 thumb', COLOR_CM_BG, COLOR_DIMMED);
      masterSec.section.appendChild(ttMasterBadge);
      ttMasterBadge.x = masterSec.innerX + _masterCursorX;
      ttMasterBadge.y = masterSec.innerY + mHeaderBar.height + 24 + 20;
      tryBindFill(ttMasterBadge, t2Vars['default/component/bg']);
      if (ttMasterBadge.children.length > 0) tryBindFill(ttMasterBadge.children[0], t2Vars['default/content/subtle']);

      var _ttColW = Math.max(ttMasterLabel.width, ttMasterBadge.width, ttMaster.width);
      _masterCursorX += _ttColW + 48;
      masterComponents[masterName] = ttMaster;
      log('Created track-thumb master: ' + masterName + ' (thumbX=' + masterCfg.thumbXVar + ')');

      /* ── ON master — HORIZONTAL auto-layout, thumb right-aligned ─────────────
         Binding 'x' via setBoundVariable on a component child is unreliable in
         Figma: it silently fails for some variable types (e.g. FLOAT variables
         with CORNER_RADIUS scope on neighbouring properties). The fix: use
         HORIZONTAL auto-layout with primaryAxisAlignItems='MAX' so the thumb is
         pushed to the right edge by the layout engine itself. paddingRight is
         bound to toggle/thumb-inset (a GAP-scoped variable — a safe binding).
         thumb.x never needs to be set or bound; the layout computes it.          */
      var _onM = figma.createComponent();
      _onM.name = 'mc / ' + masterName + ' [On]';
      stampOwner(_onM);
      _onM.description = ttMaster.description;
      _onM.resize(ttW, ttH);
      _onM.layoutMode = 'HORIZONTAL';
      _onM.primaryAxisAlignItems = 'MAX';    /* push thumb to right edge */
      _onM.counterAxisAlignItems = 'CENTER'; /* vertically centred */
      _onM.layoutSizingHorizontal = 'FIXED'; /* track-w from variable */
      _onM.layoutSizingVertical   = 'FIXED'; /* track-h from variable */
      _onM.clipsContent = true;
      _onM.fills = [];
      _onM.strokes = [];
      _onM.paddingLeft   = 0;
      _onM.paddingTop    = 0;
      _onM.paddingBottom = 0;
      _onM.paddingRight  = 2; /* literal fallback; bound below */
      _onM.itemSpacing   = 0;
      /* Bind track width and height only (skip individual radius keys —
         topLeftRadius/topRightRadius/etc. can silently fail on HORIZONTAL
         auto-layout components; cornerRadius uniform binding used below). */
      for (var _onrk = 0; _onrk < ttRootKeys.length; _onrk++) {
        var _onrKey = ttRootKeys[_onrk];
        if (_onrKey === 'topLeftRadius' || _onrKey === 'topRightRadius' ||
            _onrKey === 'bottomLeftRadius' || _onrKey === 'bottomRightRadius') continue;
        var _onrv = compSizeVars[ttRootBinds[_onrKey]];
        if (_onrv) { await tryBindVar(_onM, _onrKey, _onrv); stats.bindings++; }
      }
      /* Bind corner radius uniformly — more reliable than individual corners on
         auto-layout. Square: toggle/radius-square. Pill: toggle/radius (9999). */
      var _onCRV = masterCfg.rootRadiusPath
          ? compSizeVars[masterCfg.rootRadiusPath]
          : compSizeVars[ttRootBinds['topLeftRadius']]; /* e.g. toggle/radius-square */
      if (_onCRV) { await tryBindVar(_onM, 'cornerRadius', _onCRV); stats.bindings++; }
      /* Bind right-side inset to toggle/thumb-inset. Auto-layout positions the
         thumb at (track-w − thumb-size − paddingRight) without any x binding. */
      var _onInsetVar = compSizeVars['toggle/thumb-inset'];
      if (_onInsetVar) { await tryBindVar(_onM, 'paddingRight', _onInsetVar); stats.bindings++; }

      /* ON thumb — same size/radius as OFF thumb; position driven by layout */
      var _onTh = figma.createFrame();
      _onTh.name = 'Thumb';
      _onTh.resize(20, 20);
      _onTh.layoutMode = 'NONE';
      _onTh.layoutSizingHorizontal = 'FIXED'; /* fixed child in auto-layout */
      _onTh.layoutSizingVertical   = 'FIXED';
      _onTh.cornerRadius = 9999;
      _onTh.fills  = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
      _onTh.strokes = [];
      _onTh.effects = ttThumb.effects.slice();
      /* ON thumb — bind width/height only (skip individual corner keys, same
         cornerRadius-last strategy as OFF master thumb). x/y not needed here —
         HORIZONTAL auto-layout positions the thumb via MAX-alignment + paddingRight. */
      for (var _onthk = 0; _onthk < ttThumbKeys.length; _onthk++) {
        var _onThKey = ttThumbKeys[_onthk];
        if (_ttCRKeys[_onThKey]) continue;
        var _onthv = compSizeVars[ttThumbBinds[_onThKey]];
        if (_onthv) { await tryBindVar(_onTh, _onThKey, _onthv); stats.bindings++; }
      }
      /* Thumb cornerRadius — Square: toggle/thumb-radius-square. Pill: toggle/radius (9999). */
      var _onThCRV = masterCfg.thumbRadiusPath
          ? compSizeVars[masterCfg.thumbRadiusPath]
          : compSizeVars[ttThumbBinds['topLeftRadius']];
      if (_onThCRV) { await tryBindVar(_onTh, 'cornerRadius', _onThCRV); stats.bindings++; }
      _onM.appendChild(_onTh);

      /* Place ON master in the master-section display */
      masterFrame.appendChild(_onM);
      _onM.x = _masterCursorX;
      _onM.y = 0;
      /* [On] masters are internal positioning helpers — dim them in Tier 1
         so they don't visually compete with the user-facing OFF masters. */
      var _onLbl = createLabel(masterName + ' \u00b7 On pos.', 11, false, COLOR_DIMMED);
      masterSec.section.appendChild(_onLbl);
      _onLbl.x = masterSec.innerX + _masterCursorX;
      _onLbl.y = masterSec.innerY + mHeaderBar.height + 24;
      tryBindFill(_onLbl, t2Vars['default/content/subtle']);
      var _onBdg = createBadge('internal', COLOR_CM_BG, COLOR_DIMMED);
      masterSec.section.appendChild(_onBdg);
      _onBdg.x = masterSec.innerX + _masterCursorX;
      _onBdg.y = masterSec.innerY + mHeaderBar.height + 24 + 18;
      tryBindFill(_onBdg, t2Vars['default/component/bg']);
      if (_onBdg.children.length > 0) tryBindFill(_onBdg.children[0], t2Vars['default/content/subtle']);
      var _onColW = Math.max(_onLbl.width, _onBdg.width, _onM.width);
      _masterCursorX += _onColW + 48;
      masterComponents[masterName + '_on'] = _onM;
      log('Created ON track-thumb master: ' + masterName + ' [On]');
      continue; /* skip generic slot-based construction below */
    }

    /* Create master component */
    var master = figma.createComponent();
    master.name = 'mc / ' + masterName;
    stampOwner(master);
    master.description = BP.description || '';
    master.resize(120, 32);
    master.layoutMode = 'HORIZONTAL';
    master.counterAxisAlignItems = 'CENTER';
    master.primaryAxisAlignItems = masterCfg.rootPAlign || 'MIN';

    /* Icon Button is always square — FIXED on both axes so width = height
       (bound to icon-button/default/size). Regular buttons HUG horizontally. */
    var isIconOnlyMaster = (masterName === 'Icon Button');
    master.layoutSizingHorizontal = isIconOnlyMaster ? 'FIXED' : 'HUG';
    master.layoutSizingVertical = 'FIXED';
    master.fills = []; /* NO fill on master — color comes from variant */
    master.clipsContent = false;

    /* No root gap — icon wrapper's right padding provides visual spacing
       between icon and text. Root itemSpacing is always 0. */
    master.itemSpacing = 0;

    /* Bind root size variables (height, radius).
       Icon Button uses iconBtnSizeBindings (width+height from icon-button/size,
       icon from icon-button/icon container) so values are in sync with
       icon-button.tokens.css — not button.tokens.css icon sizes. */
    var activeSizeBindings = (isIconOnlyMaster && BP.iconBtnSizeBindings)
      ? BP.iconBtnSizeBindings
      : BP.sizeBindings;
    var rootBinds = activeSizeBindings.root;
    var rootKeys = Object.keys(rootBinds);
    for (var rk = 0; rk < rootKeys.length; rk++) {
      var rv = compSizeVars[rootBinds[rootKeys[rk]]];
      if (rv) {
        await tryBindVar(master, rootKeys[rk], rv);
        stats.bindings++;
      }
    }

    /* Track whether this master has an icon (for INSTANCE_SWAP property) */
    var hasIcon = false;
    var chevronInstRef = null; /* set by chevronSlot handler; used for INSTANCE_SWAP wiring */

    /* ── Create children based on slot definitions ──
       Padding rules:
         - Icon wrapper: ALWAYS bind both padL + padR (its padR = gap between icon & text)
         - Text wrapper: padR always, padL only when it's the sole slot (text-only button)
         - Root itemSpacing = 0 — no gap between wrappers */
    for (var si = 0; si < slots.length; si++) {
      var slot = slots[si];
      var isFirstSlot = (si === 0);

      if (slot === 'iconWrapper') {
        hasIcon = true;

        /* ── Icon Wrapper Container ── */
        var iconWrapper = figma.createFrame();
        iconWrapper.name = 'Icon wrapper cont';
        iconWrapper.layoutMode = 'HORIZONTAL';
        iconWrapper.counterAxisAlignItems = 'CENTER';
        iconWrapper.primaryAxisAlignItems = masterCfg.iconWrapperPAlign || 'MIN';
        iconWrapper.fills = [];
        iconWrapper.itemSpacing = 0;

        /* For icon+text buttons: HUG×HUG with L/R padding tokens.
           For icon-only buttons: FILL×FILL — center the icon within the
           full master bounds so there's no wrapper boundary cutting through
           the component. Sizing must be set AFTER appendChild (same rule as
           instances — Figma requires parent context to accept FILL sizing). */
        var isOnlySlot = (slots.length === 1);
        if (!isOnlySlot) {
          iconWrapper.layoutSizingHorizontal = 'HUG';
          iconWrapper.layoutSizingVertical   = 'HUG';
          /* Bind L/R padding: padR is either icon-to-text gap or symmetric iconPad */
          var iwPadLVar = compSizeVars[BP.sizeBindings.iconWrapperPadL];
          if (iwPadLVar) { await tryBindVar(iconWrapper, 'paddingLeft', iwPadLVar); stats.bindings++; }
          var iwPadRVar = compSizeVars[BP.sizeBindings.iconWrapperPadR];
          if (iwPadRVar) { await tryBindVar(iconWrapper, 'paddingRight', iwPadRVar); stats.bindings++; }
        } else {
          /* Icon-only: center alignment — padding is provided by the gap
             between icon instance and wrapper edge, not by explicit tokens. */
          iconWrapper.primaryAxisAlignItems  = 'CENTER';
          iconWrapper.counterAxisAlignItems  = 'CENTER';
          /* FILL sizing applied after appendChild below */
        }

        /* ── Icon Instance (INSTANCE of placeholder component) ──
           ORDERING: append to parent BEFORE setting FIXED sizing or binding
           width/height variables — Figma requires an auto-layout context to
           accept dimension variable bindings on instance nodes (same rule as
           trigger zone in split-button). */
        var iconInst = iconPlaceholder.createInstance();
        iconInst.name = iconPlaceholder.name;

        /* Append both nodes to establish parent context before sizing */
        iconWrapper.appendChild(iconInst);
        master.appendChild(iconWrapper);

        /* Now safe to set sizing on iconWrapper (FILL needs parent context) */
        if (isOnlySlot) {
          iconWrapper.layoutSizingHorizontal = 'FILL';
          iconWrapper.layoutSizingVertical   = 'FILL';
        }

        /* Now safe to set FIXED sizing and bind dimension variables on iconInst */
        iconInst.layoutSizingHorizontal = 'FIXED';
        iconInst.layoutSizingVertical = 'FIXED';

        /* Bind icon instance size to comp-size variables.
           For Icon Button, activeSizeBindings.icon points to
           icon-button/default/icon container (18px at base, not 16px). */
        var iconBinds = activeSizeBindings.icon;
        var iconKeys = Object.keys(iconBinds);
        for (var iik = 0; iik < iconKeys.length; iik++) {
          var iiv = compSizeVars[iconBinds[iconKeys[iik]]];
          if (iiv) {
            await tryBindVar(iconInst, iconKeys[iik], iiv);
            stats.bindings++;
          }
        }
      }

      if (slot === 'textWrapper') {
        /* ── Text Wrapper Container ── */
        var textWrapper = figma.createFrame();
        textWrapper.name = 'text wrapper cont';
        textWrapper.layoutMode = 'HORIZONTAL';
        textWrapper.counterAxisAlignItems = 'CENTER';
        textWrapper.primaryAxisAlignItems = 'CENTER';
        textWrapper.layoutSizingHorizontal = 'HUG';
        textWrapper.layoutSizingVertical = 'HUG';
        textWrapper.fills = [];
        textWrapper.itemSpacing = 0;

        /* Text wrapper: padR always, padL only when text is the sole slot
           (text-only button needs left padding; icon+text button does not
            because the icon wrapper's right padding provides spacing). */
        if (isFirstSlot) {
          var twPadLVar = compSizeVars[BP.sizeBindings.textWrapperPadL];
          if (twPadLVar) { await tryBindVar(textWrapper, 'paddingLeft', twPadLVar); stats.bindings++; }
        }
        var twPadRVar = compSizeVars[BP.sizeBindings.textWrapperPadR];
        if (twPadRVar) { await tryBindVar(textWrapper, 'paddingRight', twPadRVar); stats.bindings++; }

        /* Text node */
        var textNode = figma.createText();
        textNode.name = 'text button';
        textNode.fontName = fontName;
        textNode.characters = 'Button';
        textNode.fontSize = 14;
        textNode.lineHeight = { unit: 'AUTO' };
        textNode.textAlignHorizontal = 'LEFT';
        textNode.textAlignVertical = 'CENTER';
        textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
        textNode.leadingTrim = 'NONE';
        textNode.layoutAlign = 'INHERIT';

        /* Content color on text */
        var textContentVar = t2Vars[BP.masterContentColor];
        if (textContentVar) {
          setPaintBoundToVariable(textNode, 'fills', textContentVar);
          stats.bindings++;
        }

        /* Bind font size from comp-size */
        var textBinds = BP.sizeBindings.text;
        var textKeys = Object.keys(textBinds);
        for (var txk = 0; txk < textKeys.length; txk++) {
          var txv = compSizeVars[textBinds[textKeys[txk]]];
          if (txv) {
            await tryBindVar(textNode, textKeys[txk], txv);
            stats.bindings++;
          }
        }

        /* Bind typography variables to text node (font-family, font-style, line-height, letter-spacing).
           Button text is body-level — bind to font-family/body, not headline. */
        if (typoVars['font-family/body']) {
          await tryBindVar(textNode, 'fontFamily', typoVars['font-family/body']);
          stats.bindings++;
        }
        if (typoVars['font-style/default']) {
          await tryBindVar(textNode, 'fontStyle', typoVars['font-style/default']);
          stats.bindings++;
        }
        if (typoVars['line-height/base']) {
          await tryBindVar(textNode, 'lineHeight', typoVars['line-height/base']);
          stats.bindings++;
        }
        if (typoVars['letter-spacing/normal']) {
          await tryBindVar(textNode, 'letterSpacing', typoVars['letter-spacing/normal']);
          stats.bindings++;
        }

        textWrapper.appendChild(textNode);
        master.appendChild(textWrapper);
      }

      if (slot === 'chevronSlot') {
        /* ── Chevron Slot Container ──
           Menu-button's always-present trailing disclosure icon.
           Root frame owns padding/gap so this wrapper has zero padding. */
        var chevSlotFrame = figma.createFrame();
        chevSlotFrame.name = 'Chevron cont';
        chevSlotFrame.layoutMode = 'HORIZONTAL';
        chevSlotFrame.counterAxisAlignItems = 'CENTER';
        chevSlotFrame.primaryAxisAlignItems = 'CENTER';
        chevSlotFrame.layoutSizingHorizontal = 'HUG';
        chevSlotFrame.layoutSizingVertical = 'HUG';
        chevSlotFrame.fills = [];
        chevSlotFrame.itemSpacing = 0;

        /* Chevron icon — instance of chevron icon component (or icon placeholder).
           ORDERING: append to parent BEFORE setting FIXED sizing or binding
           width/height variables — Figma requires auto-layout context. */
        var chevSlotInst = triggerIconComp.createInstance();
        chevSlotInst.name = 'Chevron';
        chevSlotFrame.appendChild(chevSlotInst);
        master.appendChild(chevSlotFrame);

        /* Now safe to set FIXED sizing and bind dimension variables */
        try { chevSlotInst.layoutSizingHorizontal = 'FIXED'; } catch (e) {}
        try { chevSlotInst.layoutSizingVertical   = 'FIXED'; } catch (e) {}

        /* Bind chevron icon dimensions to comp-size variables. */
        var chevSlotBinds = activeSizeBindings.chevronSlot;
        if (chevSlotBinds) {
          var chevSlotKeys = Object.keys(chevSlotBinds);
          for (var csk = 0; csk < chevSlotKeys.length; csk++) {
            var csvv = compSizeVars[chevSlotBinds[chevSlotKeys[csk]]];
            if (csvv) {
              await tryBindVar(chevSlotInst, chevSlotKeys[csk], csvv);
              stats.bindings++;
            }
          }
        }

        /* Bind trailing-edge padding to the chevron slot WRAPPER frame.
           chevron-pe gives the button its right breathing room. Done on the
           wrapper (not root) to match the wrapper-based pattern used by button
           and to avoid relying on itemSpacing variable binding on the root. */
        var chevWrapPadRVar = compSizeVars[activeSizeBindings.chevronWrapperPadR];
        if (chevWrapPadRVar) {
          await tryBindVar(chevSlotFrame, 'paddingRight', chevWrapPadRVar);
          stats.bindings++;
        }

        chevronInstRef = chevSlotInst;
      }
    }

    /* ── Add component properties on the MASTER ──
       Properties added here propagate through all instances automatically.
       INSTANCE_SWAP for icon + TEXT for label. */
    if (hasIcon) {
      var swapPropKey = master.addComponentProperty('Icon', 'INSTANCE_SWAP', iconPlaceholder.id);
      /* Wire the icon instance to this swap property.
         Must be done BEFORE the master is instanced. */
      var iconInstInMaster = master.findOne(function(n) { return n.type === 'INSTANCE'; });
      if (iconInstInMaster) {
        iconInstInMaster.componentPropertyReferences = { mainComponent: swapPropKey };
        log('Wired INSTANCE_SWAP on ' + masterName + ' → key: ' + swapPropKey);
      }
    }

    /* TEXT property for label — wire to text node inside the master */
    var hasText = masterCfg.slots.indexOf('textWrapper') !== -1;
    if (hasText) {
      var textPropKey = master.addComponentProperty('label', 'TEXT', 'Button');
      var textInMaster = master.findOne(function(n) { return n.type === 'TEXT' && n.name === 'text button'; });
      if (textInMaster) {
        textInMaster.componentPropertyReferences = { characters: textPropKey };
        log('Wired TEXT property on ' + masterName + ' → key: ' + textPropKey);
      }
    }

    /* INSTANCE_SWAP for chevron icon — allows designers to swap chevron glyph. */
    if (chevronInstRef) {
      try {
        var chevSwapPropKey = master.addComponentProperty('Chevron icon', 'INSTANCE_SWAP', triggerIconComp.id);
        chevronInstRef.componentPropertyReferences = { mainComponent: chevSwapPropKey };
        log('Wired Chevron INSTANCE_SWAP on ' + masterName + ' → key: ' + chevSwapPropKey);
      } catch (e) {
        log('Chevron INSTANCE_SWAP failed on ' + masterName + ': ' + e.message);
      }
    }

    masterFrame.appendChild(master);
    /* Position inside invisible frame (for Figma component panel) */
    master.x = _masterCursorX;
    master.y = 0;

    /* Simple label for this master — positioned directly above it */
    var masterLabel = createLabel(masterName, 13, true, COLOR_HEADING);
    masterSec.section.appendChild(masterLabel);
    masterLabel.x = masterSec.innerX + _masterCursorX;
    masterLabel.y = masterSec.innerY + mHeaderBar.height + 24;
    tryBindFill(masterLabel, t2Vars['default/content/strong']);

    var masterSlotBadge = createBadge(masterCfg.slots.join(' + '), COLOR_CM_BG, COLOR_DIMMED);
    masterSec.section.appendChild(masterSlotBadge);
    masterSlotBadge.x = masterSec.innerX + _masterCursorX;
    masterSlotBadge.y = masterSec.innerY + mHeaderBar.height + 24 + 20;
    tryBindFill(masterSlotBadge, t2Vars['default/component/bg']);
    if (masterSlotBadge.children.length > 0) tryBindFill(masterSlotBadge.children[0], t2Vars['default/content/subtle']);

    /* Advance cursor by the widest of: label, badge, or master component — plus gap */
    var _colW = Math.max(masterLabel.width, masterSlotBadge.width, master.width);
    _masterCursorX += _colW + 48;

    masterComponents[masterName] = master;
    log('Created master: ' + masterName + ' (' + master.children.length + ' children)');
  }

  /* Resize master frame to fit its children (invisible, just for component panel) */
  var mfMaxX = 0, mfMaxY = 0;
  for (var mfi = 0; mfi < masterFrame.children.length; mfi++) {
    var mc = masterFrame.children[mfi];
    var mcR = mc.x + mc.width;
    var mcB = mc.y + mc.height;
    if (mcR > mfMaxX) mfMaxX = mcR;
    if (mcB > mfMaxY) mfMaxY = mcB;
  }
  try { masterFrame.resize(mfMaxX + 40, mfMaxY + 20); } catch (e) {}

  /* Place master frame in section (below header + single label row) */
  var masterFrameY = masterSec.innerY + mHeaderBar.height + 24 + 20 + 24 + 16; /* header + label + badge + gap */
  masterSec.section.appendChild(masterFrame);
  masterFrame.x = masterSec.innerX;
  masterFrame.y = masterFrameY;

  /* Expand section width if master columns exceed the state-based minimum */
  var _mastersTotalW = masterSec.innerX + _masterCursorX - 48 + masterSec.innerX; /* last gap removed */
  if (_mastersTotalW > SECTION_W) SECTION_W = _mastersTotalW;

  var masterSecH = masterFrameY + masterFrame.height + 40;
  try { masterSec.section.resize(SECTION_W, masterSecH); } catch (e) {}
  page.appendChild(masterSec.section);
  masterSec.section.x = PAGE_X;
  masterSec.section.y = cursorY;
  cursorY += masterSecH + SECTION_GAP;

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     PRESENTATION: Tier 2 — Variant Component Sets (absolute positioning)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  figma.ui.postMessage({ type: 'gen-progress', text: 'Building variant components…' });

  var allComponentSets = [];

  var variantSec = createSection(
    BP.unified ? BP.name : 'Variants / ' + BP.name,
    SECTION_W);

  /* Header bar — plain frame, absolute children */
  var vHeaderBar = figma.createFrame();
  vHeaderBar.name = 'tier2-header';
  vHeaderBar.resize(CARD_W, 96);
  vHeaderBar.cornerRadius = 0;
  vHeaderBar.fills = [];
  vHeaderBar.clipsContent = false;

  var vhBadge = createBadge('TIER 2', COLOR_SUCCESS_CONTAINER, COLOR_SUCCESS_CT);
  vHeaderBar.appendChild(vhBadge); vhBadge.x = 0; vhBadge.y = 8;
  var vhTitle = createLabel('Variant Component Sets', 26, true, COLOR_HEADING);
  vHeaderBar.appendChild(vhTitle); vhTitle.x = 0; vhTitle.y = 38;
  var vhDesc = createLabel('Color + state overrides \u00b7 Each variant wraps a Tier 1 master instance with token-bound fills, strokes, and content colors', 12, false, COLOR_BODY);
  vHeaderBar.appendChild(vhDesc); vhDesc.x = 0; vhDesc.y = 74;

  variantSec.section.appendChild(vHeaderBar);
  vHeaderBar.x = variantSec.innerX;
  vHeaderBar.y = variantSec.innerY;

  /* Bind variant header to surface-bright tokens */
  if (t2Col && brightModeId) {
    try {
      vHeaderBar.setExplicitVariableModeForCollection(t2Col, brightModeId);
      tryBindFill(vhTitle, t2Vars['default/content/strong']);
      tryBindFill(vhDesc, t2Vars['default/content/default']);
    } catch (vhBindErr) {
      log('Variant header binding skipped: ' + vhBindErr.message);
    }
  }
  /* Bind tier-2 badge to success container tokens */
  if (t3Col && t3Modes['success']) {
    try {
      vhBadge.setExplicitVariableModeForCollection(t3Col, t3Modes['success']);
      tryBindFill(vhBadge, t3Vars['container/bg']);
      if (vhBadge.children.length > 0) tryBindFill(vhBadge.children[0], t3Vars['content/default']);
    } catch (e) {}
  }

  var varSecContentY = variantSec.innerY + vHeaderBar.height + 24;

  /* Unified blueprint: shared variant accumulator across ALL master iterations.
     All 4 masters (Switch, Switch/Pill, Switch/Labeled, Switch/Pill/Labeled)
     contribute to a SINGLE "Switch" component set with Pill=On|Off + Label=On|Off axes.
     _unifiedVarMap is pre-built once from the existing set (SAFE_REBUILD)
     and consumed during variant creation; survivors are stale and get pruned. */
  var _unifiedComps = BP.unified ? [] : null;
  var _unifiedVarMap = {};
  if (BP.unified && SAFE_REBUILD) {
    var _uPreSet = reuseSetByName[BP.name];
    /* Semantic-ID fallback: if BP.name changed or section was renamed,
       find via dtf-set-id and align reuseSetByName so _uReuseTarget works. */
    if (!_uPreSet && reuseSetBySemanticId) {
      var _uPreSem = reuseSetBySemanticId['dtf::' + BP.name];
      if (_uPreSem && !_uPreSem.removed) {
        _uPreSet = _uPreSem;
        reuseSetByName[BP.name] = _uPreSem;
        log('SAFE_REBUILD: aligned unified "' + BP.name + '" via semantic ID');
      }
    }
    if (_uPreSet && !_uPreSet.removed) {
      /* Snapshot children — iterating live array while removing breaks indices. */
      var _uKids = Array.prototype.slice.call(_uPreSet.children || []);
      for (var _uki = 0; _uki < _uKids.length; _uki++) {
        var _uk = _uKids[_uki];
        if (!_uk || _uk.type !== 'COMPONENT') continue;
        /* Key by CANONICAL sorted axes so axis reordering never breaks
           the name-match lookup (e.g. "Pill=Off,State=Off,Type=Fill"
           and "State=Off,Type=Fill,Pill=Off" → same canonical key). */
        var _ukCK = _uk.name.split(/,\s*/).sort().join('|');
        if (_unifiedVarMap[_ukCK]) {
          /* Duplicate canonical key — remove the extra copy now. */
          try { _uk.remove(); } catch (_udupe) { /* already gone */ }
        } else {
          _unifiedVarMap[_ukCK] = _uk;
        }
      }
      log('SAFE_REBUILD unified: ' + Object.keys(_unifiedVarMap).length + ' existing variants for "' + BP.name + '"');
    }
  }

  for (var mci = 0; mci < masterNames.length; mci++) {
    var mName = masterNames[mci];
    var masterCfg = BP.masters[mName]; /* re-read per master — builder loop used a separate iterator */
    var masterComp = masterComponents[mName];

    /* singleFamily: ALL families share one component array + one _existingVarMap
       per master.  We accumulate across families and run combineAsVariants ONCE.
       Without this, the second family's SAFE_REBUILD prune removes the first
       family's Neutral-only types (Filled/Outlined/Fill&Outline/Ghost-Selected).
       _sfComponentsMap deduplicates shared type names (e.g. Ghost) — first family wins.
       _sfAllTypes/_sfAllStates union all families so the grid layout covers every row/col. */
    var _sfComponents     = BP.singleFamily ? [] : null;
    var _sfComponentsMap  = BP.singleFamily ? {} : null; /* name → true; first-family-wins dedup */
    var _sfAllTypes       = BP.singleFamily ? [] : null; /* merged type list for grid layout */
    var _sfAllStates      = BP.singleFamily ? [] : null; /* merged state list for grid layout */
    var _sfVarMap         = null; /* built once from pre-existing set, shared across families */
    var _sfVarMapBuilt    = false;

    /* Iterate FAMILIES (Neutral, Brand, …) — each produces its own component set. */
    var familyNames = Object.keys(BP.families);
    for (var famI = 0; famI < familyNames.length; famI++) {
      var familyName = familyNames[famI];
      var family = BP.families[familyName];
      var famTypes = family.types;
      var famStates;          /* state name array */
      var famOverrides;       /* { type: { state: overridesObj } } */
      var famT3ModeId = (family.t3Mode && t3Modes[family.t3Mode]) ? t3Modes[family.t3Mode] : null;

      /* Two blueprint shapes:
         - Legacy flat (button): family.states + family.stateOverrides
         - Wrapper-with-zones (split-button): BP.states + family.typeSpecs
           Expand typeSpecs to per-zone overrides matching the 8-state axis. */
      if (BP.kind === 'wrapper-with-button-instance' && family.typeSpecs) {
        famStates = BP.states;
        famOverrides = expandTypeSpecsToZoneOverrides(family.typeSpecs, BP.states);
      } else {
        famStates = family.states;
        famOverrides = family.stateOverrides;
      }

      /* singleFamily: accumulate merged types/states for grid layout. */
      if (BP.singleFamily) {
        for (var _sfti = 0; _sfti < famTypes.length; _sfti++) {
          if (_sfAllTypes.indexOf(famTypes[_sfti]) === -1) _sfAllTypes.push(famTypes[_sfti]);
        }
        for (var _sfsi = 0; _sfsi < famStates.length; _sfsi++) {
          if (_sfAllStates.indexOf(famStates[_sfsi]) === -1) _sfAllStates.push(famStates[_sfsi]);
        }
      }

      var setDisplayName = BP.unified
        ? BP.name
        : (BP.singleFamily ? mName : (BP.name + ' / ' + familyName + ' / ' + mName));

      /* Unified blueprints: all masters share a single components array and a
         single pre-built _existingVarMap (populated from the "Switch" set above).
         singleFamily: all families of a master share a single components array
         and a single pre-built _existingVarMap (built on first family, reused for
         subsequent ones so the second family's prune doesn't remove the first
         family's unique types).
         Non-unified / non-singleFamily: per-iteration fresh array + fresh lookup. */
      var components = BP.unified ? _unifiedComps : []; /* { component, type, state, rounded } */

      /* SAFE_REBUILD variant reuse map — keyed by variant name.
         If we have an existing set to reuse, pre-index its current COMPONENT
         children so we can UPDATE them in-place instead of delete+recreate.
         Preserving individual variant node IDs keeps placed instances from
         showing "Missing variant" (instances track mainComponent by ID, not
         just by the set's library key). */
      var _existingVarMap = BP.unified ? _unifiedVarMap : ((_sfVarMap && _sfVarMapBuilt) ? _sfVarMap : {});
      if (!BP.unified && SAFE_REBUILD && !(_sfVarMapBuilt && BP.singleFamily)) {
        var _preReuseSet = reuseSetByName[setDisplayName];
        /* Semantic-ID fallback: if setDisplayName changed (singleFamily toggle,
           section rename), find via dtf-set-id and align reuseSetByName so
           the reuseTarget lookup and STEP-1 prune work correctly.
           Without this alignment, _existingVarMap stays empty → STEP 1 prunes
           nothing → STEP 2 appends new variants on top of old ones → doubles. */
        if (!_preReuseSet && reuseSetBySemanticId) {
          var _preSemId = 'dtf::' + BP.name + '::' + mName;
          var _preSemSet = reuseSetBySemanticId[_preSemId];
          if (_preSemSet && !_preSemSet.removed) {
            _preReuseSet = _preSemSet;
            reuseSetByName[setDisplayName] = _preSemSet;
            log('SAFE_REBUILD: aligned "' + setDisplayName + '" via semantic ID');
          }
        }
        if (_preReuseSet && !_preReuseSet.removed) {
          /* Snapshot children first — iterating a live array while removing
             children from it would shift indices and skip entries. */
          var _preKids = Array.prototype.slice.call(_preReuseSet.children || []);
          for (var _pki = 0; _pki < _preKids.length; _pki++) {
            var _pk = _preKids[_pki];
            if (!_pk || _pk.type !== 'COMPONENT') continue;
            if (_existingVarMap[_pk.name]) {
              /* Duplicate variant name — left behind by a previous doubling bug.
                 Remove the extra copy now so it can never be appended again. */
              try { _pk.remove(); } catch (_dupe) { /* already gone */ }
            } else {
              _existingVarMap[_pk.name] = _pk;
            }
          }
          log('SAFE_REBUILD variant map: ' + Object.keys(_existingVarMap).length + ' existing variants for "' + setDisplayName + '"');
        }
        /* singleFamily: store the map so subsequent family iterations reuse it
           (avoiding a second prune pass that would remove the first family's types). */
        if (BP.singleFamily && !_sfVarMapBuilt) {
          _sfVarMap = _existingVarMap;
          _sfVarMapBuilt = true;
        }
      }

      /* Rounded axis — boolean variant property mirroring CSS [data-rounded].
         False = bound to button/default/radius (default). True = bound to
         button/radius-rounded (pill, 9999). Lookup tolerates both naming
         conventions used across files. */
      var radiusRoundedVar = (BP.radiusRoundedPath && compSizeVars[BP.radiusRoundedPath])
                          || compSizeVars['button/radius-rounded']
                          || compSizeVars['button/default/radius-rounded'];
      /* skipRounded: true → the component is always pill-shaped; skip the
         Rounded=True axis entirely so the variant set stays clean.
         labeledAxis: true → add Labeled=True/False boolean variant property. */
      var roundedValues = BP.skipRounded ? [false] : [false, true];
      var labeledValues = BP.labeledAxis ? [false, true] : [false];

      for (var li2 = 0; li2 < labeledValues.length; li2++) {
        var isLabeledIter = labeledValues[li2];
      for (var ri2 = 0; ri2 < roundedValues.length; ri2++) {
        /* Per-master shape override: if the master declares isRounded:true
           (e.g. 'Switch / Pill'), use pill radius regardless of the loop value.
           This lets skipRounded:true + per-master isRounded coexist cleanly. */
        var isRounded = (masterCfg.isRounded === true) ? true : roundedValues[ri2];
      for (var ti = 0; ti < famTypes.length; ti++) {
        var typeName = famTypes[ti];
        for (var sti = 0; sti < famStates.length; sti++) {
          var stateName = famStates[sti];
          var overrides = famOverrides[typeName] && famOverrides[typeName][stateName];
          if (!overrides) continue;

          /* For track-thumb ON states, switch to the ON master whose Thumb.x
             is already bound to toggle/thumb-x-on (right side). Figma does
             not allow overriding a variable-bound layout property (x) on an
             instance child, so swapping the whole master is the only solution. */
          var _activeMaster = (BP.kind === 'track-thumb' && overrides.thumbXOverride &&
                               masterComponents[mName + '_on'])
            ? masterComponents[mName + '_on']
            : masterComp;

          /* Build the full variant name from all active axes.
             Unified: Pill=On|Off + Label=On|Off prefix from masterCfg booleans.
             Non-unified: existing Type= + State= (+ optional Square= / Label= suffix). */
          var _variantName;
          if (BP.unified) {
            var _pillVal  = (masterCfg && masterCfg.pill)  ? 'On' : 'Off';
            var _labelVal = (masterCfg && masterCfg.label) ? 'On' : 'Off';
            _variantName = 'State=' + stateName + ', Type=' + typeName + ', Pill=' + _pillVal + ', Label=' + _labelVal;
          } else {
            var _labeledSuffix = BP.labeledAxis ? (', Label=' + (isLabeledIter ? 'On' : 'Off')) : '';
            _variantName = BP.skipRounded
              ? 'Type=' + typeName + ', State=' + stateName + _labeledSuffix
              : 'Type=' + typeName + ', State=' + stateName + ', Square=' + (isRounded ? 'Off' : 'On') + _labeledSuffix;
          }

          /* SAFE_REBUILD: reuse the existing COMPONENT node so placed instances
             keep their mainComponent reference (same node ID). Clear its
             children so we can re-add a fresh master instance below.
             For unified sets the map is keyed by canonical sorted axes; for
             non-unified it is keyed by exact name. */
          var _vLookupKey = BP.unified
            ? _variantName.split(/,\s*/).sort().join('|')
            : _variantName;
          var _reuseVarComp = _existingVarMap[_vLookupKey];
          var varComp;
          if (_reuseVarComp && !_reuseVarComp.removed) {
            varComp = _reuseVarComp;
            delete _existingVarMap[_vLookupKey]; /* mark consumed */
            /* Drain all children before re-adding a fresh instance.
               Ghost instances (mainComponent deleted) resist simple .remove()
               — unlock first, then fall back to page.appendChild() to eject
               the node out of varComp before deleting it from the page. */
            var _drainLimit = 200;
            while (varComp.children && varComp.children.length > 0 && _drainLimit-- > 0) {
              var _kn = varComp.children[0];
              if (!_kn) break;
              try { if (_kn.locked) _kn.locked = false; } catch (_le) {}
              var _knRemoved = false;
              try { _kn.remove(); _knRemoved = true; } catch (_re) {}
              if (!_knRemoved) {
                /* Eject to page root so varComp is clear, then delete. */
                var _ejected = false;
                try { page.appendChild(_kn); _ejected = true; } catch (_ee) {}
                try { _kn.remove(); } catch (_re2) {}
                if (!_ejected) {
                  log('SAFE_REBUILD: child eject failed on "' + _variantName + '" — ' + (_kn.type || '?'));
                  break; /* give up on this node to avoid infinite loop */
                }
              }
            }
            if (varComp.children && varComp.children.length > 0) {
              log('SAFE_REBUILD: ' + varComp.children.length + ' children NOT cleared from "' + _variantName + '"');
            }
          } else {
            /* Create variant component — thin wrapper, NO padding or layout. */
            varComp = figma.createComponent();
          }
          varComp.name = _variantName;
          varComp.resize(120, 36);
          varComp.layoutMode = 'HORIZONTAL';
          varComp.counterAxisAlignItems = 'CENTER';
          varComp.primaryAxisAlignItems = 'CENTER';
          varComp.layoutSizingHorizontal = 'HUG';
          varComp.layoutSizingVertical = 'HUG';
          varComp.fills = [];
          varComp.effects = []; /* clear stale effects from old generator runs */
          varComp.clipsContent = false;
          varComp.paddingLeft = 0;
          varComp.paddingRight = 0;
          varComp.paddingTop = 0;
          varComp.paddingBottom = 0;
          varComp.itemSpacing = 0;

          /* Lock T3 mode for brand/semantic families so all { t3: … } bindings
             resolve to the family's status palette. A per-state override
             (overrides.t3Mode) wins — used by Selected to force brand-mode
             resolution so the selected highlight is visibly distinct from
             the default neutral surface. */
          var stateT3ModeId = (overrides.t3Mode && t3Modes[overrides.t3Mode]) ? t3Modes[overrides.t3Mode] : null;
          var effectiveT3ModeId = stateT3ModeId || famT3ModeId;
          if (effectiveT3ModeId && t3Col) {
            try { varComp.setExplicitVariableModeForCollection(t3Col, effectiveT3ModeId); }
            catch (e) { log('T3 mode lock failed (' + familyName + '/' + stateName + '): ' + e.message); }
          }

          /* Reset opacity first so a reused varComp never carries stale
             opacity from a prior Disabled run; then apply any override. */
          varComp.opacity = 1;
          if (overrides.componentOpacity !== undefined) {
            varComp.opacity = overrides.componentOpacity;
          }

          /* ── LABELED TRACK VARIANT — HUG, direct build ────────────────────────
             Type=Labeled for track-thumb: varComp IS the track (HORIZONTAL HUG).
             Layout children: [LabelOn] [Thumb] [LabelOff] — thumb stays centred.
             OFF states: LabelOn opacity=0, LabelOff opacity=1.
             ON  states: LabelOn opacity=1, LabelOff opacity=0.
             No thumbXOverride — position is implicit from visible child ordering.
             Width HUGs text + thumb (wider than fixed-width Default toggle).    */
          if (BP.kind === 'track-thumb' && (masterCfg.isLabeled || isLabeledIter)) {
            var _lblIsOn  = (stateName.indexOf('On') === 0);
            /* Padding + gap: driven by comp-size variables for per-density correctness.
               Literal fallbacks used until bindings are applied below.
               OFF: thumb on LEFT → left=thumbInset, right=labelTextPad
               ON:  thumb on RIGHT → left=labelTextPad, right=thumbInset */
            var _lblThumbPad = 2;  /* literal fallback — overridden by toggle/thumb-inset binding */
            var _lblTextPad  = 6;  /* literal fallback — overridden by toggle/label-text-pad binding */
            var _lblGap      = 6;  /* literal fallback — overridden by toggle/gap binding */
            var _lblFS       = 9;  /* base font size (px) */

            /* Reconfigure varComp as the track frame */
            varComp.layoutMode = 'HORIZONTAL';
            varComp.counterAxisAlignItems = 'CENTER';
            varComp.primaryAxisAlignItems = 'CENTER';
            varComp.layoutSizingHorizontal = 'HUG';
            varComp.layoutSizingVertical   = 'FIXED';
            /* Outer track padding: thumb-inset on the thumb side; label-text-pad on the
               text side. itemSpacing (gap between thumb and text) also = label-text-pad
               so the text has equal padding on both its left and right.
               OFF: paddingLeft=inset, itemSpacing=textPad, text, paddingRight=textPad
               ON:  paddingLeft=textPad, text, itemSpacing=textPad, paddingRight=inset */
            varComp.paddingLeft   = _lblIsOn ? _lblTextPad : _lblThumbPad;
            varComp.paddingRight  = _lblIsOn ? _lblThumbPad : _lblTextPad;
            varComp.paddingTop    = 0;
            varComp.paddingBottom = 0;
            varComp.itemSpacing   = _lblTextPad; /* = label-text-pad → equal space either side of text */
            /* Clip thumb shadow to the track boundary. Without this, the
               2-layer drop-shadow (blur=6px) visually overflows the track
               at mega/ultra where the thumb is large (36–44 px). */
            varComp.clipsContent  = true;

            /* Bind paddings and gap to per-density comp-size variables. */
            var _lblInsetVar   = compSizeVars['toggle/thumb-inset'];
            var _lblTxtPadVar  = compSizeVars['toggle/label-text-pad'];
            var _lblFSVar      = compSizeVars['toggle/track-label-font-size'];
            if (_lblInsetVar) {
              if (await tryBindVar(varComp, _lblIsOn ? 'paddingRight' : 'paddingLeft', _lblInsetVar)) stats.bindings++;
            }
            if (_lblTxtPadVar) {
              /* Text-side outer padding */
              if (await tryBindVar(varComp, _lblIsOn ? 'paddingLeft' : 'paddingRight', _lblTxtPadVar)) stats.bindings++;
              /* itemSpacing = label-text-pad → equal space on both sides of the label text */
              if (await tryBindVar(varComp, 'itemSpacing', _lblTxtPadVar)) stats.bindings++;
            }

            /* Bind track height to comp-size variable */
            var _lblHVar = compSizeVars['toggle/track-h'];
            if (_lblHVar) { await tryBindVar(varComp, 'height', _lblHVar); stats.bindings++; }

            /* Bind track corner radii — pill (9999) when Rounded=True, square (6px) otherwise */
            var _lblTrackRadVar = isRounded
              ? compSizeVars[BP.radiusRoundedPath || 'toggle/radius']
              : compSizeVars['toggle/radius-square'];
            if (_lblTrackRadVar) {
              var _lbRadKeys = ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'];
              for (var _lbk = 0; _lbk < _lbRadKeys.length; _lbk++) {
                if (await tryBindVar(varComp, _lbRadKeys[_lbk], _lblTrackRadVar)) stats.bindings++;
              }
            }

            /* Track fill */
            if (overrides.fill) {
              var _lbFv = resolveColorSpec(overrides.fill, t2Vars, t3Vars);
              if (_lbFv) { setPaintBoundToVariable(varComp, 'fills', _lbFv); stats.bindings++; }
            } else { varComp.fills = []; }

            /* Track stroke */
            if (overrides.stroke) {
              var _lbSv = resolveColorSpec(overrides.stroke, t2Vars, t3Vars);
              if (_lbSv) {
                setPaintBoundToVariable(varComp, 'strokes', _lbSv);
                varComp.strokeWeight = overrides.strokeWeight || 1;
                varComp.strokeAlign  = 'INSIDE';
                stats.bindings++;
              }
            } else { varComp.strokes = []; }

            /* LabelOn — LEFT child.
               In layout (AUTO) when ON state so Thumb appears on the right.
               Out of layout (ABSOLUTE + hidden) in OFF state so Thumb sits at the left edge. */
            var _lbOn = figma.createText();
            _lbOn.name = 'LabelOn';
            _lbOn.fontName = fontNameBold;
            _lbOn.characters = 'ON';
            _lbOn.fontSize = _lblFS;
            _lbOn.textAutoResize = 'WIDTH_AND_HEIGHT';
            _lbOn.visible = _lblIsOn;
            if (_lblFSVar) { if (await tryBindVar(_lbOn, 'fontSize', _lblFSVar)) stats.bindings++; }
            /* Label text color:
               - T3 semantic fill (success/brand ON states): T3 oncomponent-content/default
                 (resolves to white in T3 mode locked on varComp → white-on-colour).
               - T2 fill or no fill (Neutral/Brand OFF, Outlined OFF): T2 default/content/default
                 (dark body text — readable on light grey bg-pressed or on empty track).
               Just like buttons, Neutral toggle label text uses the content token,
               NOT oncomponent-content (which is white — invisible on light grey). */
            var _useOnComponent = !!(overrides.t3Mode);
            var _lbOnFv = _useOnComponent
              ? (t3Vars['oncomponent-content/default'] || t2Vars['default/content/inverse'])
              : t2Vars['default/content/default'];
            if (_lbOnFv) { tryBindFill(_lbOn, _lbOnFv); stats.bindings++; }
            else { _lbOn.fills = [{ type: 'SOLID', color: { r:0.35,g:0.35,b:0.40 } }]; }
            varComp.appendChild(_lbOn);
            try { _lbOn.layoutPositioning = _lblIsOn ? 'AUTO' : 'ABSOLUTE'; } catch (e) {}

            /* Thumb — FIXED centre child */
            var _lbThumb = figma.createFrame();
            _lbThumb.name = 'Thumb';
            _lbThumb.resize(20, 20);
            _lbThumb.layoutMode = 'NONE';
            _lbThumb.layoutSizingHorizontal = 'FIXED';
            _lbThumb.layoutSizingVertical   = 'FIXED';
            _lbThumb.fills   = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
            _lbThumb.strokes = [];
            _lbThumb.cornerRadius = 9999;
            /* Two-layer shadow — matches master thumb (elevated appearance). */
            _lbThumb.effects = [
              { type: 'DROP_SHADOW', color: { r:0,g:0,b:0,a:0.22 }, offset:{x:0,y:2}, radius:6, spread:0, visible:true, blendMode:'NORMAL' },
              { type: 'DROP_SHADOW', color: { r:0,g:0,b:0,a:0.10 }, offset:{x:0,y:1}, radius:2, spread:0, visible:true, blendMode:'NORMAL' }
            ];
            var _lbThSVar = compSizeVars['toggle/thumb-size'];
            if (_lbThSVar) {
              await tryBindVar(_lbThumb, 'width',  _lbThSVar);
              await tryBindVar(_lbThumb, 'height', _lbThSVar);
              stats.bindings += 2;
            }
            /* Thumb radius — circle for Pill (toggle/radius=9999), concentric square for Square (toggle/thumb-radius-square). */
            var _lbThRadVar = compSizeVars[isRounded ? (BP.radiusRoundedPath || 'toggle/radius') : 'toggle/thumb-radius-square'];
            if (_lbThRadVar) {
              var _lbtrKeys = ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'];
              for (var _lbt = 0; _lbt < _lbtrKeys.length; _lbt++) {
                if (await tryBindVar(_lbThumb, _lbtrKeys[_lbt], _lbThRadVar)) stats.bindings++;
              }
            }
            varComp.appendChild(_lbThumb);

            /* LabelOff — RIGHT child.
               In layout (AUTO) when OFF state so Thumb appears on the left.
               Out of layout (ABSOLUTE + hidden) in ON state so Thumb sits at the right edge. */
            var _lbOff = figma.createText();
            _lbOff.name = 'LabelOff';
            _lbOff.fontName = fontNameBold;
            _lbOff.characters = 'OFF';
            _lbOff.fontSize = _lblFS;
            _lbOff.textAutoResize = 'WIDTH_AND_HEIGHT';
            _lbOff.visible = !_lblIsOn;
            if (_lblFSVar) { if (await tryBindVar(_lbOff, 'fontSize', _lblFSVar)) stats.bindings++; }
            /* Same rule as LabelOn: T3 mode = white on colour; no T3 mode = dark body text. */
            var _lbOffFv = _useOnComponent
              ? (t3Vars['oncomponent-content/default'] || t2Vars['default/content/inverse'])
              : t2Vars['default/content/default'];
            if (_lbOffFv) { tryBindFill(_lbOff, _lbOffFv); stats.bindings++; }
            else { _lbOff.fills = [{ type: 'SOLID', color: COLOR_BODY }]; }
            varComp.appendChild(_lbOff);
            try { _lbOff.layoutPositioning = _lblIsOn ? 'ABSOLUTE' : 'AUTO'; } catch (e) {}

            components.push({ component: varComp, type: typeName, state: stateName, rounded: isRounded });
            stats.components++;
            continue; /* skip instance-creation + override code */
          }

          /* Create instance of master component.
             For track-thumb ON states _activeMaster is the ON master (thumb
             pre-positioned right); for OFF states it is the regular master. */
          var instance = _activeMaster.createInstance();
          varComp.appendChild(instance);
          /* track-thumb: both axes FIXED (track is a fixed-size pill, not HUG).
             All other components: HUG width so the instance wraps its content. */
          if (BP.kind === 'track-thumb') {
            instance.layoutSizingHorizontal = 'FIXED';
            instance.layoutSizingVertical   = 'FIXED';
            /* Ensure shadow from the thumb is clipped at the track boundary.
               Instances do not inherit clipsContent from the master component. */
            try { instance.clipsContent = true; } catch(e) {}
          } else {
            instance.layoutSizingHorizontal = 'HUG';
            instance.layoutSizingVertical   = 'FIXED';
          }

          /* Rounded override — for NON-track-thumb (buttons): rebind corner radii
             variable on the instance root.
             For track-thumb (toggle): shape is baked into the MASTER via
             rootRadiusPath / thumbRadiusPath — instances inherit it. Skip
             variable binding on instances (Figma doesn't allow overriding
             layout variable bindings on instances). */
          if (isRounded && radiusRoundedVar && BP.kind !== 'track-thumb') {
            try {
              await tryBindVar(instance, 'topLeftRadius',     radiusRoundedVar);
              await tryBindVar(instance, 'topRightRadius',    radiusRoundedVar);
              await tryBindVar(instance, 'bottomLeftRadius',  radiusRoundedVar);
              await tryBindVar(instance, 'bottomRightRadius', radiusRoundedVar);
              stats.bindings += 4;
            } catch (rre) {
              log('Rounded radius bind failed (' + familyName + '/' + typeName + '/' + stateName + '): ' + rre.message);
            }
          }

          /* ── Apply color overrides on the INSTANCE ── */

          if (BP.kind === 'wrapper-with-button-instance') {
            /* Per-zone overrides: action zone + trigger zone applied
               independently. Wrapper-level overrides apply to the instance
               (which is the wrapper master instance). */
            var wrapOv    = overrides.wrapper || {};
            var actionOv  = overrides.action  || {};
            var triggerOv = overrides.trigger || {};

            /* Wrapper-level componentOpacity → on the variant component */
            if (wrapOv.componentOpacity !== undefined) {
              varComp.opacity = wrapOv.componentOpacity;
            }

            /* Wrapper-level fill (rare — focus-with-fill) → on the instance */
            if (wrapOv.fill) {
              var wrapFillVar = resolveColorSpec(wrapOv.fill, t2Vars, t3Vars);
              if (wrapFillVar) { setPaintBoundToVariable(instance, 'fills', wrapFillVar); stats.bindings++; }
            } else {
              try { instance.fills = []; } catch (e) {}
            }

            /* Wrapper-level stroke (selected ring, outlined types) or Focus Ring overlay
               → on the instance. Uses OUTSIDE alignment so the ring stays
               visible regardless of inner zone fills. INSIDE alignment was
               masked by the action+trigger zone fills (Selected applies a
               container/bg fill that covers the wrapper bounds), making
               the selected ring invisible on Filled / Ghost / Fill&Outline.
               Focus states use a Focus Ring master instance overlay instead
               of a direct stroke (4px gap + variable-bound ring width). */
            if (wrapOv.focusRing) {
              /* Apply the border stroke first when present (e.g. Outlined Focus keeps
                 a 1px gray border while also showing the external ring overlay). */
              if (wrapOv.stroke) {
                var wrapStrokeVar = resolveColorSpec(wrapOv.stroke, t2Vars, t3Vars);
                if (wrapStrokeVar) {
                  setPaintBoundToVariable(instance, 'strokes', wrapStrokeVar);
                  instance.strokeWeight = wrapOv.strokeWeight || 1;
                  instance.strokeAlign = 'OUTSIDE';
                  stats.bindings++;
                }
              } else {
                try { instance.strokes = []; } catch (e) {}
              }
              /* Focus Ring: auto-layout wrapper frame enclosing the instance.
                 HUG both axes with padding=gap → width/height auto-adapt to
                 any button content width and any density — no literals needed.
                 Stroke INSIDE provides the visible ring. */
              var _frBrand = _frReadColor(_frColorVar, { r: 0.22, g: 0.37, b: 0.98, a: 1 });
              try {
                var _wfrFrame = figma.createFrame();
                _wfrFrame.name = 'Focus ring';
                _wfrFrame.layoutMode            = 'HORIZONTAL';
                _wfrFrame.primaryAxisSizingMode = 'AUTO';
                _wfrFrame.counterAxisSizingMode = 'AUTO';
                _wfrFrame.primaryAxisAlignItems = 'CENTER';
                _wfrFrame.counterAxisAlignItems = 'CENTER';
                _wfrFrame.paddingTop    = _frgap;
                _wfrFrame.paddingBottom = _frgap;
                _wfrFrame.paddingLeft   = _frgap;
                _wfrFrame.paddingRight  = _frgap;
                if (_frgapVar) {
                  try { await tryBindVar(_wfrFrame, 'paddingTop',    _frgapVar); stats.bindings++; } catch(e) {}
                  try { await tryBindVar(_wfrFrame, 'paddingBottom', _frgapVar); stats.bindings++; } catch(e) {}
                  try { await tryBindVar(_wfrFrame, 'paddingLeft',   _frgapVar); stats.bindings++; } catch(e) {}
                  try { await tryBindVar(_wfrFrame, 'paddingRight',  _frgapVar); stats.bindings++; } catch(e) {}
                }
                _wfrFrame.fills   = [];
                _wfrFrame.strokes = [{ type: 'SOLID', color: _frBrand, visible: true, blendMode: 'NORMAL', opacity: 1 }];
                if (_frColorVar) { setPaintBoundToVariable(_wfrFrame, 'strokes', _frColorVar); stats.bindings++; }
                _wfrFrame.strokeWeight = _frwidth;
                if (_frwidthVar) { try { await tryBindVar(_wfrFrame, 'strokeWeight', _frwidthVar); stats.bindings++; } catch(e) {} }
                _wfrFrame.strokeAlign  = 'INSIDE';
                /* cornerRadius = button radius + gap so ring follows button shape. */
                if (isRounded) {
                  _wfrFrame.cornerRadius = 9999;
                } else {
                  var _wfr_instCR = 0; try { _wfr_instCR = instance.topLeftRadius || 0; } catch(_wfr_e) {}
                  _wfrFrame.cornerRadius = Math.round(_wfr_instCR + _frgap);
                  if (_frradiusVar) { try { await tryBindVar(_wfrFrame, 'cornerRadius', _frradiusVar); stats.bindings++; } catch(e) {} }
                }
                _wfrFrame.clipsContent = false;
                /* Reparent instance INTO ring frame; then place ring frame in varComp. */
                _wfrFrame.appendChild(instance);
                varComp.appendChild(_wfrFrame);
                try {
                  _wfrFrame.layoutSizingHorizontal = 'HUG';
                  _wfrFrame.layoutSizingVertical   = 'HUG';
                } catch(e) {}
              } catch(e) { log('focusRing wrapper ring-frame: ' + e.message); }
              varComp.clipsContent = false;
            } else if (wrapOv.stroke) {
              var wrapStrokeVar = resolveColorSpec(wrapOv.stroke, t2Vars, t3Vars);
              if (wrapStrokeVar) {
                setPaintBoundToVariable(instance, 'strokes', wrapStrokeVar);
                instance.strokeWeight = wrapOv.strokeWeight || 1;
                instance.strokeAlign = 'OUTSIDE';
                stats.bindings++;
              }
            } else {
              try { instance.strokes = []; } catch (e) {}
            }

            /* Locate Action and Trigger sub-children inside the wrapper instance */
            var actionChild  = instance.findOne(function(n) { return n.name === 'Action'; });
            var triggerChild = instance.findOne(function(n) { return n.name === 'Trigger'; });

            /* ── Zero out the seam corners ──
               Action zone is the LEFT half — its right corners must be square
               so it butts cleanly against the trigger. Conversely the trigger
               zone is the RIGHT half — its left corners must be square. The
               wrapper's outer corner radii (bound to button/default/radius or
               radius-rounded) provide the only visible rounding. */
            if (actionChild) {
              try {
                actionChild.topRightRadius    = 0;
                actionChild.bottomRightRadius = 0;
              } catch (e) {}
            }
            if (triggerChild) {
              try {
                triggerChild.topLeftRadius    = 0;
                triggerChild.bottomLeftRadius = 0;
                /* Trigger zone never gets outer rounding — the wrapper handles
                   the right-side rounding via clipsContent. */
                triggerChild.topRightRadius    = 0;
                triggerChild.bottomRightRadius = 0;
              } catch (e) {}
            }

            /* Helper: apply zone-level overrides to a single zone child */
            async function applyZoneOverrides(zoneNode, zOv) {
              if (!zoneNode) return;
              if (zOv.fill) {
                var zfv = resolveColorSpec(zOv.fill, t2Vars, t3Vars);
                if (zfv) { setPaintBoundToVariable(zoneNode, 'fills', zfv); stats.bindings++; }
              } else {
                try { zoneNode.fills = []; } catch (e) {}
              }
              /* NOTE: do NOT touch the trigger zone's strokes here — those
                 carry the divider (left-stroke) which is independent of
                 zone state. Skip stroke overrides for the trigger child. */
              if (zoneNode === actionChild) {
                if (zOv.stroke) {
                  var zsv = resolveColorSpec(zOv.stroke, t2Vars, t3Vars);
                  if (zsv) {
                    setPaintBoundToVariable(zoneNode, 'strokes', zsv);
                    zoneNode.strokeWeight = zOv.strokeWeight || 1;
                    zoneNode.strokeAlign = 'INSIDE';
                    stats.bindings++;
                  }
                } else {
                  try { zoneNode.strokes = []; } catch (e) {}
                }
              }
              if (zOv.text) {
                var ztv = resolveColorSpec(zOv.text, t2Vars, t3Vars);
                if (ztv) {
                  var tns = zoneNode.findAll(function(n) { return n.type === 'TEXT'; });
                  for (var ttx = 0; ttx < tns.length; ttx++) {
                    setPaintBoundToVariable(tns[ttx], 'fills', ztv);
                    stats.bindings++;
                  }
                }
              }
              if (zOv.icon) {
                var ziv = resolveColorSpec(zOv.icon, t2Vars, t3Vars);
                if (ziv) {
                  var ins = zoneNode.findAll(function(n) { return n.name === 'Vector'; });
                  for (var iix = 0; iix < ins.length; iix++) {
                    var v = ins[iix];
                    /* Bind BOTH fills and strokes so the override survives an
                       INSTANCE_SWAP across icons with different paint types
                       (filled icons use fills, line icons like chevron use
                       strokes). Only the paint type the icon component uses
                       renders visibly; the unused binding is harmless.
                       Critically, Figma preserves child overrides across
                       INSTANCE_SWAP only when the child node names match —
                       we standardize on the name 'Vector' for all icons. */
                    var hasFills   = v.fills   && v.fills.length   > 0;
                    var hasStrokes = v.strokes && v.strokes.length > 0;
                    if (hasFills || !hasStrokes) {
                      setPaintBoundToVariable(v, 'fills', ziv);
                      stats.bindings++;
                    }
                    if (hasStrokes) {
                      setPaintBoundToVariable(v, 'strokes', ziv);
                      stats.bindings++;
                    }
                  }
                }
              }
            }
            await applyZoneOverrides(actionChild,  actionOv);
            await applyZoneOverrides(triggerChild, triggerOv);

            /* ── Chevron direction flip on "open" states ──
               When the trigger is pressed (menu open) or the split-button is
               in Selected state, flip the chevron from Down → Up so the icon
               communicates the menu's open state. Apex is preserved across
               the swap (both Down and Up have apex at x=9, see chevron set
               creation), so there's no visual jitter.
               Idempotent: only acts when the chevron icon is the variant set
               (chevronIconSet present); silently no-ops when fallback single
               chevron is in use. */
            if (triggerChild && chevronIconSet && (stateName === 'Trigger Pressed' || stateName === 'Selected')) {
              try {
                var chevInst = triggerChild.findOne(function(n) {
                  return n.type === 'INSTANCE' && n.name === 'Chevron';
                });
                if (chevInst && chevInst.componentProperties && chevInst.componentProperties.Direction) {
                  chevInst.setProperties({ Direction: 'Up' });
                }
              } catch (cfe) {
                log('Chevron flip skipped (' + familyName + '/' + typeName + '/' + stateName + '): ' + cfe.message);
              }
            }

            /* Divider colour: rebind trigger's left-stroke to track the
               variant's context.

               Strategy:
               - Selected state: the action+trigger fills become container/bg
                 (a tinted surface). The default separator no longer reads.
                 Use container/separator (T3) or default/container/separator (T2)
                 so the divider stays visible against the selected fill.
               - Brand-mode families (any non-Selected state): rebind to T3
                 component/separator so the divider tracks the brand palette.
               - Neutral non-selected: keep the master-level T2 binding. */
            if (triggerChild) {
              var dividerVar = null;
              var isSelected = (stateName === 'Selected');
              /* Ghost variant: divider hidden at REST, revealed on any
                 interaction. Mirrors the CSS rule
                   .split-btn[data-variant="ghost"] { --_sb-divider-color: transparent; }
                   .split-btn[data-variant="ghost"]:hover/:focus/...
                 Without this, every Neutral Ghost split-button shipped to
                 designers had a visible divider at rest — inconsistent
                 with the spec and with the live demo page. */
              var isGhost = (typeName === 'Ghost');
              var isRest  = (stateName === 'Default');
              var ghostHidesDivider = (isGhost && isRest);
              if (ghostHidesDivider) {
                /* Strip the divider entirely on rest. */
                try {
                  triggerChild.strokes = [];
                  triggerChild.strokeWeight = 0;
                  triggerChild.strokeLeftWeight = 0;
                  triggerChild.strokeRightWeight = 0;
                  triggerChild.strokeTopWeight = 0;
                  triggerChild.strokeBottomWeight = 0;
                } catch (e) {}
              } else if (isSelected) {
                /* Use container-flavoured separator for selected. T3 first
                   (works for both Neutral with container collection mode and
                   Brand with brand mode), fall back to T2 if T3 missing. */
                dividerVar = t3Vars['container/separator']
                          || t3Vars['oncontainer-content/default']
                          || t2Vars['default/container/separator']
                          || t2Vars[BP.dividerColor.t2];
              } else if (famT3ModeId && BP.dividerColor && BP.dividerColor.t3) {
                dividerVar = t3Vars[BP.dividerColor.t3];
              }
              if (dividerVar) {
                /* Re-apply because applyZoneOverrides skipped trigger strokes */
                setPaintBoundToVariable(triggerChild, 'strokes', dividerVar);
                triggerChild.strokeWeight = 0;
                try {
                  triggerChild.strokeLeftWeight   = 1;
                  triggerChild.strokeRightWeight  = 0;
                  triggerChild.strokeTopWeight    = 0;
                  triggerChild.strokeBottomWeight = 0;
                } catch (e) {}
                triggerChild.strokeAlign = 'INSIDE';
                stats.bindings++;
              }
            }

          } else {
          /* ── Legacy flat overrides (button family) ── */

          /* Disabled opacity lives on the COMPONENT (not the instance) */
          if (overrides.componentOpacity !== undefined) {
            varComp.opacity = overrides.componentOpacity;
          }

          /* Fill override */
          if (overrides.solidFill) {
            /* Literal solid color — no variable lookup, always works */
            instance.fills = [{ type: 'SOLID', color: overrides.solidFill, opacity: 1 }];
          } else if (overrides.fill) {
            var fillVar = resolveColorSpec(overrides.fill, t2Vars, t3Vars);
            if (fillVar) {
              setPaintBoundToVariable(instance, 'fills', fillVar);
              stats.bindings++;
            } else {
              /* Variable not found — apply literal fallback if provided */
              if (overrides.fillFallback) {
                instance.fills = [{ type: 'SOLID', color: overrides.fillFallback, opacity: 1 }];
              }
            }
          } else {
            instance.fills = [];
          }

          /* Stroke override / Focus Ring overlay */
          if (overrides.focusRing) {
            /* Apply border stroke when present (e.g. Outlined Focus keeps 1px gray
               border on the mc instance while the external ring provides focus cue). */
            if (overrides.stroke) {
              var strokeVar = resolveColorSpec(overrides.stroke, t2Vars, t3Vars);
              if (strokeVar) {
                setPaintBoundToVariable(instance, 'strokes', strokeVar);
                instance.strokeWeight = overrides.strokeWeight || 1;
                instance.strokeAlign = 'INSIDE';
                try { instance.dashPattern = overrides.strokeDash || []; } catch (_dp) {}
                stats.bindings++;
              }
            } else {
              instance.strokes = [];
            }
            /* Focus Ring: auto-layout wrapper frame enclosing the instance.
               HUG both axes with padding=gap → width/height auto-adapt to
               any button content width and any density — no literals needed.
               Stroke INSIDE provides the visible ring. */
            var _frBrand = _frReadColor(_frColorVar, { r: 0.22, g: 0.37, b: 0.98, a: 1 });
            try {
              var _ffrFrame = figma.createFrame();
              _ffrFrame.name = 'Focus ring';
              _ffrFrame.layoutMode            = 'HORIZONTAL';
              _ffrFrame.primaryAxisSizingMode = 'AUTO';
              _ffrFrame.counterAxisSizingMode = 'AUTO';
              _ffrFrame.primaryAxisAlignItems = 'CENTER';
              _ffrFrame.counterAxisAlignItems = 'CENTER';
              _ffrFrame.paddingTop    = _frgap;
              _ffrFrame.paddingBottom = _frgap;
              _ffrFrame.paddingLeft   = _frgap;
              _ffrFrame.paddingRight  = _frgap;
              if (_frgapVar) {
                try { await tryBindVar(_ffrFrame, 'paddingTop',    _frgapVar); stats.bindings++; } catch(e) {}
                try { await tryBindVar(_ffrFrame, 'paddingBottom', _frgapVar); stats.bindings++; } catch(e) {}
                try { await tryBindVar(_ffrFrame, 'paddingLeft',   _frgapVar); stats.bindings++; } catch(e) {}
                try { await tryBindVar(_ffrFrame, 'paddingRight',  _frgapVar); stats.bindings++; } catch(e) {}
              }
              _ffrFrame.fills   = [];
              _ffrFrame.strokes = [{ type: 'SOLID', color: _frBrand, visible: true, blendMode: 'NORMAL', opacity: 1 }];
              if (_frColorVar) { setPaintBoundToVariable(_ffrFrame, 'strokes', _frColorVar); stats.bindings++; }
              _ffrFrame.strokeWeight = _frwidth;
              if (_frwidthVar) { try { await tryBindVar(_ffrFrame, 'strokeWeight', _frwidthVar); stats.bindings++; } catch(e) {} }
              _ffrFrame.strokeAlign  = 'INSIDE';
              /* cornerRadius = button radius + gap so ring follows button shape. */
              if (isRounded) {
                _ffrFrame.cornerRadius = 9999;
              } else {
                var _ffr_instCR = 0; try { _ffr_instCR = instance.topLeftRadius || 0; } catch(_ffr_e) {}
                _ffrFrame.cornerRadius = Math.round(_ffr_instCR + _frgap);
                if (_frradiusVar) { try { await tryBindVar(_ffrFrame, 'cornerRadius', _frradiusVar); stats.bindings++; } catch(e) {} }
              }
              _ffrFrame.clipsContent = false;
              /* Reparent instance INTO ring frame; then place ring frame in varComp. */
              _ffrFrame.appendChild(instance);
              varComp.appendChild(_ffrFrame);
              try {
                _ffrFrame.layoutSizingHorizontal = 'HUG';
                _ffrFrame.layoutSizingVertical   = 'HUG';
              } catch(e) {}
            } catch(e) { log('focusRing ring-frame: ' + e.message); }
            varComp.clipsContent = false;
          } else if (overrides.stroke) {
            var strokeVar = resolveColorSpec(overrides.stroke, t2Vars, t3Vars);
            if (strokeVar) {
              setPaintBoundToVariable(instance, 'strokes', strokeVar);
              instance.strokeWeight = overrides.strokeWeight || 1;
              instance.strokeAlign = 'INSIDE';
              /* Dash pattern — Ghost Default uses [4,4] for a dashed outline
                 that makes the button boundary visible on a white canvas.
                 Solid strokes omit this key so dashPattern resets to []. */
              try { instance.dashPattern = overrides.strokeDash || []; } catch (_dp) {}
              stats.bindings++;
            }
          } else {
            instance.strokes = [];
          }

          /* Text/icon color overrides (only when different from master default) */
          if (overrides.text) {
            var textColorVar = resolveColorSpec(overrides.text, t2Vars, t3Vars);
            if (textColorVar) {
              var textChildren = instance.findAll(function(n) { return n.type === 'TEXT'; });
              for (var tci = 0; tci < textChildren.length; tci++) {
                setPaintBoundToVariable(textChildren[tci], 'fills', textColorVar);
                stats.bindings++;
              }
            }
          }

          if (overrides.icon) {
            var iconColorVar = resolveColorSpec(overrides.icon, t2Vars, t3Vars);
            if (iconColorVar) {
              var iconChildren = instance.findAll(function(n) { return n.name === 'Vector'; });
              for (var ici = 0; ici < iconChildren.length; ici++) {
                var _icv = iconChildren[ici];
                /* Bind BOTH fills and strokes — icon-placeholder vectors use fills,
                   chevron vectors use strokes (stroke-drawn paths, no fill). Only
                   the paint type actually present on the vector matters; binding
                   the other is harmless and future-proofs icon swaps. */
                var _icHasFills   = _icv.fills   && Array.isArray(_icv.fills)   && _icv.fills.length   > 0;
                var _icHasStrokes = _icv.strokes && Array.isArray(_icv.strokes) && _icv.strokes.length > 0;
                if (_icHasFills || !_icHasStrokes) {
                  setPaintBoundToVariable(_icv, 'fills', iconColorVar);
                  stats.bindings++;
                }
                if (_icHasStrokes) {
                  setPaintBoundToVariable(_icv, 'strokes', iconColorVar);
                  stats.bindings++;
                }
              }
            }
          }

          /* thumbXOverride is now handled by master selection (_activeMaster):
             ON states use the [On] master whose Thumb.x is bound to
             toggle/thumb-x-on. No instance-level override needed. */

          /* Track label visibility — only when master has trackLabels: true.
             Detect On vs Off state from the state name prefix.
             LabelOn:  opacity=1 for On-* states,  opacity=0 for Off-* states.
             LabelOff: opacity=0 for On-* states,  opacity=1 for Off-* states.
             The fills are bound in the master (T2 for off, T3 for on) and
             automatically resolve to the correct color via the T3 mode applied
             to varComp — no per-state rebinding needed here. */
          if (masterCfg && masterCfg.trackLabels) {
            var isOnState = stateName.indexOf('On') === 0;
            var ttLblOnNode  = instance.findOne(function(n) { return n.name === 'LabelOn'; });
            var ttLblOffNode = instance.findOne(function(n) { return n.name === 'LabelOff'; });
            try { if (ttLblOnNode)  ttLblOnNode.opacity  = isOnState ? 1 : 0; } catch (e) {}
            try { if (ttLblOffNode) ttLblOffNode.opacity = isOnState ? 0 : 1; } catch (e) {}
          }
          } /* end legacy/wrapper branch */

          var _compRecord = { component: varComp, type: typeName, state: stateName, rounded: isRounded };
          components.push(_compRecord);
          /* singleFamily: accumulate into the master-level shared array with dedup.
             First-family-wins: if another family already added a variant with this
             name (e.g. both Neutral and Brand define "Ghost"), keep the first
             (Neutral's visible overrides) and skip the duplicate (Brand's). */
          if (BP.singleFamily) {
            if (!_sfComponentsMap[_variantName]) {
              _sfComponentsMap[_variantName] = true;
              _sfComponents.push(_compRecord);
            } else {
              /* Duplicate for singleFamily — remove the extra component and skip. */
              try { varComp.remove(); } catch (_sfDupe) {}
            }
          }
          stats.components++;
        }
      }
      } /* end rounded loop */
      } /* end labeled loop */

      /* Unified blueprints: component accumulation is done above; skip the
         per-family combineAsVariants — the unified set is created after all
         master iterations complete (see "Unified component set" block below).
         singleFamily: same principle — skip combining until the LAST family so
         all families' variants accumulate before the single prune+append pass. */
      if (!BP.unified && !(BP.singleFamily && famI < familyNames.length - 1)) {

      /* For singleFamily last-family pass: use all accumulated components. */
      var _combineSource = (BP.singleFamily && _sfComponents) ? _sfComponents : components;

      /* ── Combine into ComponentSet ── */
      figma.ui.postMessage({ type: 'gen-progress', text: 'Combining ' + setDisplayName + '…' });

      var allComps = [];
      for (var ai = 0; ai < _combineSource.length; ai++) {
        allComps.push(_combineSource[ai].component);
      }

      var componentSet;
      var reusedExistingSet = false;
      var _semIdKey = 'dtf::' + BP.name + '::' + mName;
      var reuseTarget = (SAFE_REBUILD && (reuseSetByName[setDisplayName] || reuseSetBySemanticId[_semIdKey])) || null;

      /* Schema-change guard: if the existing set has a "Rounded=" variant property
         but the new blueprint has skipRounded:true, the schemas are incompatible.
         Appending non-Rounded variants into a Rounded set causes Figma to assign
         implicit Rounded=False to new variants, leaving an empty Pill row even after
         stale pruning. Force a fresh combineAsVariants instead of SAFE_REBUILD. */
      if (reuseTarget && BP.skipRounded) {
        var _kids = reuseTarget.children || [];
        var _hasOldRounded = false;
        for (var _rci = 0; _rci < _kids.length && !_hasOldRounded; _rci++) {
          if (_kids[_rci].name && _kids[_rci].name.indexOf('Rounded=') !== -1) {
            _hasOldRounded = true;
          }
        }
        if (_hasOldRounded) {
          log('SAFE_REBUILD schema change (skipRounded): forcing fresh set for "' + setDisplayName + '"');
          /* Delete the rescued set from page root — it has the wrong schema
             (Rounded axis) and would be left as a stale duplicate otherwise. */
          var _staleOldSet = reuseSetByName[setDisplayName];
          if (_staleOldSet && !_staleOldSet.removed) {
            try { _staleOldSet.remove(); }
            catch (_soe) { log('Schema-change cleanup failed: ' + _soe.message); }
          }
          reuseTarget = null; /* fall through to combineAsVariants */
        }
      }

      /* Schema-change guard for variant property renames.
         If EVERY old variant is stale (no name matches the new spec), the
         ComponentSet is about to be fully cleared in STEP 1. Removing the
         last COMPONENT child causes Figma to auto-delete the empty
         ComponentSet, making reuseTarget.id stale. Detect this up-front:
         if 0 out of N old variants are reused, force combineAsVariants so we
         never end up with an empty (and auto-deleted) ComponentSet. */
      if (reuseTarget && !reuseTarget.removed) {
        var _newNameSet = {};
        for (var _nni = 0; _nni < allComps.length; _nni++) {
          if (allComps[_nni].name) _newNameSet[allComps[_nni].name] = true;
        }
        var _oldKeys = Object.keys(_existingVarMap);
        var _matchCount = 0;
        for (var _oki = 0; _oki < _oldKeys.length; _oki++) {
          if (_newNameSet[_oldKeys[_oki]]) _matchCount++;
        }
        if (_oldKeys.length > 0 && _matchCount === 0) {
          /* 0% overlap in the REMAINING stale map. But if singleFamily is in use,
             some families (e.g. Neutral) may have already consumed their entries,
             leaving only the other family's stale entries (e.g. old "Type=Primary"
             after renaming to "Type=Brand Filled"). In that case reused variants
             are already sitting inside reuseTarget — removing it would destroy them.
             Only fire the guard when NO component is already inside reuseTarget
             (i.e., nothing was reused in-place, so the set is truly empty after STEP 1). */
          var _anyKeptInSet = false;
          for (var _nki = 0; _nki < allComps.length && !_anyKeptInSet; _nki++) {
            if (allComps[_nki].parent && allComps[_nki].parent.id === reuseTarget.id) {
              _anyKeptInSet = true;
            }
          }
          if (!_anyKeptInSet) {
            /* Truly 0% overlap and nothing reused — full schema change.
               Remove the stale set entirely so combineAsVariants creates fresh. */
            log('SAFE_REBUILD full-schema-change: 0/' + _oldKeys.length + ' variants match — forcing fresh set for "' + setDisplayName + '"');
            try { reuseTarget.remove(); } catch (_rre) { /* ignore if already gone */ }
            reuseTarget = null;
          } else {
            log('SAFE_REBUILD: 0-overlap guard skipped — ' + _oldKeys.length + ' stale entries are from a sibling family rename; reused variants already in set.');
          }
        }
      }

      if (reuseTarget && !reuseTarget.removed) {
        /* M4 + V2 — preserve set AND individual variant node IDs.
           Variants that were updated in-place (consumed from _existingVarMap)
           are already inside reuseTarget and don't need re-appending.
           Only truly NEW variants (not found in _existingVarMap originally)
           need to be appended. Unconsumed _existingVarMap entries are stale
           variants (removed from the blueprint spec) and should be pruned.
           IMPORTANT: prune stale variants BEFORE appending new ones so that
           Figma never sees old+new variants coexisting with different property
           schemas (which would cause implicit property assignment on new variants). */
        try {
          /* STEP 1: Prune stale variants FIRST — removes schema-incompatible
             variants before new variants arrive, preventing Figma from inferring
             obsolete properties (e.g. "Rounded") on the incoming new variants. */
          var _staleNamesFirst = Object.keys(_existingVarMap);
          for (var _sfi = 0; _sfi < _staleNamesFirst.length; _sfi++) {
            var _staleFirst = _existingVarMap[_staleNamesFirst[_sfi]];
            if (_staleFirst && !_staleFirst.removed) {
              try { _staleFirst.remove(); } catch (_sfe) { /* ignore */ }
            }
          }

          /* Guard: after full stale-prune, confirm reuseTarget is still alive.
             Figma auto-deletes an empty ComponentSet when its last child is
             removed. If that happened, fall through to combineAsVariants. */
          if (reuseTarget.removed) {
            log('SAFE_REBUILD: reuseTarget auto-deleted after prune — falling back to combineAsVariants');
            componentSet = figma.combineAsVariants(allComps, page);
          } else {

          /* STEP 2: Append only variants that are NOT already in the set
             (i.e. newly created, not reused in-place). A reused variant
             is no longer in _existingVarMap (we deleted its entry). */
          for (var _mi = 0; _mi < allComps.length; _mi++) {
            var _ac = allComps[_mi];
            /* If this component is already a child of reuseTarget (reused
               in-place), skip — appending would just move it to the end,
               which reorders the set but doesn't break anything. Still,
               avoid it to keep ordering stable. */
            if (_ac.parent && _ac.parent.id === reuseTarget.id) continue;
            try { reuseTarget.appendChild(_ac); }
            catch (_ae) { log('SAFE_REBUILD append failed: ' + _ae.message); }
          }
          /* Stale pruning already done before append (STEP 1 above). */
          componentSet = reuseTarget;
          reusedExistingSet = true;
          log('SAFE_REBUILD: reused set "' + setDisplayName + '" id=' + reuseTarget.id);
          } /* end else (reuseTarget still alive after prune) */
        } catch (rue) {
          log('SAFE_REBUILD reuse failed, falling back to combineAsVariants: ' + rue.message);
          componentSet = figma.combineAsVariants(allComps, page);
        }
      } else {
        componentSet = figma.combineAsVariants(allComps, page);
      }

      componentSet.name = setDisplayName;
      stampOwner(componentSet);
      /* Allow focus-ring drop-shadow effects to overflow the set bounds. */
      try { componentSet.clipsContent = false; } catch(_ccE) {}
      try { componentSet.setPluginData('dtf-set-id', 'dtf::' + BP.name + '::' + mName); } catch(_csidE) {}
      componentSet.description = (BP.description || '') + (BP.singleFamily ? ' All families.' : (' Family: ' + familyName + '.'));

      /* Grid layout: types as rows, states as columns. Rounded=False set
         occupies the top half; Rounded=True set is stacked below with a
         small gap so the variant set is browsable at a glance.
         singleFamily: use merged types/states so all families' entries are
         positioned within the grid (not pushed to negative y). */
      var _gridTypes  = (BP.singleFamily && _sfAllTypes)  ? _sfAllTypes  : famTypes;
      var _gridStates = (BP.singleFamily && _sfAllStates) ? _sfAllStates : famStates;
      var colCount = _gridStates.length;
      var rowCount = _gridTypes.length;
      var padX = 20;
      var padY = 27;
      /* Per-blueprint grid constants — scaled to component proportions.
         TOGGLE uses 64/36 (40×24 track); BUTTON uses defaults 155/70 (120×36). */
      var colSpacing = (BP.gridLayout && BP.gridLayout.colSpacing) || 155;
      var rowSpacing = (BP.gridLayout && BP.gridLayout.rowSpacing) || 70;
      var _compW     = (BP.gridLayout && BP.gridLayout.componentW) || 120;
      var _compH     = (BP.gridLayout && BP.gridLayout.componentH) || 32;
      var roundedBlockGap = 30; /* extra gap between False-block and True-block */
      var blockHeight = rowCount * rowSpacing;
      for (var gi = 0; gi < _combineSource.length; gi++) {
        var entry = _combineSource[gi];
        var typeIdx  = _gridTypes.indexOf(entry.type);
        var stateIdx = _gridStates.indexOf(entry.state);
        /* When skipRounded:true, every master owns its OWN separate ComponentSet
           (one set per master, not one set per family). All entries in this set
           share the same shape, so there is no "Rounded block" to stack below.
           Force roundedOffset to 0 so pill variants are not pushed below the
           componentSet's bottom edge (which would make them invisible). */
        var roundedOffset = (!BP.skipRounded && entry.rounded) ? (blockHeight + roundedBlockGap) : 0;
        entry.component.x = padX + stateIdx * colSpacing;
        entry.component.y = padY + typeIdx * rowSpacing + roundedOffset;
      }
      var totalW = padX * 2 + (colCount - 1) * colSpacing + _compW;
      /* Height: single block when skipRounded, doubled block otherwise. */
      var totalH = BP.skipRounded
        ? padY + (rowCount - 1) * rowSpacing + _compH + padY
        : padY + (rowCount - 1) * rowSpacing + _compH + (blockHeight + roundedBlockGap) + padY;
      try { componentSet.resize(totalW, totalH); } catch (e) { /* auto-size */ }

      /* ── Row/column label constants ── */
      var ROW_LABEL_WIDTH = 100;
      var COL_HEADER_HEIGHT = 40;

      /* ── Step 7: Component properties propagated from master ── */
      figma.ui.postMessage({ type: 'gen-progress', text: 'Properties propagated from masters…' });

      /* ── Step 8: Wire interactive reactions ── */
      figma.ui.postMessage({ type: 'gen-progress', text: 'Wiring interactions for ' + familyName + '…' });

      if (BP.kind === 'wrapper-with-button-instance') {
        /* Per-zone reactions: each variant has reactions on its Action and
           Trigger sub-children. Hovering/pressing a zone navigates the
           whole component to the corresponding zone-state variant. */
        for (var rri = 0; rri < roundedValues.length; rri++) {
          var rRounded = roundedValues[rri];
          for (var ri = 0; ri < famTypes.length; ri++) {
            var rType = famTypes[ri];

            /* Build a state→component map for this (type, rounded) */
            var stateToComp = {};
            for (var rj = 0; rj < components.length; rj++) {
              var entry = components[rj];
              if (entry.type !== rType) continue;
              if (entry.rounded !== rRounded) continue;
              stateToComp[entry.state] = entry.component;
            }

            var actionHover    = stateToComp['Action Hover'];
            var actionPressed  = stateToComp['Action Pressed'];
            var triggerHover   = stateToComp['Trigger Hover'];
            var triggerPressed = stateToComp['Trigger Pressed'];

            var stateNamesForRx = Object.keys(stateToComp);
            for (var sx = 0; sx < stateNamesForRx.length; sx++) {
              var srcComp = stateToComp[stateNamesForRx[sx]];
              if (!srcComp) continue;
              /* Reach into the wrapper instance to find Action/Trigger children */
              var srcWrapInst = srcComp.findOne(function(n) { return n.type === 'INSTANCE'; });
              if (!srcWrapInst) continue;
              var srcAction  = srcWrapInst.findOne(function(n) { return n.name === 'Action'; });
              var srcTrigger = srcWrapInst.findOne(function(n) { return n.name === 'Trigger'; });

              if (srcAction && (actionHover || actionPressed)) {
                var rxA = [];
                if (actionHover) {
                  rxA.push({ trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: actionHover.id, navigation: 'CHANGE_TO',
                    transition: { type: 'DISSOLVE', duration: 0.15, easing: { type: 'EASE_IN_AND_OUT' } } }] });
                  stats.reactions++;
                }
                if (actionPressed) {
                  rxA.push({ trigger: { type: 'ON_PRESS' }, actions: [{ type: 'NODE', destinationId: actionPressed.id, navigation: 'CHANGE_TO',
                    transition: { type: 'DISSOLVE', duration: 0.05, easing: { type: 'EASE_IN_AND_OUT' } } }] });
                  stats.reactions++;
                }
                try { await srcAction.setReactionsAsync(rxA); }
                catch (re) { log('Action reactions failed (' + familyName + '/' + rType + '/' + stateNamesForRx[sx] + '): ' + re.message); }
              }

              if (srcTrigger && (triggerHover || triggerPressed)) {
                var rxT = [];
                if (triggerHover) {
                  rxT.push({ trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: triggerHover.id, navigation: 'CHANGE_TO',
                    transition: { type: 'DISSOLVE', duration: 0.15, easing: { type: 'EASE_IN_AND_OUT' } } }] });
                  stats.reactions++;
                }
                if (triggerPressed) {
                  rxT.push({ trigger: { type: 'ON_PRESS' }, actions: [{ type: 'NODE', destinationId: triggerPressed.id, navigation: 'CHANGE_TO',
                    transition: { type: 'DISSOLVE', duration: 0.05, easing: { type: 'EASE_IN_AND_OUT' } } }] });
                  stats.reactions++;
                }
                try { await srcTrigger.setReactionsAsync(rxT); }
                catch (re) { log('Trigger reactions failed (' + familyName + '/' + rType + '/' + stateNamesForRx[sx] + '): ' + re.message); }
              }
            }
          }
        }
      } else {
      /* ── General prototype reactions (button-family + track-thumb) ────────
         Helper: produce a single Reaction object.
         • DISSOLVE 0.15s for hover-speed transitions
         • DISSOLVE 0.05s for press-speed transitions
         • DISSOLVE 0.20s for toggle-click (toggle state change feels deliberate) */
      function _makeRx(trigType, destId, dur) {
        return {
          trigger: { type: trigType },
          actions: [{
            type: 'NODE',
            destinationId: destId,
            navigation: 'CHANGE_TO',
            transition: { type: 'DISSOLVE', duration: dur || 0.15,
                          easing: { type: 'EASE_IN_AND_OUT' } }
          }]
        };
      }

      for (var ri = 0; ri < famTypes.length; ri++) {
        var rType = famTypes[ri];
        for (var rri = 0; rri < roundedValues.length; rri++) {
          var rRounded = roundedValues[rri];

          /* Build a state → component map for this (type, rounded) slice */
          var _stMap = {};
          for (var rj = 0; rj < components.length; rj++) {
            if (components[rj].type    !== rType)    continue;
            if (components[rj].rounded !== rRounded) continue;
            _stMap[components[rj].state] = components[rj].component;
          }

          /* ── Reaction map: stateName → [Reaction, …] ── */
          var _rxMap = {};

          if (BP.kind === 'track-thumb') {
            /* STATEFUL toggle — MOUSE_ENTER/LEAVE for hover, ON_CLICK to toggle.
               Why MOUSE_ENTER/LEAVE (not ON_HOVER):
               ON_HOVER is a "while" trigger that auto-reverts when the pointer
               leaves. That is fine for stateless buttons but breaks toggles —
               an ON_HOVER-introduced Off-Hover state would revert to Off even
               after the user has clicked to On-Hover, undoing the click.
               MOUSE_ENTER fires once on entry (persists), MOUSE_LEAVE fires once
               on exit (persists) → clean deterministic state machine.

               State machine:
                 Off        : ENTER→Off-Hover,  CLICK→On
                 Off-Hover  : LEAVE→Off,         CLICK→On-Hover (or On)
                 On         : ENTER→On-Hover,   CLICK→Off
                 On-Hover   : LEAVE→On,          CLICK→Off-Hover (or Off)      */
            var _offC   = _stMap['Off'];
            var _offHC  = _stMap['Off-Hover'];
            var _onC    = _stMap['On'];
            var _onHC   = _stMap['On-Hover'];
            if (_offC && _onC) {
              _rxMap['Off'] = [];
              if (_offHC) _rxMap['Off'].push(_makeRx('MOUSE_ENTER', _offHC.id, 0.1));
              _rxMap['Off'].push(_makeRx('ON_CLICK', _onC.id, 0.2));

              if (_offHC) {
                var _offHClick = _onHC || _onC;
                _rxMap['Off-Hover'] = [
                  _makeRx('MOUSE_LEAVE', _offC.id, 0.1),
                  _makeRx('ON_CLICK',    _offHClick.id, 0.2)
                ];
              }

              _rxMap['On'] = [];
              if (_onHC) _rxMap['On'].push(_makeRx('MOUSE_ENTER', _onHC.id, 0.1));
              _rxMap['On'].push(_makeRx('ON_CLICK', _offC.id, 0.2));

              if (_onHC) {
                var _onHClick = _offHC || _offC;
                _rxMap['On-Hover'] = [
                  _makeRx('MOUSE_LEAVE', _onC.id, 0.1),
                  _makeRx('ON_CLICK',    _onHClick.id, 0.2)
                ];
              }
            }
          } else {
            /* STATELESS button-family — ON_HOVER / ON_PRESS "while" triggers.
               ON_HOVER auto-reverts to Default when the pointer leaves.
               ON_PRESS auto-reverts when the pointer is released.

               State machine:
                 Default : HOVER→Hover,  PRESS→Pressed
                 Hover   : PRESS→Pressed  (press while already hovering)         */
            var _defC  = _stMap['Default'];
            var _hovC  = _stMap['Hover'];
            var _preC  = _stMap['Pressed'];
            if (_defC) {
              _rxMap['Default'] = [];
              if (_hovC) _rxMap['Default'].push(_makeRx('ON_HOVER',  _hovC.id, 0.15));
              if (_preC) _rxMap['Default'].push(_makeRx('ON_PRESS',  _preC.id, 0.05));
            }
            /* Hover → Pressed: pressing while already in the hover state */
            if (_hovC && _preC) {
              _rxMap['Hover'] = [ _makeRx('ON_PRESS', _preC.id, 0.05) ];
            }
          }

          /* Apply the reactions map */
          var _rxStates = Object.keys(_rxMap);
          for (var rxi = 0; rxi < _rxStates.length; rxi++) {
            var _rxSt   = _rxStates[rxi];
            var _rxComp = _stMap[_rxSt];
            var _rxList = _rxMap[_rxSt];
            if (!_rxComp || !_rxList || _rxList.length === 0) continue;
            try {
              await _rxComp.setReactionsAsync(_rxList);
              stats.reactions += _rxList.length;
            } catch (re) {
              log('Reaction wiring failed (' + familyName + '/' + rType + '/' + _rxSt + '): ' + re.message);
              stats.errors.push('Reactions ' + familyName + '/' + rType + '/' + _rxSt + ': ' + re.message);
            }
          }
        }
      }
      } /* end general/wrapper reactions branch */


      allComponentSets.push(componentSet);

      /* ── Position inside variant section with styled labels ── */

      /* Sub-heading card for this family + master combo */
      var setHeadingCard = createCard({
        name: 'heading-' + familyName + '-' + mName,
        fill: COLOR_HEADER_BG,
        radius: 10,
        padX: 20,
        padY: 12,
        gap: 0,
        direction: 'HORIZONTAL'
      });
      setHeadingCard.counterAxisAlignItems = 'CENTER';
      setHeadingCard.itemSpacing = 12;
      setHeadingCard.appendChild(createLabel(BP.singleFamily ? mName : (familyName + ' · ' + mName), 14, true, COLOR_HEADING));
      var slotLabel = (BP.masters[mName].slots && BP.masters[mName].slots.join(' + '))
                   || (BP.masters[mName].buttonMaster ? 'action + chevron' : '')
                   || (BP.kind === 'track-thumb'
                       ? (masterCfg.isLabeled ? 'labeled track \u00b7 thumb' : 'track \u00b7 thumb')
                       : '');
      var slotBadge = createBadge(slotLabel, COLOR_CM_BG, COLOR_DIMMED);
      setHeadingCard.appendChild(slotBadge);
      variantSec.section.appendChild(setHeadingCard);
      setHeadingCard.x = variantSec.innerX;
      setHeadingCard.y = varSecContentY;
      varSecContentY += setHeadingCard.height + 20;

      /* Bind sub-heading to surface tokens */
      if (t2Col && brightModeId) {
        try {
          setHeadingCard.setExplicitVariableModeForCollection(t2Col, brightModeId);
          tryBindFill(setHeadingCard, t2Vars['default/surfaces/strong']);
          if (setHeadingCard.children.length > 0) tryBindFill(setHeadingCard.children[0], t2Vars['default/content/strong']);
          tryBindFill(slotBadge, t2Vars['default/component/bg-default']);
          if (slotBadge.children.length > 0) tryBindFill(slotBadge.children[0], t2Vars['default/content/subtle']);
        } catch (e) {}
      }

      /* Component set X offset (leave room for row labels) */
      var csX = variantSec.innerX + ROW_LABEL_WIDTH;
      var csY = varSecContentY + COL_HEADER_HEIGHT;

      /* Column header bar */
      var colHeaderBar = figma.createFrame();
      colHeaderBar.name = 'col-headers-' + familyName + '-' + mName;
      colHeaderBar.resize(totalW, 34);
      colHeaderBar.cornerRadius = 8;
      colHeaderBar.fills = [{ type: 'SOLID', color: COLOR_HEADER_BG }];
      colHeaderBar.clipsContent = false;

      for (var chi = 0; chi < _gridStates.length; chi++) {
        var colH = createLabel(_gridStates[chi], 11, true, COLOR_DIMMED);
        colHeaderBar.appendChild(colH);
        colH.x = padX + chi * colSpacing;
        colH.y = 10;
        tryBindFill(colH, t2Vars['default/content/subtle']);
      }
      variantSec.section.appendChild(colHeaderBar);
      colHeaderBar.x = csX;
      colHeaderBar.y = varSecContentY;
      tryBindFill(colHeaderBar, t2Vars['default/surfaces/strong']);

      /* Row labels — printed twice: once for the Rounded=False block (top
         half) and again for the Rounded=True block (bottom half). A small
         section sub-header marks each block so the static layout reads
         clearly even though the variant property panel already exposes
         a "Rounded" toggle. */
      var halfBlockOffset = blockHeight + roundedBlockGap;

      /* Row label sub-header: only show shape label when Rounded axis exists.
         With skipRounded, each master IS its own shape — no sub-header needed. */
      if (!BP.skipRounded) {
        var squareHdr = createLabel('Square (Default)', 10, true, COLOR_DIMMED);
        variantSec.section.appendChild(squareHdr);
        squareHdr.x = variantSec.innerX + 4;
        squareHdr.y = csY + 6;
        tryBindFill(squareHdr, t2Vars['default/content/subtle']);
      }

      if (!BP.skipRounded) {
        var pillHdr = createLabel('Pill (Rounded=True)', 10, true, COLOR_DIMMED);
        variantSec.section.appendChild(pillHdr);
        pillHdr.x = variantSec.innerX + 4;
        pillHdr.y = csY + halfBlockOffset + 6;
        tryBindFill(pillHdr, t2Vars['default/content/subtle']);
      }

      for (var rhi = 0; rhi < _gridTypes.length; rhi++) {
        /* Square block label (always shown) */
        var rowLabel = createLabel(_gridTypes[rhi], 11, false, COLOR_BODY);
        variantSec.section.appendChild(rowLabel);
        rowLabel.x = variantSec.innerX + 4;
        rowLabel.y = csY + padY + rhi * rowSpacing + 8;
        tryBindFill(rowLabel, t2Vars['default/content/default']);

        /* Pill block label — only when Rounded axis exists */
        if (!BP.skipRounded) {
          var rowLabelPill = createLabel(_gridTypes[rhi], 11, false, COLOR_BODY);
          variantSec.section.appendChild(rowLabelPill);
          rowLabelPill.x = variantSec.innerX + 4;
          rowLabelPill.y = csY + padY + rhi * rowSpacing + 8 + halfBlockOffset;
          tryBindFill(rowLabelPill, t2Vars['default/content/default']);
        }
      }

      /* Place the component set */
      variantSec.section.appendChild(componentSet);
      componentSet.x = csX;
      componentSet.y = csY;
      varSecContentY = csY + totalH + 40;

      /* Separator line between groups (except very last family of last master) */
      var isLastFamily = (famI === familyNames.length - 1);
      var isLastMaster = (mci === masterNames.length - 1);
      if (!(isLastFamily && isLastMaster)) {
        var groupDiv = createDivider(SECTION_W - 80);
        variantSec.section.appendChild(groupDiv);
        groupDiv.x = variantSec.innerX;
        groupDiv.y = varSecContentY;
        tryBindFill(groupDiv, t2Vars['default/surfaces/separator']);
        varSecContentY += 24;
      }

      log('Created component set: ' + setDisplayName + ' (' + components.length + ' variants)');
      } /* end !BP.unified — non-unified combineAsVariants */
    } /* end families loop */
  }

  /* ── Unified component set (e.g. Switch with Pill + Label boolean axes) ──
     After all 4 master iterations have accumulated variants into _unifiedComps,
     create ONE component set named BP.name ("Switch"). Variant names encode all
     axes: "State=Off, Type=Fill, Pill=Off, Label=Off" — Figma renders
     Pill= and Label= as boolean toggles; State= as the first (topmost) dropdown. */
  if (BP.unified && _unifiedComps && _unifiedComps.length > 0) {
    figma.ui.postMessage({ type: 'gen-progress', text: 'Combining unified ' + BP.name + '…' });

    var _uAllComps = [];
    for (var _uai = 0; _uai < _unifiedComps.length; _uai++) {
      _uAllComps.push(_unifiedComps[_uai].component);
    }

    var _uComponentSet;
    var _uSemIdKey = 'dtf::' + BP.name;
    var _uReuseTarget = (SAFE_REBUILD && (reuseSetByName[BP.name] || reuseSetBySemanticId[_uSemIdKey])) || null;

    /* Schema-change guard: if 0 old variants match the new spec, force fresh.
       Both old keys and new names are normalised to canonical sorted form so
       axis reordering (e.g. Pill-first → State-first) never triggers a false
       full-schema-change and never orphans placed instances. */
    if (_uReuseTarget && !_uReuseTarget.removed) {
      var _uNewNameSet = {};
      for (var _unni = 0; _unni < _uAllComps.length; _unni++) {
        if (_uAllComps[_unni].name) {
          var _unnCK = _uAllComps[_unni].name.split(/,\s*/).sort().join('|');
          _uNewNameSet[_unnCK] = true;
        }
      }
      var _uOldKeys = Object.keys(_unifiedVarMap); /* already canonical keys */
      var _uMatchCount = 0;
      for (var _uoki = 0; _uoki < _uOldKeys.length; _uoki++) {
        if (_uNewNameSet[_uOldKeys[_uoki]]) _uMatchCount++;
      }
      if (_uOldKeys.length > 0 && _uMatchCount === 0) {
        log('SAFE_REBUILD unified: 0/' + _uOldKeys.length + ' match \u2014 fresh set for "' + BP.name + '"');
        try { _uReuseTarget.remove(); } catch (_ure) {}
        _uReuseTarget = null;
      }
    }

    if (_uReuseTarget && !_uReuseTarget.removed) {
      try {
        /* STEP 1: prune stale variants (unconsumed _unifiedVarMap entries). */
        var _uStaleKeys = Object.keys(_unifiedVarMap);
        for (var _usk = 0; _usk < _uStaleKeys.length; _usk++) {
          var _uStale = _unifiedVarMap[_uStaleKeys[_usk]];
          if (_uStale && !_uStale.removed) { try { _uStale.remove(); } catch (_use) {} }
        }
        /* Guard: Figma auto-deletes an empty ComponentSet. */
        if (_uReuseTarget.removed) {
          log('SAFE_REBUILD unified: auto-deleted after prune \u2014 falling back to combineAsVariants');
          _uComponentSet = figma.combineAsVariants(_uAllComps, page);
        } else {
          /* STEP 2: append only truly new variants (not reused in-place). */
          for (var _uai2 = 0; _uai2 < _uAllComps.length; _uai2++) {
            var _uNewC = _uAllComps[_uai2];
            if (_uNewC.parent && _uNewC.parent.id === _uReuseTarget.id) continue;
            try { _uReuseTarget.appendChild(_uNewC); } catch (_uae) {}
          }
          _uComponentSet = _uReuseTarget;
          log('SAFE_REBUILD: reused unified set "' + BP.name + '" id=' + _uReuseTarget.id);
        }
      } catch (_urue) {
        log('SAFE_REBUILD unified failed, falling back: ' + _urue.message);
        _uComponentSet = figma.combineAsVariants(_uAllComps, page);
      }
    } else {
      _uComponentSet = figma.combineAsVariants(_uAllComps, page);
    }

    _uComponentSet.name = BP.name;
    stampOwner(_uComponentSet);
    /* Allow focus-ring drop-shadow effects to overflow the set bounds. */
    try { _uComponentSet.clipsContent = false; } catch(_uccE) {}
    try { _uComponentSet.setPluginData('dtf-set-id', 'dtf::' + BP.name); } catch(_uSidE) {}
    _uComponentSet.description = BP.description || '';

    /* ── Expose LabelOn / LabelOff as component text properties ───────────
       Designers can edit the "ON"/"OFF" text directly in the Design panel
       (useful for localization or alternate labels like "Yes"/"No").
       addComponentProperty is called ONCE (on the first labeled variant)
       — it propagates to the entire component set. Subsequent labeled
       variants just reference the already-registered key. */
    var _uLblOnKey  = null;
    var _uLblOffKey = null;
    for (var _upi2 = 0; _upi2 < _uAllComps.length; _upi2++) {
      var _uPComp   = _uAllComps[_upi2];
      var _uTxtOn   = _uPComp.findOne(function(n) { return n.type === 'TEXT' && n.name === 'LabelOn'; });
      var _uTxtOff  = _uPComp.findOne(function(n) { return n.type === 'TEXT' && n.name === 'LabelOff'; });
      if (!_uTxtOn && !_uTxtOff) continue; /* skip Label=Off variants */
      if (!_uLblOnKey && _uTxtOn) {
        try { _uLblOnKey  = _uPComp.addComponentProperty('LabelOn',  'TEXT', 'ON');  } catch (_upe) {}
      }
      if (!_uLblOffKey && _uTxtOff) {
        try { _uLblOffKey = _uPComp.addComponentProperty('LabelOff', 'TEXT', 'OFF'); } catch (_upe) {}
      }
      if (_uLblOnKey  && _uTxtOn)  {
        try { _uTxtOn.componentPropertyReferences  = { characters: _uLblOnKey };  } catch (_ube) {}
      }
      if (_uLblOffKey && _uTxtOff) {
        try { _uTxtOff.componentPropertyReferences = { characters: _uLblOffKey }; } catch (_ube) {}
      }
    }

    /* ── Grid layout constants (shared with presentation code below) ──── */
    var _uColSpacing  = (BP.gridLayout && BP.gridLayout.colSpacing) || 88;
    var _uRowSpacing  = (BP.gridLayout && BP.gridLayout.rowSpacing) || 40;
    var _uCompW       = (BP.gridLayout && BP.gridLayout.componentW) || 72;
    var _uCompH       = (BP.gridLayout && BP.gridLayout.componentH) || 28;
    var _uFamStates   = [];
    var _uFamTypes    = [];
    var _uFamFamilies = Object.keys(BP.families || {});
    if (_uFamFamilies.length > 0) {
      var _uFam = BP.families[_uFamFamilies[0]];
      _uFamStates = _uFam.states || [];
      _uFamTypes  = _uFam.types  || [];
    }
    /* Row ordering: Pill=Off first (Square group), then Pill=On (Pill group).
       Within each Pill group: Label=Off rows first, then Label=On rows. */
    var _uPillVals    = ['Off', 'On'];
    var _uLabelVals   = ['Off', 'On'];
    var _uRowKeys     = [];
    for (var _upvi = 0; _upvi < _uPillVals.length; _upvi++) {
      for (var _ulvi = 0; _ulvi < _uLabelVals.length; _ulvi++) {
        for (var _utvi = 0; _utvi < _uFamTypes.length; _utvi++) {
          _uRowKeys.push('Pill=' + _uPillVals[_upvi] + ',Label=' + _uLabelVals[_ulvi] + ',Type=' + _uFamTypes[_utvi]);
        }
      }
    }
    var _uRowsPerPill = _uLabelVals.length * _uFamTypes.length; /* e.g. 4 */
    var _uPillGap     = 40;   /* gap between Square and Pill groups */
    var _uPadX        = 24;
    var _uPadY        = 36;

    /* Position each variant inside the component set. */
    for (var _ugi = 0; _ugi < _unifiedComps.length; _ugi++) {
      var _uEntry  = _unifiedComps[_ugi];
      var _uVName  = _uEntry.component.name;
      var _uPillM  = _uVName.match(/Pill=(\w+)/);
      var _uLblM   = _uVName.match(/Label=(\w+)/);
      var _uTypeM  = _uVName.match(/Type=(\w+)/);
      var _uStateM = _uVName.match(/State=([^,]+)/);
      if (!_uPillM || !_uLblM || !_uTypeM || !_uStateM) continue;
      var _uRowKey  = 'Pill=' + _uPillM[1] + ',Label=' + _uLblM[1] + ',Type=' + _uTypeM[1];
      var _uRowIdx  = _uRowKeys.indexOf(_uRowKey);
      var _uColIdx  = _uFamStates.indexOf(_uStateM[1]);
      if (_uRowIdx < 0 || _uColIdx < 0) continue;
      /* pilGroup=0 → Square; pillGroup=1 → Pill. Each group adds
         (rowsPerPill*rowSpacing + gap) to the y offset. */
      var _uPillGroup = Math.floor(_uRowIdx / _uRowsPerPill);
      _uEntry.component.x = _uPadX + _uColIdx * _uColSpacing;
      _uEntry.component.y = _uPadY
        + (_uRowIdx % _uRowsPerPill) * _uRowSpacing
        + _uPillGroup * (_uRowsPerPill * _uRowSpacing + _uPillGap);
    }

    /* Component set total dimensions.
       Height formula derived from last row y + compH + bottom pad:
         last row y = padY + (rowsPerPill-1)*rowSpacing + 1*(rowsPerPill*rowSpacing+gap)
                    = padY + (2*rowsPerPill-1)*rowSpacing + gap
         totalH = last row y + compH + padY */
    var _uTotalCols = _uFamStates.length;
    var _uTotalW    = _uPadX * 2 + (_uTotalCols - 1) * _uColSpacing + _uCompW;
    var _uTotalH    = _uPadY + (2 * _uRowsPerPill - 1) * _uRowSpacing + _uPillGap + _uCompH + _uPadY;
    try { _uComponentSet.resize(_uTotalW, _uTotalH); } catch (e) {}

    /* ── Presentation: sub-heading card ─────────────────────────────── */
    var _uHeadCard = createCard({
      name: 'heading-unified-' + BP.name,
      fill: COLOR_HEADER_BG,
      radius: 10,
      padX: 20,
      padY: 12,
      gap: 0,
      direction: 'HORIZONTAL'
    });
    _uHeadCard.counterAxisAlignItems = 'CENTER';
    _uHeadCard.itemSpacing = 12;
    _uHeadCard.appendChild(createLabel(
      (_uFamFamilies[0] || 'Success') + ' \u00b7 ' + BP.name,
      14, true, COLOR_HEADING));
    var _uSlotBadge = createBadge('State \u00b7 Type \u00b7 Pill \u00b7 Label', COLOR_CM_BG, COLOR_DIMMED);
    _uHeadCard.appendChild(_uSlotBadge);
    variantSec.section.appendChild(_uHeadCard);
    _uHeadCard.x = variantSec.innerX;
    _uHeadCard.y = varSecContentY;
    varSecContentY += _uHeadCard.height + 20;
    if (t2Col && brightModeId) {
      try {
        _uHeadCard.setExplicitVariableModeForCollection(t2Col, brightModeId);
        tryBindFill(_uHeadCard, t2Vars['default/surfaces/strong']);
        if (_uHeadCard.children.length > 0) tryBindFill(_uHeadCard.children[0], t2Vars['default/content/strong']);
        tryBindFill(_uSlotBadge, t2Vars['default/component/bg-default']);
        if (_uSlotBadge.children.length > 0) tryBindFill(_uSlotBadge.children[0], t2Vars['default/content/subtle']);
      } catch (e) {}
    }

    /* ── Presentation: column header bar (state names) ──────────────── */
    var _uColHdr = figma.createFrame();
    _uColHdr.name = 'col-headers-unified';
    _uColHdr.resize(_uTotalW, 34);
    _uColHdr.cornerRadius = 8;
    _uColHdr.fills = [{ type: 'SOLID', color: COLOR_HEADER_BG }];
    _uColHdr.clipsContent = false;
    for (var _uci = 0; _uci < _uFamStates.length; _uci++) {
      var _uColLabel = createLabel(_uFamStates[_uci], 11, true, COLOR_DIMMED);
      _uColHdr.appendChild(_uColLabel);
      _uColLabel.x = _uPadX + _uci * _uColSpacing;
      _uColLabel.y = 10;
      tryBindFill(_uColLabel, t2Vars['default/content/subtle']);
    }
    var _uRowLabelW = 120;
    var _uCsX = variantSec.innerX + _uRowLabelW;
    variantSec.section.appendChild(_uColHdr);
    _uColHdr.x = _uCsX;
    _uColHdr.y = varSecContentY;
    tryBindFill(_uColHdr, t2Vars['default/surfaces/strong']);
    var _uCsY = varSecContentY + 34; /* component set top = below col header */

    /* ── Presentation: row group sub-headers (Square / Pill) ─────────── */
    var _uSqHdr = createLabel('Square', 10, true, COLOR_DIMMED);
    variantSec.section.appendChild(_uSqHdr);
    _uSqHdr.x = variantSec.innerX + 4;
    _uSqHdr.y = _uCsY + 6;
    tryBindFill(_uSqHdr, t2Vars['default/content/subtle']);

    var _uPillHdr = createLabel('Pill', 10, true, COLOR_DIMMED);
    variantSec.section.appendChild(_uPillHdr);
    _uPillHdr.x = variantSec.innerX + 4;
    /* Pill group starts after Square group + gap */
    _uPillHdr.y = _uCsY + _uRowsPerPill * _uRowSpacing + _uPillGap + 6;
    tryBindFill(_uPillHdr, t2Vars['default/content/subtle']);

    /* ── Presentation: row labels ─────────────────────────────────────── */
    /* 4 row labels per Pill group: Fill, Outline, Fill+label, Outline+label */
    var _uRowLabelTexts = [];
    for (var _urtk = 0; _urtk < _uLabelVals.length; _urtk++) {
      for (var _uttk = 0; _uttk < _uFamTypes.length; _uttk++) {
        _uRowLabelTexts.push(_uFamTypes[_uttk] + (_uLabelVals[_urtk] === 'On' ? ' \u00b7 label' : ''));
      }
    }
    for (var _urli = 0; _urli < _uRowsPerPill; _urli++) {
      var _uRLText = _uRowLabelTexts[_urli] || _uFamTypes[_urli % _uFamTypes.length];
      /* Square group */
      var _uRL = createLabel(_uRLText, 11, false, COLOR_BODY);
      variantSec.section.appendChild(_uRL);
      _uRL.x = variantSec.innerX + 4;
      _uRL.y = _uCsY + _uPadY + _urli * _uRowSpacing + 8;
      tryBindFill(_uRL, t2Vars['default/content/default']);
      /* Pill group */
      var _uRLPill = createLabel(_uRLText, 11, false, COLOR_BODY);
      variantSec.section.appendChild(_uRLPill);
      _uRLPill.x = variantSec.innerX + 4;
      _uRLPill.y = _uCsY + _uPadY + _urli * _uRowSpacing + 8
                   + _uRowsPerPill * _uRowSpacing + _uPillGap;
      tryBindFill(_uRLPill, t2Vars['default/content/default']);
    }

    /* ── Place the component set ─────────────────────────────────────── */
    _uComponentSet.x = _uCsX;
    _uComponentSet.y = _uCsY;
    variantSec.section.appendChild(_uComponentSet);
    varSecContentY = _uCsY + _uTotalH + 40;

    allComponentSets.push(_uComponentSet);
    log('Created unified component set: "' + BP.name + '" (' + _uAllComps.length + ' variants)');
  }

  /* Finalize variant section size and append to page */
  var varSecH = varSecContentY + 40;
  try { variantSec.section.resize(SECTION_W, varSecH); } catch (e) {}
  page.appendChild(variantSec.section);
  variantSec.section.x = PAGE_X;
  variantSec.section.y = cursorY;
  cursorY += varSecH + SECTION_GAP;

  /* Post-build: delete any BP-owned component sets still at page root.
     These are SAFE_REBUILD-rescued sets whose family or master was removed
     from the blueprint (e.g. old 'Brand' family). All newly generated sets
     have been moved into sections above, so anything remaining at root is stale. */
  if (SAFE_REBUILD) {
    var _pageTopKids = page.children ? page.children.slice() : [];
    for (var _ptki = 0; _ptki < _pageTopKids.length; _ptki++) {
      var _ptkNode = _pageTopKids[_ptki];
      if (_ptkNode && _ptkNode.type === 'COMPONENT_SET' && ownedByThisBP(_ptkNode)) {
        try { _ptkNode.remove(); log('Post-build orphan removed: "' + _ptkNode.name + '"'); }
        catch (_pte) { log('Orphan removal failed: ' + _pte.message); }
      }
    }
  }

  /* ── Step 9: Store version metadata ────────────────────── */
  var existingVersions = {};
  try {
    existingVersions = JSON.parse(figma.root.getPluginData('dtf-component-versions') || '{}');
  } catch (e) { /* ignore */ }

  /* One-shot migration: prior builds (before this fix) wrote the
     ledger under "split button" (BP.name lowercased, space intact)
     instead of the registry key "split-button". Carry the old entry
     forward under the correct key so users don't see a stale NEW
     pill after upgrade. Safe to run every build; no-op once moved. */
  try {
    var _migMap = { 'split button': 'split-button' };
    for (var _ok in _migMap){
      if (existingVersions[_ok] && !existingVersions[_migMap[_ok]]){
        existingVersions[_migMap[_ok]] = existingVersions[_ok];
        delete existingVersions[_ok];
      }
    }
  } catch (e) { /* ignore */ }

  /* W1 — capture slim identity surface for the ledger.
     We store only nodeId + name + variantCount (NOT the full variants
     map) to keep the pluginData payload well under Figma's 100 kB
     per-entry limit.  The UI only ever reads Object.keys(cs.variants).length
     so storing the count directly is equivalent. */
  var newComponentSets = [];
  try {
    for (var _ns = 0; _ns < allComponentSets.length; _ns++) {
      var _snap = snapshotComponentSet(allComponentSets[_ns]);
      newComponentSets.push({
        nodeId:       _snap.nodeId,
        name:         _snap.name,
        libraryKey:   _snap.libraryKey || null,
        /* Store count only — variants map can be 20 kB+ per component set */
        variantCount: Object.keys(_snap.variants || {}).length,
        properties:   _snap.properties || {}
      });
    }
  } catch (nse) { /* ignore */ }

  var savedProject = '';
  try { savedProject = figma.root.getPluginData('dtf-project') || ''; } catch (e) {}

  /* W1/M5 — fingerprint the blueprint and bound-token surface so a
     future Build can diff "spec unchanged · tokens differ" etc.
     structureHash: deterministic hash of the BP definition object.
                    Drives the "structure" pill.
     prototypeHash: hash of BP.states + plugin code version + a
                    'wired' marker — reactions are hardcoded in
                    code.js (not in BP data), so a CODE_VERSION
                    bump or a states[] change should re-fire the
                    "prototype" pill. Drives the "prototype" pill.
     tokensHash:    hash of the sorted variable IDs we actually bound
                    during this Build (one entry per id, deduped).
                    Drives the "bindings" pill.
     specHash:      legacy alias of structureHash for M5-part-1
                    readers. New code should read structureHash. */
  var structureHash = '';
  try { structureHash = dtfHash32(dtfStableStringify(BP)); } catch (e) {}
  var specHash = structureHash;
  var prototypeHash = '';
  try {
    /* V6 — CODE_VERSION intentionally NOT included. A plugin update
       that ships new diagnostics or unrelated logic should NOT fire
       the 'Prototype interactions need re-wiring' pill on every
       built component. The real signals are BP.states[] divergence
       (caller changed the state matrix) and whether reactions were
       actually wired (stats.reactions > 0). */
    prototypeHash = dtfHash32(
      'proto:' +
      dtfStableStringify(BP.states || []) + ':' +
      (stats.reactions > 0 ? 'wired' : 'none')
    );
  } catch (e) {}
  var tokensHash = '';
  var boundIds = [];
  try {
    /* Only the IDs we ACTUALLY bound this build. Avoids the
       false-positive "bindings changed" pill that the old behaviour
       (hash all IDs in csMap+t2Map+t3Map) produced after any unrelated
       sync touched those collections. */
    boundIds = Object.keys(_boundIdsForBuild || {});
    boundIds.sort();
    tokensHash = dtfHash32(boundIds.join('|'));
  } catch (e) {}
  /* V3 \u2014 capture id\u2192name map so the Builder pill can show
     human-readable names when bindings break later (variables
     deleted in Figma lose their .name; the ledger keeps it). */
  var boundNames = {};
  try {
    var _bn = _boundNamesForBuild || {};
    for (var _bid in _bn) { if (_bn.hasOwnProperty(_bid)) boundNames[_bid] = _bn[_bid]; }
  } catch (e) {}

  /* Preserve prior hashes so the Builder pill can show "changed since
     last build" without needing to recompute on every prereq ping. */
  /* Ledger key MUST match the registry key the UI uses (data-component
     attribute), not the human-readable BP name. UI looks up
     versions['split-button']; bare blueprint.name.toLowerCase() would
     write 'split button' (with space) and the row would forever show
     NEW even after a successful build. */
  var ledgerKey = String(blueprint.ledgerKey || blueprint.name || '').toLowerCase().replace(/\s+/g, '-');
  var _priorEntry = existingVersions[ledgerKey] || {};

  existingVersions[ledgerKey] = {
    /* Legacy fields (kept for any reader of the old shape) */
    version: '2.0.0',
    nodeIds: allComponentSets.map(function(cs) { return cs.id; }),
    masterFrameId: masterFrame.id,
    generatedAt: new Date().toISOString(),
    families: Object.keys(BP.families || {}),
    types: (function(){ var n=0; var ks=Object.keys(BP.families||{}); for (var i=0;i<ks.length;i++) { var f=BP.families[ks[i]]; n += (f.types&&f.types.length)||0; } return n; })(),
    states: (function(){ var rs=(BP.states&&BP.states.length)||0; var m=0; var ks=Object.keys(BP.families||{}); for (var i=0;i<ks.length;i++) { var f=BP.families[ks[i]]; var L=(f.states&&f.states.length)||rs; if (L>m) m=L; } return m; })(),
    /* V3.1 \u2014 per-family snapshot persisted so the next build's
       "build needed" delta line can say exactly what's changing
       per family (not just an aggregate "176 variants removed"
       number that reads as catastrophic). */
    familyDetail: (function(){
      var out = {};
      var rs = (BP.states && BP.states.length) || 0;
      var ks = Object.keys(BP.families || {});
      for (var i = 0; i < ks.length; i++){
        var f = BP.families[ks[i]] || {};
        var ty = (f.types && f.types.length) || 0;
        var st = (f.states && f.states.length) || rs;
        out[ks[i]] = { types: ty, states: st, variants: ty * st * 2 };
      }
      return out;
    })(),
    totalComponents: stats.components,
    architecture: 'two-tier-master-instance',

    /* W1 — extended ledger shape (schema v1 from §6). Forward-only;
       readers must tolerate missing fields. */
    schemaVersion:  1,
    writtenAt:      new Date().toISOString(),
    writtenBy:      'dtf-plugin@code.js',
    pluginVersion:  CODE_VERSION,
    project:        savedProject,
    pageId:         page.id,
    pageName:       page.name,
    bpKind:         BP.kind || 'standalone',
    componentSets:  newComponentSets,
    axes: {
      color:   true,
      spacing: true,
      radius:  true,
      motion:  (stats.reactions > 0)
    },
    /* M5 fingerprints */
    specHash:         specHash,         /* legacy alias = structureHash */
    structureHash:    structureHash,
    prototypeHash:    prototypeHash,
    tokensHash:       tokensHash,
    /* boundIds / boundNames intentionally NOT persisted — they can be
       50 kB+ and the UI derives binding diffs from tokensHash alone.
       priorSnapshot intentionally NOT persisted — it mirrors componentSets
       from the previous build and is only used during the build itself. */
    prevSpecHash:     _priorEntry.specHash      || '',
    prevStructureHash:_priorEntry.structureHash || _priorEntry.specHash || '',
    prevPrototypeHash:_priorEntry.prototypeHash || '',
    prevTokensHash:   _priorEntry.tokensHash    || ''
  };
  figma.root.setPluginData('dtf-component-versions', JSON.stringify(existingVersions));

  log('Gen complete: ' + stats.components + ' components, ' + stats.bindings + ' bindings, ' + stats.reactions + ' reactions');
  return stats;
}

/* ── Available blueprints registry ───────────────────────── */

var COMPONENT_BLUEPRINTS = {
  button: BUTTON_BLUEPRINT,
  'split-button': SPLIT_BUTTON_BLUEPRINT,
  'menu-button': MENU_BUTTON_BLUEPRINT,
  toggle: TOGGLE_BLUEPRINT
};

/* ── Auto-wire prototype interactions on every COMPONENT_SET on the
   current page. Idempotent — re-running overwrites prior reactions.

   For each set:
     1. Group child variants by every variant prop EXCEPT 'State'.
     2. In each group, find Default and wire ON_HOVER → Hover (150ms)
        and ON_PRESS → Pressed (50ms) sibling variants.
     3. Sub-zone pass: if Default contains a top-level INSTANCE with
        named children (e.g. split-button Action/Trigger), wire those
        children to sibling variants named "<Zone> Hover" / "<Zone> Pressed".

   Returns: { sets, defaults, reactions, subzones, skipped, errors[] } */
async function wireReactionsForCurrentPage() {
  /* State → reaction mapping. Order in this map determines wiring priority
     when multiple states exist (top entries win the trigger slot if
     conflicting). Triggers explained:
       Hover    → ON_HOVER       auto-reverts on mouse-out
       Pressed  → ON_PRESS       auto-reverts on mouse-up
       Selected → ON_CLICK       persists (toggle-style)
       Loading  → AFTER_TIMEOUT  used to simulate async transitions
     Focus / Disabled are intentionally NOT mapped — Figma has no
     :focus-visible trigger and Disabled is a terminal state. */
  var stateMap = {
    'Hover':    { trigger: 'ON_HOVER',       duration: 0.15 },
    'Pressed':  { trigger: 'ON_PRESS',       duration: 0.05 },
    'Selected': { trigger: 'ON_CLICK',       duration: 0.10 },
    'Loading':  { trigger: 'AFTER_TIMEOUT',  duration: 0.20, timeout: 1.0 }
  };
  var stats = { sets: 0, defaults: 0, reactions: 0, subzones: 0, skipped: 0, errors: [] };

  function buildRx(destId, duration, triggerType, opts) {
    var triggerObj = { type: triggerType };
    /* AFTER_TIMEOUT requires a `timeout` field (seconds). */
    if (triggerType === 'AFTER_TIMEOUT' && opts && opts.timeout !== undefined) {
      triggerObj.timeout = opts.timeout;
    }
    return {
      trigger: triggerObj,
      actions: [{
        type: 'NODE',
        destinationId: destId,
        navigation: 'CHANGE_TO',
        transition: { type: 'DISSOLVE', duration: duration, easing: { type: 'EASE_IN_AND_OUT' } }
      }]
    };
  }

  var sets = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET'] });

  for (var si = 0; si < sets.length; si++) {
    var cs = sets[si];
    stats.sets++;

    /* Group child variants by every variant property EXCEPT State */
    var groups = {};
    for (var ci = 0; ci < cs.children.length; ci++) {
      var v = cs.children[ci];
      if (v.type !== 'COMPONENT') continue;
      var vp = v.variantProperties || {};
      if (!vp.State) continue;  /* set has no State axis — skip silently */
      var keyParts = [];
      var keys = Object.keys(vp).sort();
      for (var ki = 0; ki < keys.length; ki++) {
        if (keys[ki] === 'State') continue;
        keyParts.push(keys[ki] + '=' + vp[keys[ki]]);
      }
      var groupKey = keyParts.join('|') || '_default';
      if (!groups[groupKey]) groups[groupKey] = {};
      groups[groupKey][vp.State] = v;
    }

    var groupKeys = Object.keys(groups);
    if (groupKeys.length === 0) {
      stats.skipped++;
      continue;
    }

    for (var gi = 0; gi < groupKeys.length; gi++) {
      var byState = groups[groupKeys[gi]];
      var defaultV = byState['Default'];
      if (!defaultV) {
        var stateNames = Object.keys(byState);
        if (stateNames.length === 0) continue;
        defaultV = byState[stateNames[0]];
      }

      /* ── Top-level reactions on the Default variant ── */
      var rx = [];
      var stateNamesAll = Object.keys(stateMap);
      for (var sni = 0; sni < stateNamesAll.length; sni++) {
        var sName = stateNamesAll[sni];
        var dest = byState[sName];
        if (!dest || dest.id === defaultV.id) continue;
        rx.push(buildRx(dest.id, stateMap[sName].duration, stateMap[sName].trigger, stateMap[sName]));
      }

      if (rx.length > 0) {
        try {
          await defaultV.setReactionsAsync(rx);
          stats.defaults++;
          stats.reactions += rx.length;
        } catch (re) {
          stats.errors.push(cs.name + ' / ' + groupKeys[gi] + ': ' + re.message);
        }
      }

      /* ── Sub-zone reactions (e.g. split-button Action / Trigger) ── */
      var hostInst = defaultV.findOne(function(n) { return n.type === 'INSTANCE'; });
      if (!hostInst || hostInst.children.length === 0) continue;

      for (var zi = 0; zi < hostInst.children.length; zi++) {
        var zone = hostInst.children[zi];
        if (!zone.name) continue;
        var zoneRx = [];
        for (var sji = 0; sji < stateNamesAll.length; sji++) {
          var zSName = stateNamesAll[sji];
          var zoneStateName = zone.name + ' ' + zSName;
          var zoneDestVariant = byState[zoneStateName];
          if (!zoneDestVariant) continue;
          var zoneDestInst = zoneDestVariant.findOne(function(n) { return n.type === 'INSTANCE'; });
          if (!zoneDestInst) continue;
          var destZone = zoneDestInst.findOne(function(n) { return n.name === zone.name; });
          if (!destZone) continue;
          zoneRx.push(buildRx(zoneDestVariant.id, stateMap[zSName].duration, stateMap[zSName].trigger, stateMap[zSName]));
        }
        if (zoneRx.length > 0) {
          try {
            await zone.setReactionsAsync(zoneRx);
            stats.subzones++;
            stats.reactions += zoneRx.length;
          } catch (re) {
            stats.errors.push(cs.name + ' / zone ' + zone.name + ': ' + re.message);
          }
        }
      }
    }
  }

  return stats;
}

/* ── Message handler ─────────────────────────────────────── */

figma.ui.onmessage = async function(msg) {

  if (msg.type === 'scan') {
    try {
      /* Opportunistic cleanup: silently remove CSS-origin font vars from
         primitives-numbers that were exported before CSS_FONT_SKIP was added.
         Runs on every plugin open so it fires even when the plugin shows
         "up to date" (i.e. syncAll never gets called). */
      try {
        var _CSS_PURGE = { 'font/family': true, 'font/family-sans': true, 'font/family-mono': true };
        var _scanCols = await figma.variables.getLocalVariableCollectionsAsync();
        for (var _sci = 0; _sci < _scanCols.length; _sci++) {
          if (_scanCols[_sci].name !== 'primitives-numbers') continue;
          var _scanIds = _scanCols[_sci].variableIds.slice();
          for (var _svi = 0; _svi < _scanIds.length; _svi++) {
            var _sv = await figma.variables.getVariableByIdAsync(_scanIds[_svi]);
            if (_sv && _CSS_PURGE[_sv.name]) {
              try { _sv.remove(); log('scan: purged CSS-origin var: ' + _sv.name); }
              catch (_sve) { log('scan: could not purge ' + _sv.name + ': ' + _sve.message); }
            }
          }
          break;
        }
      } catch (_scanPurgeErr) { /* non-fatal */ }

      var cols = await findDTFCollections();
      var varCount = 0;
      var colNames = [];
      for (var i = 0; i < cols.length; i++) {
        varCount += cols[i].variableIds.length;
        colNames.push(cols[i].name);
      }
      var savedHash = figma.root.getPluginData('dtf-hash') || '';
      var savedVarCount = parseInt(figma.root.getPluginData('dtf-var-count') || '0', 10);
      var savedProject = figma.root.getPluginData('dtf-project') || '';

      /* ── Stale state cleanup ──────────────────────────────────
         If all DTF collections are gone (user deleted them) but
         saved sync state still exists, clear it so the plugin
         starts fresh instead of showing "up to date". Also
         clear the ID map — those variable IDs are all dead. */
      if (varCount === 0 && savedHash) {
        log('Stale state detected: 0 variables but savedHash=' + savedHash + ' — clearing document sync state');
        figma.root.setPluginData('dtf-hash', '');
        figma.root.setPluginData('dtf-var-count', '0');
        saveIdMap({});
        savedHash = '';
        savedVarCount = 0;
      }

      figma.ui.postMessage({
        type: 'scan-result',
        found: cols.length > 0,
        colNames: colNames,
        varCount: varCount,
        savedHash: savedHash,
        savedVarCount: savedVarCount,
        savedProject: savedProject
      });
    } catch (e) {
      figma.ui.postMessage({ type: 'scan-result', found: false, colNames: [], varCount: 0, savedHash: '', savedVarCount: 0 });
    }
  }

  /* Lightweight verify — just check if DTF variables still exist */
  if (msg.type === 'verify') {
    try {
      var cols = await findDTFCollections();
      var varCount = 0;
      for (var i = 0; i < cols.length; i++) {
        varCount += cols[i].variableIds.length;
      }
      /* Heal icon color bindings on every verify (cheap, idempotent).
         Verify fires on plugin open + manual refresh, so this catches
         icon swaps even when no token sync is pending ("You're up to
         date"). Silent unless paints were actually rebound. */
      try {
        var verifyRebind = await rebindIconPlaceholderPaints();
        if (verifyRebind.rebound > 0) {
          figma.notify('DTF: rebound ' + verifyRebind.rebound + ' icon paint' +
            (verifyRebind.rebound === 1 ? '' : 's') + ' to role colors across ' +
            verifyRebind.variantsTouched + ' button variant' +
            (verifyRebind.variantsTouched === 1 ? '' : 's') + '.');
        }
      } catch (rbe) { log('verify rebind skipped: ' + rbe.message); }
      figma.ui.postMessage({ type: 'verify-result', varCount: varCount });
    } catch (e) {
      /* Report error instead of false zero — prevents false undo detection */
      figma.ui.postMessage({ type: 'verify-result', varCount: -1, error: e.message });
    }
  }

  /* Explicit "Repair icon colors" command — same as the auto-run on
     verify/sync, but the user can trigger it on demand (e.g. after
     manually editing a button master). Always notifies, even if zero
     rebinds, so the user gets confirmation. */
  if (msg.type === 'repair-icons') {
    try {
      var rep = await rebindIconPlaceholderPaints();
      figma.notify(rep.rebound === 0
        ? 'DTF: all icon colors are correct (' + rep.placeholders + ' placeholder' +
          (rep.placeholders === 1 ? '' : 's') + ' scanned).'
        : 'DTF: rebound ' + rep.rebound + ' icon paint' +
          (rep.rebound === 1 ? '' : 's') + ' across ' + rep.variantsTouched +
          ' button variant' + (rep.variantsTouched === 1 ? '' : 's') + '.');
      figma.ui.postMessage({ type: 'repair-icons-done', report: rep });
    } catch (e) {
      figma.notify('DTF: icon repair failed — ' + e.message, { error: true });
    }
  }

  if (msg.type === 'sync') {
    try {
      figma.ui.postMessage({ type: 'progress', text: '[' + CODE_VERSION + '] Syncing T0 → T1 → T2/T3...' });
      var stats = await syncAll(msg.data);
      var syncHash = msg.hash || '';
      /* Persist sync state to this document */
      figma.root.setPluginData('dtf-hash', syncHash);
      figma.root.setPluginData('dtf-var-count', String(stats.variables));
      if (msg.project) figma.root.setPluginData('dtf-project', msg.project);

      /* Path C — auto-heal icon color bindings. When a designer has
         swapped Icon/Placeholder for an external icon, the swapped
         icon's vectors carry literal SOLID paints. Rebind them to
         the content-color variable so buttons recolor correctly.
         Idempotent; runs every sync; silent unless paints were
         actually rebound or a warning needs surfacing. */
      var iconReport = await rebindIconPlaceholderPaints();
      stats.iconPaintsRebound = iconReport.rebound;
      stats.iconWarnings = iconReport.warnings;

      figma.ui.postMessage({ type: 'done', stats: stats, hash: syncHash });
      var notifyMsg =
        'DTF: ' + stats.variables + ' vars (' + stats.updated + ' updated, ' +
        stats.created + ' created' +
        (stats.renamed > 0 ? ', ' + stats.renamed + ' renamed' : '') +
        (stats.orphansRemoved > 0 ? ', ' + stats.orphansRemoved + ' orphans removed' : '') +
        '), ' + stats.aliases + ' aliases' +
        (stats.errors.length > 0 ? ' (' + stats.errors.length + ' errors)' : '');
      if (iconReport.rebound > 0) {
        notifyMsg += ' • rebound ' + iconReport.rebound + ' icon paint' +
                     (iconReport.rebound === 1 ? '' : 's') + ' to content color';
      }
      figma.notify(notifyMsg);
      if (iconReport.warnings.length > 0) {
        figma.notify('Icon rebinder: ' + iconReport.warnings.length +
                     ' paint' + (iconReport.warnings.length === 1 ? '' : 's') +
                     ' need manual review (gradients/images). See plugin logs.',
                     { timeout: 6000 });
        for (var wi = 0; wi < iconReport.warnings.length; wi++) {
          log('icon-rebind warning: ' + iconReport.warnings[wi]);
        }
      }
    } catch (e) {
      figma.ui.postMessage({ type: 'error', error: e.message });
    }
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }

  /* User dragged the resize handle in the bottom-right corner. */
  if (msg.type === 'resize') {
    var w = Math.max(360, Math.min(2000, Math.round(msg.width || 480)));
    var h = Math.max(420, Math.min(2000, Math.round(msg.height || 560)));
    figma.ui.resize(w, h);
    try { figma.clientStorage.setAsync('dtf-panel-size', { width: w, height: h }); } catch (e) {}
  }

  /* "Reset window size" menu action from the UI. */
  if (msg.type === 'reset-panel-size') {
    figma.ui.resize(480, 560);
    try { figma.clientStorage.setAsync('dtf-panel-size', { width: 480, height: 560 }); } catch (e) {}
  }

  /* UI requests user info (in case the initial delayed message was missed) */
  if (msg.type === 'get-user-info') {
    sendUserInfo();
  }

  /* Open external URL in the user's default browser. Used by the
     "Version history" menu item to hand off to the DTF web app
     where the full per-commit history dialog lives. */
  if (msg.type === 'open-external' && msg.url) {
    try { figma.openExternal(msg.url); } catch (e) {}
  }

  /* Reset ID map — useful when rename state is corrupted */
  if (msg.type === 'reset-idmap') {
    saveIdMap({});
    figma.root.setPluginData('dtf-hash', '');
    log('ID map and hash cleared — next sync will use name-based matching');
    figma.ui.postMessage({ type: 'progress', text: 'ID map cleared. Click sync to re-sync fresh.' });
    figma.notify('DTF: ID map cleared — press Sync to apply fresh');
  }

  /* Persist URL to clientStorage when user changes it in UI */
  if (msg.type === 'save-server-url' && msg.url) {
    figma.clientStorage.setAsync('dtf-server-url', msg.url).catch(function() {});
  }

  /* Persist GitHub credentials (username + PAT) so the user never has to
     re-enter them after a successful Connect. */
  if (msg.type === 'save-creds') {
    try {
      if (msg.username !== undefined) await figma.clientStorage.setAsync('dtf-gh-username', msg.username || '');
      if (msg.pat !== undefined)      await figma.clientStorage.setAsync('dtf-gh-pat',      msg.pat || '');
    } catch (e) { log('save-creds failed: ' + e.message); }
  }

  /* Persist DTF bearer token (linked plugin account) */
  if (msg.type === 'save-bearer-token') {
    try {
      await figma.clientStorage.setAsync('dtf-bearer-token', msg.token || '');
    } catch (e) { log('save-bearer-token failed: ' + e.message); }
  }

  if (msg.type === 'clear-bearer-token') {
    try {
      await figma.clientStorage.deleteAsync('dtf-bearer-token');
    } catch (e) { /* ignore */ }
  }

  if (msg.type === 'clear-creds') {
    try {
      await figma.clientStorage.deleteAsync('dtf-gh-username');
      await figma.clientStorage.deleteAsync('dtf-gh-pat');
    } catch (e) { /* ignore */ }
  }

  /* ── Dump current variables (used by UI to synthesize a diff on
       static hosts where no /changelog endpoint exists) ───────── */
  if (msg.type === 'dump-current-tokens') {
    try {
      var dtfCols = await findDTFCollections();
      /* Pre-resolve all variable IDs → names so aliases can be encoded
         as their target NAME (matching tokens.json's alias shape).
         Without this, an alias dumped as {id:'VariableID:42'} and the
         same alias in tokens.json as {name:'prim/brand/500'} will
         compare as different on every single row, flooding the diff. */
      var idToName = {};
      for (var pci = 0; pci < dtfCols.length; pci++) {
        var pcCol = dtfCols[pci];
        for (var pvi = 0; pvi < pcCol.variableIds.length; pvi++) {
          var pid = pcCol.variableIds[pvi];
          try {
            var pv = await figma.variables.getVariableByIdAsync(pid);
            if (pv) idToName[pid] = pv.name;
          } catch (e) { /* ignore */ }
        }
      }
      var out = { collections: [] };
      for (var dci = 0; dci < dtfCols.length; dci++) {
        var dcCol = dtfCols[dci];
        var modeIdToName = {};
        for (var mmi = 0; mmi < dcCol.modes.length; mmi++) {
          modeIdToName[dcCol.modes[mmi].modeId] = dcCol.modes[mmi].name;
        }
        var outVars = [];
        var varIds = dcCol.variableIds.slice();
        for (var dvi = 0; dvi < varIds.length; dvi++) {
          var vv = await figma.variables.getVariableByIdAsync(varIds[dvi]);
          if (!vv) continue;
          var vbm = {};
          var modeIds = Object.keys(vv.valuesByMode || {});
          for (var dmi = 0; dmi < modeIds.length; dmi++) {
            var mId = modeIds[dmi];
            var raw = vv.valuesByMode[mId];
            var modeName = modeIdToName[mId] || mId;
            if (raw && raw.type === 'VARIABLE_ALIAS') {
              vbm[modeName] = { alias: true, id: raw.id, name: idToName[raw.id] || '' };
            } else if (vv.resolvedType === 'COLOR' && raw && typeof raw === 'object') {
              vbm[modeName] = rgbToHex(raw);
            } else {
              vbm[modeName] = raw;
            }
          }
          outVars.push({ name: vv.name, type: vv.resolvedType, valuesByMode: vbm });
        }
        out.collections.push({ name: dcCol.name, modes: dcCol.modes.map(function(m){ return m.name; }), variables: outVars });
      }
      figma.ui.postMessage({ type: 'current-tokens', data: out });
    } catch (e) {
      log('dump-current-tokens failed: ' + e.message);
      figma.ui.postMessage({ type: 'current-tokens', data: { collections: [] } });
    }
  }

  /* ── Component Generation ─────────────────────────────── */

  if (msg.type === 'generate-components') {
    try {
      var requested = msg.components || ['button'];
      /* Ensure dependencies are generated first. Split-button instances the
         button master, so button must run earlier in the same dispatch. */
      var depOrder = { 'button': 0, 'split-button': 1, 'menu-button': 2, 'toggle': 3 };
      requested.sort(function(a, b) {
        var oa = depOrder[a.toLowerCase()]; if (oa === undefined) oa = 99;
        var ob = depOrder[b.toLowerCase()]; if (ob === undefined) ob = 99;
        return oa - ob;
      });
      var allStats = { components: 0, bindings: 0, reactions: 0, errors: [] };
      /* Track which pages received components so we can wire all of them. */
      var _usedPages = {}; /* pageName → PageNode */

      for (var gci = 0; gci < requested.length; gci++) {
        var compName = requested[gci].toLowerCase();
        var blueprint = COMPONENT_BLUEPRINTS[compName];
        if (!blueprint) {
          allStats.errors.push('Unknown component: ' + compName);
          continue;
        }
        log('Generating component: ' + blueprint.name);
        var cStats = await generateComponentFromBlueprint(blueprint);
        allStats.components += cStats.components;
        allStats.bindings += cStats.bindings;
        allStats.reactions += cStats.reactions;
        for (var ei = 0; ei < cStats.errors.length; ei++) {
          allStats.errors.push(cStats.errors[ei]);
        }
        /* Record the page this blueprint just wrote to. */
        _usedPages[figma.currentPage.name] = figma.currentPage;
      }

      /* Auto-wire prototype interactions on EVERY page that received
         components. Idempotent — safe to run multiple times per page. */
      figma.ui.postMessage({ type: 'gen-progress', text: 'Auto-wiring prototype interactions…' });
      var _usedPageNames = Object.keys(_usedPages);
      for (var _wpi = 0; _wpi < _usedPageNames.length; _wpi++) {
        try {
          await figma.setCurrentPageAsync(_usedPages[_usedPageNames[_wpi]]);
          var wireStats = await wireReactionsForCurrentPage();
          allStats.reactions += wireStats.reactions;
          for (var wei = 0; wei < wireStats.errors.length; wei++) {
            allStats.errors.push('Wire: ' + wireStats.errors[wei]);
          }
          log('Auto-wired ' + wireStats.reactions + ' reactions on page “' + _usedPageNames[_wpi] + '”');
        } catch (we) {
          log('Auto-wire failed on page “' + _usedPageNames[_wpi] + '”: ' + we.message);
          allStats.errors.push('Auto-wire (' + _usedPageNames[_wpi] + '): ' + we.message);
        }
      }

      /* Post-build icon color heal — runs AFTER all variants are committed
         to the page tree so that ghost-node overrides inside floating
         instances (which can silently fail to persist through combineAsVariants)
         are replaced with correct role-variable bindings in the live document.
         Idempotent; mirrors the same pass run on sync/verify. */
      figma.ui.postMessage({ type: 'gen-progress', text: 'Healing icon colors…' });
      try {
        var genRebind = await rebindIconPlaceholderPaints();
        allStats.bindings += genRebind.rebound;
        for (var gri = 0; gri < genRebind.warnings.length; gri++) {
          allStats.errors.push('icon-color: ' + genRebind.warnings[gri]);
        }
        if (genRebind.rebound > 0) {
          log('Post-build icon rebind: ' + genRebind.rebound + ' paints across ' +
              genRebind.variantsTouched + ' variants');
        }
      } catch (gre) {
        log('Post-build icon rebind skipped: ' + gre.message);
      }

      figma.ui.postMessage({ type: 'gen-done', stats: allStats });
      figma.notify(
        'DTF: Generated ' + allStats.components + ' component variants, ' +
        allStats.bindings + ' variable bindings, ' +
        allStats.reactions + ' reactions' +
        (allStats.errors.length > 0 ? ' (' + allStats.errors.length + ' errors)' : '')
      );
    } catch (e) {
      var detail = e && e.stack ? (e.message + ' \u2014 ' + e.stack.split('\n').slice(0,3).join(' \u2192 ')) : (e && e.message) || String(e);
      figma.ui.postMessage({ type: 'gen-error', error: detail });
      log('Component gen error: ' + detail);
    }
  }

  /* ── Auto-wire Prototype Interactions ────────────────────
     Defined as a module-level helper (wireReactionsForCurrentPage)
     and invoked automatically at the end of every component-generation
     pass — see the 'generate-components' handler above. No manual
     trigger needed. */

  /* Check prerequisite status for component generation */
  if (msg.type === 'check-gen-prereqs') {
    try {
      var csMap = await buildCollectionVarMap('comp size');
      var t2Map = await buildCollectionVarMap('T2 Surface Context Tokens');
      var t3Map = await buildCollectionVarMap('T3 Status Context Tokens');
      var versions = {};
      try {
        versions = JSON.parse(figma.root.getPluginData('dtf-component-versions') || '{}');
      } catch (e) { /* ignore */ }

      /* Self-healing migration for legacy ledger keys (see ledger
         writer comment in generateComponentFromBlueprint). Older
         builds wrote 'split button' (space); UI looks up the
         hyphenated registry key. Rename in place AND persist so
         the user doesn't have to rebuild to clear the NEW pill. */
      try {
        var _migMap = { 'split button': 'split-button' };
        var _migDirty = false;
        for (var _ok in _migMap){
          if (versions[_ok] && !versions[_migMap[_ok]]){
            versions[_migMap[_ok]] = versions[_ok];
            delete versions[_ok];
            _migDirty = true;
          }
        }
        if (_migDirty){
          figma.root.setPluginData('dtf-component-versions', JSON.stringify(versions));
        }
      } catch (e) { /* ignore */ }

      /* Drop ledger entries whose component sets no longer exist in
         the file (designer deleted Button / Split Button from the
         page). Without this, the row keeps saying "added to Figma
         1m ago" forever even though there's nothing in Figma. We
         check every recorded nodeId; if NONE resolve to a live
         (non-removed, attached) node, the build is considered gone
         and the entry is removed so the row flips back to NEW.
         (Partial deletes still count as present — user can re-Build
         to regenerate the missing variants.)

         Hardening (2026-05-18):
           - loadAllPagesAsync() so getNodeByIdAsync can resolve
             component sets on pages that haven't been opened yet.
           - Check node.removed — Figma's undo buffer keeps deleted
             nodes resolvable for a while; .removed === true means
             they're not actually in the tree.
           - Walk up parents to confirm the node is still attached
             to figma.root (orphans / detached subtrees → dead). */
      try {
        try { await figma.loadAllPagesAsync(); } catch (eLoad) { /* tolerate */ }

        /* Tombstone revival — if the user just hit Cmd+Z on a
           component-set delete, the nodes are back with their
           original IDs but the ledger entry was dropped. Walk
           tombstones first; any whose nodeIds resolve again get
           restored before the sweep runs. */
        var _nowTs = Date.now();
        var _revived = false;
        var _tombKeys = Object.keys(LEDGER_TOMBSTONES);
        for (var _tk = 0; _tk < _tombKeys.length; _tk++){
          var _tkey = _tombKeys[_tk];
          var _tomb = LEDGER_TOMBSTONES[_tkey];
          if (!_tomb) continue;
          /* Expire stale tombstones. */
          if (_nowTs - _tomb.droppedAt > LEDGER_TOMBSTONE_TTL_MS){
            delete LEDGER_TOMBSTONES[_tkey];
            continue;
          }
          /* Already restored by a real Build → discard tombstone. */
          if (versions[_tkey]){
            delete LEDGER_TOMBSTONES[_tkey];
            continue;
          }
          var _tNids = (_tomb.entry && _tomb.entry.nodeIds) || [];
          var _tAlive = false;
          for (var _tni = 0; _tni < _tNids.length; _tni++){
            try {
              var _tn = await figma.getNodeByIdAsync(_tNids[_tni]);
              if (_tn && !_tn.removed){ _tAlive = true; break; }
            } catch (e) {}
          }
          if (_tAlive){
            versions[_tkey] = _tomb.entry;
            delete LEDGER_TOMBSTONES[_tkey];
            _revived = true;
            log('Ledger revive: ' + _tkey + ' — nodes restored (likely undo)');
          }
        }
        if (_revived){
          figma.root.setPluginData('dtf-component-versions', JSON.stringify(versions));
        }

        var _existDirty = false;
        var _keys = Object.keys(versions);
        for (var _ki = 0; _ki < _keys.length; _ki++){
          var _k = _keys[_ki];
          var _entry = versions[_k];
          var _nids = (_entry && _entry.nodeIds) || [];
          if (!_nids.length) continue; // nothing to check
          var _anyAlive = false;
          var _checked = 0;
          var _aliveCount = 0;
          for (var _ni = 0; _ni < _nids.length; _ni++){
            try {
              var _n = await figma.getNodeByIdAsync(_nids[_ni]);
              _checked++;
              if (!_n) continue;
              if (_n.removed) continue;
              /* Walk parents to confirm attachment to document root.
                 A detached subtree (e.g. cut to clipboard) shouldn't
                 count as "in Figma". */
              var _p = _n.parent;
              var _attached = false;
              var _hops = 0;
              while (_p && _hops < 50){
                if (_p === figma.root){ _attached = true; break; }
                _p = _p.parent; _hops++;
              }
              if (_attached){ _anyAlive = true; _aliveCount++; }
            } catch (e) { /* node lookup failed → treat as dead */ }
          }
          log('Ledger liveness: ' + _k + ' → ' + _aliveCount + '/' + _checked + ' alive (of ' + _nids.length + ' recorded)');
          if (!_anyAlive){
            log('Ledger drop: ' + _k + ' — no live component sets remain (tombstoned for ' + Math.round(LEDGER_TOMBSTONE_TTL_MS/1000) + 's in case of undo)');
            /* Stash for potential undo-revival within TTL. */
            LEDGER_TOMBSTONES[_k] = { entry: _entry, droppedAt: Date.now() };
            delete versions[_k];
            _existDirty = true;
          }
        }
        if (_existDirty){
          figma.root.setPluginData('dtf-component-versions', JSON.stringify(versions));
        }
      } catch (e) {
        log('Ledger liveness check failed: ' + (e && e.message || e));
      }

      /* M5/V2 — per-component bindings status.
         The OLD behaviour hashed every variable ID in the three
         collections. That meant any sync that added/removed a single
         unrelated variable flipped the hash for EVERY built component,
         producing a false-positive "bindings changed" pill.

         New behaviour:
           1. Build a Set of all current variable IDs.
           2. For each existing ledger entry, check whether every ID
              it actually bound is still present.
           3. If yes → emit ledger.tokensHash unchanged (UI sees no
                       diff, no pill).
              If no → emit a sentinel hash including the missing IDs
                       (UI sees a diff, bindings pill fires for THIS
                       component only). */
      var currentTokensHash = '';
      var currentTokensHashes = {};
      var currentTokensMissing = {};   /* V3 \u2014 per-comp [{name,id}] */
      try {
        /* CRITICAL — _idSet must cover EVERY variable in the file,
           not just the three collections the generator pulls from.
           Button binds T1 brand color vars, T2 surface vars, T3
           status vars, comp-size vars, etc. If we only check three
           collections, every T1 binding looks "missing" and the
           bindings pill fires on every prereq ping. */
        var _ids = [];
        var _idSet = {};
        try {
          var _allCols = await figma.variables.getLocalVariableCollectionsAsync();
          for (var _ci = 0; _ci < _allCols.length; _ci++){
            var _cvids = _allCols[_ci].variableIds || [];
            for (var _vi2 = 0; _vi2 < _cvids.length; _vi2++){
              var _vid = _cvids[_vi2];
              if (_vid) { _ids.push(_vid); _idSet[_vid] = 1; }
            }
          }
        } catch (e) {
          /* Fall back to the named-collection scan if the global
             enumeration fails — better than nothing. */
          function _collect(m){
            var ks = Object.keys(m||{});
            for (var i=0;i<ks.length;i++){
              var v=m[ks[i]];
              if (v && v.id) { _ids.push(v.id); _idSet[v.id] = 1; }
            }
          }
          _collect(csMap); _collect(t2Map); _collect(t3Map);
        }
        _ids.sort();
        /* Kept for back-compat with UI readers that haven't migrated
           to the per-component map yet. */
        currentTokensHash = dtfHash32(_ids.join('|'));

        /* V4 — build a name→id map for the current file so we can
           AUTO-HEAL stale ledger boundIds when a variable was deleted
           + recreated (e.g. sync server started emitting a previously-
           missing variable). Before V4, a recreated variable produced
           a new ID; ledger still had the old ID; bindings pill fired
           forever even though the same NAME still resolved correctly. */
        var _nameToId = {};
        var _allColsForHeal = _allCols;
        if (!_allColsForHeal) {
          try { _allColsForHeal = await figma.variables.getLocalVariableCollectionsAsync(); }
          catch (eRetry) { _allColsForHeal = []; }
        }
        try {
          for (var _ci2 = 0; _ci2 < _allColsForHeal.length; _ci2++){
            var _col2 = _allColsForHeal[_ci2];
            var _cvids2 = _col2.variableIds || [];
            for (var _vi3 = 0; _vi3 < _cvids2.length; _vi3++){
              try {
                var _v = await figma.variables.getVariableByIdAsync(_cvids2[_vi3]);
                if (_v && _v.name) _nameToId[_v.name] = _v.id;
              } catch (eN) {}
            }
          }
        } catch (eAll) {}

        /* V5 — if a ledger entry references a name in
           REQUIRED_COMPSIZE_VARS that's missing from the file, create
           it on the spot. Step 2c does this during Build, but waiting
           for Build means the bindings pill stays stuck until the
           user manually clicks it. Auto-creating here clears the pill
           on the next prereq ping. */
        var _csColHeal = null;
        try {
          for (var _hi = 0; _hi < _allColsForHeal.length; _hi++){
            if (_allColsForHeal[_hi].name === 'comp size'){ _csColHeal = _allColsForHeal[_hi]; break; }
          }
        } catch (eC) {}
        var _requiredByName = {};
        var _requiredModeVals = {};
        for (var _rqi = 0; _rqi < REQUIRED_COMPSIZE_VARS.length; _rqi++){
          var _rq = REQUIRED_COMPSIZE_VARS[_rqi];
          _requiredByName[_rq.name] = _rq.defaultVal;
          if (_rq.modeVals) _requiredModeVals[_rq.name] = _rq.modeVals;
        }
        async function _ensureRequired(name){
          if (_nameToId[name]) return _nameToId[name];
          if (!(name in _requiredByName)) return null;
          if (!_csColHeal) return null;
          try {
            var nv = figma.variables.createVariable(name, _csColHeal, 'FLOAT');
            var modes = (_csColHeal.modes || []).map(function(m){ return m.modeId; });
            var _erModeVals = _requiredModeVals[name] || null;
            for (var mi = 0; mi < modes.length; mi++){
              var _erMN = _erModeVals && _csColHeal.modes[mi] ? _csColHeal.modes[mi].name.toLowerCase() : null;
              var _erVal = (_erModeVals && _erMN && _erModeVals[_erMN] !== undefined) ? _erModeVals[_erMN] : _requiredByName[name];
              try { nv.setValueForMode(modes[mi], _erVal); } catch (e) {}
            }
            try { nv.scopes = ['CORNER_RADIUS', 'GAP', 'WIDTH_HEIGHT']; } catch (e) {}
            _nameToId[name] = nv.id;
            _idSet[nv.id] = 1;
            log('Auto-create missing required var: ' + name + ' = ' + _requiredByName[name]);
            return nv.id;
          } catch (e) {
            log('Auto-create FAILED for ' + name + ': ' + (e && e.message || e));
            return null;
          }
        }

        var _vkeys = Object.keys(versions);
        var _ledgerDirty = false;
        for (var _vi = 0; _vi < _vkeys.length; _vi++){
          var _vk = _vkeys[_vi];
          var _ve = versions[_vk];
          if (!_ve) continue;
          var _bound = _ve.boundIds;
          if (!_bound || !_bound.length) {
            currentTokensHashes[_vk] = _ve.tokensHash || '';
            continue;
          }
          var _names = _ve.boundNames || {};
          var _missing = [];
          var _healedBound = [];
          var _healedNames = {};
          var _entryHealed = false;
          for (var _bi = 0; _bi < _bound.length; _bi++){
            var _bid = _bound[_bi];
            if (_idSet[_bid]) {
              _healedBound.push(_bid);
              if (_names[_bid]) _healedNames[_bid] = _names[_bid];
              continue;
            }
            /* Stale ID — try to recover by name. */
            var _stName = _names[_bid] || '';
            var _newId  = _stName ? _nameToId[_stName] : null;
            /* V5 — if name maps to a known required structural var
               that's missing entirely, create it. */
            if (!_newId && _stName && (_stName in _requiredByName)) {
              _newId = await _ensureRequired(_stName);
            }
            if (_newId) {
              _healedBound.push(_newId);
              _healedNames[_newId] = _stName;
              _entryHealed = true;
              try { log('Ledger auto-heal HIT: ' + _vk + ' "' + _stName + '" ' + _bid + ' → ' + _newId); } catch (e) {}
            } else {
              try { log('Ledger auto-heal MISS: ' + _vk + ' "' + (_stName || '(no name in ledger)') + '" id=' + _bid + ' — not present in any local collection'); } catch (e) {}
              _missing.push(_bid);
            }
          }
          if (_entryHealed) {
            _ve.boundIds   = _healedBound;
            _ve.boundNames = _healedNames;
            try {
              var _sorted = _healedBound.slice().sort();
              _ve.tokensHash = dtfHash32(_sorted.join('|'));
            } catch (eH) {}
            _ledgerDirty = true;
          }
          if (_missing.length === 0) {
            currentTokensHashes[_vk] = _ve.tokensHash || '';
          } else {
            currentTokensHashes[_vk] = dtfHash32('missing:' + _missing.sort().join('|'));
            var _missList = [];
            for (var _mi = 0; _mi < _missing.length; _mi++){
              var _mid = _missing[_mi];
              _missList.push({ id: _mid, name: _names[_mid] || '' });
            }
            currentTokensMissing[_vk] = _missList;
          }
        }
        if (_ledgerDirty) {
          try {
            figma.root.setPluginData('dtf-component-versions', JSON.stringify(versions));
            log('Ledger persisted after auto-heal pass');
          } catch (ePers) {}
        }
      } catch (e) {}

      var currentSpecHashes = {};
      var currentStructureHashes = {};
      var currentPrototypeHashes = {};
      /* V3.1 — per-BP planned-matrix snapshot so the UI can render
         a human-readable delta in the "build needed" why-line
         instead of the vague "New variants are available". We send
         family names + planned variant counts; UI compares against
         the prior ledger entry's families / totalComponents and
         formats e.g. "Adds Brand family (40 new variants, 0 \u2192 40)". */
      var currentBpMeta = {};
      try {
        var _bpKeys = Object.keys(COMPONENT_BLUEPRINTS);
        for (var _bki = 0; _bki < _bpKeys.length; _bki++) {
          var _bk = _bpKeys[_bki];
          var _bp = COMPONENT_BLUEPRINTS[_bk];
          if (!_bp) continue;
          var _sh = dtfHash32(dtfStableStringify(_bp));
          currentStructureHashes[_bk] = _sh;
          currentSpecHashes[_bk] = _sh;  /* legacy alias */
          /* V6 — keyed only on BP.states[]. CODE_VERSION removed:
             unrelated plugin updates should not invalidate prior
             builds. If we ever ship a real reactions-rewiring change,
             bump a dedicated REACTIONS_VERSION constant and add it
             back to BOTH this hash AND the build-time hash above. */
          var _ps = 'proto:' +
                    dtfStableStringify(_bp.states || []) + ':' +
                    'wired';
          currentPrototypeHashes[_bk] = dtfHash32(_ps);
          /* V6 migration — if a ledger entry was built under an older
             plugin version, its stored prototypeHash was computed with
             CODE_VERSION mixed in and will never match the new V6 hash.
             For entries whose component sets are still alive (liveness
             check above already pruned dead entries), overwrite the
             stored hash so the Prototype pill stops firing on every
             prereq ping. Real BP.states[] changes still re-fire it. */
          try {
            var _veForProto = versions[_bk];
            if (_veForProto && _veForProto.prototypeHash &&
                _veForProto.prototypeHash !== currentPrototypeHashes[_bk]) {
              log('Ledger proto-hash migrate: ' + _bk + ' ' + _veForProto.prototypeHash + ' → ' + currentPrototypeHashes[_bk]);
              _veForProto.prototypeHash = currentPrototypeHashes[_bk];
              try {
                figma.root.setPluginData('dtf-component-versions', JSON.stringify(versions));
              } catch (ePers2) {}
            }
          } catch (eMig) {}
          /* Planned-matrix snapshot. Matches the actual build loop:
             for each family, types \u00d7 (family.states || BP.states)
             \u00d7 2 (rounded variants are always built). */
          try {
            var _famNames = Object.keys(_bp.families || {});
            var _rootStates = (_bp.states && _bp.states.length) || 0;
            var _plannedVariants = 0;
            var _famDetail = {};
            for (var _fi = 0; _fi < _famNames.length; _fi++) {
              var _fn = _famNames[_fi];
              var _f = _bp.families[_fn] || {};
              var _ty = (_f.types && _f.types.length) || 0;
              var _st = (_f.states && _f.states.length) || _rootStates || 0;
              var _ct = _ty * _st * 2;  /* rounded \u00d7 2 */
              _plannedVariants += _ct;
              _famDetail[_fn] = { types: _ty, states: _st, variants: _ct };
            }
            currentBpMeta[_bk] = {
              families: _famNames,
              familyDetail: _famDetail,
              plannedVariants: _plannedVariants
            };
          } catch (eMeta) { /* per-BP meta is best-effort */ }
        }
      } catch (e) {}

      figma.ui.postMessage({
        type: 'gen-prereqs',
        compSizeCount: Object.keys(csMap).length,
        t2Count: Object.keys(t2Map).length,
        t3Count: Object.keys(t3Map).length,
        versions: versions,
        currentTokensHash:     currentTokensHash,       /* legacy: union of all IDs */
        currentTokensHashes:   currentTokensHashes,     /* V2: per-component */
        currentTokensMissing:  currentTokensMissing,    /* V3: per-comp missing names */
        currentSpecHashes:     currentSpecHashes,       /* legacy alias */
        currentStructureHashes:currentStructureHashes,
        currentPrototypeHashes:currentPrototypeHashes,
        currentBpMeta:         currentBpMeta,           /* V3.1 — UI delta */
        currentProject:        (function(){ try { return figma.root.getPluginData('dtf-project') || ''; } catch(e){ return ''; } })(),
        pluginVersion: CODE_VERSION
      });
    } catch (e) {
      figma.ui.postMessage({ type: 'gen-prereqs', compSizeCount: 0, t2Count: 0, t3Count: 0, versions: {} });
    }
  }

  /* M4 — safe-rebuild flag get/set. Stored in root pluginData. */
  if (msg.type === 'get-safe-rebuild') {
    var sr = '';
    try { sr = figma.root.getPluginData('dtf-safe-rebuild') || ''; } catch (e) {}
    figma.ui.postMessage({ type: 'safe-rebuild-state', enabled: sr === '1' });
  }
  if (msg.type === 'set-safe-rebuild') {
    try {
      figma.root.setPluginData('dtf-safe-rebuild', msg.enabled ? '1' : '');
    } catch (e) { /* ignore */ }
    figma.ui.postMessage({ type: 'safe-rebuild-state', enabled: !!msg.enabled });
  }
};
