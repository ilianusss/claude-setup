# Acceptance criteria in EARS

EARS (Easy Approach to Requirements Syntax) gives each criterion one shape, so it reads one way and turns into one test.

## The patterns

| Pattern | Form | Example |
| --- | --- | --- |
| Ubiquitous | THE SYSTEM SHALL <response> | THE SYSTEM SHALL store passwords hashed with argon2id. |
| Event | WHEN <trigger> THE SYSTEM SHALL <response> | WHEN a user submits a valid email and password THE SYSTEM SHALL start a session and show the dashboard. |
| State | WHILE <state> THE SYSTEM SHALL <response> | WHILE an account is locked THE SYSTEM SHALL refuse sign-in with 429 and a Retry-After header. |
| Unwanted behaviour | IF <condition> THEN THE SYSTEM SHALL <response> | IF the password is wrong THEN THE SYSTEM SHALL answer 401 with the same body as for an unknown email. |
| Option | WHERE <feature is enabled> THE SYSTEM SHALL <response> | WHERE two-factor login is enabled THE SYSTEM SHALL ask for the code after the password. |
| Complex | Combine them: WHILE ... WHEN ... THE SYSTEM SHALL ... | WHILE offline WHEN the user saves a note THE SYSTEM SHALL keep it locally and sync it on reconnect. |

## Rules

- One SHALL per criterion. Two responses are two criteria.
- Observable: a test can check it by looking at a status, a body, a stored row, a screen. "Fast" is not observable; "within 300 ms at the 95th percentile" is.
- No implementation: "SHALL cache in Redis" is a design decision, not a criterion.
- Every criterion about access or input has its negative twins: another user's object, a role that may not, a malformed or oversized input (`writing-tests-first`, abuse cases).
- Number them per slice (`AC1`, `AC2`) so a test name can cite one.
