# External uptime monitoring

Production site: https://frogconvert.xyz/

Configure an independent hosted uptime monitor, preferably UptimeRobot, with an alert contact and a 5-minute interval where available.

- Check HTTPS availability and HTTP 200 for the public homepage.
- Prefer a response keyword unique to the actual rendered app, once validated against the live response, to distinguish the real application from generic error pages.
- An uptime monitor cannot prove that local-only file conversions work; maintain separate browser conversion tests for functional coverage. Do not upload user files to an external monitor.
- Verify failure and recovery notifications using a disposable test monitor.
- Document the monitor dashboard and alert owner here, without storing API credentials.

**Status:** Configuration guide only. No UptimeRobot monitor has been provisioned or verified. Do not claim monitoring is active based on this file.
