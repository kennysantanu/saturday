# Job duplicate protection

## Sub-features

Duplicate warning, retained description/notes/tags/starred state, explicit override, return-to navigation, optional person-link context.

## How to get to it (user POV)

Open Jobs, choose Add job, and enter a title/company matching an existing fictional job. A warning should offer opening the existing job or explicitly creating another.

## Driving it with Puppeteer and the public runner

Run `node tests/run.mjs -- node --test tests/job-duplicates.integration.mjs` after the protected build. The test seeds a job, person, and tag; fills `#job_title`, `#company_name`, and `#notes`; clicks Save job; and checks `[role="alert"]`. Native HTTP submissions complement the enhanced browser path. It clicks `button[name="allow_duplicate"]` only to test the explicit override.

The assertions require a native 409 warning without a new record; retained draft text; no implicit person link; the expected 303 redirect on override; browser focus on the alert; no horizontal overflow at 320px; expected job totals after distinct/override submissions; preserved return context; and no page errors. These assertions, not an HTTP health response, prove the journey.

## Gotchas

`tests/job-duplicates.integration.mjs` is the source of truth for current selectors. The screenshot and native HTML response are temporary and are not retained by the runner. Retain the runner transcript outside scratch. A browser startup failure is not a feature pass.
