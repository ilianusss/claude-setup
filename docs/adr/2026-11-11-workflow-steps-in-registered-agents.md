# Workflow steps run in agents the workflow mod registers

Date: 2026-11-11. Status: accepted. Workflow: accompagny.

## Context

The workflow ran every phase in the user's conversation, on the conversation's model, and asked the user to type `/workflow next` between phases to clear the context. The user wants the conversation to be the pipeline they follow, with each step's technical work running on a model and effort chosen per step (defaults, Claude's recommendations, or their own picks), and without typing anything to move on. The gates (approval, the test lock, the write scope) must keep holding.

## Decision

The conversation orchestrates: it talks to the user, asks every decision, and calls the gate. The work of each step runs in an agent the mod registers with `$.agent.register` (`workflow:map`, `workflow:setup`, `workflow:spec`, `workflow:design`, `workflow:slice`, `workflow:build`, `workflow:review`), whose model, effort, tools and prompt come from the workflow's model plan and the phase files. Step agents cannot call `advance`, `handoff`, `progress` or `AskUserQuestion`.

## Options considered

- Generic `general-purpose` agents with a hook that sets the model and effort: less code, but the agents keep `advance` and their prompts are written by Claude each time, so neither is under test.
- One session that switches model with `/model` between phases: no cold starts, but code and tool output fill the conversation the user follows, and a mod running `/model` is not verified.

## Consequences

- Each step and each slice costs a cold start on the user's Pro plan, offset by cheaper models on most steps and short, focused prompts.
- The write scope and the test lock now depend on `tool.call` firing for a subagent's calls; the first slice proves it on a real run.
- Phase files split into a part for the conversation and a part for the agent, so a phase's prompt is tested where it is written.
- Revisit if subagent dialogs or tool access prove unreliable, or if cold starts use up the plan's windows: the fallback is to run the build in the conversation.

## Notes

- 2026-11-12, the agents' tools: the specs withhold `mcp__workflow__advance`, `mcp__workflow__handoff`, `mcp__workflow__unlock` and `AskUserQuestion`, not `progress` as the decision above says. The mod also refuses `advance`, `handoff`, `unlock`, `progress` and `finish` when the call carries an `agentId`, so a tool a spec cannot withhold is still out of an agent's reach.
- 2026-11-12, the hand-over: `$.agent.register` applies from the next turn, so whatever registers the step agents again (a gate's Continue, a plan change, a verified slice) ends the turn, and the mod submits the next phase or slice as a prompt of its own. After a slice a `workflow:build` agent verified, the mod records the agent in `$.state` and hands the next step over when the agent's run ends, so a reload of the mod in between does not lose it.
