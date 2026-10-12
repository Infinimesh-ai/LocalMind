# LocalMind patch for affine_doc_loader 0.1.4

This directory contains the crates.io `affine_doc_loader` 0.1.4 source pinned by
the workspace lockfile. The local change in `src/markdown/delta.rs` preserves
whitespace inside inline code and link runs when exporting Yjs text to Markdown.
It also selects a code span delimiter that does not conflict with backticks in
the content. The unchanged parser and LocalMind's semantic round-trip guard
remain responsible for rejecting structures that Markdown cannot preserve.
The test fixtures are copied from `packages/common/native/fixtures` because the
published crate's original test path points outside its package.

Replace this patch with a verified upstream release only after the same
round-trip and direct resource tests pass against that release.
