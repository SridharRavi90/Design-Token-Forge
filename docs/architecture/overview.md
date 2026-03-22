# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  DESIGN TOKEN FORGE                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              SPEC LAYER (YAML schemas)            │   │
│  │  /specs/tokens/    → Global token definitions     │   │
│  │  /specs/components/ → Component variable schemas  │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│                 ▼                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │              TOKEN ENGINE                         │   │
│  │  @design-token-forge/tokens                       │   │
│  │  - Parses global token schemas                    │   │
│  │  - Resolves cross-references (var(--x))           │   │
│  │  - Validates token values                         │   │
│  │  - Exports: CSS, JSON, SCSS, Tailwind config      │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│                 ▼                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │             COMPONENT LIBRARY                     │   │
│  │  @design-token-forge/components                   │   │
│  │  - ~35 L1 components                              │   │
│  │  - Pure CSS (variable-driven, zero hardcoded)     │   │
│  │  - Thin JS wrappers per framework                 │   │
│  │  - 7-axis variable coverage per component         │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │                                        │
│                 ▼                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │              GENERATOR                            │   │
│  │  @design-token-forge/generator                    │   │
│  │  - Input: product config (YAML/JSON)              │   │
│  │  - Output: complete CSS with all vars resolved    │   │
│  │  - Applies layered cascade                        │   │
│  │  - Supports multiple output formats               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Token Architecture: Tokn 4-Tier Foundation

Global tokens follow the Tokn 4-tier color architecture (see `docs/tokens/global-tokens.md`):

```
T0  PRIMITIVES       → 148 colors (8 palettes × 21 steps), 39 spacing, 19 typography
T1  SEMANTIC ROLES    → 6 roles × 18 tokens × light/dark = 108 definitions
T2  SURFACE CONTEXTS  → 9 surfaces × 34 tokens × light/dark
T3  COMPONENT SIZES   → 93 tokens × 10 density modes
                        + DTF extras: radius, shadows, motion, z-index, opacity
```

### 10 Density Modes

```
micro → tiny → small → base → medium → large → big → huge → mega → ultra
```

`base` is the default density. Components declare which mode subset they support.

### 9 Surface Contexts

```
surface-base | surface-bright | surface-deep | surface-accent | surface-dim
container    | over-container | float         | inverse
```

Surfaces are applied via `[data-surface="base"]` on a containing element. All descendant
components inherit the surface context's content colors, component fills, and semantic mappings.

## Layered Cascade Resolution

The cascade is the core intellectual property. It determines how 3,000+ variables resolve without overwhelming the user.

```
LAYER 0: SYSTEM DEFAULTS
│  Provided by Design Token Forge (Tokn 4-tier tokens + DTF component vars).
│  Every variable has a default value.
│  These create a usable (if generic) design system out of the box.
│
├── LAYER 1: GLOBAL TOKENS (org-wide)
│   │  Set by the org's design team.
│   │  Override Tokn T0 primitives to rebrand the palette.
│   │  e.g., --prim-brand-500: #ea580c
│   │  T1/T2/T3 tokens auto-resolve from new primitives.
│   │
│   ├── LAYER 2: PRODUCT TOKENS (per-product)
│   │   │  Set per product/brand via [data-product].
│   │   │  Override any tier: primitives, roles, surface tokens.
│   │   │  e.g., Product A: --prim-brand-500: #ea580c;
│   │   │
│   │   ├── LAYER 3: COMPONENT TOKENS (per-component)
│   │   │   │  Rare. For when a specific component needs
│   │   │   │  to break from the system.
│   │   │   │  e.g., --btn-border-radius: var(--radius-full)
│   │   │   │  (pill buttons even though system radius is 8px)
│   │   │   │
│   │   │   └── LAYER 4: INSTANCE (inline)
│   │   │       One-off override. Applied via inline style
│   │   │       or scoped class. Discouraged but available.
```

### Resolution Example

```css
/* Layer 0: Tokn T0 primitive */
:root { --prim-brand-500: #E53F28; }

/* Layer 0: Tokn T1 semantic role referencing T0 */
:root { --primary-component-bg-default: var(--prim-brand-500); }

/* Layer 0: DTF component token referencing T1 */
:root { --btn-primary-bg: var(--primary-component-bg-default); }

/* Layer 2: Product A overrides the primitive */
[data-product="product-a"] { --prim-brand-500: #ea580c; }

/* Result: buttons in Product A are orange, Product B stays red */
```

## CSS Architecture

### Scoping Strategy

```css
/* Tokn T0 primitives on :root */
:root {
  --prim-brand-500: #E53F28;
  --prim-monochromatic-500: #286CE5;
  --spacing-4: 4px;
  --radius-md: 6px;
  /* ... ~775 global tokens (Tokn + DTF extras) */
}

/* Surface contexts on containing elements */
[data-surface="base"]   { /* inherits surface-base tokens */ }
[data-surface="float"]  { /* inherits float tokens */ }

/* Product tokens override via data attribute */
[data-product="product-a"] {
  --prim-brand-500: #ea580c;
  --radius-md: 12px;
}

/* Component defaults reference Tokn T1/T2 semantic tokens */
:root {
  --btn-primary-bg: var(--primary-component-bg-default);
  --btn-border-radius: var(--radius-md);
  --btn-padding-x-base: var(--spacing-12);
}

/* Component CSS uses only component-level tokens */
.btn {
  border-radius: var(--btn-border-radius);
  padding-inline: var(--btn-padding-x-base);
  /* NEVER: border-radius: 8px; ← FORBIDDEN */
}
```

### File Organization Per Component

```
packages/components/src/button/
├── button.css          # Core CSS (framework-agnostic)
├── button.tokens.css   # Component token declarations + defaults
├── button.types.ts     # TypeScript prop types
├── button.a11y.ts      # Accessibility attribute mapping
├── react/
│   └── Button.tsx      # React wrapper (thin)
├── vue/
│   └── Button.vue      # Vue wrapper (thin)
└── svelte/
    └── Button.svelte   # Svelte wrapper (thin)
```

## Component Anatomy Standard

Every L1 component is defined as:

```
COMPONENT: [name]
├── Root element            → has component-level class (.btn, .input, .card)
├── Slots (sub-elements)    → each has its own class (.btn__icon, .btn__label)
├── Variants                → applied via data attributes (data-variant="primary")
├── Sizes                   → applied via data attributes (data-size="base")
│                             10 density modes: micro,tiny,small,base,medium,large,big,huge,mega,ultra
├── States                  → natural CSS states (:hover, :focus-visible, :disabled)
│                             + data attributes (data-loading, data-error)
└── Variable resolution     → all styles read from CSS custom properties
```

### Data Attribute Convention

```html
<!-- Variant + Size + State via data attributes -->
<button class="btn" data-variant="primary" data-size="base" data-loading="true">
  <span class="btn__loader" aria-hidden="true"></span>
  <span class="btn__icon">...</span>
  <span class="btn__label">Submit</span>
</button>
```

Why data attributes over classes:
- Predictable specificity (no `.btn-primary-lg-loading` class chains)
- Easy to target in CSS: `.btn[data-variant="primary"]`
- Framework-agnostic (works in any templating system)
- Machine-readable (AI can parse component state)

## Multi-Product Configuration

Product configurations are YAML files that specify token overrides:

```yaml
# products/product-a.yaml
product:
  name: "Product A"
  id: "product-a"
  density: "base"           # Default density mode
  color-scheme: "light"     # Default color scheme

tokens:
  # Override Tokn T0 primitives to rebrand
  primitives:
    prim-brand-500: "#ea580c"
    prim-brand-600: "#c2410c"
    prim-brand-400: "#f97316"

  # Override DTF extras
  global:
    radius-md: "12px"
    font-family: "'Inter', system-ui, sans-serif"

  # Component-level overrides (Layer 3)
  components:
    button:
      btn-border-radius: "var(--radius-full)"  # pill buttons
      btn-font-weight: "600"
    card:
      card-shadow-raised: "0 4px 12px rgba(0,0,0,0.08)"
```

The generator reads this config, resolves the Tokn 4-tier cascade, and outputs a complete CSS file with all overrides applied.
