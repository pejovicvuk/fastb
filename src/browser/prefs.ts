import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Chrome pop-ups that take input away from the page: the "password found in a data
// breach" warning (after a login with a known demo password), the save-password bubble,
// and address or card autofill. They are browser UI, so a page click cannot close them.
// Turned off in the profile's Preferences before Chrome starts (own-Chrome mode only:
// a Chrome reached over CDP is the user's, with the user's settings).
export function quietPrefs(prefs: Record<string, unknown>): Record<string, unknown> {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  return {
    ...prefs,
    credentials_enable_service: false,
    credentials_enable_autosignin: false,
    profile: { ...obj(prefs.profile), password_manager_enabled: false, password_manager_leak_detection: false },
    autofill: { ...obj(prefs.autofill), profile_enabled: false, credit_card_enabled: false },
  };
}

// Writes the settings into <profile>/Default/Preferences. A file that cannot be read
// as JSON is left as it is (Chrome may hold other settings there); false then.
export function writeQuietPrefs(profileDir: string): boolean {
  const dir = join(profileDir, "Default");
  const file = join(dir, "Preferences");
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(quietPrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}
