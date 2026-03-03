# Shared Components Guide

## LoadingState Components

Consistent loading indicators across the application.

### Basic Usage

```typescript
import { LoadingState, TableLoadingState, PageLoadingState } from '@/features/shared/components';

// Generic loading state
<LoadingState message="Loading..." size="md" />

// Table loading (most common)
<TableLoadingState message="Loading projects..." />

// Full page loading
<PageLoadingState message="Loading dashboard..." />

// Inline loading (no centering)
<InlineLoadingState message="Saving..." />

// Small loading for compact areas
<SmallLoadingState />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| message | string | "Loading..." | Loading message to display |
| size | 'sm' \| 'md' \| 'lg' | 'md' | Minimum height of loading container |
| inline | boolean | false | If true, no centering/padding applied |

### When to Use

- **TableLoadingState**: Loading data tables, lists
- **PageLoadingState**: Loading entire pages/views
- **InlineLoadingState**: Loading within buttons, inline elements
- **SmallLoadingState**: Compact areas, cards

---

## EmptyState Components

Professional empty state messages with actions.

### Basic Usage

```typescript
import { 
  EmptyState, 
  NoDataState, 
  NoResultsState, 
  ErrorState,
  NoMatchesState 
} from '@/features/shared/components';

// Generic empty state
<EmptyState
  icon={Folder}
  title="No files yet"
  description="Upload a file to get started"
  action={{
    label: 'Upload file',
    onClick: handleUpload,
    icon: Upload
  }}
/>

// No data (first time user)
<NoDataState 
  resource="project" 
  onCreate={() => navigate('/projects/new')} 
/>

// No search results
<NoResultsState onClear={() => setSearchTerm('')} />

// Error state
<ErrorState 
  message="Failed to load data" 
  onRetry={() => refetch()} 
/>

// No filter matches
<NoMatchesState 
  filterCount={3}
  onClear={() => clearFilters()} 
/>
```

### EmptyState Props

| Prop | Type | Description |
|------|------|-------------|
| icon | React.ComponentType | Icon to display (from @carbon/icons-react) |
| title | string | Main heading |
| description | string | Supporting text |
| action | object | Optional action button config |
| variant | 'default' \| 'search' \| 'filter' \| 'error' | Preset styling |

### Action Object

```typescript
{
  label: string;        // Button text
  onClick: () => void;  // Click handler
  icon?: ComponentType; // Optional icon (defaults to Add)
}
```

### Preset Components

#### NoDataState
For empty collections (first-time users)
```typescript
<NoDataState 
  resource="project"  // Singular noun
  onCreate={() => {}} // Optional create handler
/>
```

#### NoResultsState
For search with no results
```typescript
<NoResultsState 
  onClear={() => {}}  // Optional clear handler
/>
```

#### ErrorState
For error conditions
```typescript
<ErrorState 
  message="Custom error message"
  onRetry={() => {}}  // Optional retry handler
/>
```

#### NoMatchesState
For filters with no matches
```typescript
<NoMatchesState 
  filterCount={3}     // Number of active filters
  onClear={() => {}}  // Optional clear handler
/>
```

---

## Real-World Examples

### Example 1: Project List with All States

```typescript
function ProjectList() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects
  });

  if (isLoading) {
    return <TableLoadingState message="Loading projects..." />;
  }

  if (isError) {
    return <ErrorState message="Failed to load projects" onRetry={refetch} />;
  }

  if (data.length === 0) {
    return <NoDataState resource="project" onCreate={handleCreate} />;
  }

  return <ProjectTable data={data} />;
}
```

### Example 2: Search with Empty State

```typescript
function SearchResults({ query, results, onClearSearch }) {
  if (results.isLoading) {
    return <InlineLoadingState message="Searching..." />;
  }

  if (results.data.length === 0 && query) {
    return <NoResultsState onClear={onClearSearch} />;
  }

  if (results.data.length === 0) {
    return <NoDataState resource="item" />;
  }

  return <ResultsList data={results.data} />;
}
```

### Example 3: Custom Empty State

```typescript
<EmptyState
  icon={Rocket}
  title="Ready to launch?"
  description="Deploy your first process to get started"
  action={{
    label: 'Deploy process',
    onClick: handleDeploy,
    icon: Upload
  }}
/>
```

---

## Design Guidelines

### Loading States
- ✅ Use consistent loading messages
- ✅ Show loading for operations > 300ms
- ✅ Use appropriate size for context
- ❌ Don't show loading for instant operations
- ❌ Don't nest loading states

### Empty States
- ✅ Be helpful and actionable
- ✅ Explain why it's empty
- ✅ Provide next steps
- ✅ Use appropriate icons
- ❌ Don't be vague ("No data")
- ❌ Don't blame the user
- ❌ Don't use technical jargon

### Accessibility
- All components include proper ARIA labels
- Loading states announce to screen readers
- Empty state actions are keyboard accessible
- Color contrast meets WCAG AA standards

---

## Migration Guide

### Before
```typescript
{isLoading && <div>Loading...</div>}
{error && <div>Error!</div>}
{data.length === 0 && <div>No items</div>}
```

### After
```typescript
{isLoading && <TableLoadingState />}
{error && <ErrorState onRetry={refetch} />}
{data.length === 0 && <NoDataState resource="item" onCreate={handleCreate} />}
```

---

## Testing

```typescript
import { render, screen } from '@testing-library/react';
import { LoadingState, EmptyState } from './';

test('shows loading message', () => {
  render(<LoadingState message="Loading data..." />);
  expect(screen.getByText('Loading data...')).toBeInTheDocument();
});

test('calls action on button click', () => {
  const handleClick = jest.fn();
  render(
    <EmptyState
      title="No data"
      action={{ label: 'Create', onClick: handleClick }}
    />
  );
  fireEvent.click(screen.getByText('Create'));
  expect(handleClick).toHaveBeenCalled();
});
```
