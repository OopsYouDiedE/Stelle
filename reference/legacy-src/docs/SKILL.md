---
name: gemini-centric-multi-agent
description: Use GPT-5.5 as the high-level architect (framework, task allocation, test design) and coordinate Gemini CLI as the sole primary engine for code generation and review.
---

# Gemini-Centric Task Dispatch

Use this skill when tackling development tasks where GPT-5.5 designs the architecture and delegates the actual code implementation exclusively to the Gemini CLI.

## Controller Rule (GPT-5.5 The Architect)

- GPT-5.5 is the Controller and Architect. **Do not write implementation code directly.**
- The controller owns high-dimensional tasks:
  - Designing code framework structures and interfaces.
  - Breaking down features into executable tasks for Gemini.
  - Designing test workflows and validation criteria.
  - Final integration, conflict resolution, and committing.
- Treat Gemini CLI as your dedicated engineering team. Provide them with clear boundaries, input/output contracts, and context.

## Gemini Dispatch Strategy (The Execution Engine)

Gemini CLI is the sole primary force for writing code. Select the model strictly based on the task's complexity to optimize speed and cost:

- **Use `gemini-flash-lite` for Non-Coding Work:**
  - Tasks that do not require code generation.
  - Reading and summarizing error logs, formatting documentation, simple regex checks, or extracting parameters from text.
- **Use `gemini-flash` (or `auto`) for Standard Coding (The Workhorse):**
  - Everyday development tasks.
  - Implementing standard functions, building UI components, writing unit tests based on Controller's design, and fixing standard bugs.
- **Use `gemini-pro` ONLY for Complex Optimization:**
  - Heavy-duty tasks involving ~1000+ lines of code.
  - Deep architecture refactoring, complex state-machine optimization, heavy algorithmic rewrites, or resolving subtle concurrency/memory governance issues.

## Session Discipline

- Always establish the framework and test plan (by GPT-5.5) _before_ dispatching Gemini to write code.
- Maintain interactive sessions for continuous features. Do not throw away context if a file requires multiple passes.
- If Gemini writes code, GPT-5.5 must verify it against the initial test workflow design before accepting the patch.

## Gemini CLI Patterns

**Architectural Planning (GPT-5.5 local thought process, no CLI):**

1. Define folder structure.
2. Define interfaces.
3. Design test strategy.

**Standard Development (Flash):**

```bash
gemini --approval-mode auto --model flash -i "Implement the UserService class according to this interface contract. Ensure error handling follows the project standard. Target file: reference/legacy-src/src/user_service.ts"
```

**Complex Code Optimization (Pro):**

```bash
gemini --approval-mode plan --model pro -i "Review and optimize this 1200-line legacy state manager. Refactor it to use the new immutable store pattern. Retain all existing event hook behaviors."
```

**Non-Coding / Verification (Flash-Lite):**

```bash
gemini --approval-mode auto --model flash-lite -i "Extract the stack trace from this log file and identify the failing module name."
```

## Worker Write Policy & Execution Flow

1. **Phase 1: Design (GPT-5.5)** - Output the blueprint, APIs, and test commands.
2. **Phase 2: Execution (Gemini)** - Dispatch `gemini-flash` to write the files. Give it strict file-write boundaries.
3. **Phase 3: Verification (Gemini)** - Dispatch `gemini-flash-lite` or use local linters to run sanity checks.
4. **Phase 4: Finalization (GPT-5.5)** - Review the diffs, run the tests designed in Phase 1, and commit.

## Hard Boundaries

- GPT-5.5 MUST NOT get bogged down in writing boilerplate or long functions. Delegate immediately.
- Do NOT use `gemini-pro` for tasks under 300 lines unless the logic is mathematically or cryptographically complex.
- Do not let Gemini commit or push code. GPT-5.5 retains all Git write privileges.

## Quota Exhaustion & Pro Fallback (Pro 额度耗尽时的降级策略)

If `gemini-pro` quota is exhausted, rate-limited, or unavailable during a complex/1000+ line task, do not halt the workflow. The Controller (GPT-5.5) must dynamically adjust the execution strategy:

1. **Architectural Slicing (任务切碎)**: GPT-5.5 MUST step in to manually break down the massive file or complex refactoring task into smaller, logically isolated chunks (e.g., 200-300 lines, or class-by-class).
2. **Fallback to Flash**: Delegate these smaller chunks sequentially to `gemini-flash`.
3. **Heightened Integration Review**: Because `flash` lacks the massive context window and reasoning depth of `pro`, GPT-5.5 must spend extra effort reviewing the boundaries and integrations between these chunks to ensure global consistency.

## Gemini CLI Patterns (Fallback Example)

When `pro` is exhausted, instead of one massive prompt, GPT-5.5 should execute a sequence like this:

# Step 1: Flash handles chunk A

```bash
gemini --approval-mode auto --model flash -i "Refactor ONLY the data fetching methods (lines 1-300) in this legacy state manager to use the new immutable pattern."
```

```bash
# Step 2: Flash handles chunk B
gemini --approval-mode auto --model flash -i "Now refactor the event emitters (lines 301-600) based on the newly updated data fetching methods..."
```
