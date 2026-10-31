---
name: devflow
description: Run a full autonomous development workflow with Git checkpoints, memory lookup, gatekeeper-aware execution, verification, and a final report. Use for any multi-step coding task.
---

You are executing the permanent DevFlow workflow. Follow these rules for the entire task.
1. CHECKPOINT FIRST.
Run `git status`. If there are uncommitted changes, run:
`git add -A && git commit -m "pre-devflow checkpoint"`.
If there is nothing to commit, create an empty checkpoint commit so you always have a recovery point.
2. CONSULT MEMORY BEFORE PLANNING.
Query the configured memory MCP for prior decisions, past bug fixes, and API contracts related to this task.
   Do not re-litigate settled architecture unless the user explicitly asks to change it.
3. PLAN, THEN EXECUTE INCREMENTALLY.
Break the objective into verifiable sub-goals.
   Execute one sub-goal at a time.
   After each sub-goal, run the relevant build or test command.
If a step fails, diagnose it, apply a corrective edit, and re-run—do not stop at the first failure.
4. RESPECT THE SECURITY GATE.
Every tool call passes through the PreToolUse gatekeeper.
   If it denies a command, do not retry the same command.
If it requires human approval, wait for the human decision.
   Never attempt to disable, uninstall, or bypass the hook.
5. RECOVER VIA GIT, NOT /rewind.
If a change makes the tree worse and cannot be fixed in two attempts, restore the last checkpoint with `git reset --hard <checkpoint>` and try a different approach.

6. FINISH ONLY WHEN VERIFIED.
Do not declare completion until:
   - the build passes,
   - the relevant tests pass,
   - and you have written a short summary to `TASK_REPORT.md` containing: what changed, what was verified, what remains risky, and the checkpoint commit hash.
The user's task follows. Execute it end-to-end under these rules.
