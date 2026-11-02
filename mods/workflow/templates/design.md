# <Title>: design

Keep these section names: slices name the sections they need, and the workflow mod hands exactly those to the build.

## Drivers

- <Quality attributes and constraints that decide this design, most important first.>

## Options

| Driver | Option A | Option B |
| --- | --- | --- |
| <driver> | | |

## Decision

<The option chosen, why, and why each other option lost. Link the ADR when it outlives the feature.>

## Components

<The parts and their responsibilities, and how they talk. A Mermaid diagram when it helps.>

## Data model

<Tables or documents, keys, constraints, indexes, and the migration from today's model.>

## API contracts

<Each route or message: input, output, errors, status codes. The validator schema is the source of truth in code.>

## Key flows

<Sequence diagrams in Mermaid for the main path and the main failure path.>

## Security model

<Trust boundaries, who may do what (the authorisation rule and where it is enforced), secrets and where they live, untrusted inputs and where they are parsed.>

## Test strategy

<The test level (`writing-tests-first`), what is proved at which level, what needs a real database or a fake adapter, the end-to-end journeys.>

## Observability

<What is logged, measured and alerted on, and what must never be logged.>

## Rollout and rollback

<Feature flag or not, migration order (expand, then contract), how to roll back each step.>

## Risks

- <Risk, likelihood, impact, and what retires it (often: the first slices).>

## What changed from the design

<Filled in by the retro: where the build departed from this document, and why.>
