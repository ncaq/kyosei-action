// `Build settings`ステップから実行される入口です。
//
// 実行専用のファイルに分けているのは、
// `process.argv[1] === import.meta.filename`のような入口の判定を持たないためです。
// `process.argv[1]`は`path.resolve`されるだけでsymlinkを解決しませんが、
// `import.meta.filename`はNode.jsがmainモジュールの実体を解決したパスになるので、
// `$GITHUB_ACTION_PATH`にsymlinkが含まれると一致せず、
// 終了コード0のまま何も出力しないという分かりにくい壊れ方をします。

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { buildSettings, isSettings, type Environment, type Settings } from "./build-settings.ts";

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
