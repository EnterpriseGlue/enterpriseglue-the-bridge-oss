# Standardized Modal System

This directory contains the standardized modal system for the Voyager application. All modals use Carbon Design System components and follow consistent patterns.

## Components

### 1. AlertModal
Simple alert/notification modal with OK button.

**Usage:**
```tsx
import { AlertModal, useAlert } from '@/components/modals'

function MyComponent() {
  const { alertState, showAlert, closeAlert } = useAlert()
  
  return (
    <>
      <button onClick={() => showAlert('Operation successful!', 'info')}>
        Show Alert
      </button>
      
      <AlertModal
        open={alertState.open}
        onClose={closeAlert}
        message={alertState.message}
        title={alertState.title}
        kind={alertState.kind}
      />
    </>
  )
}
```

**Props:**
- `open: boolean` - Whether modal is open
- `onClose: () => void` - Close handler
- `message: string` - Alert message
- `title?: string` - Optional title (auto-generated based on kind if not provided)
- `kind?: 'error' | 'warning' | 'info'` - Alert type (default: 'info')

---

### 2. ConfirmModal
Confirmation dialog with Cancel and Confirm buttons.

**Usage:**
```tsx
import { ConfirmModal, useModal } from '@/components/modals'

function MyComponent() {
  const { isOpen, openModal, closeModal } = useModal()
  
  const handleDelete = async () => {
    await deleteUser()
    closeModal()
  }
  
  return (
    <>
      <button onClick={() => openModal()}>Delete User</button>
      
      <ConfirmModal
        open={isOpen}
        onClose={closeModal}
        onConfirm={handleDelete}
        title="Delete User"
        description="Are you sure you want to delete this user?"
        confirmText="Delete"
        danger
        showWarning
      />
    </>
  )
}
```

**Props:**
- `open: boolean` - Whether modal is open
- `onClose: () => void` - Close handler
- `onConfirm: () => void | Promise<void>` - Confirm handler
- `title: string` - Modal title
- `description: string` - Description text
- `confirmText?: string` - Confirm button text (default: 'Confirm')
- `cancelText?: string` - Cancel button text (default: 'Cancel')
- `danger?: boolean` - Show as danger modal (red)
- `warning?: boolean` - Show as warning modal (yellow)
- `busy?: boolean` - Show loading state
- `showWarning?: boolean` - Show warning notification
- `warningMessage?: string` - Custom warning message

---

### 3. FormModal
Modal for forms with inputs.

**Usage:**
```tsx
import { FormModal, useModal } from '@/components/modals'
import { TextInput, Select, SelectItem } from '@carbon/react'

function MyComponent() {
  const { isOpen, openModal, closeModal } = useModal()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('user')
  const [loading, setLoading] = useState(false)
  
  const handleSubmit = async () => {
    setLoading(true)
    await createUser({ email, role })
    setLoading(false)
    closeModal()
  }
  
  return (
    <>
      <button onClick={() => openModal()}>Create User</button>
      
      <FormModal
        open={isOpen}
        onClose={closeModal}
        onSubmit={handleSubmit}
        title="Create New User"
        submitText="Create"
        submitDisabled={!email}
        busy={loading}
      >
        <TextInput
          id="email"
          labelText="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Select
          id="role"
          labelText="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <SelectItem value="user" text="User" />
          <SelectItem value="admin" text="Admin" />
        </Select>
      </FormModal>
    </>
  )
}
```

**Props:**
- `open: boolean` - Whether modal is open
- `onClose: () => void` - Close handler
- `onSubmit: () => void | Promise<void>` - Submit handler
- `title: string` - Modal title
- `submitText?: string` - Submit button text (default: 'Submit')
- `cancelText?: string` - Cancel button text (default: 'Cancel')
- `busy?: boolean` - Show loading state
- `submitDisabled?: boolean` - Disable submit button
- `children: ReactNode` - Form content
- `size?: 'xs' | 'sm' | 'md' | 'lg'` - Modal size (default: 'sm')
- `danger?: boolean` - Show as danger modal

---

## Hooks

### useModal
Manages modal open/close state with optional data.

```tsx
const { isOpen, data, openModal, closeModal } = useModal<UserData>()

// Open with data
openModal({ userId: 123, name: 'John' })

// Access data
console.log(data?.userId) // 123
```

### useAlert
Manages alert modal state.

```tsx
const { alertState, showAlert, closeAlert } = useAlert()

// Show different types of alerts
showAlert('Success!', 'info')
showAlert('Warning!', 'warning')
showAlert('Error occurred', 'error')
```

---

## Design Principles

1. **Consistency**: All modals use the same Carbon Design System `Modal` component
2. **Standardized Spacing**: Use `var(--spacing-5)` for content gaps
3. **Loading States**: Show "Processing..." text when `busy` is true
4. **Accessibility**: All modals are keyboard accessible and screen reader friendly
5. **Size Standards**: 
   - `xs`: Extra small (320px)
   - `sm`: Small (480px) - Default for most modals
   - `md`: Medium (640px)
   - `lg`: Large (768px)

---

## Migration Guide

### From ComposedModal to Standard Modal

**Before:**
```tsx
<ComposedModal open onClose={onClose}>
  <ModalHeader title="Create Project" closeModal={onClose} />
  <ModalBody>
    <TextInput ... />
  </ModalBody>
  <ModalFooter>
    <Button kind="secondary" onClick={onClose}>Cancel</Button>
    <Button kind="primary" onClick={onSubmit}>Create</Button>
  </ModalFooter>
</ComposedModal>
```

**After:**
```tsx
<FormModal
  open={isOpen}
  onClose={onClose}
  onSubmit={onSubmit}
  title="Create Project"
  submitText="Create"
>
  <TextInput ... />
</FormModal>
```

### From alert() to AlertModal

**Before:**
```tsx
alert('User created successfully')
```

**After:**
```tsx
const { showAlert } = useAlert()
showAlert('User created successfully', 'info')
```

---

## Best Practices

1. **Always use hooks**: Use `useModal` and `useAlert` for state management
2. **Consistent button text**: 
   - Use "Create" not "Add" for creation
   - Use "Delete" not "Remove" for deletion
   - Use "Save" not "Update" for updates
3. **Loading states**: Always show loading state during async operations
4. **Validation**: Disable submit button when form is invalid
5. **Danger modals**: Use `danger` prop for destructive actions
6. **Warning notifications**: Show warnings for irreversible actions
