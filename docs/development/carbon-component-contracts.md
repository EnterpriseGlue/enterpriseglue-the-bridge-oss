---
doc_class: technical
audience: developer, maintainer
publication: github
lifecycle: as-built
---

# Carbon component contracts

The frontend host owns the Carbon React instance. Trusted system modules obtain
controls from `host.components.carbon` rather than bundling another Carbon or
React runtime. Plugin API 0.6 adds optional `Checkbox`, `NumberInput`,
`RadioButton` and `RadioButtonGroup` members. Modules must feature-detect these
members before using them and retain a compatible view when an older host lacks
the complete set. The current and next plugin API fixture checks cover the
additive contract.

Semantic application color aliases are resolved at each Carbon theme boundary
(`white`, `g10`, `g90`, `g100`), so nested content uses that zone's foreground and
background colors. Profile dialog content establishes its own `g10` zone even
when opened from the dark header. Shared account typography helpers are scoped
to their content containers; spacing uses defined application tokens with
literal fallbacks.

Public account routes retain their requested appearance when the workspace
owns the header. Their default process shell uses `g100`, a left-aligned panel
and the existing process illustration. The shared header is reused without
rendering a second header; extensions can still explicitly request the default
non-illustrated appearance.

Email-verification feedback uses responsive Carbon `Grid` and `Column`
components inside the account panel. The panel supplies the horizontal inset;
the nested grid removes its additional column gutters. Notification, countdown
and actions share the same column edges and a 24px row gap, without extra
paragraph or action-group margins.

Organization selection uses a named listbox with one tab stop. Arrow keys,
Home and End move focus among active options; Enter or Space activates the
focused option. Unavailable options are announced as disabled and skipped by
keyboard navigation. The shell retains the sole main landmark and skip target.

Dashboard filters have visible and accessible labels. Retry actions refetch the
failed query without clearing unrelated results or profile drafts.
