# LocalMind Release Integrity

This document defines how LocalMind publishes and verifies release artifacts
without depending on the inherited AFFiNE Windows signing service.

## Windows Trust Model

LocalMind community Windows ZIP, Squirrel, and NSIS artifacts intentionally do
not use Authenticode or a public certificate authority code-signing certificate.
They also do not depend on AFFiNE signing infrastructure, certificates, or
signing clients.

Windows can therefore display `Unknown publisher` and Microsoft Defender
SmartScreen warnings. LocalMind must not automatically bypass, suppress, or
weaken these operating-system security prompts. Users should verify downloaded
artifacts before deciding whether to run them.

Enterprise customers may apply their own Authenticode certificate to LocalMind
artifacts as a separate downstream release step. That signature and its key
management remain under the customer's control.

## Published Evidence

The desktop release workflow publishes these integrity files with the release:

- `release-manifest.json`: artifact names, sizes, SHA-256 digests, release
  metadata, and the LocalMind release key identifier.
- `release-manifest.sig`: an Ed25519 signature over the exact manifest bytes.
- `SHA256SUMS`: SHA-256 checksums for direct command-line verification.
- `release-manifest.sigstore.json`: a keyless Sigstore bundle for the manifest.
- GitHub build provenance attestations for artifacts and integrity metadata.

The Ed25519 private key signs only the release manifest. It is never included in
the repository or a release. The configured public key is checked against the
private key during release generation, so a mismatched configuration fails the
workflow.

## Key Setup

Generate a dedicated Ed25519 key pair outside the repository:

```shell
openssl genpkey -algorithm ED25519 -out localmind-release-private.pem
openssl pkey \
  -in localmind-release-private.pem \
  -pubout \
  -out localmind-release-public.pem
```

Encode both PEM files as single-line base64 values:

```shell
openssl base64 -A -in localmind-release-private.pem
openssl base64 -A -in localmind-release-public.pem
```

Configure the private value as the GitHub Actions secret
`LOCALMIND_RELEASE_PRIVATE_KEY_BASE64`. Configure the public value as the
repository variable `LOCALMIND_RELEASE_PUBLIC_KEY_BASE64`.

Keep the private key in an access-controlled secret manager with an offline
recovery copy. Public-key rotation requires updating the repository variable
and distributing the new trusted public key through an independently verified
channel before publishing artifacts signed by it.

## Release Verification

Download all assets from one release into the same directory, then run:

```shell
export LOCALMIND_RELEASE_PUBLIC_KEY_BASE64='<base64-public-key>'
yarn verify:release ./release
```

The verifier fails if the Ed25519 signature or signing metadata is invalid, if
an artifact is missing, or if an artifact's size or SHA-256 digest differs from
the signed manifest.

The Sigstore bundle and GitHub provenance provide independent evidence about
the GitHub Actions identity and build. They complement the LocalMind Ed25519
signature rather than replacing it.

## Automatic Update Limitation

The current Electron updater still consumes its platform update metadata and
does not yet enforce the Ed25519 release manifest. Before unsigned Windows
installers are offered through automatic update, the trusted LocalMind public
key must be pinned in the desktop client and manifest verification must fail
closed before download execution or installer launch.
