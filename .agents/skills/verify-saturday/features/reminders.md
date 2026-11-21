# Reminders

## Sub-features

Fixed schedules, midnight preservation, dismissal, editing inactive reminders, reactivation, deletion confirmation, atomic activity/reminder creation, failure recovery, responsive dialogs.

## How to get to it (user POV)

Open a job or person detail page and use its reminder editor. Open Past reminders to edit or reactivate a dismissed reminder.

## Driving it with Puppeteer and the public runner

Run `node tests/run.mjs -- node --test tests/reminders.integration.mjs` after the protected build. The test starts its own fictional app and drives `#reminder-editor`, `#reminder-date`, `#reminder-time`, `#reminder-note`, and buttons scoped by `data-reminder-id`.

Assertions cover preserved `00:00`, dismissal visible in inactive records, editing without unintended reactivation, retained unsaved text after canceling deletion, explicit deletion, job/person activity and reminder persistence, retained return context, recovery from failed saves, responsive geometry, and no browser page errors.

## Gotchas

Do not test against real follow-ups or assume dismissal means completion. Temporary screenshots disappear with runner cleanup. This journey is mapped but needs its own recorded execution before claiming coverage.
