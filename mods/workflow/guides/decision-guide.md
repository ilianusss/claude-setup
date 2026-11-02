# Choosing between options

How to choose, not a catalogue of patterns. You know the patterns; this is about not reaching for them too early.

## Drivers first

Before any option, list the drivers: the quality attributes and constraints that decide this case (latency on the main path, data that must never be lost, a team of one, a free hosting tier). An option is only better or worse against a driver. Two to five drivers is normal; ten means nothing was prioritised.

## Boring by default

The default is what the project already uses and the team already runs. Something new needs a driver it serves that the existing stack cannot, and the cost of running it (learning, hosting, failure modes) goes in the table.

## When it is worth reaching for

| Reach for | When | Not when |
| --- | --- | --- |
| Separate services | Parts scale or deploy independently, or separate teams own them | One person or one team, one deploy |
| Async processing, a queue | Work is slow, retried, or must survive a crash; the user does not wait for it | The user needs the result in the same request |
| A document store | Data is read and written as whole documents, without joins across them | Relations and constraints matter: use the relational database |
| A cache | A measured hot path, with a clear invalidation rule | No measurement, or no way to know when it goes stale |
| Server-side rendering | Content must be indexed or fast on first paint | An app behind a login, used for long sessions |
| Managed over self-hosted | Almost always for a small team | A hard data-location or cost constraint |
| Event sourcing | An audit trail is the product | Almost every other case |

## Design it twice

Sketch at least two real options before choosing: the second one often shows what the first one assumed. "Do nothing" or "do the simplest thing" is a fair option.

## The table

| Driver | Option A | Option B | Option C |
| --- | --- | --- | --- |
| <driver> | <how it does, with evidence> | | |
| Cost to run and to change | | | |
| Reversibility | | | |

Mark the recommendation and say why in two or three sentences.

## Reversibility

Spend the most care on decisions that are hard to undo: data models, public APIs, storage engines, anything a migration locks in. A decision that is cheap to reverse can be made fast and revisited.

## Write down why the loser lost

The losing options and the reason they lost stay in `design.md`, and in the ADR when the decision outlives the feature. That record is what stops the same debate six months later.
