---
name: enterpriseglue-plugin-development
description: Use when planning, implementing, testing, or releasing EnterpriseGlue plugin architecture changes; route shared platform work to the OSS host and product-specific behavior to its owning plugin repository.
---

# EnterpriseGlue plugin development

1. Resolve the active repository and classify the change before editing:
   - host shell, runtime, public plugin API, SDK, installer, manager, deployment,
     security boundary, or reference plugin: OSS repository;
   - proprietary product capability: the private repository that owns that
     plugin.
   The standalone EE repository is not a forward-development target.
2. Keep the host generic. Expose a documented public contract when a plugin
   needs a new capability; do not import proprietary plugin code into OSS or
   add product-specific behavior to host modules.
3. Preserve compatibility across the public plugin API, host packages, plugin
   manifest and distribution lock, installer, manager, Helm charts, signatures,
   and runtime loading boundaries.
4. Test OSS platform changes with the repository's plugin-platform, package,
   external-consumer, production-image, and current/next plugin API lanes.
   Test plugin changes against every supported OSS host/API version declared by
   that plugin repository.
5. Keep public technical contracts and operator guidance in OSS. Route internal
   product decisions to Product Hub and customer installation guidance to the
   documentation CMS under the documentation-governance workflow.
6. Release OSS host/platform artifacts and each plugin independently. Never add
   an OSS-to-EE synchronization or release dependency.
7. Let owning plugin repositories consume reusable OSS contract workflows and
   publish their own signed artifacts and receipts. An OSS host release may
   advertise a compatibility target, but must not wait for every proprietary
   plugin to release.
