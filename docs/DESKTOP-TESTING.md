# Desktop user journeys

The CI desktop journey runs the built Electron application against the real
collaboration server on disposable Windows x64 and macOS ARM runners. It uses
synthetic accounts and isolated stores. No real AI website or user profile is used.

## Run and inspect

After installing the root, renderer and server dependencies:

```sh
npm run build:next
node scripts/verify-desktop-journey.cjs
node scripts/verify-desktop-journey.cjs --performance
```

Local execution keeps the window hidden. The CI-only `--cloud-visible` option
shows the application on a GitHub-hosted runner. Action and Chromium performance
traces are recorded in separate runs to reduce observer overhead. Performance
runs omit screenshots. Hidden-window frame timings
must not be used to assess visible responsiveness.

The journey exercises onboarding and login, settings categories, notification
settings, navigation, management access, restart persistence, and admin/member/
admin switching. Assertions check visible outcomes and persistence, rather than
only successful clicks. Existing focused acceptance scripts continue to cover
chat, AI lifecycle with local fixtures, native terminal, and package installation.

Download the `desktop-journey-*` Actions artifacts after a run, including failed
runs. Review:

- `result.json`: exact source revision, platform, step outcomes, durations,
  renderer errors and long tasks. Step duration includes automatic waiting and
  is not an input-latency measurement.
- Numbered PNG screenshots: visible layout and the outcome of each journey step.
- `actions-*.zip`: open with `npx playwright show-trace <file>` to inspect clicks,
  DOM snapshots and requests. This is an operation trace, not desktop video.
- `chromium-*.json`: load into a local Chromium DevTools Performance panel to
  inspect renderer tasks, layout and compositing. A requestAnimationFrame callback
  does not prove that pixels were displayed on a physical monitor.

A green assertion result is not visual or performance approval. Review slow
actions, long tasks, screenshots and recovery behavior before accepting a change.
Compare repeated runs on the same runner type; shared cloud scheduling and
virtual graphics make single-run millisecond comparisons unreliable. Document
untested flows explicitly. These journeys do not establish production login,
hardware GPU behavior, signing/keychain continuity or installed-package quality.

Artifacts contain only synthetic test activity, not server stores or application
profiles. They are retained for seven days. Do not supply production credentials
or add user profiles to artifact paths. Standard GitHub-hosted compute is free for
public repositories; larger runners and artifact storage have separate billing
rules and should be checked before expanding retention or runner sizes.

References:

- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Playwright Electron support (experimental)](https://playwright.dev/docs/api/class-electron)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)
