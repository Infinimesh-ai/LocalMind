# LocalMind Documentation

This directory keeps both upstream AFFiNE documentation and LocalMind branch
documentation.

## LocalMind Branch

LocalMind is an AFFiNE-based branch focused on AI capability modernization. The
branch adds planning and implementation work around durable AI runtime state,
DB-backed AI registries, auditable repair execution, support bundle artifacts,
and Docker-grounded validation.

LocalMind standardizes local development and validation on Linux and Linux
containers. Upstream documentation may still describe other platforms for
desktop packaging or release support; treat those notes as platform-specific
reference unless the current task explicitly targets them.

Start here for LocalMind-specific work:

- [AI modernization entrypoint](./ai-modernization/README.md)
- [Branch differences](./ai-modernization/branch-differences.md)
- [AI document map](./ai-modernization/document-map.md)
- [Docker development constraints](./localmind-docker-development-constraints.md)

## Planning Documents

- [AI modernization](./ai-modernization/README.md) is the active execution
  entrypoint for new LocalMind AI work.
- [AI capability modernization archive](./ai-modernization/archive/README.md)
  is the split historical audit log.
- [Validation](./ai-modernization/validation.md) defines how to validate AI
  modernization changes without defaulting to expensive full image rebuilds.

## Upstream Documentation

The rest of this directory is inherited from upstream AFFiNE and remains useful
for build, contribution, server, and desktop development topics.
