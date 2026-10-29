# LocalMind patch for y-octo 0.1.0

This directory contains the published MIT-licensed y-octo 0.1.0 crate, pinned
through the workspace Cargo patch. Its mutable and immutable Yjs update readers
start map-key conflict resolution at the head of the existing conflict chain.
The immutable reader also reconnects a newly inserted map item to that head.
This follows Yjs's Item integration algorithm and prevents a deleted concurrent
map value from hiding a live value. The corresponding LocalMind regression uses
Yjs-generated updates, checks both update orders, and verifies reads and
incremental registration. Replace this patch only after an upstream version
passes the same interoperability and replay checks.
