import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quietPrefs, writeQuietPrefs } from "./prefs.ts";

test("quiet prefs turn off password and autofill pop-ups and keep other settings", () => {
  const out = quietPrefs({ profile: { name: "x", password_manager_enabled: true }, autofill: { other: 1 }, homepage: "h" });
  assert.deepEqual(out, {
    homepage: "h",
    credentials_enable_service: false,
    credentials_enable_autosignin: false,
    profile: { name: "x", password_manager_enabled: false, password_manager_leak_detection: false },
    autofill: { other: 1, profile_enabled: false, credit_card_enabled: false },
  });
});

test("writeQuietPrefs makes the file in a new profile and leaves a broken one alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "fastb-prefs-"));
  try {
    assert.equal(writeQuietPrefs(dir), true);
    const prefs = JSON.parse(readFileSync(join(dir, "Default", "Preferences"), "utf8"));
    assert.equal(prefs.profile.password_manager_leak_detection, false);
    const broken = mkdtempSync(join(tmpdir(), "fastb-prefs-"));
    mkdirSync(join(broken, "Default"));
    writeFileSync(join(broken, "Default", "Preferences"), "{not json");
    assert.equal(writeQuietPrefs(broken), false);
    assert.equal(readFileSync(join(broken, "Default", "Preferences"), "utf8"), "{not json");
    rmSync(broken, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
