/* ════════════════════════════════════════════════════════════
   Design Token Forge — Component Page Configs
   ────────────────────────────────────────────────────────────
   This file documents what each component page needs to
   customize when built from _TEMPLATE.html.
   Not imported at runtime — purely a build reference.

   SECTION KEY:
     ✅ = Standard (rendered by shared helpers, same across all pages)
     🔧 = Component-specific (custom render function required)
     ➖ = Not applicable (omit section entirely)
   ════════════════════════════════════════════════════════════ */

var COMPONENT_CONFIGS = {

  /* ═══════════════════════════════════════════════════════
     TYPE: BUTTON FAMILY (interactive controls)
     Pill bars: variantBar (10) + sizeBar (10) + roundedBar
     All 10 variants × 10 sizes × 2 shapes
     ═══════════════════════════════════════════════════════ */

  button: {
    folder: 'button', prefix: 'btn', className: 'btn',
    vars: 246,
    pillBars: ['variantBar', 'sizeBar', 'roundedBar'],
    variants: ['primary','secondary','tertiary','ghost','danger','success','warning','neutral','outline','brand'],
    sizes: 'all10',  // micro → ultra
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅ (6 states: default/hover/active/focus/disabled/loading)',
      surface:    '✅ (neutral/outline/brand on 3 BG levels)',
      shape:      '✅ (radius per density + shadow presets)',
      slots:      '🔧 (label, icon-start, icon-end, both, icon-only)',
      motion:     '🔧 (transition durations, loading shimmer)',
      playground: '✅ (surface × role, 2 cards, token chain)',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  'icon-button': {
    folder: 'icon-button', prefix: 'ib', className: 'icon-btn',
    vars: 120,
    pillBars: ['variantBar', 'sizeBar', 'roundedBar'],
    variants: ['primary','secondary','tertiary','ghost','danger','success','warning','neutral','outline','brand'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅',
      surface:    '✅',
      shape:      '✅',
      slots:      '➖ (single icon only — no slot combos)',
      motion:     '🔧 (transition + loading)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  'split-button': {
    folder: 'split-button', prefix: 'sb', className: 'split-btn',
    vars: 154,
    pillBars: ['variantBar', 'sizeBar', 'roundedBar'],
    variants: ['primary','secondary','tertiary','ghost','danger','success','warning','neutral','outline','brand'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅',
      anatomy:    '🔧 (action + trigger halves, divider)',
      surface:    '✅',
      shape:      '✅',
      motion:     '🔧',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  'menu-button': {
    folder: 'menu-button', prefix: 'mb', className: 'menu-btn',
    vars: 139,
    pillBars: ['variantBar', 'sizeBar', 'roundedBar'],
    variants: ['primary','secondary','tertiary','ghost','danger','success','warning','neutral','outline','brand'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅',
      anatomy:    '🔧 (chevron, dropdown)',
      surface:    '✅',
      shape:      '✅',
      motion:     '🔧',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  /* ═══════════════════════════════════════════════════════
     TYPE: INPUT FAMILY (form controls)
     Pill bars: variantBar (outline/filled/ghost) + sizeBar (10)
     Surface section uses input-on-surface approach
     ═══════════════════════════════════════════════════════ */

  input: {
    folder: 'input', prefix: 'in', className: 'input-wrap',
    vars: 172,
    pillBars: ['variantBar', 'sizeBar'],
    variants: ['outline','filled','ghost'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅ (default/hover/focus/disabled/error)',
      surface:    '✅ (input on 3 BG levels)',
      shape:      '➖ (inputs don\'t have shape override — consider adding)',
      slots:      '🔧 (label, helper, icon-start, icon-end, clear)',
      comparison: '🔧 (outline vs filled vs ghost side-by-side)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  textarea: {
    folder: 'textarea', prefix: 'ta', className: 'textarea-wrap',
    vars: 114,
    pillBars: ['variantBar', 'sizeBar', 'heightBar'],
    variants: ['outline','filled','ghost'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      height:     '🔧 (rows/height variants)',
      states:     '✅',
      surface:    '✅',
      slots:      '🔧 (label, helper, counter)',
      resize:     '🔧 (resize handles)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  select: {
    folder: 'select', prefix: 'sl', className: 'select-wrap',
    vars: 120,
    pillBars: ['variantBar', 'sizeBar'],
    variants: ['outline','filled','ghost'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅',
      surface:    '✅',
      slots:      '🔧 (label, helper, chevron)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  /* ═══════════════════════════════════════════════════════
     TYPE: COMPOUND (filled/outlined binary)
     Pill bars: variantBar (""=filled/outlined) + sizeBar (10)
                + checkedBar or stateBar
     ═══════════════════════════════════════════════════════ */

  toggle: {
    folder: 'toggle', prefix: 'sw', className: 'toggle',
    vars: 93,
    pillBars: ['variantBar', 'sizeBar', 'checkedBar'],
    variants: ['','outlined'],  // empty = filled
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅ (note: empty string variant = filled)',
      density:    '✅',
      states:     '✅ (default/checked/disabled/error)',
      anatomy:    '🔧 (track, thumb, label)',
      surface:    '✅',
      shape:      '✅ (pill shape override)',
      motion:     '🔧 (thumb slide transition)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  checkbox: {
    folder: 'checkbox', prefix: 'ck', className: 'checkbox',
    vars: 74,
    pillBars: ['variantBar', 'sizeBar', 'stateBar'],
    variants: ['','outlined'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅ (unchecked/checked/indeterminate/disabled)',
      anatomy:    '🔧 (box, checkmark, label)',
      surface:    '✅',
      shape:      '✅',
      motion:     '🔧 (checkmark animation)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  radio: {
    folder: 'radio', prefix: 'rd', className: 'radio',
    vars: 73,
    pillBars: ['variantBar', 'sizeBar', 'stateBar'],
    variants: ['','outlined'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅ (unchecked/checked/disabled)',
      anatomy:    '🔧 (circle, dot, label)',
      surface:    '✅',
      groups:     '🔧 (radio group layout)',
      motion:     '🔧 (dot scale animation)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  /* ═══════════════════════════════════════════════════════
     TYPE: DISPLAY / FEEDBACK
     Pill bars: roleBar + variantBar + sizeBar
     Has semantic roles as primary axis
     ═══════════════════════════════════════════════════════ */

  alert: {
    folder: 'alert', prefix: 'al', className: 'alert',
    vars: 91,
    pillBars: ['roleBar', 'variantBar', 'sizeBar'],
    roles: ['primary','success','warning','danger','neutral'],
    variants: ['default','filled','outline','soft'],
    sizes: ['small','base','large'],      // 3 sizes (not 10)
    sections: {
      hero:       '✅',
      variants:   '✅ (variant × role matrix)',
      density:    '✅ (3 sizes)',
      states:     '✅ (visible/dismissing/disabled)',
      surface:    '✅',
      shape:      '➖ (alerts don\'t have radius variants — fixed radius)',
      accent:     '🔧 (left accent bar)',
      slots:      '🔧 (icon, title, body, link, close)',
      dismiss:    '🔧 (dismiss animation demo)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  toast: {
    folder: 'toast', prefix: 'ts', className: 'toast',
    vars: 89,
    pillBars: ['roleBar', 'variantBar', 'sizeBar'],
    roles: ['primary','success','warning','danger','neutral'],
    variants: ['default','filled','outline'],
    sizes: ['small','base','large'],
    sections: {
      hero:       '✅',
      variants:   '✅ (variant × role matrix)',
      density:    '✅ (3 sizes)',
      states:     '✅',
      surface:    '✅',
      positions:  '🔧 (6 position slots)',
      slots:      '🔧 (icon, title, action, close)',
      motion:     '🔧 (enter/exit/auto-dismiss)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  badge: {
    folder: 'badge', prefix: 'bd', className: 'badge',
    vars: 90,
    pillBars: ['roleBar', 'variantBar', 'shapeBar', 'sizeBar'],
    roles: ['primary','success','warning','danger','neutral'],
    variants: ['filled','outlined','soft','ghost'],
    sizes: ['micro','tiny','small','base','medium','large'],
    sections: {
      hero:       '✅',
      variants:   '✅ (variant gallery)',
      shapes:     '🔧 (default vs pill shape)',
      density:    '✅',
      roles:      '🔧 (role × variant matrix)',
      states:     '✅',
      surface:    '✅',
      dot:        '🔧 (dot/notification badge)',
      slots:      '🔧 (icon, text, remove)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  tooltip: {
    folder: 'tooltip', prefix: 'tt', className: 'tooltip',
    vars: 60,
    pillBars: ['variantBar', 'sizeBar', 'placementBar'],
    variants: ['default','inverted'],
    sizes: ['small','base','large'],
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅',
      surface:    '✅',
      placement:  '🔧 (12 placements: top/right/bottom/left × start/center/end)',
      slots:      '🔧 (text, rich content)',
      rich:       '🔧 (rich tooltip with actions)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  avatar: {
    folder: 'avatar', prefix: 'av', className: 'avatar',
    vars: 80,
    pillBars: ['roleBar', 'shapeBar', 'sizeBar'],
    roles: ['primary','success','warning','danger','neutral'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      content:    '🔧 (image, initials, icon, fallback)',
      shapes:     '🔧 (circle vs square vs rounded)',
      density:    '✅',
      roles:      '🔧 (role colors for initials bg)',
      states:     '✅ (default/disabled)',
      surface:    '✅',
      badges:     '🔧 (status badge positioning)',
      group:      '🔧 (avatar group/stack)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  /* ═══════════════════════════════════════════════════════
     TYPE: PROGRESS
     Pill bars: roleBar + variantBar + sizeBar + shapeBar
     ═══════════════════════════════════════════════════════ */

  'progress-bar': {
    folder: 'progress-bar', prefix: 'pg', className: 'progress-bar',
    vars: 110,
    pillBars: ['roleBar', 'variantBar', 'sizeBar', 'shapeBar'],
    roles: ['primary','success','warning','danger','neutral'],
    variants: ['filled','outline'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅ (determinate/indeterminate/disabled)',
      surface:    '✅',
      shape:      '✅ (rounded vs square track)',
      slots:      '🔧 (label, value text)',
      motion:     '🔧 (indeterminate animation)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  'progress-circle': {
    folder: 'progress-ring', prefix: 'rg', className: 'progress-ring',
    vars: 86,
    pillBars: ['roleBar', 'variantBar', 'sizeBar'],
    roles: ['primary','success','warning','danger','neutral'],
    variants: ['filled','outline'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      density:    '✅',
      states:     '✅ (determinate/indeterminate/disabled)',
      surface:    '✅',
      shape:      '✅ (stroke width)',
      slots:      '🔧 (center label)',
      motion:     '🔧 (ring animation)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  /* ═══════════════════════════════════════════════════════
     TYPE: SPECIALTY
     ═══════════════════════════════════════════════════════ */

  slider: {
    folder: 'slider', prefix: 'sr', className: 'slider',
    vars: 120,
    pillBars: ['sizeBar'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      styles:     '🔧 (track + thumb styling)',
      density:    '✅',
      states:     '✅ (default/hover/active/disabled)',
      surface:    '✅',
      shape:      '✅',
      slots:      '🔧 (track, thumb, ticks, labels)',
      motion:     '🔧 (thumb transition)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  datepicker: {
    folder: 'datepicker', prefix: 'dp', className: 'datepicker',
    vars: 190,
    pillBars: ['sizeBar'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      styles:     '🔧 (calendar grid styling)',
      density:    '✅',
      states:     '✅ (default/hover/selected/today/disabled/range)',
      surface:    '✅',
      shape:      '✅',
      slots:      '🔧 (header, weekday, day cells, range)',
      motion:     '🔧 (month transition)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  },

  'file-upload': {
    folder: 'file-upload', prefix: 'fu', className: 'file-upload',
    vars: 120,
    pillBars: ['variantBar', 'sizeBar', 'modeBar'],
    variants: ['outline','filled'],
    sizes: 'all10',
    sections: {
      hero:       '✅',
      variants:   '✅',
      modes:      '🔧 (dropzone vs button)',
      density:    '✅',
      states:     '✅ (default/hover/dragover/disabled/error)',
      surface:    '✅',
      filelist:   '🔧 (file list items)',
      slots:      '🔧 (icon, label, helper, file items)',
      playground: '✅',
      a11y:       '✅',
      framework:  '✅'
    }
  }
};
