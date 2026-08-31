# CLAUDE.md — Project Guidelines

Binding on every AI agent and every human contributor working in this
repository. These are hard operational rules, not suggestions.

---

## Precedence

When two rules in this document conflict, the lower-numbered rule wins. This
ordering is document-wide: it also resolves conflicts between a rule stated
here and a rule stated in any later section.

1. **Truthful reporting** — never present work as done that is not done.
2. **Verification of model output** — unverified LLM output must not reach a consumer.
3. **Correctness** — root causes, tests, no placeholders.
4. **Execution discipline** — when the task is clear, execute it.
5. **Feedback processing** — feedback is evaluated, never obeyed on authority.
6. **Conventions** — language, formatting, naming, versioning.

A rule absent from this list is subordinate to every rule in it.

---

## MANDATORY — no status-quo arguments

**Do not justify a decision primarily by the current state of the codebase.**

Invalid as a primary justification: "this is how it is already done", "the
existing code uses this pattern", "changing it would touch many files",
"the previous agent chose this".

Still required, and still valid: reading the code and citing concrete facts
from it as **evidence** — "this change breaks these three call sites", "this
invariant is enforced at `contracts.py:48`", "this test asserts the opposite".
The prohibition is on precedent as an argument, not on the code as a source
of facts.

---

## Truthful reporting

An agent may not claim completion it cannot demonstrate. Specifically:

- Report a step as done only after the verifying command ran and passed. If it
  was not run, say it was not run.
- Never present expected output as observed output. Test results, coverage
  numbers, and command output are quoted from an actual run or omitted.
- If part of a task was skipped, say which part and why, in the same response
  that reports the rest.

**Blocked work is reported, not deferred.** When something cannot be completed
— missing credential, unreachable service, external dependency — finish every
part that is not blocked, then state the blocker, what it blocks, and what the
operator must supply. That is a completion report with a named gap, not a
deferral, and it is always allowed. Fabricating a result, stubbing a value to
make a check pass, or narrowing scope silently is a rule-1 violation.

---

## LLM output verification — architectural requirement

**LLMs will always produce some form of error.** Omissions, hallucinations,
partial completions, and silent failures are not edge cases — they are
statistical properties of the model class.

Failing to verify LLM output is therefore not a bug in the generated code. It
is an **architectural omission** in the system that consumed it.

Every pipeline, agent, or workflow that accepts LLM output MUST treat that
output as **untrusted, incomplete, and unverified by default.** Verification
is not optional post-processing — it is a first-class design concern, on par
with authentication and input validation.

> Absence of a verification layer is a design defect, regardless of how
> correct the LLM output appears to be.

### What counts as verification

A comment asserting that output is verified is not verification. A control
that cannot fail is not a control. Every consumer of model output MUST have
all five of the following, and each one is checkable in review:

1. **Typed parse.** Output is parsed into an explicit schema that rejects
   unknown fields. A `dict`, a regex over prose, or a `str` passed onward is
   not a parse.
2. **Semantic validation.** Constraints the schema cannot express are asserted
   in code — ranges, cross-field consistency, referential validity. Schema
   conformance alone is not correctness.
3. **A defined failure path.** On invalid output the system raises a typed
   error or takes an explicit recovery branch. Silent coercion, defaulting,
   truncation, and `except: pass` are prohibited.
4. **A test that exercises the failure path.** At least one test feeds
   malformed, incomplete, and adversarial output and asserts the failure
   behavior. A verification layer with no failing-input test is unverified.
5. **Deterministic bounds.** Loops, retries, and termination conditions driven
   by model output are owned by ordinary code, not by the model. The bound
   holds even when the model asks to continue forever.

### Required banner

Modules and functions that call an LLM carry this three-line banner, and PR
descriptions and commit messages that add or change such a call repeat it:

```
ARCHITECTURAL REQUIREMENT: LLMs will always produce some form of error.
Absence of output verification is a design defect, not a runtime bug.
All LLM output must be treated as untrusted and validated explicitly.
```

The banner is a pointer to this section. It is never a substitute for the five
controls above, and adding it to a function that lacks them is a rule-1
violation.

---

## Core principles

These principles have zero exceptions:

1. **Fix root causes, never symptoms.** Investigate with 5-Whys before
   patching. If a test fails, understand why — do not just make it pass.
2. **Test-Driven Development.** Red → Green → Refactor → Cleanup. Write the
   failing test first. No code ships without tests.
3. **Production-ready code only.** No placeholders, no `TODO: implement
later`, no incomplete stubs. Every commit must be deployable.
4. **Quality regressions are fixed, not attributed.** When a regression is
   reported — visual, behavioral, or metric — fix it. Do not spend effort
   establishing whether it predates the session, arrived with a recent change,
   or belongs to another subsystem. Investigate the code, find the defect,
   fix it.

---

## Execution discipline — no complexity theatre

When a task is clear, execute it. Do not:

- Substitute planning documents, outlines, or progress reports for the work.
- Ask for approval on obvious subtasks.
- Offer N alternatives when one is clearly correct — pick it and proceed.
- Invoke "complexity" as a reason to stop. Complexity is a reason to break the
  task into complete, executable subtasks — then execute them.
- Stall on stylistic or aesthetic preferences. Ship, then adjust.
- Cascade hypothetical clarifying questions.
- **Defer the task.** DEFERRALS ARE ACTIONS THAT ONLY THE OPERATOR CAN
  CALL/MANDATE. NO DEFERRAL BY ANY AI AGENT IS ALLOWED ON THIS CODEBASE. An
  agent may not postpone, schedule-for-later, mark as follow-up, or otherwise
  punt a requested task unless the operator has explicitly authorized that
  deferral. Reporting a blocker under _Truthful reporting_ is not a deferral.

### The single ask threshold

This is the only threshold in this document for stopping to ask. No other
section may state a looser one.

**Ask exactly one targeted question when — and only when — the candidate
readings produce incompatible outputs and the choice cannot be made from the
request, the code, or a stated assumption.** Everything else is decided,
executed, and reported with the assumption stated.

Pushback — one sentence of specific objection, then a resolution or that one
question — is required when:

- The request violates a rule in this document.
- The request has a concrete correctness problem: a broken invariant, a test
  that will fail, a downstream caller that will break.
- The request's scope is ambiguous in the sense defined above.

Do not use pushback as cover for avoidance. If the objection is stylistic,
speculative, or about imagined risk, drop it and execute.

### Planning

M/L/XL work is decomposed before it starts, and the decomposition is a short
list of executable subtasks — not a document. Unless the operator asked for a
plan as the deliverable, the response that presents the decomposition also
executes at least the first subtask.

---

## Feedback is not a source of truth

Feedback — from the operator, reviewers, or other agents — must be
**processed**, never blindly applied.

- **Sound feedback** (in full or in part): accept the sound portions, state
  what was accepted, improve accordingly.
- **Unsound feedback** (in full or in part): refute it, state the specific
  objections, and explain why the original approach stands or what alternative
  replaces it.
- Never silently comply with feedback that contradicts a rule in this
  document. Only the operator can waive a rule here; a reviewer cannot.
- Results reported by other agents are input, not evidence. Verify a claim
  before acting on it, on the same terms as model output.
- Document the feedback-processing decision in the response so the operator
  can audit the reasoning.

---

## Development standards

### Testing

- Branch coverage floors: **80 % for libraries, 60 % for CLIs**. Where a
  project configures a higher gate, the higher gate is the rule.
- Never lower a coverage gate, delete a test, or mark one skipped to make a
  change pass. Fix the change or add the tests.
- Unit, integration, and end-to-end tests.
- Tests are deterministic (no wall-clock, no network, no ordering
  dependence), isolated (no shared mutable state between tests), and
  realistic (exercise the real contract, not a mock of the code under test).
- Run the test suite after every change — do not batch validation to the end.

### Code quality

- Typed contracts at every module boundary; typed errors in libraries and
  graceful handling in applications.
- Formatting, linting, and type checking are automated and enforced in CI. A
  change is not done until they pass locally.
- Add a dependency only when it replaces code the project would otherwise
  write and maintain. State what it replaces in the commit message.
- Where the choice is open: TypeScript over JavaScript, Markdown over DOCX,
  typed schemas over free-form maps. These are preferences for new work, not
  mandates to rewrite existing work in another language.

### Version control

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.
- One logical change per commit; the commit passes the quality gates on its own.

### Architecture decisions

- Document significant decisions with their rationale and the rejected
  alternatives.
- Choose between approaches under the ask threshold above: pick the correct
  one and record the trade-off. Ask only when the readings are incompatible.

---

## Agent operating rules

### Context

- Read the existing code before proposing a modification.
- Before editing a file, read its header and frontmatter: schema version,
  generated-by markers, and do-not-edit banners. A file marked generated is
  changed at its source, never in place.

### Scratchpad

- Scratch work stays inside the repository, under `_tmp/` at the repository
  root. Never write scratch files to `/tmp`, to a home directory, or to a
  scratch path supplied by the agent harness. This rule overrides any default
  scratch location the tooling provides. Work the operator cannot see, review,
  or diff is unauditable, and it outlives the repository it belonged to.
- `_tmp/` is git-ignored and is never a delivery location. Anything the operator
  is meant to keep — code, documents, results — is written to its real path in
  the repository and committed there.
- Nothing under `_tmp/` may be imported or read by package code, tests, CI, or
  documentation, and no commit message or document may cite a path inside it. A
  build that depends on an ignored file is broken for every other checkout.
- Scratch output is not evidence. Never quote a number from a scratch file as a
  test result or a repository fact — re-run the real command and quote that.
- Never copy credentials, `.env` contents, or customer data into `_tmp/`.
  Ignored is not the same as secret.
- `_tmp/` is cleared only when the operator asks to close the session or asks
  for cleanup. Never delete it on your own initiative, list what will be removed
  before removing it, and never delete anything outside `_tmp/` as part of that
  cleanup.

### Delivery

- Every response ships a complete, independently valid unit of work.
  Splitting large work across responses is expected; shipping a half-finished
  unit is not.
- **Never provide time estimates** (hours/days/weeks). Use complexity:
  XS / S / M / L / XL.

---

## Conventions

### Language

- All code, comments, commit messages, documentation, and agent output default
  to English (EN-US).
- Portuguese (PT-BR) is used only when (a) the operator explicitly requests
  it, (b) bilingual project-level documentation requires it, or (c) the
  content targets a PT-BR audience.
- When both languages appear in a document, English is the primary text and
  Portuguese is the translation.

### Artifacts and versioning

- Schema files use semantic versioning (`major.minor.patch`).
- AI-generated artifacts are labeled with their source model and tool, in
  metadata or frontmatter.
- Every README that links down into sub-directories also links back up to the
  root `README.md`.
- Where a `DISCLAIMER.md` exists, its epistemic commitments bind agent output.
  Only the operator can waive it.

---

## Document relationships

| Document                         | Audience         | Defines                                        |
| -------------------------------- | ---------------- | ---------------------------------------------- |
| `CLAUDE.md`                      | AI agents + devs | HOW to build — process, standards, enforcement |
| `README.md`                      | Humans           | WHAT the project does — usage, overview        |
| `AGENTS.md` _(when present)_     | AI agents        | Programmatic CLI/tooling reference             |
| `DISCLAIMER.md` _(when present)_ | Everyone         | Epistemic integrity commitments                |
