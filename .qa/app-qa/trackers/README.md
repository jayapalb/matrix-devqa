# Finding trackers (app-tier)

Drop `<name>.mjs` exporting `async file(finding)` (+ optional `async exists(finding)`) to file findings
into your system (Jira / Bitbucket / an admin app). Select via qa.config `tracker: { type: '<name>' }`.
See `touchstone/docs/EXTENDING.md`.
