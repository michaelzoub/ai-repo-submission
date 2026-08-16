# Submission

## What did you investigate first, and why?
I first investigated the structure of the system, then went on to see how the CLI and MCP run and what the input and output is.

## What did you choose to implement or fix?

## What did you intentionally not do?

## Interface decision

- Decision: Hybrid
- Primary user and execution environment: Developers would run it locally; agents would most likely run it in the cloud.
- Trust boundary and allowed capabilities: Read-only inspection operations only; everything else is illegal.
- Reliability, discoverability, latency/context, and output tradeoffs: Keep output as compressed and comprehensive as possible; the other tradeoffs are not decided yet.
- How supported interfaces remain consistent: One shared core with thin adapters for each interface.
- Evidence that would change this decision: If it ends up being used solely by agents, I would reconsider MCP-first.

## How did you use an AI coding agent?

## Where did you check, correct, or reject an AI suggestion? (required)

## Commands used to verify the result, with outcomes

## A blocker you hit and how you approached it

## Known limitations and the next three things you would do

## Approximate focused-work time

- Start:
- Finish:
