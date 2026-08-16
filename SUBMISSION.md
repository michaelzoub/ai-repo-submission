# Submission

## What did you investigate first, and why?
I first investigated the structure of the system, then went on to see how the CLI and MCP run and what the input and output is.

## What did you choose to implement or fix?

## What did you intentionally not do?

## Interface decision

Hybrid: CLI for local developers and MCP for AI agents, both sharing the same core behavior.

## How did you use an AI coding agent?

## Where did you check, correct, or reject an AI suggestion? (required)

I corrected the AI design to use bounded `git diff -U3` instead of sending whole source files to OpenRouter. This reduces source exposure while preserving exact changes with minimal context.

## Commands used to verify the result, with outcomes

## A blocker you hit and how you approached it

## Known limitations and the next three things you would do

## Approximate focused-work time

- Start:
- Finish:
