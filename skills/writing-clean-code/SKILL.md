---
name: writing-clean-code
description: Code craft for any language - the four cases where a comment is allowed and the rule that deletes the rest, names, functions, types, errors, when duplication beats an abstraction, and how a test reads. Use before writing or editing code, when naming something, when tempted to write a comment or finding one, when extracting a helper or abstraction, and when tidying or reviewing code.
---

# Writing clean code

Clean code means two things, in this order: a reader who was not there understands it without asking anyone, and the next change is cheap. The project's CLAUDE.md, its linter and its conventions win where they are stricter.

## Comments

A comment is paid by every reader, checked by no tool, and rots while the code moves. **Default: write none.** Make the code carry it instead: extract a function named after what the block computes, name the constant, change the type so the value cannot be null, rename the variable.

A comment is allowed only when the information cannot live in code:

1. **Why, and what was rejected.** The reason behind a non-obvious decision, naming the alternative that failed.
2. **An external constraint** the code cannot show: a browser quirk, a protocol rule, a bug in a dependency.
3. **A deliberate duplication or coupling** a reader would otherwise "fix".
4. **A toolchain directive or licence header**, with its reason (`@ts-expect-error`, `eslint-disable-next-line`, `# noqa`, `#[allow(...)]`).

Write it above the code, in one or two sentences, with no name, date or changelog. No TODO or FIXME. A docstring that repeats the signature is noise.

While you are in a file, delete comments that restate the code, contradict it, describe code that is gone, or comment code out. Never touch generated files, directives or a comment that passes the four-case test. When you cannot tell, keep it and flag it in your report.

## Names

- Reveal intent. No type in the name (`agents`, not `agentList`), no abbreviation outside the domain's own vocabulary. Length scales with scope.
- Use the product's words and only those, one word per concept across the codebase: `fetch`, `get`, `load` and `retrieve` doing the same thing is three words too many.
- Functions are verbs, values and types are nouns, booleans read as predicates (`isActive`, `canEdit`), never negated (`notReady`).
- A literal with a meaning becomes a named constant.
- If no good name comes, the unit does two things. Fix the unit, not the name.

## Functions

- One job at one level of abstraction. Size follows from that, not from a line budget: one linear 40-line algorithm with named steps beats six 5-line functions that exist only to be small.
- Guard clauses first, happy path last, two levels of nesting at most.
- Zero to three parameters, then one options object. No boolean flag parameter: split the function or take a union of literals.
- No output parameters, no mutation of an argument. Command or query, never both. No surprises: a `get...` never writes.
- Keep decisions pure and push IO to the edges: a pure core is tested without mocks.

## Types

- Parse at the boundary, trust inside. The schema is the single source of truth; after the boundary, data is typed, not re-checked.
- No escape hatches to silence the compiler (`any`, casts, `!`, `# type: ignore`, `unsafe` without a reason).
- Make illegal states unrepresentable: a discriminated union over a status beats a bag of optional fields.
- Prefer immutable values.
- In TypeScript: no floating promises, `async` only when the function awaits, and `import type` for imports used only as types.

## Errors

- Signal failure in the language's idiom (exceptions, error values, `Result`), never with `null`, `-1` or an empty object.
- Fail fast at the boundary. Every error says what was attempted and on which ids, never a secret.
- Never swallow. Catch the narrowest case, only to handle it, add context, or convert it to this layer's error.
- Log through the codebase's logger as structured data.

## Duplication and abstraction

- Rule of three. Two similar fragments stay duplicated; the third shows the real shape. The wrong abstraction costs far more than duplication.
- Before extracting, check that both copies change for the same reason. If not, they are not duplicates.
- A flag added to a shared helper for one caller means the abstraction was wrong: inline it back.
- No speculative generality: no interface with one implementation, no option nobody asked for.
- The smallest change that meets the spec. A wrapper that forwards its arguments unchanged hides nothing: delete it.
- Dependencies point one way, and the linter's boundary rules are the contract. Never weaken one to make code fit.

## How tests read

- The name states the behaviour and the condition, so a failure reads as a sentence.
- One behaviour per test, arrange-act-assert, no logic in the test.
- Assert observable behaviour (return value, stored row, emitted event, rendered text), never a private call count.
- Write the expected value out; never recompute it with the production logic.
- Some setup duplication is fine. Extract a builder once the third test needs the same shape.

## Before calling it done

1. Typecheck, lint, format check and tests pass.
2. Reread your diff as a reviewer and remove dead code, unused imports and parameters, debug logging, commented-out code, comments that fail the four-case test, and anything outside the task.
3. Report every comment you deleted or kept against your judgement.

## Rules deliberately not followed

- "Functions should be tiny." Over-extraction produces indirection chains. Depth beats count.
- DRY on sight. See the rule of three.
- Comment-free as dogma. Deleting a why-comment destroys the only record of a decision.
- A docstring on every symbol. It trains readers to skip all of them.
- SOLID as a checklist. Coupling and cohesion measure what it gestures at.

Before refactoring or tidying code you did not just write, read `references/cleaning-up.md`.
