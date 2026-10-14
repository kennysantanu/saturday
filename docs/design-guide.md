# Saturday UI design guide

Saturday is a local SvelteKit app with a restrained glass navigation layer and solid content surfaces. CSS approximates translucent materials; it does not provide native refraction or system vibrancy. Use existing components and tokens so new pages behave consistently.

## Materials, geometry, and navigation

`src/routes/layout.css` owns light/dark tokens, materials, radius scale, responsive geometry, and primitive overrides. `src/routes/+layout.svelte` owns navigation, the scroll edge, toast host, and route transitions.

Reserve glass/blur for the functional layer: top bar, tab bar, toast, dialog, and scroll edge. Use solid surfaces for cards, lists, statistics, fields, buttons, disclosures, and history. Selection uses a tinted fill without another blur layer.

| Token         | Value | Use                                          |
| ------------- | ----- | -------------------------------------------- |
| `--r-shell`   | 28px  | Top/tab bars, dialogs, toasts, empty states  |
| `--r-card`    | 24px  | Cards, disclosures, funnel, activity summary |
| `--r-group`   | 16px  | Insets, notices, code blocks, callouts       |
| `--r-control` | 12px  | Fields, selects, compact buttons             |

Use `rounded-[var(--r-group)]` and the other tokens, not Tailwind's numbered/named radius scale for app surfaces. Nested surfaces step down; navigation items use the existing concentric radii (18px top bar, 22px tab bar).

Navigation contains Dashboard, Jobs, Network, Documents, and Settings. Extensions appears before Settings only when enabled. Profile belongs under Documents, with no separate top-level tab. Keep icons and visible labels consistent across sizes.

At 48rem and wider, navigation is in a sticky top bar with a blurred scroll edge. Below 48rem, use the floating bottom tab bar; the brand row is non-sticky. The tab bar scrolls horizontally when necessary. Preserve content padding and safe-area clearance. Hover fills belong inside `@media (hover: hover)`.

## Building a new page or feature

Read this guide, then start from the closest existing page: Jobs for a filtered list, Network detail for linked records, Add job for a form, Settings for sections. Check `src/lib/components/app/` before writing markup; reuse a component or extract a repeated pattern.

| Need                           | Use                                                                  |
| ------------------------------ | -------------------------------------------------------------------- |
| Page frame and title           | `PageShell`, then `PageHeader`                                       |
| Back navigation                | `PageHeader`'s `back={{href, label}}` prop                           |
| Labelled input/select/textarea | `Field` with `Input`, `NativeSelect`, or `Textarea`                  |
| Checkbox/radio                 | `Checkbox`, `RadioOption`                                            |
| Record lists                   | `Card` with `JobRow`, `PersonRow`, `DateRow`, or `DocumentRow`       |
| Due dates                      | `DueBadge`                                                           |
| Detail sections                | `SectionCard`, `LinkedItem`, `EmptyState size="inline"`              |
| Search and paging              | `FilterBar`, `FilterChips`, `Pagination`                             |
| Per-item actions               | `RowActions`, `ActionMenu`                                           |
| Consequential confirmation     | `ConfirmDialog`                                                      |
| Form progress and error focus  | `enhanceWithFocus` or `withPending` from `$lib/forms`                |
| Unsaved edits                  | `UnsavedChanges`, `UnsavedGuard`                                     |
| Shared create/edit fields      | `JobFields`, `PersonFields`, or the relevant shared fields component |
| Date/size display              | `formatDate`, `relativeDay`, `formatBytes`, `formatDateTime`         |

`PageShell` supplies spacing and `{title} · Saturday`; use `width="form"` for forms. Contextual titles read `Ada Lovelace · Network`. `PageHeader` supports eyebrow, description, metadata, actions, and back navigation. Allow actions and long titles to wrap. Job detail uses two columns from 64rem and one below it.

Rows follow the shared `.list-row` grid. Job/person/date rows are whole-row links; document rows contain separate actions. Secondary text must be at least 13px (`.meta-text` or `text-sm`). Show job/person `#123` references beside names in rows, headings, linked records, and pickers; pass IDs explicitly rather than parsing URLs.

Use `.link` for content links. Headings use balanced wrapping, paragraphs use pretty wrapping, and counts use natural language. Inline `code` receives its chip style automatically. Posting links show the host, full-address tooltip, and an accessible new-tab cue. Long job descriptions use Show more with `aria-expanded`.

## Buttons and forms

- Keep at most one tinted primary action per view/header. If an empty state repeats that primary action, hide the duplicate header action.
- Prominent actions inside `.page-actions`, `.form-actions`, `Dialog.Footer`, and EmptyState use capsules. Other controls use `--r-control`. The shared Button exposes `data-variant` for styling.
- Use `default` for primary, `outline` for secondary, `ghost` for Cancel/low emphasis, and `destructive` for permanent deletion. Dismiss is reversible and uses a normal confirmation button.
- Pair Create/Upload/Link actions with `Plus`/`Upload`/`Link2`. Icon-only buttons require an accessible name and title.
- Use shared labelled controls; never hand-write bare `<label>`, `<select>`, checkbox, or radio elements in page code.
- Add/Edit forms share field components. Mark required fields with `*` and include a “* Required” cue.
- Additional optional fields use `.disclosure` / `.disclosure-body`. Keep job title/company, posting link, description, notes, and star visible; employment/follow-up details belong in the disclosure.
- Footers use `.form-actions`, primary last; add/edit pages align actions to the end.
- Wrap custom `use:enhance` callbacks in `withPending`; `enhanceWithFocus` already does this. Show submit progress and focus the first invalid field or error Notice on failure. Use `focusFirstError()` in custom callbacks.
- Free-text forms use `UnsavedChanges`, `guard.enhance`, `oninput={guard.markDirty}`, and `UnsavedGuard`. Document editors also show an unsaved badge.

Explain conditional behavior in a field hint where needed. Preserve drafts and selections after validation failure.

## Dialogs and feedback

Dialogs use centered glass panels at desktop widths and bottom sheets below 48rem, with a dimmed backdrop and solid controls. Always include a title and description. Use `sm:max-w-md` for short forms/confirmation, `sm:max-w-lg` for longer forms, and `sm:max-w-2xl` for pickers. Cancel comes first and uses ghost styling.

Use `ConfirmDialog` for consequential actions; it submits the form identified by `formId`. Never use `window.confirm`. Entry corrections follow the same dialog pattern as additions. Keep dialog errors inside the dialog and preserve focus on failure.

`RowActions` exposes Edit with icon/text; other actions use `ActionMenu`, with permanent Delete tinted, separated, and last. Empty states explain the next step and offer one primary action.

Successful server saves redirect with `?saved=<key>` from `SAVED_MESSAGES` in `$lib/toast.svelte.ts`; the layout shows the toast once and removes the parameter. Client actions can call `toast.show(message)`. Use `Notice` for errors and persistent information; error notices need a title, `role="alert"`, and a focus target. Long-running Settings operations use their existing status notices.

## Feature patterns

### Dashboard and Jobs

Progress counts link to `/jobs?step=<key>` and count distinct jobs that ever reached a step, including inactive jobs. Counts overlap; decorative funnel bars do not replace the number. Show active follow-ups/deadlines and future dated updates with readable date cues. Use `DueBadge` everywhere; overdue meaning must not rely on color alone.

Jobs uses a GET filter form, explicit Apply, URL state, removable chips, and Pagination. Historical-step filters imply All and disable Activity selection. Advanced groups use opaque disclosures and labelled choices. Both paging buttons stay visible, with unavailable ones disabled. Attribution appears once at job level; history entries use an accessible icon. Dates sit beneath timeline labels; future entries get Scheduled cues.

### Network

Use solid lists/cards, shared person fields, GET filters, and independent pagination for linked jobs and interactions. Name is required. Distinguish Person Notes, Relationship note, and Interaction note. Keep role/organization, last recorded interaction, and follow-up readable on narrow screens.

Choosers use explicit selection and confirmation, paginated search, and disabled already-linked choices. Creating a person does not implicitly link them. Unlink preserves both records. Follow-up/interaction dialogs use existing focus handling; permanent interaction deletion uses ConfirmDialog.

### Documents and Profile

Documents uses DocumentRows in a Card with a search FilterBar. Upload is primary; New document and Profile are secondary. Rows show filename, designation badges, type, size, date, Edit, and the action menu. Editor toolbar buttons have accessible labels, `aria-pressed` where relevant, and disabled Undo/Redo when unavailable.

Profile has one solid SectionCard per designation. Show the selected filename or a brief empty state, with compact Select document, Upload, and Create new actions. Reuse existing pickers/editors; template slots create HTML, other slots Markdown. Edit stays visible; Clear selection uses a confirmed menu action and keeps the file.

Existing-document selection keeps search/paging in the URL. Copy to this job loads in place with a skeleton. Network/job pickers also retain URL state for reloads and validation.

### Settings

Section navigation covers Assistant, Backups, Updates, Storage, Server, and Extensions. Each section uses SectionCard.

- **Assistant:** show copyable JSON/TOML, built-entry status, and installation/dataset/build identities. Distinguish configuration prepared from real-client verification. Copy actions do not modify client files; instructions belong in the [assistant guide](assistant-guide.md).
- **Backups:** one Back up now action with Database and files / Database only / Files only. BackupList groups pairs with Download, Restore, and confirmed Delete. Partial entries show an available-artifact download. RestorePreview shows the selected contents and warnings. Independent import/additive restore/unmatched folders belong in Advanced file recovery. No schedule/retention panel.
- **Storage:** copyable data directory with Open folder; failure preserves the path and shows an error Notice. Keep build, storage versions, descriptor/log/backup/recovery paths in collapsed Diagnostics. Do not display secrets or present the placeholder package version as a release.
- **Server:** Restart is regular; Stop confirms and explains reopening. Poll installation/generation readiness for a bounded interval before reloading; show logs/reopen guidance on timeout. Do not invalidate while shutdown is in progress. Without JavaScript, show accepted state and manual recovery guidance. Start at login uses the shared Checkbox and Save startup setting; read actual OS registration, disable unavailable controls, and explain sign-in/no-browser/Stop behavior.
- **Updates:** show installed/target identity, check errors, and local-change state. Confirm the selected target. Poll only active requested operations, with bounded timeout and recovery guidance. Uninstall defaults to retention; data deletion previews exact directories and requires the unchecked option plus `DELETE DATA` in the confirmation dialog. Wrap paths and preserve focus on errors.
- **Extensions:** use the existing directory and lifecycle controls; shared core design still applies. See the [extension guide](extension-guide.md) for the public component exports.

Dataset-mismatch notices explain that files are retained, user documents remain available, and job attachments need matching backups. Do not offer automatic rebinding or opaque dataset IDs as editable controls.

## Icons, motion, and accessibility

Use individual `@lucide/svelte/icons/...` imports. The root provider defaults to 20px, 2px stroke, and `currentColor`; inline button icons use the existing 16px styling. Icons reinforce visible labels. Keep decorative icons hidden from assistive technology. The Saturday logo remains a separate brand asset; do not add another icon library.

Route changes use a short View Transitions cross-fade; sheets/toasts use brief ease-out motion. Respect reduced motion, reduced transparency, and increased contrast. Browser support determines which OS preferences propagate. Without backdrop-filter, surfaces remain solid. Do not assume CSS blur automatically provides adequate contrast.

Before completing UI work:

1. Format changes, run `npm run check`, and run relevant tests, including `tests/ui-conventions.test.mjs` for UI changes. That test enforces shared labels/selects/choices, radius tokens, readable text, PageShell, back links, pagination, filters, confirmations, and enhanced-form progress. Change a convention only with its guide and test.
2. Review desktop/narrow layouts, long content, 200% zoom, light/dark, keyboard navigation, validation focus, dialogs, toasts, tab-bar scrolling, and reduced-motion/contrast/transparency preferences. Use disposable database and file roots.
3. Confirm required cues, errors, progress, success feedback, and unsaved-edit handling for new forms. Update the [user guide](user-guide.md) for user-visible behavior.

Browser review, contrast inspection, and actual screen-reader testing are separate from compilation and HTTP checks. Full platform accessibility verification remains pending.
