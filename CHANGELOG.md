# @lunariajs/action

## 0.4.0

### Minor Changes

- [#5](https://github.com/lunariajs/action/pull/5) [`a6edda9`](https://github.com/lunariajs/action/commit/a6edda9f1e256b88d453bd457917d47352446279) Thanks [@yanthomasdev](https://github.com/yanthomasdev)! - Updates the action to use Lunaria v0.3.

## 0.3.0

### Minor Changes

- [#3](https://github.com/lunariajs/action/pull/3) [`8bc5d4f`](https://github.com/lunariajs/action/commit/8bc5d4ff7cefd704c9ee7b344208f86c48853abd) Thanks [@yanthomasdev](https://github.com/yanthomasdev)! - Adds support for running the action from a `workflow_run` workflow triggered by a `pull_request` workflow. This allows commenting on pull requests from forks without using `pull_request_target`, which GitHub blocks by default in public repositories starting December 2, 2026.

## 0.2.0

### Minor Changes

- [`ee4e29c`](https://github.com/lunariajs/action/commit/ee4e29c44689e7b96fd9c79e2aeb529bff5c8e01) Thanks [@yanthomasdev](https://github.com/yanthomasdev)! - Updates the action to use Lunaria v0.2.

### Patch Changes

- [`1841c00`](https://github.com/lunariajs/action/commit/1841c00d23804bb8e061cbbd510bca83290e0f4a) Thanks [@yanthomasdev](https://github.com/yanthomasdev)! - Fixes an issue where the status comment wouldn't be updated when all tracked files were removed from the pull request.

## 0.1.0

### Minor Changes

- [#3](https://github.com/yanthomasdev/lunaria-action/pull/3) [`f70c426`](https://github.com/yanthomasdev/lunaria-action/commit/f70c426abb8f4ea4f9b972359316f2c741c2ba70) Thanks [@yanthomasdev](https://github.com/yanthomasdev)! - Adds a note indicating the tracked files table's notes don't apply when a ignored keyword is present.
