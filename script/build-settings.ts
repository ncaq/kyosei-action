// Claude Codeへ渡す設定を組み立てます。
//
// Claude Codeはワーキングディレクトリの外にあるファイルへのツールの利用を拒否しますが、
// kyoseiスキルはレビュー情報のファイルを専有の作業ディレクトリに書き出し、
// Claude Code自身もスクラッチファイルを一時ディレクトリに置きます。
// そのためそれらを`permissions.additionalDirectories`で許可する必要があります。
//
// claude-code-actionの`settings`入力は`~/.claude/settings.json`に書き込まれ、
// `settingSources`に`user`が含まれるのでそのまま設定として読まれます。
// 利用者が`settings`を渡している場合に上書きしてしまわないよう、ここでマージします。
//
// Node.jsは型注釈を剥がして`.ts`を直接実行出来るので、ビルド成果物は持ちません。

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import process from "node:process";

/** Claude Codeの設定。中身の細かい構造には関心がないので浅く扱います。 */
export type Settings = Record<string, unknown>;

/** このスクリプトが読む環境変数。 */
export type Environment = {
  readonly SETTINGS?: string | undefined;
  readonly ADDITIONAL_DIRECTORIES?: string | undefined;
  readonly RUNNER_TEMP?: string | undefined;
  readonly XDG_RUNTIME_DIR?: string | undefined;
  readonly TMPDIR?: string | undefined;
  readonly RUNNER_DEBUG?: string | undefined;
};

/** 利用者の入力が不正であることを表す失敗。 */
export class BuildSettingsError extends Error {
  override readonly name = "BuildSettingsError";
}

/** `JSON.parse`の結果など、型の分からない値がオブジェクトであることを判定します。 */
function isSettings(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 末尾のスラッシュを1つだけ落とします。 */
function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 組み込みで許可するディレクトリ。
 *
 * kyoseiスキルが作業ディレクトリを解決する順に並べ、実在するものだけを採用します。
 */
async function builtInDirectories(environment: Environment): Promise<string[]> {
  const candidates = [
    environment.RUNNER_TEMP,
    environment.XDG_RUNTIME_DIR,
    environment.TMPDIR ?? "/tmp",
  ]
    .filter((candidate) => candidate !== undefined)
    .filter((candidate) => candidate !== "");
  const existing = await Promise.all(
    candidates.map(async (candidate) => ((await isDirectory(candidate)) ? candidate : undefined)),
  );
  return existing.filter((candidate) => candidate !== undefined).map(stripTrailingSlash);
}

/**
 * 利用者が`additional_directories`で追加したディレクトリ。
 *
 * YAMLのブロックスカラーではインデントが混入しやすいので前後の空白を落とします。
 * 相対パスや、末尾のスラッシュを落とすと空になる`/`は、
 * 黙って無効な設定にせずエラーにします。
 */
function inputDirectories(environment: Environment): string[] {
  return (environment.ADDITIONAL_DIRECTORIES ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const directory = stripTrailingSlash(line);
      if (!isAbsolute(directory) || directory === "") {
        throw new BuildSettingsError(
          `additional_directories must be an absolute path: ${JSON.stringify(line)}`,
        );
      }
      return directory;
    });
}

/** 与えられた順序を保ったまま重複を除きます。 */
function deduplicate(directories: readonly string[]): string[] {
  return [...new Set(directories)];
}

/**
 * `settings`入力を読みます。
 *
 * JSON文字列かJSONファイルへのパスのどちらかで、
 * これはclaude-code-action自身が適用している規則と同じです。
 */
async function parseGivenSettings(environment: Environment): Promise<unknown> {
  const raw = environment.SETTINGS ?? "";
  if (raw.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    // JSONとして読めなければファイルパスとして扱います。
  }
  let content;
  try {
    content = await readFile(raw, "utf8");
  } catch (error) {
    throw new BuildSettingsError(
      `settings is neither valid JSON nor a readable file: ${String(error)}`,
    );
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new BuildSettingsError(`settings file does not contain valid JSON: ${String(error)}`);
  }
}

/** オブジェクトは再帰的にマージし、それ以外は後勝ちにします。 */
function mergeDeep(base: Settings, override: Settings): Settings {
  const merged: Settings = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] =
      isSettings(baseValue) && isSettings(overrideValue)
        ? mergeDeep(baseValue, overrideValue)
        : overrideValue;
  }
  return merged;
}

/** 利用者が`settings`で指定したディレクトリ。 */
function givenDirectories(given: Settings): string[] {
  const permissions = given["permissions"];
  if (!isSettings(permissions)) {
    return [];
  }
  const directories = permissions["additionalDirectories"];
  return Array.isArray(directories)
    ? directories.filter((directory) => typeof directory === "string")
    : [];
}

/** 組み込みのディレクトリと利用者の`settings`をマージした設定を返します。 */
export async function buildSettings(environment: Environment): Promise<Settings> {
  const directories = [
    ...(await builtInDirectories(environment)),
    ...inputDirectories(environment),
  ];

  const given = await parseGivenSettings(environment);
  if (!isSettings(given)) {
    throw new BuildSettingsError(
      `settings must be a JSON object, but got: ${JSON.stringify(given)}`,
    );
  }

  const built: Settings = {
    permissions: { additionalDirectories: deduplicate(directories) },
  };
  const merged = mergeDeep(built, given);
  // マージでは配列は後勝ちになるので、ディレクトリの一覧だけは明示的に連結します。
  const permissions = merged["permissions"];
  merged["permissions"] = {
    ...(isSettings(permissions) ? permissions : {}),
    additionalDirectories: deduplicate([...directories, ...givenDirectories(given)]),
  };
  return merged;
}

/**
 * マージした設定をファイルに書き出してそのパスを返します。
 *
 * claude-code-actionの`settings`入力はJSON文字列でもファイルのパスでも受け付けますが、
 * GitHub Actionsはactionステップの`with:`を展開してログに出すため、
 * JSONをそのまま渡すとマージ結果の全体がログに残ります。
 * パスを渡せば内容は残りません。
 * `$GITHUB_OUTPUT`のサイズ制限も避けられます。
 *
 * `mkdtemp`が作るディレクトリは`0700`なので、その中に`0600`で書きます。
 */
async function writeSettings(environment: Environment, settings: Settings): Promise<string> {
  const parent = environment.RUNNER_TEMP || tmpdir();
  const directory = await mkdtemp(join(parent, "kyosei-settings-"));
  const path = join(directory, "settings.json");
  await writeFile(path, `${JSON.stringify(settings)}\n`, { mode: 0o600 });
  return path;
}

async function main(): Promise<void> {
  const environment: Environment = {
    SETTINGS: process.env["SETTINGS"],
    ADDITIONAL_DIRECTORIES: process.env["ADDITIONAL_DIRECTORIES"],
    RUNNER_TEMP: process.env["RUNNER_TEMP"],
    XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"],
    TMPDIR: process.env["TMPDIR"],
    RUNNER_DEBUG: process.env["RUNNER_DEBUG"],
  };
  const merged = await buildSettings(environment);
  // `settings`はhooksや`env`を設定できるので、
  // マージ結果全体はAPIキーなどを含み得ます。
  // 特にファイル経由で読んだ内容はGitHub Actionsのシークレットマスクの対象にならず、
  // 公開リポジトリでは誰でも読めるログに平文で残ります。
  // そのため通常は許可したディレクトリだけを出して、
  // 全体はデバッグログが有効な時にだけ出します。
  //
  // 標準出力は呼び出し元がそのまま`$GITHUB_OUTPUT`へ書くので、ログは標準エラーに出します。
  const permissions = merged["permissions"];
  const directories = isSettings(permissions) ? permissions["additionalDirectories"] : undefined;
  process.stderr.write(`Additional directories: ${JSON.stringify(directories)}\n`);
  if (environment.RUNNER_DEBUG === "1") {
    process.stderr.write(`Settings: ${JSON.stringify(merged)}\n`);
  }
  process.stdout.write(`${await writeSettings(environment, merged)}\n`);
}

if (process.argv[1] === import.meta.filename) {
  await main();
}
