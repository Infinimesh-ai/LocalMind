## LocalMind Release Process

Stable and beta releases require authorization from the LocalMind maintainers.

## Who Can Make a Release?

The LocalMind maintainers grant release authorization and enforce the following requirements:

- Commit access to the LocalMind repository.
- Access to GitHub Actions.

## How to Make a Release

Before releasing, update the LocalMind `main` branch and review the [SemVer](https://semver.org) specification.

### 1. Update the Version in `package.json`

```shell
./scripts/set-version.sh 0.5.4-canary.5
```

### 2. Commit Changes and Push to `main`

```shell
git add .
# vX.Y.Z-canary.N
git commit -m "v0.5.4-canary.5"
git push origin main
```

### 3. Create a Release Action

Trigger the [LocalMind release workflow](https://github.com/Infinimesh-ai/LocalMind/actions/workflows/release.yml).

![img.png](assets/release-action.png)

Select the appropriate branch, complete the form, and click `Run workflow`.

### 4. Publish the Release

Once the release action is complete, a draft release will appear on the [LocalMind releases page](https://github.com/Infinimesh-ai/LocalMind/releases).

Edit the release notes if necessary, then publish the release.

Ensure that:

- The release tag and title match the version in `package.json`.
- The release targets the commit you just pushed.
- `release-manifest.json`, `release-manifest.sig`, `SHA256SUMS`, and
  `release-manifest.sigstore.json` are attached to the release.
- GitHub build provenance is available for the release integrity metadata.

Before publishing a stable release, download the complete release asset set and
run:

```shell
export LOCALMIND_RELEASE_PUBLIC_KEY_BASE64='<base64-public-key>'
yarn verify:release ./release
```

LocalMind community Windows installers intentionally do not use Authenticode.
See [LocalMind release integrity](../localmind-release-integrity.md) for the
trust model, expected Windows warnings, key configuration, and enterprise
re-signing guidance.
