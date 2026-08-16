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

import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

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
export function isSettings(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 末尾のスラッシュを1つだけ落とします。 */
function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * 書き込めるディレクトリかどうか。
 *
 * kyoseiスキルもClaude Codeもここにファイルを作るので、
 * 読めるだけのディレクトリを許可しても意味がありません。
 */
async function isWritableDirectory(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isDirectory()) {
      return false;
    }
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 組み込みで許可するディレクトリ。
 *
 * kyoseiスキルが作業ディレクトリを解決する順に並べ、書き込めるものだけを採用します。
 * `TMPDIR`は空文字で存在することも珍しくないので、未設定と同じく`/tmp`に落とします。
 */
async function builtInDirectories(environment: Environment): Promise<string[]> {
  const candidates = [
    environment.RUNNER_TEMP,
    environment.XDG_RUNTIME_DIR,
    environment.TMPDIR || "/tmp",
  ]
    .filter((candidate) => candidate !== undefined)
    .filter((candidate) => candidate !== "");
  const writable = await Promise.all(
    candidates.map(async (candidate) =>
      (await isWritableDirectory(candidate)) ? candidate : undefined,
    ),
  );
  return writable.filter((candidate) => candidate !== undefined).map(stripTrailingSlash);
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
  // 失敗の理由にはエラーの内容を混ぜません。
  // `raw`はJSONとして読めなかった`settings`そのものなので、
  // `readFile`のエラーにはそれが全文含まれますし、
  // `JSON.parse`のエラーには読んだファイルの抜粋が含まれます。
  // このステップの標準エラーはジョブログに出ますが、
  // ファイル経由で与えられた`settings`はシークレットマスクの対象になりません。
  let content;
  try {
    content = await readFile(raw, "utf8");
  } catch (error) {
    throw new BuildSettingsError(
      `settings is neither valid JSON nor a readable file (${errorCode(error)})`,
    );
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new BuildSettingsError(
      `settings file does not contain valid JSON (${content.length} bytes read)`,
    );
  }
}

/** 中身を伴わないJSONの値の種別。 */
function jsonKind(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

/** 内容を伴わない失敗の理由。`ENOENT`などのコードが取れなければ種別だけを返します。 */
function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "unknown error";
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
    // `parseGivenSettings`の失敗と同じく、値そのものはログに出しません。
    throw new BuildSettingsError(`settings must be a JSON object, but got: ${jsonKind(given)}`);
  }

  // 組み込みで足すのは`permissions.additionalDirectories`だけなので、
  // 利用者の設定をそのまま土台にして`permissions`だけを差し替えます。
  // ディレクトリの一覧は置換ではなく連結します。
  const merged: Settings = { ...given };
  const permissions = given["permissions"];
  merged["permissions"] = {
    ...(isSettings(permissions) ? permissions : {}),
    additionalDirectories: deduplicate([...directories, ...givenDirectories(given)]),
  };
  return merged;
}
