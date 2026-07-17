// Compatibility barrel for established frontend API imports. The canonical
// transport types live beside their shared schemas so the route, OpenAPI, and
// browser cannot silently diverge.

export type { Project } from '@enterpriseglue/shared/schemas/starbase/project.js';
export type { File } from '@enterpriseglue/shared/schemas/starbase/file.js';
export type { Version } from '@enterpriseglue/shared/schemas/starbase/version.js';
export type { Comment } from '@enterpriseglue/shared/schemas/starbase/comment.js';
export type { Engine } from '@enterpriseglue/shared/schemas/mission-control/engine.js';
export type {
  ProcessDefinition,
  ProcessInstance,
} from '@enterpriseglue/shared/schemas/mission-control/process.js';
