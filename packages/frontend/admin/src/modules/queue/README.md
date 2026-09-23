# QueueDash localization

Admin uses the browser ESM entry of `@queuedash/ui` 3.16.0. The version-pinned
Yarn patch in `.yarn/patches/@queuedash-ui-npm-3.16.0-92ad79340e.patch` connects
its UI labels to `@affine/i18n`; the unmodified upstream package has no locale
prop. Keep the patch and Admin dependency declaration in sync when upgrading.

The patch translates audited interface literals, not job payloads, queue names,
status values sent to the API, or configuration keys. Table headers are render
functions because TanStack copies column definitions during initialization.
Other static labels use getters, so they do not freeze the startup language.
The existing `useI18n` subscription in `QueuePage` updates the embedded app
without remounting it or losing its local state. Date and cron descriptions
use the locale modules shipped by its existing dependencies.

After changing or upgrading the patch, install with Yarn and verify `/admin/queue`
and a queue detail page in English and Simplified Chinese. Switch both ways
without reloading, including menus, status tabs, table headers, empty states,
job dialogs, and scheduler descriptions. Do not execute queue mutations merely
to check their labels. The patch applies to the browser ESM entry; it is not
intended as a general Node/CommonJS localization of QueueDash.
