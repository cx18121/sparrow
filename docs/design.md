---
name: Sparrow
description: A practical warm-toned workspace for student cold outreach.
colors:
  primary: "#557A57"
  primary-50: "#EEF5EE"
  primary-100: "#D2E8D3"
  primary-300: "#7DB480"
  primary-500: "#557A57"
  primary-600: "#426145"
  accent: "#A8845C"
  accent-50: "#FAF3EB"
  accent-100: "#F0DCBF"
  warm-50: "#FDFAF5"
  warm-100: "#F5EFE4"
  warm-200: "#E8DDD0"
  surface: "#F5F0E8"
  panel: "#F8F4ED"
  dark: "#2C1F10"
  muted: "#7A6651"
  danger: "#EF4444"
typography:
  display:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "normal"
  headline:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  title:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.18em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "rgba(245,240,232,0.88)"
    borderColor: "rgba(168,132,92,0.28)"
    textColor: "{colors.dark}"
    rounded: "{rounded.full}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "8px 12px"
  input:
    backgroundColor: "rgba(245,240,232,0.80)"
    borderColor: "rgba(168,132,92,0.22)"
    textColor: "{colors.dark}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  segmented-chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "8px 16px"
---

# Design System: Sparrow

## 1. Overview

**Creative North Star: "The Outreach Desk"**

Sparrow should feel like a clean workspace built for students who need to move through outreach tasks quickly: discover leads, organize contacts, generate drafts, review copy, and send email. The visual system is warm, restrained, and practical. It favors clear hierarchy, familiar controls, and explicit status over decoration.

The palette is warm parchment — cream surfaces, forest green as the single action color, warm tan as a supporting accent. The sidebar is a light cream panel, not a dark rail. The app stays in light mode throughout.

Key Characteristics:
- Light mode throughout, with warm cream surfaces and a forest green primary.
- Dense enough for repeated outreach work, never crowded for its own sake.
- Familiar product patterns: sidebar navigation, segmented tabs, tables, inline editing, settings forms.
- AI output is treated as editable work, not spectacle.

## 2. Colors

The palette is warm and earthy: cream surfaces, parchment panels, a single forest green action color, and a warm tan accent. All surfaces stay light.

### Primary

- **Forest Green** (#557A57): Main button background, active navigation, segmented active state, focus rings. Pair with white text.
- **Forest Light** (#7DB480, primary-300): Hover states, decorative accents on dark surfaces.
- **Forest Deep** (#426145, primary-600): Pressed/active state tint, emphasis in dense tables.

### Accent

- **Warm Tan** (#A8845C): Supporting borders, dividers, hover fills, secondary decoration. Never used as a call-to-action color. Use at low opacity (10–30%) for borders and hover tints.

### Neutral

- **Dark Espresso** (#2C1F10): Primary text, headings, sidebar text, dark labels.
- **Warm Muted** (#7A6651): Secondary text, helper copy, inactive navigation items.
- **Surface** (#F5F0E8): Page background — warm cream.
- **Panel** (#F8F4ED): Sidebar, dropdowns, cards — slightly lighter than surface.
- **Warm Scale**: `warm-50: #FDFAF5`, `warm-100: #F5EFE4`, `warm-200: #E8DDD0` — used for hover fills and subtle layering.

### Landing Page Dark Panel

The auth screen uses a near-neutral very dark background (`#1C1C1A`) for the left split panel. This is intentionally not the same as the dark text color — it reads as charcoal, not brown. Accent highlights on this panel use Forest Light (`#7DB480`, primary-300) for the h1 span and a muted green (`rgba(125,180,128,0.6)`) for the eyebrow, keeping accents on-brand rather than using the warm tan (which reads brownish on dark backgrounds).

### Named Rules

**The One Green Rule.** Forest Green means current, primary, selected, or focused. White text on it. Do not use it as generic decoration.

**The Light Sidebar Rule.** The sidebar is always Panel (`#F8F4ED`). The content area uses Surface (`#F5F0E8`).

**The Warm Accent Rule.** Warm Tan (`#A8845C`) carries borders and low-emphasis hover fills at 10–30% opacity. Do not use it as a headline color — it reads as brown at full opacity.

**The Light Workspace Rule.** Default content surfaces stay light because students are actively reading, editing, and comparing text.

## 3. Typography

**Display Font:** Outfit with system fallback  
**Body Font:** DM Sans with system fallback  
**Label Font:** DM Sans for labels; system monospace only inside editing surfaces

**Character:** Outfit gives headers warmth and polish; DM Sans keeps tables, forms, and buttons compact and readable.

### Hierarchy

- **Display** (600, 2rem to 3.25rem, tight line-height): Onboarding and page-level titles only.
- **Headline** (600, 1.5rem, 1.2): Section headers and major panel headings.
- **Title** (600, 1rem, 1.4): Card labels, table emphasis, compact headers.
- **Body** (400, 0.875rem, 1.5): Default app copy, form text, table content. Keep longer prose at 65 to 75 characters.
- **Label** (600, 0.6875rem, 0.18em tracking, uppercase): Form labels, table headers, metadata labels. Use sparingly.

### Named Rules

**The Product Type Rule.** Keep UI text compact and fixed-scale. Do not introduce fluid hero typography inside task surfaces.

## 4. Elevation

Most surfaces stay flat with borders or subtle background contrast. Shadows appear on dropdowns, prominent secondary controls, and overlays where depth must clarify stacking.

### Shadow Vocabulary

- **Card Shadow** (`0 18px 50px rgba(44,31,16,0.08)`): Rare container emphasis, elevated utility surfaces.
- **Modal Shadow** (`0 32px 90px rgba(44,31,16,0.20)`): Dropdowns, overlays, and true modals.
- **Active Green Shadow** (`0 10px 24px rgba(85,122,87,0.18)`): Active segmented chip or primary selected state.

### Named Rules

**The Flat-Until-Needed Rule.** Tables, forms, and page shells should not float by default. Elevation appears only to clarify layering or active state.

## 5. Components

### Buttons

- **Shape:** Fully rounded pills for primary, secondary, ghost, and danger actions.
- **Primary:** Forest Green background with white text, `10px 16px` default padding.
- **Secondary:** Warm parchment background with tan border and dark text, subtle lift on hover.
- **Hover / Focus:** Slight brightness lift on primary; warm fill and one-pixel lift on ghost and secondary. Focus uses a visible green ring.
- **Disabled:** Lower opacity and blocked cursor.

### Chips

- **Style:** Segmented controls use pill chips. Active chips are Forest Green with white text; inactive chips show muted text with transparent or warm hover fill.
- **State:** Selected state must be obvious through fill, not only border or text color.

### Status Pills

- **Component:** `<Pill variant="success|warning|danger|info|neutral" />` — small tinted label for short read-only state.
- **Variant tokens:** Defined once in `src/components/ui/statusTokens.ts`. `Pill`, `Badge`, `Banner`, `Toast`, and `ConfirmDialog` consume those semantic tone classes instead of re-declaring status color strings.
- **Versus Badge:** `<Badge>` is the dot-indicator-plus-text affordance. Use `<Pill>` when a tinted background carries the meaning; use `<Badge>` when a dot is enough.

### Stats

Two valid patterns. Pick the one that matches the surface's job.

- **Strip pattern.** Inline `divide-x` row of label-then-number stats. No card backgrounds. Used on dense work surfaces (inside a campaign, settings, secondary dashboards) where stats are context, not the headline.
- **KPI card pattern.** Three restrained cards in a row at the top of the Home surface: Lead Pool, Drafts, Sent This Week. Label (uppercase 0.18em tracking, muted) top-left, single lucide icon top-right at muted opacity, big number (Outfit 600, ~2rem, dark espresso) bottom-left, one helper line (body, muted) next to or below the number. Flat panel background, no shadow, no gradient, no delta arrow, no icon chip. The card is a quiet container, not a poster.

  Reserved for the Home surface — campaigns are the work, the KPI row sets the day's context above them.

- **Ban (still in effect):** decorative variants of the KPI card — gradient backgrounds or accent stripes, icon chips with colored fills, oversized supporting-stat blocks, delta arrows, drop shadows, animated counters. If the card has any of those it has crossed into SaaS-cliché territory.

### Banners

- **Component:** `<Banner variant="success|warning|danger|info" icon? size?>` — inline tinted alert tied to a page or section.
- **Sizes:** `md` (default — `px-4 py-3 text-sm`) for page-level alerts; `sm` (`px-3 py-2 text-xs`) for in-modal contexts.
- **Side-stripe colored borders are banned.** Use `<Banner>` instead of `border-l-2` accent stripes.

### Page Header Patterns

- **Rich** — `.page-eyebrow` + `font-display text-3xl` h1 + actions in `.page-toolbar`. Used by anchor surfaces such as Home and Settings.
- **Slim** — `.page-eyebrow` + `text-sm text-muted` subtitle, no h1. Used by work surfaces with persistent toolbars.
- **Minimal** — no header section. Used by sidebar-shell tools and metric surfaces.

**Always use `.page-eyebrow`** (`tracking-[0.28em]`, `text-primary`). Don't inline other tracking values.

**Always use canonical Label tracking** (`tracking-[0.18em]`) for column headers, form labels, stat labels.

### Cards / Containers

- **Corner Style:** 8px to 16px for content containers. No nested cards.
- **Background:** Surface for page background, Panel for sidebars, tables, dropdowns, and inputs.
- **Shadow Strategy:** Flat by default. Shadows only for overlays, dropdowns, or clearly elevated controls.
- **Internal Padding:** Dense task panels use 16px to 24px. Page shells use 24px to 56px.

### Inputs / Fields

- **Style:** Rounded 16px fields with warm parchment background, tan border at low opacity, 14px text.
- **Focus:** Green-tinted border plus low-opacity green focus ring.
- **Error / Disabled:** Error states use red text and red-tinted border. Disabled states reduce opacity.

### Navigation

- **Style:** Left sidebar (`#F8F4ED`) with compact rounded row buttons. Active tab uses Forest Green fill with white text.
- **Typography:** 14px medium labels, 15px lucide icons.
- **Behavior:** Sidebar can collapse to icons.

### Tables

- **Style:** Table-first work surfaces with compact rows, warm tan dividers, muted metadata, and truncation for long content.
- **Interaction:** Row click opens preview, checkboxes support bulk action, actions stay right-aligned.

## 6. Do's and Don'ts

### Do:

- **Do** keep the product clean, fast, useful, and practical.
- **Do** make sent, draft, loading, failed, and connected states explicit.
- **Do** use Forest Green for primary action, current selection, and focus.
- **Do** preserve familiar product patterns for sidebar navigation, tables, tabs, forms, and settings.
- **Do** keep AI-generated emails inspectable and editable before sending.

### Don't:

- **Don't** make Sparrow look like generic AI slop.
- **Don't** use decorative gradients, vague productivity copy, oversized marketing composition inside the app, repetitive icon cards, glassy surfaces, or fake complexity.
- **Don't** default to dark mode.
- **Don't** add decorative motion that does not communicate state.
- **Don't** use colored side-stripe borders, gradient text, nested cards, or modal-first interactions.
- **Don't** use Warm Tan (`#A8845C`) at full opacity as a headline or accent color — it reads as brown. Use it at 10–30% opacity for borders and hover fills only.
