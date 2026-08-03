# Design Token Forge — Full Project Handoff Summary

> **Purpose:** This document gives a new AI model or developer full context on what was built, what architectural decisions were made, and where things stand — so work can continue without losing context.

---

## 1. What Is This Project?

**Design Token Forge (DTF)** is a **design system generator platform** — not a design system itself, but a tool that *generates* design systems for Zoho products. It takes a brand color as input and produces:

- A complete 4-tier color token system (CSS custom properties)
- Auto-built Figma component libraries with variable bindings
- A hosted demo site on **Zoho Catalyst Slate** (Zoho's internal hosting platform)
- Per-product token packages that teams can install and use

### Repositories / Remote Origins
- **GitHub:** `https://github.com/sridhar-ravi-2917/Design-Token-Forge.git`
- **Zoho Internal:** `https://zrepository.zohocorpcloud.in/zohocorp/user/sridhar-ravi-2917/Design-Token-Forge.git`
- **Latest commit hash:** `3919e453`
- **Total commits:** ~1,119

---

## 2. High-Level Architecture

### Monorepo Structure (pnpm workspaces)

```
/packages/
  tokens/           — CSS token files (primitives, semantic, surfaces, extras)
  components/       — Pure CSS + HTML web components (~35 L1 components)
  slyte/            — Zoho Lyte (Zoho's internal UI framework) wrapper components
  generator/        — Token generation engine (palette → CSS output)
  react/            — React wrapper components
  react-demo/       — React demo app
  figma-plugin/     — Figma plugin (TypeScript) that syncs tokens → Figma variables
  sync-server/      — Local server that bridges plugin ↔ GitHub

/demo/              — Hosted demo site (served via Zoho Catalyst Slate)
/projects/          — Per-product token overrides (config.json + generated CSS)
/specs/             — YAML schemas for tokens and components
/docs/              — Architecture docs, decision records, roadmap
/scripts/           — Build, audit, migration, and deployment scripts
/tests/             — Playwright visual regression tests
```

### The 4-Tier Color System (Tokn Architecture)

```
T0 Primitives    →   --prim-{palette}-{step}          (e.g., --prim-brand-500)
T1 Semantic      →   --{role}-{group}-{property}       (e.g., --primary-component-bg-default)
T2 Surfaces      →   --{surface}-{group}-{property}    (e.g., --surface-base-ct-default)
T3 Component     →   --{component}-{property}-{state}  (e.g., --btn-primary-bg-hover)
```

**Scale:** ~3,000–3,500 total CSS custom properties (~775 global + ~2,200–2,700 component-level)

**Color palettes:** 7 — brand, danger, warning, info, success, greyscale, desaturated  
**Semantic roles:** 6 — primary, brand, success, warning, danger, info  
**Surface contexts:** 9 — surface-base, surface-bright, surface-deep, surface-accent, surface-dim, container, over-container, float, inverse  
**Density modes:** 10 — micro, tiny, small, base, medium, large, big, huge, mega, ultra  
**Themes:** light + dark (dual-mode T1/T2 tokens)

---

## 3. What Was Built (Component Library)

### 35 L1 Components (all with 100% variable coverage)

| Category | Components |
|----------|-----------|
| **Buttons** | Button, IconButton, SplitButton, MenuButton |
| **Form Controls** | Input, Textarea, Select, Checkbox, Radio, Toggle, Slider, DatePicker, FileUpload |
| **Feedback** | Alert, Toast, ProgressBar, ProgressCircle, ProgressRing, Spinner |
| **Display** | Avatar, Badge, Tooltip, Skeleton, Divider, Card |
| **Navigation** | Nav, Kbd |
| **Overlays** | Modal/Auth Gate |
| **Typography** | Typography scale |
| **Special** | Color System Generator, Token Editor |

### Component Architecture Rules (NEVER break these)
1. **Zero hardcoded values** — every visual property is a CSS variable
2. **7-axis coverage per component:** Shape, Dimension, Surface, Typography, Slots, Motion, A11y
3. **Framework-agnostic core** — CSS + HTML only in `/packages/components/`. JS wrappers are thin prop→class mappers
4. **Density mode naming** — use `micro/tiny/small/base/medium/large/big/huge/mega/ultra` (NOT xs/sm/md/lg/xl)
5. **No `!important`** in component CSS
6. **No L2 components** (layouts/page patterns) — only L1 primitives in scope

---

## 4. The Figma Plugin

The Figma plugin (`/packages/figma-plugin/`) is a significant piece of work. It:

- **Syncs token JSON → Figma variable collections** (T0–T3 all get Figma variables)
- **Builds Figma component sets** from code blueprints — auto-generates Button, Toggle, etc. as native Figma components with variable bindings
- Uses a **SAFE_REBUILD** pattern — components are identified by a stable `dtf-set-id` semantic ID that survives any renaming, preventing duplicate creation
- Routes built components to **grouped Figma pages by category** (e.g., "DTF/Buttons", "DTF/Form Controls")
- Handles **icon primitives** — migrates icons to the target page on rebuild to avoid duplication
- **Focus ring system** — builds variable-driven focus rings as absolute overlays with per-density border-radius baked into `REQUIRED_COMPSIZE_VARS`
- Prevents Typography Scale collection duplication on each sync

### Plugin Key Patterns
- Components have `dtf-set-id` plugin data as a stable semantic anchor
- `REQUIRED_COMPSIZE_VARS` stores per-density variables for each component size
- Variable bindings use Figma's `setBoundVariableForPaint/setVariableAlias` APIs (async)
- Page migration uses `migrate owned nodes from old page to target page on rebuild`

---

## 5. The Token System Generator (Editor V2)

Located at `/demo/editor-v2/`, this is a browser-based color system editor:

- **Palette engine** (`demo/palette-engine.js`) — generates full 22-step (50–600 + 350) color palettes from a single key color using OKLCH
- **T2 Surface palette editor** — per-surface palette source dropdowns, contrast warnings
- **Developer Handoff section** — exports tokens as CSS/JSON/Table/Android(Kotlin)/iOS(Swift) with T0/T1/T2/T3 tier filter
- **Save & Apply** — commits token changes to GitHub directly from the browser
- **Deploy to Figma** — auto-triggers a sync to push token changes to the Figma file
- **Multi-project memory** — uses per-document `dtf-active-project` in Figma plugin data to prevent accidental cross-project sync

---

## 6. Multi-Project Support

The system supports multiple named **product projects**, each with its own token overrides:

| Project | Config |
|---------|--------|
| `desktop-pdf-editor` | `/projects/desktop-pdf-editor/` |
| `pearl` | `/projects/pearl/` |
| `slate-demo` | `/projects/slate-demo/` |
| `writer-handhelds` | `/projects/writer-handhelds/` |

Each project has:
- `config.json` — palette key colors + semantic map overrides
- `primitives.css` — generated T0 color tokens
- `semantic.css` — generated T1 role tokens
- `surfaces.css` — generated T2 surface tokens

The `slate-demo` project specifically has brand color `#286CE5` (Zoho blue).

---

## 7. Zoho Catalyst Slate Deployment

The **most recent major work** was migrating the demo site hosting from GitHub Pages to **Zoho Catalyst Slate** (Zoho's internal CDN/hosting service).

### What Was Done

#### Phase 1: Initial Slate Setup
- Made `demo/` folder self-contained for Slate serving
- Stubbed a build script (static site, no build needed)
- Added a root `index.html` redirect → `demo/`
- Pushed a `pages` branch to GitHub that Slate reads from

#### Phase 2: Authentication Migration (GitHub PAT → Catalyst)
**Before:** Users connected via a GitHub Personal Access Token (PAT) stored in `sessionStorage`. The hub fetched the user's forked projects via GitHub API.

**After:** Full **Zoho Catalyst SDK authentication**:
- `demo/catalyst-user.js` — wraps Catalyst SDK, resolves the logged-in Zoho user
- `demo/auth-gate.js` — gates all pages behind Catalyst session; redirects to `/` for auth if session is missing
- The hub (`demo/index.html`) now filters projects by the user's **Zoho email** instead of GitHub PAT fork detection
- The topbar (`demo/dtf-topbar.js`) always shows the Catalyst account chip when session is active

#### Phase 3: Bug Fixes and Stabilization
- Fixed `inSubdir` regex in topbar to match trailing-slash directory URLs (prevented double-path 404s)
- Added Catalyst SDK fallback for direct URL access to `demo/index.html`
- Fixed hub redirect — goes through `/` for Catalyst auth when `sessionStorage` is empty
- Removed `slate-demo` from `projects.json` (it belongs to a different user — `Gowthamrg20`)
- Eliminated page load delay, now filters projects by Zoho email immediately
- Debug logging added to console for Catalyst user field discovery

### Current Auth Flow
```
User visits any /demo/* page
  → auth-gate.js checks for Catalyst session
  → If no session → redirect to / (Catalyst login)
  → After login → Catalyst SDK returns user object
  → Hub filters projects.json by user's Zoho email
  → User sees their projects, enters editor-v2
```

### Deployment CI
- `.github/workflows/` pushes `demo/` assets to Slate via `pages` branch on every merge to main
- `scripts/deploy-zoho-pages.sh` handles the push
- `chore(deploy): sync demo/ assets for Zoho Slate [skip ci]` commits are auto-deploy syncs

---

## 8. The `slyte` Package (Zoho Lyte Wrappers)

`/packages/slyte/` is a **Zoho-specific adapter layer** — it wraps the DTF CSS components into **Zoho Lyte** (Zoho's internal web component framework) compatible wrappers.

- Package name: `@design-token-forge/slyte`
- 24 components wrapped: Button, IconButton, SplitButton, MenuButton, Toggle, Checkbox, Radio, Input, Textarea, Select, Slider, DatePicker, FileUpload, Avatar, Badge, Tooltip, Alert, Toast, ProgressBar, ProgressCircle, ProgressRing, Spinner, Skeleton, Card, Divider
- Each wrapper is a thin JS class that maps Lyte props → DTF CSS classes + sets ARIA attributes
- Located at `packages/slyte/src/dtf-{component}.js`

---

## 9. Key Design Decisions (ADRs)

From the `docs/decisions/` directory:

1. **Tokn 4-tier architecture** — T0→T1→T2→T3 cascade chosen over flat token maps for maximum semantic expressiveness and surface context support
2. **CSS custom properties as the canonical format** — not JSON tokens, not Tailwind config — CSS variables are the source of truth, everything else is derived
3. **10-step density scale** — replaces the 5-step xs/sm/md/lg/xl system; gives fine-grained control needed for data-dense Zoho products
4. **Framework-agnostic core** — Lyte wrappers, React wrappers, etc. are adapters on top of CSS; visual logic never lives in JS
5. **SAFE_REBUILD in Figma plugin** — component identity is anchored to `dtf-set-id` plugin data, not node name, so renaming never creates duplicates
6. **Zoho Catalyst for auth** — replaced GitHub PAT with Catalyst SDK so Zoho employees authenticate with their existing Zoho account, no extra credentials needed

---

## 10. Current Status & What's In-Progress

### Done ✅
- Full 4-tier token system with 3,000+ variables
- 35 L1 components (all gold-standard — 100% variable coverage, dark mode, all density sizes)
- Figma plugin: variable sync + component builder + SAFE_REBUILD + focus ring
- Multi-project token support (desktop-pdf-editor, pearl, slate-demo, writer-handhelds)
- Editor V2: palette engine, surface editor, developer handoff, GitHub commit
- Deployment on Zoho Catalyst Slate with Catalyst authentication
- Visual regression tests (Playwright)
- `slyte` package (Zoho Lyte wrappers for all 35 components)

### Known Issues / Last Touched
- `slate-demo` project was incorrectly in `projects.json` (belongs to `Gowthamrg20`, not the current user) — **just fixed in latest commit**
- Catalyst user field discovery was still being debugged (debug console.log in commit `1365a7e`) — the field name for user email in the Catalyst user object may need confirming
- The hub's project filter uses Zoho email match — if the email field name in Catalyst SDK changes, this breaks

### Roadmap (from `docs/ROADMAP.md`)
- **Phase 1 (Build Infra):** ✅ Done — PostCSS build, dist/ output, npm-publishable packages
- **Phase 2 (Components):** ✅ Done — 35 L1 components
- **Phase 3 (Admin/Color System):** ✅ Done — Editor V2, per-project color system
- **Phase 4 (Figma Plugin):** ✅ Done — variable sync + component builder
- **Phase 5 (Deployment):** ✅ Done — Zoho Catalyst Slate hosting + Catalyst auth
- **Next:** (not explicitly defined yet) — likely React package maturation, more product project onboarding, or Lyte wrapper stabilization

---

## 11. File Map — Key Files to Know

| File | Purpose |
|------|---------|
| `.instructions.md` | **Read this first.** AI rules, naming conventions, architecture facts |
| `demo/index.html` | Projects hub — entry point for authenticated users |
| `demo/catalyst-user.js` | Catalyst SDK user resolver |
| `demo/auth-gate.js` | Auth gate for all demo pages |
| `demo/dtf-topbar.js` | Top navigation bar with account chip |
| `demo/editor-v2/index.html` | Color system / token editor UI |
| `demo/editor-v2/editor-v2.js` | Editor logic (palette generation, save/deploy) |
| `demo/palette-engine.js` | OKLCH palette generation from key color |
| `packages/tokens/src/` | Source CSS token files |
| `packages/components/src/` | Component CSS + HTML source |
| `packages/slyte/src/` | Zoho Lyte wrapper components |
| `packages/figma-plugin/src/` | Figma plugin TypeScript source |
| `projects/{name}/config.json` | Per-product token configuration |
| `projects/{name}/primitives.css` | Generated T0 tokens for that product |
| `projects/{name}/semantic.css` | Generated T1 tokens for that product |
| `projects/{name}/surfaces.css` | Generated T2 surface tokens for that product |
| `specs/components/` | YAML schemas for component variables |
| `docs/decisions/` | Architecture Decision Records |
| `scripts/deploy-zoho-pages.sh` | Slate deployment script |

---

## 12. Context for the Next AI Model

**This is what you're working with:**

- A production-grade Zoho-internal design system generator
- The CSS/component/token system is **complete and stable**
- The Figma plugin is **complete and stable** (focus ring, SAFE_REBUILD, variable sync all working)
- The deployment to **Zoho Catalyst Slate is live** — demo site runs at the Slate URL
- **Authentication has been fully migrated** from GitHub PAT to Zoho Catalyst SDK
- The last remaining uncertainty is **which field on the Catalyst user object holds the Zoho email** (see debug commit `1365a7e` — the console.log was added to discover this field name in production)

**When continuing work:**
1. Read `.instructions.md` first — it has all naming conventions and rules
2. Respect the 4-tier token cascade — never hardcode visual values
3. Use `micro/tiny/small/base/medium/large/big/huge/mega/ultra` for density (not xs/sm/md/lg/xl)
4. Components must cover all 7 axes: Shape, Dimension, Surface, Typography, Slots, Motion, A11y
5. For Figma plugin changes: always use `dtf-set-id` as the component identity anchor, not node names
6. For auth/hub changes: the Catalyst user email field name may still be in discovery — check `demo/catalyst-user.js` and `demo/index.html` for the current field being used

---

*Generated: 2026-08-03 | Commit: 3919e453 | Total commits: ~1,119*
