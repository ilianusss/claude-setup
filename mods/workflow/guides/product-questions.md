# Product questions

A bank to draw from in the spec phase, not a form to fill. Ask what the idea leaves open, at most four questions per AskUserQuestion batch, each with options and a recommended one when you have a view.

## The problem

- What happens today without this? What does it cost, and to whom?
- Why now?
- How will we know it worked: a number, a behaviour, a complaint that stops?

## Users and roles

- Who uses it? One kind of user, or several with different rights?
- Who must never see or do what? (Every "never" becomes an abuse case.)
- Anonymous visitors, signed-in users, admins, other systems?

## Journeys

- The main path, step by step, from the user's first action to the result they wanted.
- What happens on the second visit, with existing data?
- Which steps can fail, and what does the user see then?

## Scope

- What is explicitly out of scope for now?
- What is the smallest version that would still be worth shipping?
- Is anything time-bound: a launch date, an event, a contract?

## Data

- What is stored, for how long, and who owns it?
- Personal data, payment data, health data, data about minors?
- What must be importable, exportable or deletable on request?

## Failure and limits

- What must happen when a dependency is down: refuse, queue, degrade?
- Limits: how many items, how large, how often?
- What must never happen, even under failure (double charge, data leak, data loss)?

## Constraints

- Platforms and devices: web, mobile, desktop, CLI? Offline?
- Accessibility and languages?
- Budget, hosting, an existing system it must fit into?
