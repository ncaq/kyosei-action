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
Version tags such as `kyosei-action@v1.5.1` are safe to use as-is.

If your policy requires pinning to a commit hash rather than a tag,
you need the commit SHA, not the tag object SHA.
Annotated tags have their own object SHA which differs from the commit SHA.
GitHub Actions requires the commit SHA.

Use `^{commit}` to dereference the tag:

```console
git rev-parse v1.5.1^{commit}
```

Do not use `git rev-parse v1.5.1` without `^{commit}`.
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
    uses: ncaq/kyosei-action/.github/workflows/review.yml@v1.5.1
    secrets:
      claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Most Composite Action inputs can be passed via `with:`.
The Reusable Workflow additionally accepts the following inputs:

| Name              | Description                                              | Default        |
| ----------------- | -------------------------------------------------------- | -------------- |
| `runs-on`         | Runner label(s) (plain string, JSON string/array/object) | `ubuntu-24.04` |
| `timeout-minutes` | Job timeout in minutes                                   | `30`           |
| `fetch-depth`     | Number of commits to fetch                               | `50`           |

### `runs-on` format

`runs-on` accepts a plain string, a JSON-quoted string, a JSON array, or a JSON object:

```yaml
# Single label (plain string)
with:
  runs-on: ubuntu-24.04

# Single label (JSON string — also works)
with:
  runs-on: '"ubuntu-24.04"'

# Multiple labels (JSON array)
with:
  runs-on: '["self-hosted", "linux"]'

# Runner group with labels (JSON object)
with:
  runs-on: '{"group":"my-group","labels":["x64"]}'
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
      - uses: ncaq/kyosei-action@v1.5.1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### Inputs

All inputs are optional.

#### Authentication

##### `claude_code_oauth_token`

Default: `""`

Claude Code OAuth token.

##### `anthropic_api_key`

Default: `""`

Anthropic API key (alternative to OAuth token).

##### `use_bedrock`

Default: `false`

Use Amazon Bedrock with OIDC authentication.

##### `use_vertex`

Default: `false`

Use Google Vertex AI with OIDC authentication.

##### `use_foundry`

Default: `false`

Use Microsoft Foundry with OIDC authentication.

##### `custom_github_token`

Default: `""`

GitHub token for API access.
If omitted, claude-code-action uses Claude GitHub App token (claude[bot]).
Provide explicitly to use a custom token or github.token instead.
Named custom_github_token to avoid the reserved github_token input name.

#### Access control

##### `allowed_bots`

Default: `*`

Comma-separated list of allowed bot usernames, or `*` to allow all bots.
Defaults to `*` because bots are not inherently more dangerous than humans.

##### `allowed_non_write_users`

Default: `""`

Comma-separated list of users without write permission who are allowed to trigger Claude,
or `*` to allow all. Only works when `custom_github_token` is provided.
Enables bubblewrap sandbox and env scrubbing for safety.

##### `include_comments_by_actor`

Default: `""`

Filter to include only comments from specific actors.
Supports wildcards (e.g. `*[bot]`). Empty means include all.

##### `exclude_comments_by_actor`

Default: `""`

Filter to exclude comments from specific actors.
Supports wildcards. Exclusion takes precedence over inclusion.

##### `additional_permissions`

Default: `""`

Additional GitHub permissions for the App token (newline-separated `key: value`).
Example: `actions: read` enables CI/CD failure analysis.
Only effective with OIDC token exchange (ignored when `custom_github_token` is set).

##### `settings`

Default: `""`

Claude Code settings as a JSON string or path to a JSON file.
Merged with existing settings (input takes precedence).
Can configure hooks, env, MCP settings, etc.

#### Claude Code configuration

##### `model`

Default: `opus[1m]`

Claude model to use.

##### `allowed_tools`

Default: see below.

Allowed tools for Claude Code (newline-separated, replaces default set).
The defaults broadly allow tools the review agent is likely to need.
GitHub MCP tools must be listed individually
with the full `mcp__github__<tool_name>` form
(note the trailing `__` separator after "github").
The bare `mcp__github` prefix does NOT match
claude-code-action's `startsWith("mcp__github__")`
check that activates the Docker-based GitHub MCP server.
gh api is also included because MCP sometimes fails to fetch inline comments.

##### `additional_allowed_tools`

Default: `""`

Additional allowed tools to append to allowed_tools (newline-separated).

##### `claude_args`

Default: `""`

Additional arguments to pass to Claude CLI (appended after --model and --allowed-tools).

#### UI control

##### `include_fix_links`

Default: `true`

Include "Fix this" deep links in PR review feedback.

##### `display_report`

Default: `auto`

Display Claude Code Report in GitHub Step Summary.
Useful for understanding what Claude did during the review.
`auto` (default) enables it only for private repositories.
`always` enables it regardless of repository visibility.
`never` disables it entirely.
`true`/`false` are accepted as aliases for backward compatibility.

##### `show_full_output`

Default: `false`

Show full Claude Code JSON output in Actions logs.
May contain secrets in tool results; use only for debugging.
Ignored on public repositories to prevent secret leakage.

#### Marketplace and plugin

##### `marketplace_url`

Default: `https://github.com/ncaq/konoka.git`

Git URL of the plugin marketplace.

##### `plugin_name`

Default: `kyosei@konoka` and `research@konoka` (newline-separated)

Plugin identifier within the marketplace.

#### Self-hosted runner support

##### `self_hosted_packages`

Default:

```yaml
self_hosted_packages: |
  curl
  gh
  git
  zstd
```

Newline-separated list of packages to install via `apt-get` on self-hosted runners.
When the runner is self-hosted and `apt-get` is available, the listed packages are installed automatically.
On runners without `apt-get` (e.g. Fedora, NixOS), installation is skipped
and required commands must be pre-installed.

After installation (or skip), the action verifies that `curl`, `gh`, `git`, and `node` are available,
and fails with an error if any are missing.

Node.js is set up separately via `actions/setup-node` and does not need to be included in this list.

To skip automatic installation entirely, pass an empty string:

```yaml
with:
  self_hosted_packages: ""
```

On GitHub-hosted runners the `apt-get` step is always skipped
because `runner.environment` is not `self-hosted`.

#### Default allowed tools

```yaml
allowed_tools: |
  Bash(gh api *issues/*/comments*)
  Bash(gh api *pulls/*/comments*)
  Bash(gh api *pulls/*/reviews*)
  Bash(gh issue:*)
  Bash(gh pr:*)
  Bash(gh search:*)
  Bash(node:*)
  Glob
  Grep
  Read
  WebFetch
  WebSearch
  mcp__github__get_me
  mcp__github__get_commit
  mcp__github__get_file_contents
  mcp__github__get_issue
  mcp__github__get_pull_request
  # ... (all read-only GitHub MCP tools)
  mcp__github__search_users
  mcp__github_inline_comment__create_inline_comment
```

The full list of GitHub MCP tools includes all read-only tools from
[github-mcp-server](https://github.com/github/github-mcp-server) v0.17.1:

- Actions
- Code
- Context
- Dependabot
- Discussions
- Issues
- Pull
- Repos
- Secret
- Users

See [`action.yml`](action.yml) for the complete list.

To add tools without replacing the defaults, use `additional_allowed_tools`:

```yaml
- uses: ncaq/kyosei-action@v1.5.1
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
