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
with the stable local identity, no Apple timestamp, and no hardened runtime. The app keeps the
production bundle identifier `com.sjeary.sharegpt.desktop`, but the local certificate is not a
production trust identity. A self-signed identity
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

The macOS job in `.github/workflows/release.yml` fails closed when a secret is absent. It verifies
the canonical bundle identifier, Developer ID authority, Team Identifier, strict nested signature, and Gatekeeper
acceptance before uploading artifacts. It never falls back to ad-hoc or local signing.

The canonical artifact is `sharegpt-<version>-arm64.dmg`. During the 1.0.x line the workflow also
uploads a byte-identical `sharegpt-sender-<version>-arm64.dmg` compatibility alias because the
already-published 1.0.7/1.0.8 clients hard-code that download name. The app inside both files has
the single canonical bundle identifier; the alias is not a second build or application identity.

`npm run verify:signing-boundaries` rejects tracked certificates, private keys,
Keychains, or local signing password files.

Ad-hoc and the stable local self-signed identity are development tools only. They are not an
acceptable fallback for a public GitHub Release; a missing Developer ID or notarization credential
must fail the release workflow.

The workflow does not publish from the macOS job. macOS and Windows first upload private Actions
artifacts; one final job waits for both, checks the complete six-file release set, creates a draft,
uploads all assets, and only then makes the GitHub Release public.
