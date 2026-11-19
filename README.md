# kyosei-action

GitHub Action for
[kyosei](https://github.com/ncaq/konoka/tree/master/plugins/kyosei)
code review from
[konoka](https://github.com/ncaq/konoka)
marketplace.

Kyosei is a multi-perspective AI code review plugin that analyzes pull requests
for code quality, performance, security, test coverage, and documentation accuracy.

## Motivation

The Claude Code Review workflow installed
via `install-github-app` does not re-review a PR after subsequent pushes.
Once the initial review is posted,
pushing fixes in response to feedback does not trigger a new review,
so there is no automated way to verify that review comments have been properly addressed.

Using [claude-code-action](https://github.com/anthropics/claude-code-action)
directly enables per-push reviews,
but introduces other problems:

- Pushing to the same PR repeatedly causes the same comments to be posted over and over
- Comments that have already been answered with
  "this is intentional" or "by design" are re-posted on each push

The [kyosei](https://github.com/ncaq/konoka/tree/master/plugins/kyosei) plugin
solves these problems.
It collects existing PR conversations (comments, inline comments, and review comments)
before each review,
excludes already-posted feedback,
resolved comments,
and comments that have been acknowledged as intentional,
so only genuinely new feedback is provided.
It also removes project-specific coding conventions embedded
in claude-code-action's default review agents.
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
Typically you only need one;
if multiple are provided they are passed through to claude-code-action as-is.

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
Version tags such as `kyosei-action@v3.1.0` are safe to use as-is.

If your policy requires pinning to a commit hash rather than a tag,
you need the commit SHA, not the tag object SHA.
Annotated tags have their own object SHA which differs from the commit SHA.
GitHub Actions requires the commit SHA.

Use `git ls-remote` with `^{}` to fetch the dereferenced commit SHA without cloning the repository:

```console
git ls-remote https://github.com/ncaq/kyosei-action.git 'refs/tags/v3.1.0^{}'
```

Do not query `refs/tags/v3.1.0` without `^{}`.
For annotated tags it returns the tag object SHA, which GitHub Actions cannot resolve.

The Reusable Workflow references the Composite Action
with the [self-repository syntax](https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax) (`uses: $/`),
and every other action is pinned to a commit SHA.
Pinning the Reusable Workflow to a commit SHA therefore pins the Composite Action to the same commit,
which is intended to satisfy the
"Require actions to be pinned to a full-length commit SHA" policy.

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
      id-token: write # GitHub App token exchange via OIDC (needed regardless of auth method)
    uses: ncaq/kyosei-action/.github/workflows/review.yml@v3.1.0
    secrets:
      claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

The Reusable Workflow relies on the self-repository syntax (`uses: $/`),
which requires GitHub Actions runner 2.336.0 or newer
and is not available on GitHub Enterprise Server.
GitHub-hosted runners already satisfy this.
If you use older self-hosted runners or GitHub Enterprise Server,
use the Composite Action directly instead.

Most Composite Action inputs can be passed via `with:`.
The Reusable Workflow additionally accepts the following inputs:

| Name              | Description                                              | Default        |
| ----------------- | -------------------------------------------------------- | -------------- |
| `runs-on`         | Runner label(s) (plain string, JSON string/array/object) | `ubuntu-26.04` |
| `timeout-minutes` | Job timeout in minutes                                   | `60`           |
| `fetch-depth`     | Number of commits to fetch                               | `50`           |

### `runs-on` format

`runs-on` accepts a plain string, a JSON-quoted string, a JSON array, or a JSON object:

```yaml
# Single label (plain string)
with:
  runs-on: ubuntu-26.04

# Single label (JSON string — also works)
with:
  runs-on: '"ubuntu-26.04"'

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
    runs-on: ubuntu-26.04
    # Claude GitHub App manages its own token, so only minimal permissions are needed.
    permissions:
      contents: read # Read repository contents for checkout
      id-token: write # GitHub App token exchange via OIDC (needed regardless of auth method)
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false
          fetch-depth: 50
      - uses: ncaq/kyosei-action@v3.1.0
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

Claude Code settings as a JSON object, or a path to a file containing one.
Merged with existing settings (input takes precedence).
Can configure hooks, env, MCP settings, etc.

The `permissions.additionalDirectories` built from the `additional_directories` input
is merged into this as well.
Directory lists from both sides are concatenated rather than replaced,
so allowing extra directories here does not drop the built-in ones.

Because the action parses this input to perform that merge,
the job fails when the value is neither a JSON object
nor a path to a file containing one.

#### Claude Code configuration

##### `model`

Default: `opus`

Claude model to use.

The Claude Code CLI is installed by this action itself
instead of the one claude-code-action would install,
so aliases such as `opus` resolve to the model of the version pinned
in the `Install Claude Code` step of [action.yml](./action.yml).

##### `effort`

Default: empty (the `--effort` flag is omitted and the model default applies)

Reasoning effort level for the top-level orchestrator session.
Valid values: `low`, `medium`, `high`, `xhigh`, `max`.

The kyosei skill itself only dispatches reviewer subagents and posts JSON,
so it does not need deep reasoning.
Setting a lower level such as `low` reduces cost and latency without affecting review quality.

Reviewer subagents declare their own effort in agent frontmatter,
which [overrides the session-level value](https://code.claude.com/docs/en/agents),
so the actual reviews are unaffected by this setting.

Leave empty to omit the flag and use the model default.

##### `allowed_tools`

Default: see the `allowed_tools` default in [action.yml](./action.yml).

Allowed tools for Claude Code (newline-separated, replaces default set).

Mutations such as posting reviews are performed by the kyosei skill
via its Node.js implementation rather than by Claude directly.

###### Built-in tools

The default lists only the built-in tools that need permission:
`Bash`, `Read`, `Skill`, `WebFetch`, `WebSearch` and `Write`.

Tools that Claude Code runs without an allow rule,
such as `Agent`, `Glob` and `Grep`, are omitted because listing them changes nothing.
`Read` stays because it is what permits reading files outside the working directories,
the installed plugin files for example.

`Edit` is left out on purpose, since a review does not modify the code.

###### Bash and Write

The default allows `Bash` without any command restriction, and `Write`.

The kyosei plugin runs its own bundled binaries whose names and paths differ per release,
so an allowlist of individual commands cannot cover them.
Reviewers also write intermediate results to scratch files.
`node` alone already permits arbitrary code execution,
so restricting the rest gains little.

Reviewer skills list their own tools in frontmatter.
Note that this is not a boundary:
the list grants permission rather than restricting it,
and the subagents the skills run in inherit
the permission rules of the session that started them.
The `Agent` tool needs no permission either,
so the session can start general-purpose subagents at any time.

The runner is disposable, but that protects only the working tree.
The session can read the process environment,
which holds `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
and the GitHub App token,
and `WebFetch` and the MCP servers give it ways to send them elsewhere.

The reach is not limited to the review either.
`$RUNNER_TEMP` is allowed as a working directory,
and on GitHub hosted runners it also holds `_runner_file_commands`,
where the files behind `GITHUB_ENV`, `GITHUB_PATH` and `GITHUB_OUTPUT` live.
Appending to those injects environment variables or PATH entries
into the later steps of the same job.

This action feeds Claude text that the author of a pull request controls,
such as the diff, the title and the comments,
so a successful prompt injection reaches all of the above.
Replace this default with a stricter policy when you review untrusted input,
fork pull requests in particular.

###### GitHub MCP

claude-code-action starts
[github-mcp-server](https://github.com/github/github-mcp-server) v0.17.1,
and only when a tool name in the list begins with `mcp__github__`.
The bare `mcp__github` does not start it,
so keep at least one `mcp__github__<tool_name>` entry when you replace the default.

The default lists every read-only tool of v0.17.1, covering these toolsets:

- Actions
- Code security
- Context
- Dependabot
- Discussions
- Gists
- Issues
- Notifications
- Orgs
- Projects
- Pull requests
- Repos
- Secret protection
- Security advisories
- Users

The tools of the dynamic toolset are not listed,
because the server does not register them the way claude-code-action starts it.

The default also keeps `get_label`, `issue_read` and `pull_request_read`.
They do not exist in v0.17.1 and match nothing today;
they are the names later versions use,
kept so that the default keeps working when claude-code-action updates the server.

###### Kyosei skill MCP

The default also allows the MCP servers used by the research survey skill.

- `mcp__backlog__*` (the read-only tools only)
- `mcp__plugin_nix-tasuke_nixos`
- `mcp__plugin_research_*`

The `*` here is shorthand for explanation.
Claude Code itself accepts `mcp__<server>__*` as a permission rule,
but the default enumerates the read-only tools of Backlog one by one
(for example `mcp__backlog__get_issue`)
so that the tools that write stay denied.
The plugin servers only offer read-only tools,
so they are allowed per server (for example `mcp__plugin_research_cloudflare`).

Tools of MCP servers that ship with a plugin are named
`mcp__plugin_<plugin>_<server>__<tool>`.
When the repository under review defines a server with the same URL itself,
for example in `.mcp.json`,
Claude Code connects to it only once under the name the repository gave it,
and the `mcp__plugin_*` name no longer matches.
Add the other name with `additional_allowed_tools` in that case.

The `mcp__plugin_*` servers ship with the bundled plugins and work out of the box.
Backlog (`mcp__backlog__*`) is not bundled,
so it only works if you configure the Backlog MCP server yourself
(for example via `.mcp.json`).
The Backlog names cover the read-only tools of
[backlog-mcp-server](https://github.com/nulab/backlog-mcp-server) up to v0.23.4.

##### `additional_allowed_tools`

Default: `""`

Additional allowed tools to append to allowed_tools (newline-separated).

##### `additional_directories`

Default: `""`

Extra directories Claude may read and write outside the workspace
(newline-separated absolute paths).

Claude Code refuses file tools outside the working directory,
but the kyosei skill writes review information files under a private work directory,
and Claude Code puts its own scratch files under the temporary directory.
The built-in list therefore covers `$RUNNER_TEMP`, `$XDG_RUNTIME_DIR`
and `$TMPDIR` (or `/tmp`), whichever of them exist and are writable,
matching the order the kyosei skill resolves its work directory in.

This input is appended to that built-in list,
so it only adds directories and never removes them.

Unlike the built-in ones, the directories given here are not checked for existence,
so you can allow a path before whatever creates it runs.
They must be absolute, though:
the job fails when a line is anything else, `/` included.

##### `claude_args`

Default: `""`

Additional arguments to pass to Claude CLI
(appended after --model and --allowed-tools).

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
When [GitHub Actions debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/troubleshooting-workflows/enabling-debug-logging) is enabled (`ACTIONS_STEP_DEBUG`),
the report is forced on regardless of this value,
since it only summarizes what Claude did.

##### `show_full_output`

Default: `false`

Show full Claude Code JSON output in Actions logs.
May contain secrets in tool results; use only for debugging.
Ignored on public repositories to prevent secret leakage.
When [GitHub Actions debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/troubleshooting-workflows/enabling-debug-logging) is enabled (`ACTIONS_STEP_DEBUG`),
the full output is shown automatically,
but it remains restricted to private repositories.

#### Marketplace and plugin

##### `marketplace_url`

Default: `https://github.com/ncaq/konoka.git`

Git URL of the plugin marketplace.

##### `plugin_name`

Default: `kyosei@konoka`, `nix-tasuke@konoka` and `research@konoka` (newline-separated)

Plugin identifier within the marketplace.

nix-tasuke is bundled because the default `allowed_tools` allows
its `mcp__plugin_nix-tasuke_nixos` server,
which the reviewers use to look up nixpkgs packages and NixOS options.

#### Self-hosted runner support

##### `self_hosted_packages`

Default:

```yaml
self_hosted_packages: |
  curl
  gawk
  gh
  git
  jq
  zstd
```

Newline-separated list of packages to install via `apt-get` on self-hosted runners.
When the runner is self-hosted and `apt-get` is available,
the listed packages are installed automatically.
On runners without `apt-get` (e.g. Fedora, NixOS),
installation is skipped and required commands must be pre-installed.

After installation (or skip),
the action verifies that `curl`, `gh`, `git`, and `node` are available,
and fails with an error if any are missing.

Node.js is set up separately via `actions/setup-node` and
does not need to be included in this list.

To skip automatic installation entirely, pass an empty string:

```yaml
with:
  self_hosted_packages: ""
```

On GitHub-hosted runners the `apt-get` step is always skipped
because `runner.environment` is not `self-hosted`.

#### Default allowed tools

Please see the `allowed_tools` section of [action.yml](./action.yml),
and the [`allowed_tools`](#allowed_tools) input above for how the list is chosen.

To add tools without replacing the defaults, use `additional_allowed_tools`:

```yaml
- uses: ncaq/kyosei-action@v3.1.0
  with:
    claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    additional_allowed_tools: |
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
  id-token: write # GitHub App token exchange via OIDC (needed regardless of auth method)
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
