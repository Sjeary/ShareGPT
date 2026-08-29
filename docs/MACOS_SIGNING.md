# macOS Signing

ShareGPT uses separate signing identities for local builds and public GitHub releases.

## Local builds

Run `npm run setup:mac-signing:local` once on the development Mac. It creates the
`ShareGPT Local Code Signing` identity in a dedicated Keychain under
`~/Library/Application Support/ShareGPT Local Signing`.

The certificate, private key, Keychain password, and Keychain file are local-only.
They must never be committed, uploaded as an artifact, or copied into GitHub Secrets.

Build a locally installable sender app with:

```sh
npm run dist:mac:sender:local
```

The local build disables electron-builder identity auto-discovery, then signs the complete app
with the stable local identity, no Apple timestamp, and no hardened runtime. A self-signed identity
has no Apple Team ID, so hardened library validation would prevent Electron from loading its own
framework. Developer ID signing, hardened runtime, timestamps, and notarization belong only to the
GitHub release workflow.

The local signing scripts fail when `CI=true`, so GitHub Actions cannot silently use
the self-signed identity.

## GitHub releases

Public macOS artifacts must use an Apple-issued Developer ID Application certificate
and Apple notarization. Configure these GitHub Actions secrets:

- `MACOS_DEVELOPER_ID_P12`: base64-encoded Developer ID Application `.p12`
- `MACOS_DEVELOPER_ID_PASSWORD`: password for that `.p12`
- `APPLE_API_KEY_P8`: App Store Connect API private key contents
- `APPLE_API_KEY_ID`: App Store Connect API key ID
- `APPLE_API_ISSUER`: App Store Connect issuer ID

`.github/workflows/release-macos.yml` fails closed when a secret is absent. It verifies
the Developer ID authority, Team Identifier, strict nested signature, and Gatekeeper
acceptance before uploading artifacts. It never falls back to ad-hoc or local signing.

`npm run verify:signing-boundaries` rejects tracked certificates, private keys,
Keychains, or local signing password files.
