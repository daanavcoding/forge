---
name: llm-evals
description: Evaluate LLM systems with test sets, metrics, LLM judges and their failure modes, and
  regression detection. Use when changing a prompt, comparing models, or claiming an improvement.
  Do not use for retrieval-specific evaluation; use rag when retrieval changes.
---

# llm-evals

Without evaluation you do not know whether a prompt change improved anything. A non-deterministic
model and three examples create the illusion of progress effortlessly.

**A prompt change without before-and-after measurement is a bet, not an improvement** — especially
when the change looks "obviously" better.

## Start small and real

- **Twenty real cases beat 500 synthetic ones.** Draw them from production traffic, reported
  failures, and cases that worry you.
- Include difficult and adversarial cases, not only successes.
- Freeze the set. Changing it alongside the system makes the result unattributable.
- Reserve cases you **do not** inspect while tuning — your only warning that you are overfitting.

## Choose the cheapest metric that genuinely discriminates

1. **Deterministic.** Compiles? Tests pass? Schema validates? Exact match? Cheap and objective —
   use whenever possible.
2. **Programmatic with tolerance.** Correct amount present? Citation identifies the right document?
   Classification matches?
3. **LLM as judge.** Only when the above cannot assess writing quality, usefulness or tone.
4. **Human judgment.** The gold standard, and the only way to validate an automated judge.

## LLM as judge and its failure modes

- **Position bias:** prefers the first option. Alternate order and average.
- **Verbosity bias:** scores longer answers higher. Address it explicitly in the rubric.
- **Self-similarity bias:** prefers work from a similar model.
- **The judge must not be the model that produced the answer.** It approves itself — the most
  common and expensive design failure.

Rules for a useful judge:

- A rubric of **specific, independently verifiable criteria** ("Does it include the invoice
  amount?"), never "Is this a good answer?"
- A short scale. 1-to-10 is noise; pass/fail or three points carries signal.
- **Validate the judge against humans** on a sample. Without correlation you are measuring a
  model's opinion, not quality.

## Compare two versions

- Same input, test set and conditions. Change **one** variable at a time.
- Repeat each case — models are non-deterministic, and a one-point difference between single runs
  means nothing.
- Report the median, not the mean; one unusual case should not dominate.
- State uncertainty on small samples. "62% versus 58% on 20 cases" is noise.

## Regression detection

- Run evaluations in CI when prompts, models or tools change.
- A threshold that fails the build beats an unread report.
- Retain historical results; slow drift is visible only as a time series.
- **Record the model version with every result.** Comparing numbers across models is not a
  comparison.

## Anti-patterns

- Using the same model to generate and evaluate.
- Evaluating against the examples used to write the prompt.
- One aggregate metric hiding a gain in one use case and a regression in another.
- Scores from 0 to 100 implying false precision.
- Expanding the test set right after a poor result.
- Declaring improvement with n=3.
- Measuring style when the problem is factual accuracy.

## Verification

- Execute the evaluation and retain its raw output, not only a summary.
- Version the test set with the code.
- If an LLM judge is used, retain evidence that human judgment validated it.
- Include model, date and number of cases in each result.
