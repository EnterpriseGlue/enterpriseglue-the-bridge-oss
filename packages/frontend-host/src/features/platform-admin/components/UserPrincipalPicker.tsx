import React from 'react';
import { InlineLoading } from '@carbon/react';
import type { UserSearchResult } from '../../../api/platform-admin';
import UserLookupEmailField from '../../../shared/components/UserLookupEmailField';
import { useUserSearch } from '../hooks/useAdminApi';

export interface UserPrincipalPickerProps {
  id: string;
  labelText?: string;
  value: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  invalidText?: string;
}

function displayValue(user: UserSearchResult | null): string {
  return user?.email || '';
}

/**
 * Human-readable platform-user selector for authorization workflows.
 *
 * The selected value remains the immutable user id used by the API, while the
 * administrator searches and confirms a recognizable email/name. Raw ids are
 * deliberately not accepted through this control.
 */
export function UserPrincipalPicker({
  id,
  labelText = 'User',
  value,
  onChange,
  disabled,
  invalid,
  invalidText,
}: UserPrincipalPickerProps) {
  const [query, setQuery] = React.useState('');
  const [selectedUser, setSelectedUser] = React.useState<UserSearchResult | null>(null);
  const usersQ = useUserSearch(query.trim());

  React.useEffect(() => {
    if (!value && selectedUser) {
      setSelectedUser(null);
      setQuery('');
    }
  }, [selectedUser, value]);

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
      <UserLookupEmailField
        id={id}
        labelText={labelText}
        placeholder="Search existing users by email"
        value={displayValue(selectedUser) || query}
        searchValue={query}
        suggestionItems={Array.isArray(usersQ.data) ? usersQ.data : []}
        selectedItem={selectedUser}
        disabled={disabled}
        invalid={invalid}
        invalidText={invalidText}
        onChange={(next) => {
          setQuery(next);
          if (selectedUser && next.trim().toLowerCase() !== selectedUser.email.toLowerCase()) {
            setSelectedUser(null);
            onChange('');
          }
        }}
        onSelect={(user) => {
          setSelectedUser(user);
          setQuery(user.email);
          onChange(user.id);
        }}
      />
      {usersQ.isFetching && <InlineLoading description="Searching users" />}
      {!selectedUser && query.trim().length > 0 && query.trim().length < 2 && (
        <span style={{ color: 'var(--cds-text-helper)', fontSize: '0.75rem' }}>
          Enter at least two characters to search.
        </span>
      )}
    </div>
  );
}
