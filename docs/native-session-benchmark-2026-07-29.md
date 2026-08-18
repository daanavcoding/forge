# Native session benchmark — 2026-07-29

> Historical snapshot. This predates the current Agent Plugin-only package and
> does not describe the current Forge integration surface.

## Decision

Keep the native-session implementation experimental and opt-in. At that time,
it was compared with the then-current deterministic Forge path.

The native path reused one in-process worker and its prompt cache, but the main
Opus reviewer required several sequential turns. Cache reads are cheap, yet the
reviewer tool loop and output outweighed the saved worker cache writes. On the
three-file scenario the native worker also failed closed too often.

## Method

- Claude Code 2.1.220, authenticated with `authMethod: claude.ai` (Pro
  subscription); no API-key authentication.
- Same three materialized scenarios and independent verification commands.
- Three repetitions per scenario and arm.
- `forge`: existing `UserPromptSubmit` deterministic core.
- `native`: one main Opus session and exactly one resumable Sonnet
  `forge-worker`, with `SubagentStart`/`SubagentStop`.
- Transcript messages deduplicated by message ID.
- Units: `input + 1.25*cache_write + 0.1*cache_read + 5*output`.
- A completed task and a satisfied orchestration contract are reported
  separately. External edits cannot turn a failed native run into a valid
  orchestration result.

## Median results

| Level | Legacy completed/contract | Native completed/contract | Legacy tokens | Native tokens | Legacy weighted | Native weighted | Legacy latency | Native latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3/3 / 3/3 | 3/3 / 3/3 | 37,927 | 145,584 | 29,056 | 42,572 | 17.1 s | 25.6 s |
| 2 | 3/3 / 3/3 | 3/3 / 3/3 | 40,621 | 150,899 | 35,120 | 46,874 | 23.0 s | 40.0 s |
| 3 | 2/3 / 2/3 | 1/3 / 0/3 | 62,259 | 255,467 | 62,341 | 72,704 | 36.0 s | 61.3 s |

Native/legacy median ratios:

| Level | Raw tokens | Weighted units | Latency | List-price cost |
|---|---:|---:|---:|---:|
| 1 | 3.839x | 1.465x | 1.497x | 2.350x |
| 2 | 3.715x | 1.335x | 1.739x | 2.140x |
| 3 | 4.103x | 1.166x | 1.703x | 1.346x |

The subscription probe did not move at whole-percentage resolution, so these
results make no claim about percentage-window consumption. All 18 rows had
priced token telemetry; their aggregate list-price equivalent was $3.6059.

## Findings applied before the final run

- Transcript usage now counts each assistant message ID once.
- A single JSON markdown fence no longer consumes a correction.
- Dotted identifiers such as `Object.hasOwn` are not treated as file paths.
- Failed acceptance explicitly requests a complete replacement patch against
  the restored original state.
- Worker token/cache usage is collected mechanically from the hook-provided
  transcript path.

## Consequence for Forge

> Historical benchmark snapshot from 2026-07-29. It predates the current
> Agent Plugin contract and is not a description of the current runtime.

At that time, the deterministic path better satisfied all four objectives:
fewer tokens, fewer calls/iterations, lower latency, and higher contract
reliability. Native session remains useful as a research path for testing
same-worker correction-cache reuse, but it must not claim savings or production
readiness for the current package.

Raw result: the ignored local artifact `.forge/bench/2026-07-29T18-08-35-852Z.json`
was removed during generated-state cleanup.
