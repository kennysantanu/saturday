# Document editor

## Sub-features

Client-side navigation, visual formatting, draft restore, Ctrl+S, rename in place, new-document defaults, Markdown/visual fidelity guards.

## How to get to it (user POV)

Open Documents, choose a fictional Markdown document, click Edit, modify it, and save. Use the document action menu to rename; open New document for initial focus/default checks.

## Driving it with Puppeteer and the public runner

Run `node tests/run.mjs -- node --test tests/document-editor.integration.mjs` after the protected build. The fixture creates fictional Markdown and HTML files, navigates through `/documents`, enters `.editor-sticky`, observes `.editor-actionbar [role="status"]`, uses the Restore draft button, saves with Control+s, and drives Rename through its menu item.

Assertions cover no false unsaved state, a usable editor after client navigation, save/rename keeping the document identity, ready new-document fields/focus, guarded source/visual transitions, stored document fidelity, and recovery from refused lossy edits. Read the current test for exact assertion scope rather than assuming every editor feature is covered.

## Gotchas

The test explicitly skips when managed Chrome is unavailable. That outcome is blocked, never passed. This is a large interaction test; record the exact failing assertion and do not call an intermittent failure harmless without baseline evidence. This journey is mapped but needs its own recorded execution before claiming coverage.
