# kyosei-action

GitHub Action for
[kyosei](https://github.com/ncaq/konoka/tree/master/plugins/kyosei)
code review from
[konoka](https://github.com/ncaq/konoka)
marketplace.

Kyosei is a multi-perspective AI code review plugin that analyzes pull requests
for code quality, performance, security, test coverage, and documentation accuracy.

## Motivation

The Claude Code Review workflow installed via `install-github-app` does not re-review a PR after subsequent pushes.
Once the initial review is posted, pushing fixes in response to feedback does not trigger a new review,
so there is no automated way to verify that review comments have been properly addressed.

Using [claude-code-action](https://github.com/anthropics/claude-code-action) directly enables per-push reviews, but introduces other problems:

- Pushing to the same PR repeatedly causes the same comments to be posted over and over
- Comments that have already been answered with "this is intentional" or "by design" are re-posted on each push

The [kyosei](https://github.com/ncaq/konoka/tree/master/plugins/kyosei) plugin solves these problems.
It collects existing PR conversations (comments, inline comments, and review comments) before each review,
excludes already-posted feedback, resolved comments, and comments that have been acknowledged as intentional,
so only genuinely new feedback is provided.
It also removes project-specific coding conventions embedded in claude-code-action's default review agents.
For example, claude-code-action's code-quality-reviewer includes the instruction
"Prefer `type` over `interface` as per project standards",
which is applied even to projects that do not use TypeScript.
kyosei strips such opinionated defaults and expects project-specific conventions
to be specified in `CLAUDE.md` instead.

kyosei-action wraps the kyosei plugin as a GitHub Action,
making it easy to run these reviews automatically in CI.

## Overview

This repository provides a Composite Action and a Reusable Workflow.
The Composite Action is a low-level building block
that requires the caller to handle checkout and permissions.
For simpler setup, use the Reusable Workflow.

## Authentication

At least one of the following is required.
Typically you only need one; if multiple are provided they are passed through to claude-code-action as-is.

- `claude_code_oauth_token` - Claude Code OAuth token
- `anthropic_api_key` - Anthropic API key
- A cloud provider (`use_bedrock`, `use_vertex`, or `use_foundry`)

### Token Setup (OAuth token)

#### Obtain a Claude Code OAuth token:

```console
claude --bare setup-token
```

Copy the output token.

#### Set the token as a repository secret for GitHub Actions:

```console
gh secret set CLAUDE_CODE_OAUTH_TOKEN
```

Paste the token when prompted.

#### If Dependabot also triggers reviews, set the token as a Dependabot secret:

```console
gh secret set CLAUDE_CODE_OAUTH_TOKEN --app dependabot
```

Paste the token when prompted.

## Pinning to a commit hash

This project follows immutable releases:
once a version tag is published, it is never moved or overwritten.
Version tags such as `@v1.0.1` are safe to use as-is.

If your policy requires pinning to a commit hash rather than a tag,
you need the commit SHA, not the tag object SHA.
Annotated tags have their own object SHA which differs from the commit SHA.
GitHub Actions requires the commit SHA.

Use `^{commit}` to dereference the tag:

```console
git rev-parse v1.0.1^{commit}
```

Do not use `git rev-parse v1.0.1` without `^{commit}`.
For annotated tags it returns the tag object SHA, which GitHub Actions cannot resolve.

## Reusable Workflow

Handles checkout and timeout internally.
Permissions must be declared by the caller
since the reusable workflow is constrained by the caller's permissions.

```yaml
name: Kyosei

on:
  pull_request:
    # Only opened and synchronize to avoid duplicate reviews
    # on the same revision from ready_for_review or reopened events.
    types: [opened, synchronize]

permissions: {}

jobs:
  workflow:
    # Reusable workflows are constrained by the caller's permissions,
    # so they must be explicitly declared here.
    # Claude GitHub App manages its own token, so only minimal permissions are needed.
    permissions:
      contents: read # Read repository contents for checkout
      id-token: write # GitHub App token exchange via OIDC (needed regardless of Claude API auth method)
    uses: ncaq/kyosei-action/.github/workflows/review.yml@v1.0.1
    secrets:
      claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Most Composite Action inputs can be passed via `with:`.
The Reusable Workflow additionally accepts the following inputs:

| Name                   | Description                                                                | Default          |
| ---------------------- | -------------------------------------------------------------------------- | ---------------- |
| `runs-on`              | Runner label(s) as JSON                                                    | `"ubuntu-24.04"` |
| `timeout-minutes`      | Job timeout in minutes                                                     | `30`             |
| `fetch-depth`          | Number of commits to fetch                                                 | `50`             |
| `self_hosted_packages` | Packages to install via apt-get on self-hosted runners (newline-separated) | See below        |

### Self-hosted runners

When `runner.environment` is `self-hosted` and `self_hosted_packages` is non-empty,
the workflow automatically installs the listed packages via `apt-get` before checkout.
The default list covers the minimum programs required by kyosei-action and claude-code-action:

```yaml
self_hosted_packages: |
  curl
  gh
  git
  zstd
```

To skip automatic installation, pass an empty string:

```yaml
with:
  self_hosted_packages: ""
```

On GitHub-hosted runners this step is always skipped regardless of the input value.

### `runs-on` format

`runs-on` is parsed with `fromJSON()`, so the value must be valid JSON.
YAML double quotes are stripped by the YAML parser, so you need to nest JSON quotes inside YAML single quotes:

```yaml
# Single label
with:
  runs-on: '"ubuntu-24.04"'

# Multiple labels
with:
  runs-on: '["self-hosted", "linux"]'
```

See the Composite Action section below for the full input list.

## Composite Action

### Usage

Examples below use version tags.

```yaml
name: Kyosei

on:
  pull_request:
    # Only opened and synchronize to avoid duplicate reviews
    # on the same revision from ready_for_review or reopened events.
    types: [opened, synchronize]

permissions: {}

jobs:
  review:
    runs-on: ubuntu-24.04
    # Claude GitHub App manages its own token, so only minimal permissions are needed.
    permissions:
      contents: read # Read repository contents for checkout
      id-token: write # GitHub App token exchange via OIDC (needed regardless of Claude API auth method)
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false
          fetch-depth: 50
      - uses: ncaq/kyosei-action@v1.0.1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### Inputs

| Name                        | Description                                                     | Required | Default                              |
| --------------------------- | --------------------------------------------------------------- | -------- | ------------------------------------ |
| `claude_code_oauth_token`   | Claude Code OAuth token                                         | No       |                                      |
| `anthropic_api_key`         | Anthropic API key (alternative to OAuth token)                  | No       |                                      |
| `use_bedrock`               | Use Amazon Bedrock with OIDC                                    | No       | `false`                              |
| `use_vertex`                | Use Google Vertex AI with OIDC                                  | No       | `false`                              |
| `use_foundry`               | Use Microsoft Foundry with OIDC                                 | No       | `false`                              |
| `custom_github_token`       | GitHub token (omit to use Claude GitHub App)                    | No       | `""`                                 |
| `allowed_bots`              | Allowed bot usernames or `*` for all                            | No       | `*`                                  |
| `allowed_non_write_users`   | Users without write permission allowed to trigger Claude        | No       | `""`                                 |
| `include_comments_by_actor` | Include only comments from specific actors (wildcard support)   | No       | `""`                                 |
| `exclude_comments_by_actor` | Exclude comments from specific actors (wildcard support)        | No       | `""`                                 |
| `additional_permissions`    | Additional GitHub App token permissions (e.g. `actions: read`)  | No       | `""`                                 |
| `settings`                  | Claude Code settings as JSON string or file path                | No       | `""`                                 |
| `model`                     | Claude model to use                                             | No       | `opus[1m]`                           |
| `allowed_tools`             | Allowed tools (newline-separated, replaces default set)         | No       | See below                            |
| `additional_allowed_tools`  | Additional tools to append (newline-separated)                  | No       | `""`                                 |
| `claude_args`               | Additional CLI arguments                                        | No       | `""`                                 |
| `include_fix_links`         | Include "Fix this" deep links in review feedback                | No       | `true`                               |
| `display_report`            | Show Claude Code Report in Step Summary (`true`/`false`/`auto`) | No       | `auto` (enabled for private repos)   |
| `show_full_output`          | Show full JSON output in logs (private repos only)              | No       | `false`                              |
| `marketplace_url`           | Git URL of the plugin marketplace                               | No       | `https://github.com/ncaq/konoka.git` |
| `plugin_name`               | Plugin identifier within the marketplace                        | No       | `kyosei@konoka`                      |

#### Default allowed tools

```yaml
allowed_tools: |
  Bash(gh api *issues/*/comments*)
  Bash(gh api *pulls/*/comments*)
  Bash(gh api *pulls/*/reviews*)
  Bash(gh issue:*)
  Bash(gh pr:*)
  Bash(gh search:*)
  Glob
  Grep
  Read
  WebFetch
  WebSearch
  mcp__github
  mcp__github_inline_comment__create_inline_comment
```

To add tools without replacing the defaults, use `additional_allowed_tools`:

```yaml
- uses: ncaq/kyosei-action@v1.0.1
  with:
    claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    additional_allowed_tools: |
      Bash(npm test)
      Edit
```

### Outputs

| Name             | Description                                      |
| ---------------- | ------------------------------------------------ |
| `execution_file` | Path to the Claude Code execution output file    |
| `session_id`     | Claude Code session ID for resuming conversation |

## Permissions

When `custom_github_token` is omitted (default), Claude GitHub App manages its own token,
so each job only needs minimal permissions:

```yaml
permissions:
  contents: read # Read repository contents for checkout
  id-token: write # GitHub App token exchange via OIDC (needed regardless of Claude API auth method)
```

`id-token: write` is required even when using `claude_code_oauth_token` or `anthropic_api_key`.
claude-code-action internally exchanges this GitHub OIDC token at Anthropic's endpoint
for a short-lived GitHub App token that posts PR comments.
This is separate from Claude API authentication.
Only when `custom_github_token` is provided is this OIDC exchange skipped.

If you explicitly pass `custom_github_token`, the token needs additional permissions
such as `pull-requests: write` for posting review comments.
If the token lacks `pull-requests: write`
(e.g. due to workflow file changes in the PR or fork PRs),
the action will skip gracefully with a warning instead of failing.

## Development

### Setup

```console
direnv allow
```

### Format

```console
nix fmt
```

### Check

```console
nix-fast-build --option eval-cache false --no-link --skip-cached
```

## License

[Apache License 2.0](LICENSE)
