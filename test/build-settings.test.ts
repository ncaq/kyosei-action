import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildSettings } from "../script/build-settings.ts";

/** 実在するディレクトリを1つ用意します。 */
async function makeDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "build-settings-"));
}

describe("buildSettings", () => {
  it("組み込みのディレクトリを許可します", async () => {
    const runnerTemp = await makeDirectory();
    const temporary = await makeDirectory();
    const settings = await buildSettings({ RUNNER_TEMP: runnerTemp, TMPDIR: temporary });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [runnerTemp, temporary] },
    });
  });

  it("実在しないディレクトリを除きます", async () => {
    const temporary = await makeDirectory();
    const settings = await buildSettings({
      RUNNER_TEMP: join(temporary, "nonexistent"),
      TMPDIR: temporary,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
    });
  });

  it("settingsのJSON文字列をマージします", async () => {
    const temporary = await makeDirectory();
    const settings = await buildSettings({
      TMPDIR: temporary,
      SETTINGS: JSON.stringify({ env: { FOO: "bar" } }),
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
      env: { FOO: "bar" },
    });
  });

  it("settingsをファイルパスとしても読みます", async () => {
    const temporary = await makeDirectory();
    const path = join(temporary, "settings.json");
    await writeFile(path, JSON.stringify({ env: { FOO: "bar" } }));
    const settings = await buildSettings({ TMPDIR: temporary, SETTINGS: path });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary] },
      env: { FOO: "bar" },
    });
  });

  it("読めないsettingsを拒否します", async () => {
    const temporary = await makeDirectory();
    await assert.rejects(
      buildSettings({ TMPDIR: temporary, SETTINGS: join(temporary, "nonexistent.json") }),
      /settings is neither valid JSON nor a readable file/,
    );
  });

  it("オブジェクトではないsettingsを拒否します", async () => {
    const temporary = await makeDirectory();
    for (const settings of ["null", '"foo"', "[]", "42"]) {
      await assert.rejects(
        buildSettings({ TMPDIR: temporary, SETTINGS: settings }),
        /settings must be a JSON object/,
        `settings=${settings}`,
      );
    }
  });

  it("additional_directoriesの前後の空白を落とします", async () => {
    const temporary = await makeDirectory();
    const additional = await makeDirectory();
    const settings = await buildSettings({
      TMPDIR: temporary,
      ADDITIONAL_DIRECTORIES: `  ${additional}  \n`,
    });
    assert.deepEqual(settings, {
      permissions: { additionalDirectories: [temporary, additional] },
    });
  });

  it("絶対パスではないadditional_directoriesを拒否します", async () => {
    const temporary = await makeDirectory();
    for (const directory of ["relative/path", "/", "./here"]) {
      await assert.rejects(
        buildSettings({ TMPDIR: temporary, ADDITIONAL_DIRECTORIES: directory }),
        /must be an absolute path/,
        `directory=${directory}`,
      );
    }
  });

  it("ディレクトリの解決順を保ちます", async () => {
    // 辞書順に並べ替えられていないことを確かめるため、
    // 同じ親の下に辞書順とは逆になる名前で作ります。
    const parent = await makeDirectory();
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

  it("利用者のadditionalDirectoriesを組み込みの後ろに繋げます", async () => {
    const temporary = await makeDirectory();
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
