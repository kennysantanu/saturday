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
  distinct tint. Persistent navigation contains Dashboard, Jobs, Network, Documents, and
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

- Five destinations: Dashboard, Jobs, Network, Documents, Settings, always with the same icons.
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

- Wrap every page in `PageShell` (one `space-y-8` rhythm and the document title
  `{title} · Saturday`; `width="form"` for add and edit forms). Titles read
  `Primary · Context`, for example `Ada Lovelace · Network`.
- Use `PageHeader`: left-aligned title, optional `eyebrow`, `description`,
  `meta` (status and attribution shown with the title), `actions`, and `back`
  (`{href, label}`, shown as an arrow and "Back to {label}"). Do not hand-write
  back links.
- Actions: at most one primary per header. If an empty state repeats the same
  primary action, hide it from the header.
- Attribution, such as “Added by assistant”, appears once at job level as a
  badge. Entries use a small icon with an accessible name.
- Lists are a `Card` of rows on the shared `.list-row` grid: `JobRow`,
  `PersonRow`, and `DateRow` are whole-row links with a mark, a chevron and a
  status column; `DocumentRow` is not a link because it has its own actions.
  Rows wrap long titles and keep secondary text at 13px or larger (`.meta-text`).
- Follow-up and deadline dates use `DueBadge` everywhere: overdue dates are
  tinted and say "Overdue", never color alone.
- Cards on detail pages use `SectionCard` (heading, optional count and
  description, header actions). `LinkedItem` is one linked record inside such a
  card. Use `EmptyState` with `size="inline"` for an empty section.
- Paging uses `Pagination` (both buttons always shown, unavailable ones
  disabled). Search and filter forms use `FilterBar` (Clear, then Apply) and
  `FilterChips` for the filters in effect.
- In-content links use `.link`; do not hand-style underlines.

### Forms and dialogs

- Use `Field` for every labelled control, including number and file inputs;
  `NativeSelect` for selects (native menus work best on touch); `Input` and
  `Textarea` from the ui folder; `Checkbox` and `RadioOption` for choices.
  Never write a bare `<label>`, `<select>` or `<input type="checkbox">`.
- Add and Edit forms share one field component (`JobFields`, `PersonFields`) so
  they cannot drift apart.
- Mark required fields with `*` and include a “* Required” cue at the top of
  the form.
- Additional optional fields go in a `.disclosure` with a `.disclosure-body`.
  Add/Edit job keeps the posting link, description, notes, and star checkbox
  alongside title/company; employment and follow-up details use the disclosure.
- Form footers use `.form-actions` (capsules; primary last). Add and edit
  pages add `justify-end`.
- Show progress while a form is sent: wrap custom `use:enhance` callbacks in
  `withPending` (`enhanceWithFocus` already does). The submit button dims and
  shows a spinner.
- Forms with free text warn before leaving with unsaved edits: create an
  `UnsavedChanges` (`$lib/unsaved.svelte`), use `guard.enhance` and
  `oninput={guard.markDirty}`, and render `UnsavedGuard`.
- After a failed save, focus moves to the first invalid field or the error
  `Notice`. Use `enhanceWithFocus` from `$lib/forms` with `use:enhance`, or call
  `focusFirstError()` in a custom callback. Errors for a dialog appear inside it.
- Explain conditional behavior as a field hint at the moment it applies, not as
  permanent dialog text.
- Dialogs use a centered glass panel from 48rem and become bottom sheets below
  it. Always include a title and description. Width: `sm:max-w-md` for
  confirmations and short forms, `sm:max-w-lg` for longer forms, `sm:max-w-2xl`
  for pickers. Cancel is a ghost button and comes first.
- **Never use `window.confirm`.** Use `ConfirmDialog` for irreversible or
  consequential actions (it submits a form by `formId`), or an inline confirm
  step inside an edit dialog. Reserve `destructive` for the confirming button.
- Editing an entry uses the same dialog pattern as adding one (see
  `UpdateCorrection`).
- Per-item actions use `RowActions`: a visible Edit with icon and label, and the
  rest in `ActionMenu` (icons; Delete is tinted, separated and last). Reserve
  `destructive` for permanent deletion; reversible actions such as Dismiss use
  the default confirm button.
- Pair create, upload and link actions with their icon (`Plus`, `Upload`,
  `Link2`).

### Feedback

- Confirm a completed save with a toast, not an inline banner. From a server
  action, redirect with `?saved=<key>` and add the key to `SAVED_MESSAGES` in
  `$lib/toast.svelte.ts`; the root layout shows it once, then removes the
  parameter. On the client, call `toast.show(message)`.
- Use `Notice` for errors and persistent information. Errors use `role="alert"`,
  can receive focus, and always have a title.
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
- Jobs filters use a GET form with explicit Apply, URL state, removable chips, and pagination. Activity offers Active/Inactive/All; historical step filters imply All and disable the activity control. Advanced controls use an opaque disclosure and labeled checkbox groups.
- Job writes, error notices, and local assistant setup retain their existing data contracts. Search adds optional MCP query inputs and pagination metadata without a database schema change.

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

## Network patterns

Network uses solid list/cards, inline labeled person fields, GET filters and independent pagination for linked jobs/interactions. Name is the only required person field. List rows keep role/organization, last recorded interaction and follow-up readable on mobile; overdue/today have text cues. Person Notes, Relationship note and Interaction note have distinct labels. Follow-up and interaction editing use existing dialogs/focus handling; permanent interaction deletion uses ConfirmDialog. Linking/unlinking stays separate from person creation and preserves both records. Choosers use explicit selection, paginated search and disabled already-linked options. Five navigation labels must fit at narrow widths and 200% zoom.

## Documents patterns

Documents is a `Card` of `DocumentRow`s under a search `FilterBar`. Upload is the tinted primary; New document
and Select Master CV are secondary buttons beside it. A row shows the filename (link), a Master CV badge, type,
size and date, then Edit and a menu (Preview, Download, Rename, Duplicate, Delete). The Select Master CV dialog lists
Markdown documents with a No Master CV choice, so one dialog both selects and unselects. The Master CV picker and Copy to this job picker fetch in place with a
skeleton while loading; Network and job pickers keep URL state so they work with
server validation and survive reloads. The editor toolbar uses icons, reports
`aria-pressed`, and disables Undo and Redo when unavailable. Unsaved edits show
a badge beside the title.

## Settings patterns

Settings opens with a section navigation (Assistant, Backups, Storage) and one `SectionCard` per section. Backup and restore has one primary Back up now action, a contents select (Database and files by default, Database only optional), and a secondary Back up files only button. One `SchedulePanel` selects contents, interval and retained sets. One `BackupList` groups paired artifacts into a single entry with separate database/file downloads; `RestorePreview` shows the selected contents. Independent file import, additive restore and unmatched folders live in Advanced file recovery. Timestamps use `formatDateTime` and sizes use `formatBytes`.

## Building a new page or feature

Before building or changing UI:

1. Read this guide in full.
2. Find the closest existing page and copy its structure: Jobs for a filtered list, Network detail for a detail
   page with linked records, Add job for a form, Settings for a long page of sections.
3. Look in `src/lib/components/app` before writing markup. If a shared component exists, use it. If a pattern
   appears a second time, extract a component instead of copying markup.

Shared components to use:

| Need                              | Use                                                          |
| --------------------------------- | ------------------------------------------------------------ |
| Page frame and document title     | `PageShell`, then `PageHeader` (with `back`)                 |
| Labelled input, select, textarea  | `Field` with `Input`, `NativeSelect`, `Textarea`             |
| Checkbox or radio choice          | `Checkbox`, `RadioOption`                                    |
| List of records                   | `Card` of `JobRow`, `PersonRow`, `DateRow`, `DocumentRow`    |
| Due dates                         | `DueBadge`                                                   |
| Titled card on a detail page      | `SectionCard`, `LinkedItem`, `EmptyState size="inline"`      |
| Search and filters                | `FilterBar`, `FilterChips`                                   |
| Paging                            | `Pagination`                                                 |
| Edit and delete one item          | `RowActions`, `ActionMenu`                                   |
| Irreversible action               | `ConfirmDialog` (never `window.confirm`)                     |
| Form submit with a failed save    | `enhanceWithFocus` or `withPending` from `$lib/forms`        |
| Form with free text               | `UnsavedChanges` and `UnsavedGuard`                          |
| Add and edit forms for one record | One shared fields component (`JobFields`, `PersonFields`)    |
| Dates, sizes, timestamps          | `formatDate`, `relativeDay`, `formatBytes`, `formatDateTime` |

Use `rounded-[var(--r-…)]` radius tokens, `.link` for in-content links, `.meta-text` for small text, and Lucide
icons from `@lucide/svelte`. Do not add another icon or component library.

A change is done when:

- `npm run format`, `npm run check` and `npm test` pass. `npm test` includes `tests/ui-conventions.test.mjs`,
  which fails on hand-built versions of the patterns above (a raw `<select>`, checkbox or `<label>`,
  `window.confirm`, hand-built pagination, back links or filter chips, small text, Tailwind radius classes, a page
  without `PageShell`, and `use:enhance` without progress handling). Fix the code, not the rule. Change a rule
  only when this guide changes in the same commit.
- New patterns are added to this guide, and user-visible behavior is added to the user guide.
- New UI has been loaded in a browser at desktop and phone widths and in light and dark appearance, using a
  temporary database (`SATURDAY_DB_PATH` and `SATURDAY_FILES_PATH`), never the real `data` folder.
- Every new add or edit flow has required marks and a "* Required" cue, an error `Notice` with a title, focus on
  the first error, a toast on success (`SAVED_MESSAGES`), and an empty state with one primary action.

Dataset mismatches use the existing Settings Notice and restore-preview warning text. Explain that job attachments need matching backups, user documents remain available, and files are retained. Do not expose opaque dataset identifiers as controls or offer automatic rebinding.
