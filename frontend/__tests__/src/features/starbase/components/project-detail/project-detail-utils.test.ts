import { describe, it, expect } from 'vitest';
import {
  composeProjectRoles,
  getProjectAccessSelection,
  getProjectRoleDescription,
  roleLabel,
  tagTypeForRole,
  isValidEmail,
  getFileIcon,
  COLLABORATORS_PANEL_WIDTH,
  memberHeaders,
  editableRoleOptions,
  projectBaseAccessOptions,
  tableHeaders,
  type ProjectRole,
} from '../../../../../../../packages/frontend-host/src/features/starbase/components/project-detail/project-detail-utils';

describe('project-detail-utils', () => {
  describe('constants', () => {
    it('exports COLLABORATORS_PANEL_WIDTH', () => {
      expect(COLLABORATORS_PANEL_WIDTH).toBe(420);
    });

    it('exports memberHeaders', () => {
      expect(memberHeaders).toEqual([
        { key: 'name', header: 'Name' },
        { key: 'roles', header: 'Roles' },
        { key: 'actions', header: '' },
      ]);
    });

    it('exports editableRoleOptions', () => {
      expect(editableRoleOptions).toEqual(['delegate', 'developer', 'editor', 'viewer']);
      expect(editableRoleOptions).not.toContain('owner');
    });

    it('exports projectBaseAccessOptions', () => {
      expect(projectBaseAccessOptions.map((option) => option.id)).toEqual(['viewer', 'editor', 'developer']);
    });

    it('exports tableHeaders', () => {
      expect(tableHeaders).toEqual([
        { key: 'name', header: 'Name' },
        { key: 'updatedByDisplay', header: 'Updated by' },
        { key: 'updated', header: 'Last changed' },
        { key: 'actions', header: '' },
      ]);
    });
  });

  describe('roleLabel', () => {
    it('capitalizes owner role', () => {
      expect(roleLabel('owner')).toBe('Owner');
    });

    it('capitalizes delegate role', () => {
      expect(roleLabel('delegate')).toBe('Delegate');
    });

    it('capitalizes developer role', () => {
      expect(roleLabel('developer')).toBe('Developer');
    });

    it('capitalizes editor role', () => {
      expect(roleLabel('editor')).toBe('Editor');
    });

    it('capitalizes viewer role', () => {
      expect(roleLabel('viewer')).toBe('Viewer');
    });
  });

  describe('getProjectRoleDescription', () => {
    it('describes delegate access clearly', () => {
      expect(getProjectRoleDescription('delegate')).toContain('manage members');
    });

    it('describes viewer access clearly', () => {
      expect(getProjectRoleDescription('viewer')).toContain('view project files');
    });
  });

  describe('project access helpers', () => {
    it('derives developer base access with delegate toggle', () => {
      expect(getProjectAccessSelection(['delegate', 'developer'])).toEqual({
        baseRole: 'developer',
        hasDelegateAccess: true,
      });
    });

    it('falls back to viewer base access when no elevated edit role is present', () => {
      expect(getProjectAccessSelection(['viewer'])).toEqual({
        baseRole: 'viewer',
        hasDelegateAccess: false,
      });
    });

    it('composes delegate access on top of the selected base role', () => {
      expect(composeProjectRoles('editor', true)).toEqual(['delegate', 'editor']);
    });

    it('composes a single base role when delegate access is disabled', () => {
      expect(composeProjectRoles('developer', false)).toEqual(['developer']);
    });
  });

  describe('tagTypeForRole', () => {
    it('returns red for owner', () => {
      expect(tagTypeForRole('owner')).toBe('red');
    });

    it('returns magenta for delegate', () => {
      expect(tagTypeForRole('delegate')).toBe('magenta');
    });

    it('returns blue for developer', () => {
      expect(tagTypeForRole('developer')).toBe('blue');
    });

    it('returns teal for editor', () => {
      expect(tagTypeForRole('editor')).toBe('teal');
    });

    it('returns gray for viewer', () => {
      expect(tagTypeForRole('viewer')).toBe('gray');
    });

    it('returns gray for unknown role as default', () => {
      expect(tagTypeForRole('unknown' as ProjectRole)).toBe('gray');
    });
  });

  describe('isValidEmail', () => {
    it('validates correct email addresses', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('test.user@example.com')).toBe(true);
      expect(isValidEmail('user+tag@example.co.uk')).toBe(true);
      expect(isValidEmail('user_name@example.org')).toBe(true);
    });

    it('rejects invalid email addresses', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('user@example')).toBe(false);
      expect(isValidEmail('user example@test.com')).toBe(false);
    });

    it('handles empty string', () => {
      expect(isValidEmail('')).toBe(false);
    });

    it('trims whitespace before validation', () => {
      expect(isValidEmail('  user@example.com  ')).toBe(true);
      expect(isValidEmail('  invalid  ')).toBe(false);
    });

    it('handles emails with multiple dots', () => {
      expect(isValidEmail('user@sub.domain.example.com')).toBe(true);
    });

    it('rejects emails with spaces', () => {
      expect(isValidEmail('user name@example.com')).toBe(false);
      expect(isValidEmail('user@exam ple.com')).toBe(false);
    });

    it('rejects emails without domain extension', () => {
      expect(isValidEmail('user@localhost')).toBe(false);
    });

    it('handles special characters in local part', () => {
      expect(isValidEmail('user+filter@example.com')).toBe(true);
      expect(isValidEmail('user.name@example.com')).toBe(true);
      expect(isValidEmail('user_name@example.com')).toBe(true);
    });
  });

  describe('getFileIcon', () => {
    it('returns Folder icon for folder type', () => {
      const icon = getFileIcon('folder');
      expect(icon).toBeDefined();
      expect(icon).not.toBeNull();
    });

    it('returns DecisionTree icon for bpmn type', () => {
      const icon = getFileIcon('bpmn');
      expect(icon).toBeDefined();
      expect(icon).not.toBeNull();
    });

    it('returns TableSplit icon for dmn type', () => {
      const icon = getFileIcon('dmn');
      expect(icon).toBeDefined();
      expect(icon).not.toBeNull();
    });

    it('returns null for form type', () => {
      const icon = getFileIcon('form');
      expect(icon).toBeNull();
    });

    it('returns null for unknown type', () => {
      const icon = getFileIcon('unknown' as any);
      expect(icon).toBeNull();
    });
  });
});
