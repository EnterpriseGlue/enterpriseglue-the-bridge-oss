// Main facade (backward compatible)
export { VcsService, vcsService } from './VcsService.js';
export type { BranchInfo, CommitInfo, WorkingFileInfo } from './VcsService.js';

// Split services for direct access
export { vcsBranchService, VcsBranchService } from './VcsBranchService.js';
export { vcsFileService, VcsFileService } from './VcsFileService.js';
export { vcsCommitService, VcsCommitService } from './VcsCommitService.js';
export { vcsSyncService, VcsSyncService } from './VcsSyncService.js';

// File sync utilities
export { 
  syncFileCreate, 
  syncFileUpdate, 
  syncFileDelete, 
  getUserBranch 
} from './FileVcsSync.js';
