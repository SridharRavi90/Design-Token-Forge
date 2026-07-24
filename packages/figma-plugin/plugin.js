/* ═══════════════════════════════════════════════════════════════
   Design Token Forge — Figma Plugin (Live Sync Edition)
   Connects to DTF Sync Server for real-time token updates.
   Uses async Figma APIs for compatibility with Figma 2025+.
   ═══════════════════════════════════════════════════════════════ */

figma.showUI(__html__, { width: 480, height: 560 });

var CODE_VERSION = '2026-05-06-v11';
log('code.js loaded — version ' + CODE_VERSION);

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
var DTF_EXACT_NAMES = ['primitives-numbers', 'comp size', 'Typography Scale'];

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
  var found = [];
  for (var i = 0; i < all.length; i++) {
    if (isDTFCollection(all[i].name)) {
      found.push(all[i]);
    }
  }
  return found;
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
    stats.renamed = renameCount;
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
    var allDTFCols = await findDTFCollections();
    for (var dri = 0; dri < allDTFCols.length; dri++) {
      var drCol = allDTFCols[dri];
      var drVarIds = drCol.variableIds.slice();
      for (var drvi = 0; drvi < drVarIds.length; drvi++) {
        var drVar = await figma.variables.getVariableByIdAsync(drVarIds[drvi]);
        if (!drVar) continue;
        var newName = data.renames[drVar.name];
        if (newName) {
          /* Check if another variable already has the target name */
          for (var drdi = 0; drdi < drVarIds.length; drdi++) {
            if (drdi === drvi) continue;
            var drDup = await figma.variables.getVariableByIdAsync(drVarIds[drdi]);
            if (drDup && drDup.name === newName) {
              log('Pass0: removing blocker ' + newName + ' (id=' + drDup.id + ')');
              try { drDup.remove(); } catch (dre) { log('Pass0 remove failed: ' + dre.message); }
            }
          }
          log('Pass0 RENAME: ' + drVar.name + ' → ' + newName + ' (id=' + drVar.id + ')');
          try {
            drVar.name = newName;
            if (drVar.name === newName) {
              directRenames++;
              /* Update idMap to reflect new name */
              idMap[drCol.name + '::' + newName] = drVar.id;
            } else {
              log('Pass0 WARN: rename assignment did not stick for ' + newName + ' (got ' + drVar.name + ')');
            }
          } catch (drErr) {
            log('Pass0 ERROR renaming ' + drVar.name + ': ' + drErr.message);
            stats.errors.push('Pass0 rename ' + drVar.name + ': ' + drErr.message);
          }
        }
      }
    }
    log('Pass0 direct renames completed: ' + directRenames);
    stats.renamed += directRenames;

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

  /* Pass 3: Remove orphan variables not in token data */
  stats.orphansRemoved = await removeOrphans(data, stats);
  if (stats.orphansRemoved > 0) {
    log('Removed ' + stats.orphansRemoved + ' orphan variable(s)');
  }

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

  return stats;
}

/* ── Message handler ─────────────────────────────────────── */

figma.ui.onmessage = async function(msg) {

  if (msg.type === 'scan') {
    try {
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
      figma.ui.postMessage({ type: 'verify-result', varCount: varCount });
    } catch (e) {
      /* Report error instead of false zero — prevents false undo detection */
      figma.ui.postMessage({ type: 'verify-result', varCount: -1, error: e.message });
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
      figma.ui.postMessage({ type: 'done', stats: stats, hash: syncHash });
      figma.notify(
        'DTF: ' + stats.variables + ' vars (' + stats.updated + ' updated, ' +
        stats.created + ' created' +
        (stats.renamed > 0 ? ', ' + stats.renamed + ' renamed' : '') +
        (stats.orphansRemoved > 0 ? ', ' + stats.orphansRemoved + ' orphans removed' : '') +
        '), ' + stats.aliases + ' aliases' +
        (stats.errors.length > 0 ? ' (' + stats.errors.length + ' errors)' : '')
      );
    } catch (e) {
      figma.ui.postMessage({ type: 'error', error: e.message });
    }
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
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
};
