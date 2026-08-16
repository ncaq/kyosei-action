import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
      permissions: { additionalDirectories: [runnerTemp, temporary].sort() },
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
});
