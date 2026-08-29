#!/usr/bin/env node

import { signAsync } from "@electron/osx-sign";

const [app, identity, keychain] = process.argv.slice(2);
if (!app || !identity || !keychain) {
  console.error("Usage: sign-local-macos.mjs APP_PATH IDENTITY KEYCHAIN_PATH");
  process.exit(1);
}

await signAsync({
  app,
  identity,
  keychain,
  platform: "darwin",
  preEmbedProvisioningProfile: false,
  optionsForFile: () => ({
    hardenedRuntime: false,
    timestamp: "none",
  }),
});
