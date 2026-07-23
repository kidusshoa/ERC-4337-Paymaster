# apps/dashboard (reserved)

Not built as part of this project's scope. Reserved as a placeholder for a future internal ops dashboard (sponsorship policy management, stuck-transaction visibility, a UI over deposit/stake monitoring) that would read from the `apps/api` service's endpoints. No code lives here yet.

`GET /admin/paymaster-status` (`apps/api/src/modules/paymaster/admin/`) already covers the read-only deposit/stake monitoring data a dashboard would otherwise need to build from scratch — see [apps/api/README.md#admin-paymaster-depositstake-monitoring](../api/README.md#admin-paymaster-depositstake-monitoring). What's missing here is the UI, plus write-side operations (creating/editing `SponsorshipPolicy` rows, which currently only happen via direct DB access or a future admin endpoint).
