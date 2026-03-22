# ADR-001: CSS Custom Properties as the Single Styling Mechanism

## Status

**Accepted** — 2025-03-17

## Context

Design Token Forge needs a styling strategy that:
- Works across all JS frameworks (React, Vue, Svelte, Web Components)
- Allows complete visual customization without forking components
- Supports multi-brand/multi-product theming at runtime
- Has zero or minimal runtime JavaScript overhead
- Allows 3,000+ variables without performance degradation

Options considered:
1. CSS-in-JS (styled-components, Emotion)
2. Utility-first (Tailwind)
3. CSS Modules + static tokens
4. **CSS Custom Properties (variables) as the sole mechanism**

## Decision

**All visual properties in all components will be CSS custom properties.** Zero hardcoded values. Zero CSS-in-JS runtime. The components are CSS-first with thin JS wrappers.

## Rationale

- CSS custom properties cascade through the DOM — this naturally enables the layered resolution model (global → product → component → instance)
- No framework dependency — the CSS works in any context
- Runtime theme switching is free (change variable values, everything updates)
- Browser-native, no build step required for theming
- 3,000+ custom properties have negligible performance impact (proven by Material Design 3's implementation)

## Consequences

- Components cannot use dynamic styling logic in JS (all variation must be expressible in CSS)
- Some advanced patterns (computed tokens that depend on runtime JS values) require a thin JS bridge
- Developers must understand CSS custom property scoping to debug effectively
- No CSS-in-JS colocation — styles live in separate .css files

---

# ADR-002: Data Attributes for Variant/State Selection

## Status

**Accepted** — 2025-03-17

## Context

Components need to express variants (primary, secondary) and states (loading, error). Options:
1. Class-based: `.btn-primary`, `.btn--large`, `.btn-loading`
2. **Data attribute-based**: `data-variant="primary"`, `data-size="lg"`, `data-loading`
3. CSS-in-JS props: `<Button variant="primary" />`

## Decision

Use **data attributes** on the host HTML element. Framework wrappers map props to data attributes.

## Rationale

- Predictable specificity: `[data-variant="primary"]` always has the same specificity
- Machine-readable: AI tools and automated testing can parse component configuration from DOM
- Framework-agnostic: works in plain HTML, React, Vue, Svelte, server-rendered
- No class name conflicts or BEM complexity
- Clean separation: classes are for component identity (`.btn`), data attrs for configuration

## Consequences

- Slightly more verbose HTML than utility classes
- CSS selectors are attribute-based (slightly less familiar to some developers)
- Framework wrappers must map props → data attributes consistently

## Variant Taxonomy

Components use two types of variants, both expressed via `data-variant`:

### Semantic Variants (Button-family only)
`primary`, `brand`, `success`, `warning`, `danger`, `info` — convey **intent or role**. A "Danger" button has behavioral connotation beyond visual treatment.

**Components**: Button, IconButton, SplitButton, MenuButton

### Structural Variants (all component categories)
`outline`, `filled`, `ghost`, `underline` — describe **visual treatment** only. A "filled" checkbox looks different but has no behavioral difference from an "outline" checkbox.

**Components**: Button-family (`outline`, `ghost`), Toggle/Checkbox/Radio (`filled`, `outline`), Input/Textarea/Select (`outline`, `filled`, `underline`)

### Why the mix is intentional
Buttons are **the primary interactive affordance** — they trigger actions with consequences (submit, delete, confirm). Semantic variants encode that consequence in the design language. Form fields are **functionally neutral** — a text input collects data regardless of visual style. They only need structural variants.

This is **by design**, not an inconsistency. The `data-variant` attribute carries a different vocabulary per component category.

## CSS Root Class Naming Convention

Three patterns, each serving a structural purpose:

| Pattern | Rule | Components | Example |
|---------|------|-----------|---------|
| **Bare name** | Simple, self-contained components | Button, Toggle, Checkbox, Radio, Slider, DatePicker | `.btn`, `.switch`, `.checkbox`, `.radio`, `.slider`, `.datepicker` |
| **Hyphenated** | Compound components (multi-word names) | IconButton, SplitButton, MenuButton | `.icon-btn`, `.split-btn`, `.menu-btn` |
| **`-group` suffix** | Form fields that require a wrapper for label + helper + field coordination | Input, Textarea, Select | `.input-group`, `.textarea-group`, `.select-group` |

Sub-elements use BEM-like double-underscore: `.btn__icon`, `.switch__track`, `.checkbox__box`, `.input-group .input__label`.

Internal bridge variables use underscore prefix: `--_btn-*`, `--_sw-*`, `--_cb-*`.

---

# ADR-003: Layered Cascade Resolution (5 Layers)

## Status

**Accepted** — 2025-03-17

## Context

With ~3,000+ variables and multi-product support, we need a clear resolution strategy. Without it, teams won't understand which value they're getting or how to override it.

## Decision

Five-layer cascade, from lowest to highest priority:

1. **System defaults** — shipped by Design Token Forge
2. **Global tokens** — org-wide overrides (~50-80 vars)
3. **Product tokens** — per-product overrides (scoped via `[data-product]`)
4. **Component tokens** — per-component overrides (scoped via component class + override class)
5. **Instance tokens** — inline style overrides (rare, discouraged)

## Rationale

- Maps naturally to CSS specificity (each layer has predictably higher specificity)
- 90% of teams only touch Layer 1-2 and get full branding
- Power users can go to Layer 3-4 without breaking the system
- Product scoping via data attributes enables runtime multi-product (e.g., micro-frontends)

## Consequences

- Documentation must clearly explain the cascade
- Debugging requires understanding which layer a value comes from (tooling opportunity: a devtools plugin)
- Layer 4 (instance) can create drift — we should lint/warn against overuse

---

# ADR-004: 7-Axis Variable Coverage for Every Component

## Status

**Accepted** — 2025-03-17

## Context

Most design systems expose partial customization — colors and spacing, but not shape details like per-corner radius, per-side borders, clip paths, or motion.

## Decision

Every L1 component MUST expose variables across all 7 axes:

1. **Shape** — radius (4 corners), border (4 sides × width/style/color), shadow, ring, outline, clip-path, overflow
2. **Dimension** — height × size, padding x/y × size, min/max, gap, width model
3. **Surface** — bg/fg × variant × state, opacity, backdrop
4. **Typography** — family, size × scale, weight, line-height, letter-spacing, transform
5. **Slots** — each sub-element gets its own variable subset
6. **Motion** — transition property/duration/easing, animations
7. **A11y** — focus outline, min tap target, forced-colors

## Rationale

- "Designer to designer, it's totally different" — the system must accommodate any visual interpretation
- Shape is NOT just border-radius. Per-side borders enable Material-style underlined inputs. Clip-path enables squircle avatars. Shadow layering enables neumorphic cards.
- Missing even one axis creates a wall that forces developers to escape-hatch out of the system

## Consequences

- Large variable count per component (~60-150)
- Requires comprehensive documentation
- Component CSS is more complex (many var() references)
- This is the moat — exhaustiveness is the competitive advantage

---

# ADR-005: L1 Components Only (No L2)

## Status

**Accepted** — 2025-03-17

## Context

L2 components (layouts, page patterns, complex flows) are product-specific. A "settings page" differs between B2B SaaS and consumer apps. No design system has successfully generalized L2.

## Decision

Design Token Forge provides **L1 components only** — atomic, composable UI primitives. L2 patterns may be added in the future as optional, product-specific recipe packages, but they are not part of the core system.

## Rationale

- L1 is where variable-driven customization is most impactful
- L2 is domain-driven, not design-system-driven
- Focusing on L1 keeps the scope achievable
- L1 components can be composed into any L2 pattern by consuming teams

---

# ADR-006: Adoption of Tokn 4-Tier Color Architecture

## Status

**Accepted** — 2025-03-18

## Context

Design Token Forge needed a global color and sizing token foundation. We considered:
1. Building a flat color palette from scratch (10-step scales per palette)
2. Adopting Material Design 3's dynamic color model
3. **Adopting the existing Tokn system** (https://sridharravi90.github.io/Tokn/) — a validated 4-tier architecture with 607 tokens, 9 surface contexts, 6 semantic roles, and 10 density modes

## Decision

**Adopt the Tokn 4-tier architecture as DTF's global token foundation.** Tokn provides:

- **T0 Primitives**: 148 color tokens (8 palettes × 21 perceptual steps), 39 spacing, 19 typography
- **T1 Semantic Roles**: 6 roles (primary, brand, success, warning, danger, info) × 18 tokens × light/dark = 251 variables
- **T2 Surface Contexts**: 9 surfaces (base, bright, deep, accent, dim, container, over-container, float, inverse) × 16 tokens × light/dark
- **T3 Component Sizes**: 93 tokens × 10 density modes (micro → tiny → small → base → medium → large → big → huge → mega → ultra)
- **Utility tokens**: 5 (white, black, fixed-white, fixed-black, fixed-primary)

DTF adds its own extras on top: radius scale, shadows, motion, z-index, opacity.

## Rationale

- Tokn is already validated against a real Figma token file ("Desktop Color Tokens - Dec 2025")
- The 4-tier cascade (primitives → roles → surfaces → sizes) aligns perfectly with DTF's 5-layer resolution model
- 21-step palettes provide much finer color control than typical 10-step scales
- 9 surface contexts solve the adaptive-surface problem that most design systems ignore
- 10 density modes (vs the common 3-5) give products real density control for data-dense to spacious UIs
- Reusing validated work avoids reinventing and re-validating hundreds of color relationships

## Future: Algorithmic Color Generation

A future generator feature will accept a **single key color per palette** and algorithmically produce the full 21-step scale (white → key → black) using perceptual lightness distribution (OKLCH or similar). This will allow any product to define their brand with one hex value per palette and get a complete, contrast-safe color system.

This is tracked as a future milestone, not an immediate deliverable.

## Consequences

- Global token count jumps from ~268 to ~775 (including DTF extras)
- Naming convention shifts from `--color-primary-600` to Tokn's `--prim-{palette}-{step}` and `--{role}-{group}-{property}`
- Component surfaces must reference T1/T2 semantic tokens instead of raw color values
- The old 5-size system (xs/sm/md/lg/xl) is replaced by 10 density modes
- Teams must understand the 4-tier hierarchy to debug color resolution

---

# ADR-007: Figma Bridge — DTF as Sole Source of Truth

## Status

**Accepted (POC validated)** — 2026-03-20

## Context

Traditional design-system workflows maintain two parallel systems:
1. A **code** token system (CSS custom properties, SCSS variables, JSON tokens)
2. A **Figma** token system (manually recreated or maintained via Tokens Studio)

This dual-source-of-truth approach creates:
- Synchronization drift (values diverge between code and design)
- Duplicate effort (every token change must be applied twice)
- Ownership ambiguity (which system is "correct"?)

DTF already has a complete, validated token system: 538+ variables across primitives (T0), semantic roles (T1), surfaces (T2), and extras. Recreating this in Figma is redundant work.

## Decision

**DTF is the sole source of truth. Figma is a read-only consumer.**

The architecture has three pieces:

1. **Token Export API** (buildable now) — a Node.js script that parses DTF's CSS token files and emits a structured JSON payload compatible with Figma's Variable API.

2. **Figma Plugin** (POC validated) — a minimal plugin that reads the exported JSON and creates native Figma Variable Collections with Light / Dark modes. Designers use these variables exactly as they would use hand-created ones.

3. **AI Screen Composer** (future) — an AI-powered tool that reads DTF specs (YAML + tokens) and generates screen compositions, bypassing manual Figma layout work entirely.

### Data flow

```
DTF CSS tokens  ──→  export-figma.js  ──→  JSON payload
                                              │
                     ┌────────────────────────┤
                     ▼                        ▼
              Figma Plugin               AI Composer
              (native Variables)         (screen generation)
                     │                        │
                     ▼                        ▼
              Designer composes          AI composes
              (never builds tokens)      (never touches Figma)
```

## POC Results

The proof-of-concept validates the core mechanics:

| Metric | Result |
|--------|--------|
| Variables exported | 538 (173 color + 64 float + 9 string primitives, 108 semantic colors, 128 surface colors, 35 float + 21 string extras) |
| Collections | 4 (Primitives, Semantic Roles, Surfaces, Extras) |
| Light/Dark modes | Semantic + Surface collections get dual-mode support |
| Figma path grouping | `--surface-over-container-bg` → `surface/over-container/bg` — native tree hierarchy |
| Type mapping | Hex → COLOR, numeric → FLOAT, composite → STRING |
| Parsing accuracy | 100% of CSS custom properties extracted |

## Rationale

- Eliminates synchronization drift — Figma always reflects the code truth
- Saves 100% of manual Figma token maintenance
- Figma's native Variable system (not a third-party plugin) provides first-class UX: inspector shows variable names, mode switching works per-frame, auto-complete in the fill picker
- One export command updates the entire Figma token system
- Component token aliasing (V2) will create the full resolution chain inside Figma: component var → semantic var → primitive var

## Consequences

- Designers cannot create or modify tokens in Figma — all changes go through code (DTF)
- Full variable aliasing (component → semantic → primitive) requires V2 development
- Composite values (shadows, gradients) map to STRING type in Figma (no native effect variable support yet)
- Plugin must be re-run after token changes (V2: auto-sync via watch mode or webhook)

## Roadmap

| Phase | Scope |
|-------|-------|
| **POC** (done) | CSS → JSON exporter, minimal Figma plugin, 538 variables |
| **V1** | + component tokens, + variable aliasing, + HTTP fetch, + diff/update |
| **V2** | + bidirectional sync, + Figma Component generation from YAML specs, + DTCG export |
| **V3** | + AI Screen Composer, + real-time watch mode, + publish to Figma Community |
