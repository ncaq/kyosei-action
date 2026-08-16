import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it, type TestContext } from "node:test";
import { buildSettings } from "../script/build-settings.ts";

/** 実在するディレクトリを1つ用意して、テストの終了時に消します。 */
async function makeDirectory(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "build-settings-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

describe("buildSettings", () => {
  it("組み込みのディレクトリを許可します", async (t) => {
    const runnerTemp = await makeDirectory(t);
    const temporary = await makeDirectory(t);
    const settings = await buildSettings({ RUNNER_TEMP: runnerTemp, TMPDIR: temporary });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [runnerTemp, temporary] },
    });
  });

  it("実在しないディレクトリを除きます", async (t) => {
    const temporary = await makeDirectory(t);
    const settings = await buildSettings({
      RUNNER_TEMP: join(temporary, "nonexistent"),
      TMPDIR: temporary,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
    });
  });

  it("書き込めないディレクトリを除きます", async (t) => {
    if (process.getuid?.() === 0) {
      // rootはパーミッションに関わらず書き込めるので確かめようがありません。
      t.skip("running as root");
      return;
    }
    const temporary = await makeDirectory(t);
    const readOnly = join(temporary, "read-only");
    await mkdir(readOnly, { mode: 0o500 });
    const settings = await buildSettings({ RUNNER_TEMP: readOnly, TMPDIR: temporary });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
    });
  });

  it("TMPDIRが未設定なら/tmpを使います", async (t) => {
    const runnerTemp = await makeDirectory(t);
    const settings = await buildSettings({ RUNNER_TEMP: runnerTemp });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [runnerTemp, "/tmp"] },
    });
  });

  it("TMPDIRが空文字でも/tmpを使います", async (t) => {
    const runnerTemp = await makeDirectory(t);
    const settings = await buildSettings({ RUNNER_TEMP: runnerTemp, TMPDIR: "" });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [runnerTemp, "/tmp"] },
    });
  });

  it("settingsのJSON文字列をマージします", async (t) => {
    const temporary = await makeDirectory(t);
    const settings = await buildSettings({
      TMPDIR: temporary,
      SETTINGS: JSON.stringify({ env: { FOO: "bar" } }),
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
      env: { FOO: "bar" },
    });
  });

  it("settingsをファイルパスとしても読みます", async (t) => {
    const temporary = await makeDirectory(t);
    const path = join(temporary, "settings.json");
    await writeFile(path, JSON.stringify({ env: { FOO: "bar" } }));
    const settings = await buildSettings({ TMPDIR: temporary, SETTINGS: path });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
      env: { FOO: "bar" },
    });
  });

  it("読めないsettingsを拒否します", async (t) => {
    const temporary = await makeDirectory(t);
    await assert.rejects(
      buildSettings({ TMPDIR: temporary, SETTINGS: join(temporary, "nonexistent.json") }),
      /settings is neither valid JSON nor a readable file/,
    );
  });

  it("読めないsettingsのメッセージに渡された値を含めません", async (t) => {
    const temporary = await makeDirectory(t);
    // JSONとして読めない値はファイルのパスとして扱われるので、
    // 失敗した時のエラーには渡された値がそのまま入り得ます。
    await assert.rejects(
      buildSettings({ TMPDIR: temporary, SETTINGS: "{not json: s3cret}" }),
      (error: Error) => {
        assert.doesNotMatch(error.message, /s3cret/);
        return true;
      },
    );
  });

  it("中身が壊れているsettingsのファイルを拒否します", async (t) => {
    const temporary = await makeDirectory(t);
    const path = join(temporary, "settings.json");
    // JSONではないファイルを指してしまう事故を想定します。
    await writeFile(path, "SECRET=s3cret\n");
    await assert.rejects(buildSettings({ TMPDIR: temporary, SETTINGS: path }), (error: Error) => {
      assert.match(error.message, /settings file does not contain valid JSON/);
      // `JSON.parse`のメッセージは入力の抜粋を含むので、そのまま出してはいけません。
      assert.doesNotMatch(error.message, /s3cret/);
      return true;
    });
  });

  it("オブジェクトではないsettingsを拒否します", async (t) => {
    const temporary = await makeDirectory(t);
    for (const settings of ["null", '"foo"', "[]", "42"]) {
      await assert.rejects(
        buildSettings({ TMPDIR: temporary, SETTINGS: settings }),
        /settings must be a JSON object/,
        `settings=${settings}`,
      );
    }
  });

  it("オブジェクトではないsettingsのメッセージに渡された値を含めません", async (t) => {
    const temporary = await makeDirectory(t);
    await assert.rejects(
      buildSettings({ TMPDIR: temporary, SETTINGS: JSON.stringify(["s3cret"]) }),
      (error: Error) => {
        assert.match(error.message, /settings must be a JSON object/);
        assert.doesNotMatch(error.message, /s3cret/);
        return true;
      },
    );
  });

  it("additional_directoriesの前後の空白を落とします", async (t) => {
    const temporary = await makeDirectory(t);
    const additional = await makeDirectory(t);
    const settings = await buildSettings({
      TMPDIR: temporary,
      ADDITIONAL_DIRECTORIES: `  ${additional}  \n`,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary, additional] },
    });
  });

  it("絶対パスではないadditional_directoriesを拒否します", async (t) => {
    const temporary = await makeDirectory(t);
    for (const directory of ["relative/path", "/", "./here"]) {
      await assert.rejects(
        buildSettings({ TMPDIR: temporary, ADDITIONAL_DIRECTORIES: directory }),
        /must be an absolute path/,
        `directory=${directory}`,
      );
    }
  });

  it("ディレクトリの解決順を保ちます", async (t) => {
    // 辞書順に並べ替えられていないことを確かめるため、
    // 同じ親の下に辞書順とは逆になる名前で作ります。
    const parent = await makeDirectory(t);
    const runnerTemp = join(parent, "d");
    const runtime = join(parent, "c");
    const temporary = join(parent, "b");
    const additional = join(parent, "a");
    for (const directory of [runnerTemp, runtime, temporary, additional]) {
      await mkdir(directory);
    }

    const settings = await buildSettings({
      RUNNER_TEMP: runnerTemp,
      XDG_RUNTIME_DIR: runtime,
      TMPDIR: temporary,
      ADDITIONAL_DIRECTORIES: additional,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [runnerTemp, runtime, temporary, additional] },
    });
  });

  it("同じディレクトリを指す組み込みの重複を落とします", async (t) => {
    // self-hosted runnerなどでは`RUNNER_TEMP`と`TMPDIR`が同じ値になることがあります。
    const temporary = await makeDirectory(t);
    const runtime = await makeDirectory(t);
    const settings = await buildSettings({
      RUNNER_TEMP: temporary,
      XDG_RUNTIME_DIR: runtime,
      TMPDIR: temporary,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary, runtime] },
    });
  });

  it("利用者が組み込みと同じディレクトリを書いても重複を落とします", async (t) => {
    const temporary = await makeDirectory(t);
    const settings = await buildSettings({
      TMPDIR: temporary,
      ADDITIONAL_DIRECTORIES: temporary,
      SETTINGS: JSON.stringify({ permissions: { additionalDirectories: [temporary] } }),
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
    });
  });

  it("末尾のスラッシュを落とします", async (t) => {
    const temporary = await makeDirectory(t);
    const additional = await makeDirectory(t);
    const settings = await buildSettings({
      TMPDIR: `${temporary}/`,
      ADDITIONAL_DIRECTORIES: `${additional}/`,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary, additional] },
    });
  });

  it("additional_directoriesの複数行を行ごとに解釈します", async (t) => {
    const temporary = await makeDirectory(t);
    const first = await makeDirectory(t);
    const second = await makeDirectory(t);
    const settings = await buildSettings({
      TMPDIR: temporary,
      ADDITIONAL_DIRECTORIES: `${first}\n\n  ${second}  \n`,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary, first, second] },
    });
  });

  it("permissionsがオブジェクトではないsettingsを組み直します", async (t) => {
    const temporary = await makeDirectory(t);
    const settings = await buildSettings({
      TMPDIR: temporary,
      SETTINGS: JSON.stringify({ permissions: "invalid", env: { FOO: "bar" } }),
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
      env: { FOO: "bar" },
    });
  });

  it("実在しないadditional_directoriesもそのまま許可します", async (t) => {
    // 組み込みと違って利用者が明示したものは黙って捨てません。
    // マウントされる前のディレクトリなどを先に許可しておけるようにするためです。
    const temporary = await makeDirectory(t);
    const additional = join(temporary, "nonexistent");
    const settings = await buildSettings({
      TMPDIR: temporary,
      ADDITIONAL_DIRECTORIES: additional,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary, additional] },
    });
  });

  it("利用者のadditionalDirectoriesを組み込みの後ろに繋げます", async (t) => {
    const temporary = await makeDirectory(t);
    const settings = await buildSettings({
      TMPDIR: temporary,
      SETTINGS: JSON.stringify({
        permissions: { additionalDirectories: ["/opt/cache"], deny: ["Read(./secret)"] },
      }),
    });
    assert.deepEqual(settings, {
      permissions: {
        additionalDirectories: [temporary, "/opt/cache"],
        deny: ["Read(./secret)"],
      },
    });
  });
});
