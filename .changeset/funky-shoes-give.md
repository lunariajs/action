---
'@lunariajs/action': minor
---

Adds support for running the action from a `workflow_run` workflow triggered by a `pull_request` workflow. This allows commenting on pull requests from forks without using `pull_request_target`, which GitHub blocks by default in public repositories starting December 2, 2026.
