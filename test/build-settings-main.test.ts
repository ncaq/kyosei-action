import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it, type TestContext } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

// `new URL(...).pathname`は`file:`URLのパーセントエンコードを解かないので、
// リポジトリのパスに空白や非ASCII文字があると壊れます。
const entry = join(import.meta.dirname, "../script/build-settings-main.ts");

/** 実在するディレクトリを1つ用意して、テストの終了時に消します。 */
async function makeDirectory(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "build-settings-main-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

/** `promisify(execFile)`が失敗時に投げるエラー。 */
type ExecFileError = Error & { code?: number | string; stdout: string; stderr: string };

/** エントリを子プロセスとして実行します。環境変数はここで渡したものだけになります。 */
async function runEntry(
  environment: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  return await run(process.execPath, [entry], { env: environment });
}

describe("build-settings-main", () => {
  it("設定を書き出したファイルのパスを1行だけ出力します", async (t) => {
    const runnerTemp = await makeDirectory(t);
    const { stdout } = await runEntry({ RUNNER_TEMP: runnerTemp, TMPDIR: runnerTemp });

    // `$GITHUB_OUTPUT`へ`path=$path`として書くので、改行を含んでいてはいけません。
    const path = stdout.trimEnd();
    assert.ok(!path.includes("\n"), `path=${JSON.stringify(path)}`);
    assert.equal(`${path}\n`, stdout);
    assert.ok(path.startsWith(runnerTemp), `path=${path}`);

    const content = await readFile(path, "utf8");
    assert.equal(content.trimEnd().includes("\n"), false);
    assert.deepEqual(JSON.parse(content), {
      permissions: { additionalDirectories: [runnerTemp] },
    });
  });

  it("RUNNER_TEMPが未設定なら一時ディレクトリに書き出します", async (t) => {
    const temporary = await makeDirectory(t);
    // `os.tmpdir()`は`TMPDIR`を見るので、それを一時ディレクトリの代わりにします。
    const { stdout } = await runEntry({ TMPDIR: temporary });
    assert.ok(stdout.trimEnd().startsWith(temporary), `path=${stdout}`);
  });

  it("書き出したファイルを所有者だけが読めるようにします", async (t) => {
    const runnerTemp = await makeDirectory(t);
    const { stdout } = await runEntry({ RUNNER_TEMP: runnerTemp, TMPDIR: runnerTemp });
    const { mode } = await stat(stdout.trimEnd());
    assert.equal(mode & 0o777, 0o600);
  });

  it("通常はマージ結果の全体をログに出しません", async (t) => {
    const runnerTemp = await makeDirectory(t);
    const { stderr } = await runEntry({
      RUNNER_TEMP: runnerTemp,
      TMPDIR: runnerTemp,
      SETTINGS: JSON.stringify({ env: { SECRET: "s3cret" } }),
    });
    assert.match(stderr, /Additional directories:/);
    assert.doesNotMatch(stderr, /Settings:/);
    assert.doesNotMatch(stderr, /s3cret/);
  });

  it("RUNNER_DEBUGが1のときだけマージ結果の全体をログに出します", async (t) => {
    const runnerTemp = await makeDirectory(t);
    const { stderr } = await runEntry({
      RUNNER_TEMP: runnerTemp,
      TMPDIR: runnerTemp,
      SETTINGS: JSON.stringify({ env: { SECRET: "s3cret" } }),
      RUNNER_DEBUG: "1",
    });
    assert.match(stderr, /Settings:.*s3cret/);
  });

  it("入力が不正なら非0で終了して何も出力しません", async (t) => {
    const runnerTemp = await makeDirectory(t);
    // `action.yml`は`if ! path=$(node ...)`で終了コードを見た上で、
    // `[ -z "$path" ]`でも弾くので、その両方を確かめます。
    await assert.rejects(
      runEntry({ RUNNER_TEMP: runnerTemp, TMPDIR: runnerTemp, SETTINGS: "42" }),
      (error: ExecFileError) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /settings must be a JSON object/);
        return true;
      },
    );
  });
});
