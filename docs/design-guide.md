# Saturday UI — Liquid Glass adaptation

Saturday remains a local SvelteKit app. This design applies Apple's hierarchy,
geometry, and accessibility guidance to web components; it does not implement
Apple's native Liquid Glass renderer, adaptive lensing, or system vibrancy.

## Apple guidance and its application

- [Get to know the new design system — WWDC25, session 356](https://developer.apple.com/videos/play/wwdc2025/356/):
  maintain recognizable navigation across sizes, strengthen left-aligned
  headings, and reserve capsules for prominent actions. Keep compact form
  controls rounded rectangles. Rounded containers and their children use
  spacing that gives their corners room (concentric corners).
- [Materials — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/materials):
  reserve glass for the functional layer. Saturday's top bar, tab bar, toast,
  and dialog use a regular-inspired, substantially opaque material. Job lists,
  statistics, text fields, buttons, and history stay on solid surfaces. Clear
  glass is inappropriate for this text-heavy app. Selection uses a tinted fill
  inside the navigation material, without a second blur layer.
- [Toolbars — Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/toolbars)
  and [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars):
  separate text actions, retain explicit labels, and give the primary action a
  distinct tint. Persistent navigation contains only Dashboard, Jobs, and
  Settings; page-specific actions stay on their page. Flat top-level
  destinations use a tab bar on narrow screens.
- [Meet Liquid Glass — WWDC25, session 219](https://developer.apple.com/videos/play/wwdc2025/219/):
  accommodate reduced transparency, increased contrast, and reduced motion.
  Dialogs use a dimmed backdrop to establish modality. Their controls use solid
  fills instead of stacking additional glass surfaces.

## Rules for new pages

Follow these when adding or changing a page. Each rule names the class,
component, or token that implements it.

### Materials

- **Glass is for the functional layer only:** `.glass-surface` on the top bar,
  tab bar, toast, and dialog content. Nothing else uses `backdrop-filter`.
  Buttons never use glass, including page actions.
- Content surfaces are opaque: `Card`, `.funnel`, `.empty-state`,
  `.disclosure`, `.inset-surface`.
- Glass needs content moving beneath it to be meaningful. Do not add glass to
  elements that only sit in normal flow.

### Corner radii

Use the scale in `layout.css`. A nested surface uses the next step down.

| Token         | Value | Use                                                  |
| ------------- | ----- | ---------------------------------------------------- |
| `--r-shell`   | 28px  | Top bar, tab bar, dialog, toast, empty state         |
| `--r-card`    | 24px  | Cards, disclosures, funnel, activity summary         |
| `--r-group`   | 16px  | Insets inside a card: notices, code blocks, callouts |
| `--r-control` | 12px  | Fields, selects, compact buttons                     |

Items inside the 28px bars use concentric radii: 18px in the top bar, 22px in
the tab bar. In Tailwind, write `rounded-[var(--r-group)]`; do not use
`rounded-xl` and friends for app surfaces.

### Buttons

- **Capsule:** the prominent actions of a view or container. This is applied by
  container, so just place the button inside one: `.page-actions`,
  `.form-actions`, `Dialog.Footer`, or `EmptyState` actions.
- **Rounded rectangle (`--r-control`):** every other button, such as actions
  inside cards, compact `sm` buttons, and in-row controls.
- **One tinted primary per view.** The `default` variant is the tinted primary;
  `outline` becomes a solid secondary fill in capsule containers; `ghost` is
  for Cancel and low-emphasis actions; `destructive` for removing data.
- Segmented controls (`.job-filters`) are capsules, following iOS 26.
- Icon-only buttons need an accessible name and a `title`.
- The shared `Button` exposes `data-variant`, which the CSS uses.

### Navigation

- Three destinations: Dashboard, Jobs, Settings, always with the same icons.
- At 48rem and wider, they are in the sticky glass top bar
  (`.desktop-navigation`), with a soft blurred scroll edge (`.scroll-edge`)
  above scrolling content.
- Below 48rem they move to a floating glass tab bar (`.tab-bar`) within reach of
  the thumb. The top bar becomes a plain, non-sticky brand row. Content gets
  bottom padding for the bar and safe area.
- Selection is a tinted fill (`--selection`) with a primary-colored icon.
  Hover fills (`--hover-fill`) are wrapped in `@media (hover: hover)` so touch
  devices never keep a hover state.
- Back links (`.back-link`) sit above the page header on detail and form pages.

### Page structure

- Use `PageHeader`: left-aligned title, optional `eyebrow`, `description`,
  `meta` (status and attribution shown with the title), and `actions`.
- Actions: at most one primary per header. If an empty state repeats the same
  primary action, hide it from the header.
- Attribution, such as “Added by assistant”, appears once at job level as a
  badge. Entries use a small icon with an accessible name.
- Lists of jobs use `JobRow`. Rows wrap long titles and keep secondary text at
  13px or larger.

### Forms and dialogs

- Use `Field` for label, hint, and error; `NativeSelect` for selects (native
  menus work best on touch); `Input` and `Textarea` from the ui folder.
- Mark required fields with `*` and include a “* Required” cue at the top of
  the form.
- Optional fields go in a `.disclosure` with a `.disclosure-body`.
- Form footers use `.form-actions` (capsules; primary last).
- After a failed save, focus moves to the first invalid field or the error
  `Notice`. Use `enhanceWithFocus` from `$lib/forms` with `use:enhance`, or call
  `focusFirstError()` in a custom callback. Errors for a dialog appear inside it.
- Explain conditional behavior as a field hint at the moment it applies, not as
  permanent dialog text.
- Dialogs use a centered glass panel from 48rem and become bottom sheets below
  it. Always include a title and description.
- **Never use `window.confirm`.** Use `ConfirmDialog` for irreversible or
  consequential actions (it submits a form by `formId`), or an inline confirm
  step inside an edit dialog. Reserve `destructive` for the confirming button.
- Editing an entry uses the same dialog pattern as adding one (see
  `UpdateCorrection`).

### Feedback

- Confirm a completed save with a toast, not an inline banner. From a server
  action, redirect with `?saved=<key>` and add the key to `SAVED_MESSAGES` in
  `$lib/toast.svelte.ts`; the root layout shows it once, then removes the
  parameter. On the client, call `toast.show(message)`.
- Use `Notice` for errors and persistent information. Errors use `role="alert"`
  and can receive focus.
- Empty states (`EmptyState`) explain what to do next and offer one primary
  action. Error pages offer Dashboard and Jobs, plus Try again for non-404 errors.

### Dashboard patterns

- Every number that looks tappable must link somewhere meaningful. Progress
  counts link to `/jobs?step=<key>`, which filters to jobs that ever reached
  that step and shows a removable filter chip.
- Progress is shown in step order as a funnel (`.funnel`) with a proportional
  bar beside the count. Bars are decorative; the count carries the meaning.
- Show what matters next: dated future updates appear under “Coming up”.

### Typography and copy

- Headings use balanced wrapping, paragraphs use pretty wrapping.
- Use natural counts: “3 active jobs”, “1 job in total”.
- Inline `code` gets a chip style automatically; do not hand-style it.
- Dates on timelines sit on a secondary line under the label with a calendar
  icon. Future entries show a hollow marker and a Scheduled badge.

### Motion

- Route changes use a short cross-fade through the View Transitions API.
- Sheets and toasts use short ease-out motion.
- All of it is disabled or shortened under `prefers-reduced-motion`.

## Implementation

- `src/routes/layout.css` owns semantic light/dark tokens, materials, the radius
  scale, responsive geometry, and application overrides for the installed
  primitives. Browser appearance preferences determine the color scheme.
- `src/routes/+layout.svelte` owns the top bar, tab bar, scroll edge, toast host,
  saved-message handling, and route transitions.
- The sticky top bar stays in normal layout flow and provides one material
  boundary over scrolling content. Safe-area padding protects the header, tab
  bar, sheets, and toast on devices with display cutouts.
- Page headers wrap actions as space narrows. Job details use two columns from
  64rem and one below it. Forms retain a readable maximum width, long text
  wraps, and the assistant configuration scrolls within its own container.
- Long job descriptions collapse behind Show more, with `aria-expanded`.
- Job posting links show the host name, with the full address as a tooltip and
  an assistive “opens in a new tab” cue.
- The Dashboard groups the active count, upcoming items, the progress funnel,
  and recent jobs. Progress counts still overlap and retain their meaning.
- The Active/All control retains its URL-based state; the step filter implies All.
- Forms, error notices, and local assistant setup retain their existing data
  contracts. No database schema, MCP tool, or server-action contract changes.

## Icons

Use the installed `@lucide/svelte` package for interface icons. Follow the
[official Svelte integration](https://lucide.dev/guide/svelte/getting-started)
and import individual components, for example:

```svelte
<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<Button href="/jobs/new"><Plus data-icon="inline-start" />Add job</Button>
```

The root layout calls `setLucideProps` for a 20px default size, 2px stroke, and
`currentColor`. Local size classes distinguish navigation (20px) from inline
button icons (16px). The provider keeps per-icon overrides available. See
[Lucide global styling](https://lucide.dev/guide/svelte/advanced/global-styling).

Icons reinforce labels; they do not replace ambiguous text actions such as
Edit. Keep the same icon for each destination across screen sizes. Icon-only
buttons must have an accessible name on the button, such as Edit update or
Dismiss message. Decorative icons remain hidden from assistive technology, as
Lucide does by default. See [Lucide accessibility](https://lucide.dev/guide/svelte/advanced/accessibility).

The existing Saturday logo is a brand asset, separate from interface icons.
Do not introduce a second icon library or import the complete icon catalogue.

## Web limitations and review

CSS backdrop blur and restrained highlights approximate a material; they do not
reproduce native refraction or automatically sample content to adjust contrast.
Text-heavy content therefore has an opaque base and glass has a strong fill.
Browsers without backdrop-filter get solid surfaces. Accessibility media queries
apply when the browser exposes the corresponding preference; operating-system
settings are not guaranteed to propagate in every browser.

Before release, visually review wide and narrow layouts, 200% zoom, light/dark
appearance, keyboard navigation, dialog and sheet focus, the toast, the tab bar
over a long page, and the accessibility preferences (reduced transparency,
increased contrast, reduced motion). Compilation and HTTP route checks do not
replace that browser review.
