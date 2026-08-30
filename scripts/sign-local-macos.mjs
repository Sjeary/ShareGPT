#!/usr/bin/env node
import { signAsync } from "@electron/osx-sign";

const [app] = process.argv.slice(2);
if (!app) {
  console.error("Usage: sign-local-macos.mjs APP_PATH");
  process.exit(1);
}
await signAsync({
  app,
  identity: "-",
  identityValidation: false,
  platform: "darwin",
  preEmbedProvisioningProfile: false,
  optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
});
