import { getOrCreateI18n } from '@affine/i18n';

// Compatibility adapter for upstream descriptors and labels. Never translate data values.
const textKeys: Record<string, string> = {
  Sent: 'com.affine.admin.ui.sent',
  Queued: 'com.affine.admin.ui.queued',
  Sending: 'com.affine.admin.ui.sending',
  Skipped: 'com.affine.admin.ui.skipped',
  Canceled: 'com.affine.admin.ui.canceled',
  'Retry wait': 'com.affine.admin.ui.retry-wait',
  Successful: 'com.affine.admin.ui.successful',
  Unsuccessful: 'com.affine.admin.ui.unsuccessful',
  Pending: 'com.affine.admin.ui.pending',
  'BYOK local': 'com.affine.admin.ui.byok-local',
  'BYOK server': 'com.affine.admin.ui.byok-server',
  'Project BYOK global': 'com.affine.admin.ui.project-byok-global',
  Configured: 'com.affine.admin.ui.configured',
  'Legacy config': 'com.affine.admin.ui.legacy-config',

  Logs: 'com.affine.admin.ui.logs',
  'Observability / Logs': 'com.affine.admin.ui.observability-logs',
  'Log Center': 'com.affine.admin.ui.log-center',
  'Filter by request ID': 'com.affine.admin.ui.filter-by-request-id',
  'Filter by trace ID': 'com.affine.admin.ui.filter-by-trace-id',
  'Severity (info/error)': 'com.affine.admin.ui.severity-info-error',
  'Event name': 'com.affine.admin.ui.event-name',
  Keyword: 'com.affine.admin.ui.keyword',
  'Export redacted NDJSON': 'com.affine.admin.ui.export-redacted-ndjson',
  'Loading logs…': 'com.affine.admin.ui.loading-logs',
  'No logs found.': 'com.affine.admin.ui.no-logs-found',
  Time: 'com.affine.admin.ui.time',
  Severity: 'com.affine.admin.ui.severity',
  Event: 'com.affine.admin.ui.event',
  Request: 'com.affine.admin.ui.request',
  'Trace / Audit': 'com.affine.admin.ui.trace-audit',
  Status: 'com.affine.admin.ui.status',
  'Event detail': 'com.affine.admin.ui.event-detail',
  'Observability / Settings': 'com.affine.admin.ui.observability-settings',
  'Retention and ingestion': 'com.affine.admin.ui.retention-and-ingestion',
  'Self-hosted telemetry export is disabled by default.':
    'com.affine.admin.ui.self-hosted-telemetry-export-is-disabled-by-default',
  'Runtime retention (days)': 'com.affine.admin.ui.runtime-retention-days',
  'Failure retention (days)': 'com.affine.admin.ui.failure-retention-days',
  'Legal hold': 'com.affine.admin.ui.legal-hold',
  'Freeze retention and archive cleanup':
    'com.affine.admin.ui.freeze-retention-and-archive-cleanup',
  'Saving…': 'com.affine.admin.ui.saving',
  'Save policy': 'com.affine.admin.ui.save-policy',
  'Preview retention cleanup': 'com.affine.admin.ui.preview-retention-cleanup',
  'Preview signed archive': 'com.affine.admin.ui.preview-signed-archive',
  'Create signed archive': 'com.affine.admin.ui.create-signed-archive',
  'Archiving…': 'com.affine.admin.ui.archiving',
  'Signed archive batches': 'com.affine.admin.ui.signed-archive-batches',
  'No archive batches yet.': 'com.affine.admin.ui.no-archive-batches-yet',
  Created: 'com.affine.admin.ui.created',
  Records: 'com.affine.admin.ui.records',
  'Key version': 'com.affine.admin.ui.key-version',
  Integrity: 'com.affine.admin.ui.integrity',
  'Archive candidates or completed records':
    'com.affine.admin.ui.archive-candidates-or-completed-records',
  'Session deletion tasks': 'com.affine.admin.ui.session-deletion-tasks',
  'No session deletion tasks yet.':
    'com.affine.admin.ui.no-session-deletion-tasks-yet',
  Requested: 'com.affine.admin.ui.requested',
  Session: 'com.affine.admin.ui.session',
  Scope: 'com.affine.admin.ui.scope',
  'Backup status': 'com.affine.admin.ui.backup-status',
  Attempts: 'com.affine.admin.ui.attempts',
  'Unable to load logs': 'com.affine.admin.ui.unable-to-load-logs',
  'Unable to save policy': 'com.affine.admin.ui.unable-to-save-policy',
  'App Version': 'com.affine.admin.ui.app-version',
  'Editor Version': 'com.affine.admin.ui.editor-version',
  Server: 'com.affine.admin.ui.server',
  Auth: 'com.affine.admin.ui.auth',
  Notification: 'com.affine.admin.ui.notification',
  Storage: 'com.affine.admin.ui.storage',
  OAuth: 'com.affine.admin.ui.oauth',
  Crypto: 'com.affine.admin.ui.crypto',
  Job: 'com.affine.admin.ui.job',
  Throttle: 'com.affine.admin.ui.throttle',
  Doc: 'com.affine.admin.ui.doc',
  Websocket: 'com.affine.admin.ui.websocket',
  Flags: 'com.affine.admin.ui.flags',
  DocService: 'com.affine.admin.ui.docservice',
  DocumentOcr: 'com.affine.admin.ui.documentocr',
  Iscp: 'com.affine.admin.ui.iscp',
  Client: 'com.affine.admin.ui.client',
  Calendar: 'com.affine.admin.ui.calendar',
  Indexer: 'com.affine.admin.ui.indexer',
  Worker: 'com.affine.admin.ui.worker',
  'Connection tested': 'com.affine.admin.ui.connection-tested',
  Failed: 'com.affine.admin.ui.failed',
  'Not tested': 'com.affine.admin.ui.not-tested',
  Never: 'com.affine.admin.ui.never',
  Unknown: 'com.affine.admin.ui.unknown',
  Disabled: 'com.affine.admin.ui.disabled',
  Blocked: 'com.affine.admin.ui.blocked',
  Ready: 'com.affine.admin.ui.ready',
  Unconfigured: 'com.affine.admin.ui.unconfigured',
  Warning: 'com.affine.admin.ui.warning',
  'Config fallback': 'com.affine.admin.ui.config-fallback',
  'DB revision': 'com.affine.admin.ui.db-revision',
  'Legacy registry': 'com.affine.admin.ui.legacy-registry',
  Rerank: 'com.affine.admin.ui.rerank',
  'Workspace indexing': 'com.affine.admin.ui.workspace-indexing',
  Cloud: 'com.affine.admin.ui.cloud',
  Local: 'com.affine.admin.ui.local',
  'Private cloud': 'com.affine.admin.ui.private-cloud',
  Degraded: 'com.affine.admin.ui.degraded',
  Down: 'com.affine.admin.ui.down',
  Healthy: 'com.affine.admin.ui.healthy',
  'Minimum length requirement of password':
    'com.affine.admin.ui.minimum-length-requirement-of-password',
  'Maximum length requirement of password':
    'com.affine.admin.ui.maximum-length-requirement-of-password',
  'The storage provider for user uploaded blobs':
    'com.affine.admin.ui.the-storage-provider-for-user-uploaded-blobs',
  'The bucket name for user uploaded blobs storage':
    'com.affine.admin.ui.the-bucket-name-for-user-uploaded-blobs-storage',
  'The S3 compatible config for the storage provider (endpoint/region/credentials).':
    'com.affine.admin.ui.the-s3-compatible-config-for-the-storage-provider-endpoint-region-credentials',
  'The storage provider for user avatars':
    'com.affine.admin.ui.the-storage-provider-for-user-avatars',
  'The bucket name for user avatars storage':
    'com.affine.admin.ui.the-bucket-name-for-user-avatars-storage',
  'The public path prefix for user avatars(e.g. https://my-bucket.s3.amazonaws.com/)':
    'com.affine.admin.ui.the-public-path-prefix-for-user-avatars-e-g-https-my-bucket-s3-amazonaws-com',
  'The private key for used by the crypto module to create signed tokens or encrypt data.':
    'com.affine.admin.ui.the-private-key-for-used-by-the-crypto-module-to-create-signed-tokens-or-encrypt-data',
  'The config for job queues': 'com.affine.admin.ui.the-config-for-job-queues',
  'The config for job workers':
    'com.affine.admin.ui.the-config-for-job-workers',
  'The config for copilot job queue':
    'com.affine.admin.ui.the-config-for-copilot-job-queue',
  'The config for calendar job queue':
    'com.affine.admin.ui.the-config-for-calendar-job-queue',
  'The config for doc job queue':
    'com.affine.admin.ui.the-config-for-doc-job-queue',
  'The config for indexer job queue':
    'com.affine.admin.ui.the-config-for-indexer-job-queue',
  'The config for notification job queue':
    'com.affine.admin.ui.the-config-for-notification-job-queue',
  'The config for nightly job queue':
    'com.affine.admin.ui.the-config-for-nightly-job-queue',
  'The config for backend runtime job queue':
    'com.affine.admin.ui.the-config-for-backend-runtime-job-queue',
  'The config for invite abuse disposition job queue':
    'com.affine.admin.ui.the-config-for-invite-abuse-disposition-job-queue',
  'Whether the throttler is enabled.':
    'com.affine.admin.ui.whether-the-throttler-is-enabled',
  'The config for the default throttler.':
    'com.affine.admin.ui.the-config-for-the-default-throttler',
  'The config for the strict throttler.':
    'com.affine.admin.ui.the-config-for-the-strict-throttler',
  'Whether allow new registrations.':
    'com.affine.admin.ui.whether-allow-new-registrations',
  'Whether allow new registrations via configured oauth.':
    'com.affine.admin.ui.whether-allow-new-registrations-via-configured-oauth',
  'Whether require email domain record verification before accessing restricted resources.':
    'com.affine.admin.ui.whether-require-email-domain-record-verification-before-accessing-restricted-resources',
  'Whether require email verification before accessing restricted resources(not implemented).':
    'com.affine.admin.ui.whether-require-email-verification-before-accessing-restricted-resources-not-implemented',
  'Minimum account age in seconds before new accounts can invite members or create share links.':
    'com.affine.admin.ui.minimum-account-age-in-seconds-before-new-accounts-can-invite-members-or-create-share-links',
  'Whether request abuse source facts should trust Cloudflare headers from the origin edge.':
    'com.affine.admin.ui.whether-request-abuse-source-facts-should-trust-cloudflare-headers-from-the-origin-edge',
  'Whether workspace invite quota should record would-block decisions without rejecting requests or executing abuse actions.':
    'com.affine.admin.ui.whether-workspace-invite-quota-should-record-would-block-decisions-without-rejecting-requests-or-executing-abuse-actions',
  'Whether workspace invite quota should fail open when native runtime admission is unavailable. Keep disabled for production.':
    'com.affine.admin.ui.whether-workspace-invite-quota-should-fail-open-when-native-runtime-admission-is-unavailable-keep-disabled-for-production',
  'The password strength requirements when set new password.':
    'com.affine.admin.ui.the-password-strength-requirements-when-set-new-password',
  'Application auth expiration time in seconds.':
    'com.affine.admin.ui.application-auth-expiration-time-in-seconds',
  'Application auth time to refresh in seconds.':
    'com.affine.admin.ui.application-auth-time-to-refresh-in-seconds',
  'Access JWT expiration time in seconds.':
    'com.affine.admin.ui.access-jwt-expiration-time-in-seconds',
  'Auth refresh session inactivity expiration in seconds.':
    'com.affine.admin.ui.auth-refresh-session-inactivity-expiration-in-seconds',
  'Auth refresh session absolute expiration in seconds.':
    'com.affine.admin.ui.auth-refresh-session-absolute-expiration-in-seconds',
  'One-use refresh rotation concurrency grace period in seconds.':
    'com.affine.admin.ui.one-use-refresh-rotation-concurrency-grace-period-in-seconds',
  'Retention for expired auth refresh generations in seconds.':
    'com.affine.admin.ui.retention-for-expired-auth-refresh-generations-in-seconds',
  'Hostname used for SMTP HELO/EHLO (e.g. mail.example.com). Leave empty to use the system hostname.':
    'com.affine.admin.ui.hostname-used-for-smtp-helo-ehlo-e-g-mail-example-com-leave-empty-to-use-the-system-hostname',
  'Host of the email server (e.g. smtp.gmail.com)':
    'com.affine.admin.ui.host-of-the-email-server-e-g-smtp-gmail-com',
  'Port of the email server (they commonly are 25, 465 or 587)':
    'com.affine.admin.ui.port-of-the-email-server-they-commonly-are-25-465-or-587',
  'Username used to authenticate the email server':
    'com.affine.admin.ui.username-used-to-authenticate-the-email-server',
  'Password used to authenticate the email server':
    'com.affine.admin.ui.password-used-to-authenticate-the-email-server',
  'Sender of all the emails (e.g. "LocalMind Self Hosted &lt;noreply@example.com&gt;")':
    'com.affine.admin.ui.sender-of-all-the-emails-e-g-localmind-self-hosted-lt-noreply-example-com-gt',
  "Whether ignore email server's TLS certificate verification. Enable it for self-signed certificates.":
    'com.affine.admin.ui.whether-ignore-email-server-s-tls-certificate-verification-enable-it-for-self-signed-certificates',
  'The emails from these domains are always sent using the fallback SMTP server.':
    'com.affine.admin.ui.the-emails-from-these-domains-are-always-sent-using-the-fallback-smtp-server',
  'Number of mail delivery rows claimed by each worker tick.':
    'com.affine.admin.ui.number-of-mail-delivery-rows-claimed-by-each-worker-tick',
  'Mail delivery worker lease duration in milliseconds.':
    'com.affine.admin.ui.mail-delivery-worker-lease-duration-in-milliseconds',
  'Days to retain anonymized terminal mail delivery ledger rows.':
    'com.affine.admin.ui.days-to-retain-anonymized-terminal-mail-delivery-ledger-rows',
  'Hostname used for fallback SMTP HELO/EHLO (e.g. mail.example.com). Leave empty to use the system hostname.':
    'com.affine.admin.ui.hostname-used-for-fallback-smtp-helo-ehlo-e-g-mail-example-com-leave-empty-to-use-the-system-hostname',
  'Use `y-octo` to merge updates at the same time when merging using Yjs.':
    'com.affine.admin.ui.use-y-octo-to-merge-updates-at-the-same-time-when-merging-using-yjs',
  'The minimum time interval in milliseconds of creating a new history snapshot when doc get updated.':
    'com.affine.admin.ui.the-minimum-time-interval-in-milliseconds-of-creating-a-new-history-snapshot-when-doc-get-updated',
  'The public accessible path prefix for user avatars.':
    'com.affine.admin.ui.the-public-accessible-path-prefix-for-user-avatars',
  'The config of storage for user avatars.':
    'com.affine.admin.ui.the-config-of-storage-for-user-avatars',
  'The config of storage for all uploaded blobs(images, videos, etc.).':
    'com.affine.admin.ui.the-config-of-storage-for-all-uploaded-blobs-images-videos-etc',
  'The enabled transports for accepting websocket traffics.':
    'com.affine.admin.ui.the-enabled-transports-for-accepting-websocket-traffics',
  'How many bytes or characters a message can be, before closing the session (to avoid DoS).':
    'com.affine.admin.ui.how-many-bytes-or-characters-a-message-can-be-before-closing-the-session-to-avoid-dos',
  'A recognizable name for the server. It will be shown when connected with LocalMind Desktop.':
    'com.affine.admin.ui.a-recognizable-name-for-the-server-it-will-be-shown-when-connected-with-localmind-desktop',
  'Base URL of the LocalMind server, used for generating external URLs.\nDefaults to `[server.protocol]://[server.host][:server.port]` if not specified.\n    ':
    'com.affine.admin.ui.base-url-of-the-localmind-server-used-for-generating-external-urls-defaults-to-server-protocol-server-host-server-port-if-not-specified',
  'Whether the server is hosted on a ssl enabled domain (https://).':
    'com.affine.admin.ui.whether-the-server-is-hosted-on-a-ssl-enabled-domain-https',
  'Where the server get deployed(FQDN).':
    'com.affine.admin.ui.where-the-server-get-deployed-fqdn',
  'Multiple hosts the server will accept requests from.':
    'com.affine.admin.ui.multiple-hosts-the-server-will-accept-requests-from',
  'The address to listen on (e.g., 0.0.0.0 for IPv4, :: for IPv6).':
    'com.affine.admin.ui.the-address-to-listen-on-e-g-0-0-0-0-for-ipv4-for-ipv6',
  'Which port the server will listen on.':
    'com.affine.admin.ui.which-port-the-server-will-listen-on',
  'Subpath where the server is deployed, if any (e.g. /localmind).':
    'com.affine.admin.ui.subpath-where-the-server-is-deployed-if-any-e-g-localmind',
  'Whether allow guest users to create demo workspaces.':
    'com.affine.admin.ui.whether-allow-guest-users-to-create-demo-workspaces',
  'The endpoint of the doc service.':
    'com.affine.admin.ui.the-endpoint-of-the-doc-service',
  'Enable permission-checked scanned PDF OCR through the server-controlled SparkClaw endpoint.':
    'com.affine.admin.ui.enable-permission-checked-scanned-pdf-ocr-through-the-server-controlled-sparkclaw-endpoint',
  'OpenAI-compatible SparkClaw OCR base URL. The server appends /chat/completions.':
    'com.affine.admin.ui.openai-compatible-sparkclaw-ocr-base-url-the-server-appends-chat-completions',
  'Exact hostname allowed for outbound OCR requests.':
    'com.affine.admin.ui.exact-hostname-allowed-for-outbound-ocr-requests',
  'Model id sent to the OpenAI-compatible OCR endpoint.':
    'com.affine.admin.ui.model-id-sent-to-the-openai-compatible-ocr-endpoint',
  'Optional server-only bearer token for the OCR endpoint.':
    'com.affine.admin.ui.optional-server-only-bearer-token-for-the-ocr-endpoint',
  'Maximum time for one OCR page inference.':
    'com.affine.admin.ui.maximum-time-for-one-ocr-page-inference',
  'Maximum rasterized page image size accepted by the OCR API.':
    'com.affine.admin.ui.maximum-rasterized-page-image-size-accepted-by-the-ocr-api',
  'Maximum cleaned Markdown bytes accepted from one OCR completion.':
    'com.affine.admin.ui.maximum-cleaned-markdown-bytes-accepted-from-one-ocr-completion',
  'Maximum completion tokens requested from the OCR model.':
    'com.affine.admin.ui.maximum-completion-tokens-requested-from-the-ocr-model',
  'Maximum concurrent OCR page requests per LocalMind server process.':
    'com.affine.admin.ui.maximum-concurrent-ocr-page-requests-per-localmind-server-process',
  'Enable the LocalMind SparkClaw ISCP integration':
    'com.affine.admin.ui.enable-the-localmind-sparkclaw-iscp-integration',
  'Internal URL of the LocalMind ISCP controller':
    'com.affine.admin.ui.internal-url-of-the-localmind-iscp-controller',
  'Bearer token used between LocalMind and the ISCP controller':
    'com.affine.admin.ui.bearer-token-used-between-localmind-and-the-iscp-controller',
  'ISCP domain assigned to LocalMind SparkClaw endpoints':
    'com.affine.admin.ui.iscp-domain-assigned-to-localmind-sparkclaw-endpoints',
  'Whether check version of client before accessing the server.':
    'com.affine.admin.ui.whether-check-version-of-client-before-accessing-the-server',
  "Allowed version range of the app that allowed to access the server. Requires 'client/versionControl.enabled' to be true to take effect.":
    'com.affine.admin.ui.allowed-version-range-of-the-app-that-allowed-to-access-the-server-requires-client-versioncontrol-enabled-to-be-true-to-take-effect',
  'Google Calendar integration config':
    'com.affine.admin.ui.google-calendar-integration-config',
  'CalDAV integration config': 'com.affine.admin.ui.caldav-integration-config',
  'Enable indexer plugin': 'com.affine.admin.ui.enable-indexer-plugin',
  'Indexer search service provider name':
    'com.affine.admin.ui.indexer-search-service-provider-name',
  'Indexer search service endpoint':
    'com.affine.admin.ui.indexer-search-service-endpoint',
  'Indexer search service api key. Optional for elasticsearch':
    'com.affine.admin.ui.indexer-search-service-api-key-optional-for-elasticsearch',
  'Indexer search service auth username, if not set, basic auth will be disabled. Optional for elasticsearch':
    'com.affine.admin.ui.indexer-search-service-auth-username-if-not-set-basic-auth-will-be-disabled-optional-for-elasticsearch',
  'Indexer search service auth password, if not set, basic auth will be disabled. Optional for elasticsearch':
    'com.affine.admin.ui.indexer-search-service-auth-password-if-not-set-basic-auth-will-be-disabled-optional-for-elasticsearch',
  'Number of workspaces automatically indexed per batch':
    'com.affine.admin.ui.number-of-workspaces-automatically-indexed-per-batch',
  'Google OAuth provider config':
    'com.affine.admin.ui.google-oauth-provider-config',
  'GitHub OAuth provider config':
    'com.affine.admin.ui.github-oauth-provider-config',
  'OIDC OAuth provider config. Private network access requires allowPrivateNetwork: true':
    'com.affine.admin.ui.oidc-oauth-provider-config-private-network-access-requires-allowprivatenetwork-true',
  'Apple OAuth provider config':
    'com.affine.admin.ui.apple-oauth-provider-config',
  'Allowed origin': 'com.affine.admin.ui.allowed-origin',
  Overview: 'com.affine.admin.ui.overview',
  Queues: 'com.affine.admin.ui.queues',
  'Resume all': 'com.affine.admin.ui.resume-all',
  'Pause all': 'com.affine.admin.ui.pause-all',
  Paused: 'com.affine.admin.ui.paused',
  Theme: 'com.affine.admin.ui.theme',
  'System theme': 'com.affine.admin.ui.system-theme',
  'Light theme': 'com.affine.admin.ui.light-theme',
  'Dark theme': 'com.affine.admin.ui.dark-theme',
  'Could not fetch queues': 'com.affine.admin.ui.could-not-fetch-queues',
  Error: 'com.affine.admin.ui.error',
  Options: 'com.affine.admin.ui.options',
  Data: 'com.affine.admin.ui.data',
  'Return value': 'com.affine.admin.ui.return-value',
  Retry: 'com.affine.admin.ui.retry',
  Rerun: 'com.affine.admin.ui.rerun',
  Discard: 'com.affine.admin.ui.discard',
  Remove: 'com.affine.admin.ui.remove',
  Close: 'com.affine.admin.ui.close',
  Name: 'com.affine.admin.ui.name',
  Lifecycle: 'com.affine.admin.ui.lifecycle',
  'No jobs found': 'com.affine.admin.ui.no-jobs-found',
  Delete: 'com.affine.admin.ui.delete',
  'Added to queue': 'com.affine.admin.ui.added-to-queue',
  Completed: 'com.affine.admin.ui.completed',
  Processed: 'com.affine.admin.ui.processed',
  Retried: 'com.affine.admin.ui.retried',
  Cancel: 'com.affine.admin.ui.cancel',
  Waiting: 'com.affine.admin.ui.waiting',
  Active: 'com.affine.admin.ui.active',
  Prioritized: 'com.affine.admin.ui.prioritized',
  'Waiting Children': 'com.affine.admin.ui.waiting-children',
  Delayed: 'com.affine.admin.ui.delayed',
  'Are you absolutely sure?': 'com.affine.admin.ui.are-you-absolutely-sure',
  'Clean all': 'com.affine.admin.ui.clean-all',
  'New job has been added': 'com.affine.admin.ui.new-job-has-been-added',
  'New job scheduler has been added':
    'com.affine.admin.ui.new-job-scheduler-has-been-added',
  Template: 'com.affine.admin.ui.template',
  'Add job': 'com.affine.admin.ui.add-job',
  'Add scheduler': 'com.affine.admin.ui.add-scheduler',
  'Invalid JSON': 'com.affine.admin.ui.invalid-json',
  Resume: 'com.affine.admin.ui.resume',
  Pause: 'com.affine.admin.ui.pause',
  Empty: 'com.affine.admin.ui.empty',
  Scheduler: 'com.affine.admin.ui.scheduler',
  Pattern: 'com.affine.admin.ui.pattern',
  'No next run': 'com.affine.admin.ui.no-next-run',
  'Next Run': 'com.affine.admin.ui.next-run',
  'Last minute': 'com.affine.admin.ui.last-minute',
  'Last hour': 'com.affine.admin.ui.last-hour',
  'Last 24 hours': 'com.affine.admin.ui.last-24-hours',
  'Last 7 days': 'com.affine.admin.ui.last-7-days',
  Metrics: 'com.affine.admin.ui.metrics',
  'Success Rate': 'com.affine.admin.ui.success-rate',
  Throughput: 'com.affine.admin.ui.throughput',
  'No queue found': 'com.affine.admin.ui.no-queue-found',
  'Could not fetch jobs': 'com.affine.admin.ui.could-not-fetch-jobs',
};

export function translateAdminText(text: string): string {
  const key = textKeys[text];
  return key ? getOrCreateI18n().t(key, { defaultValue: text }) : text;
}
