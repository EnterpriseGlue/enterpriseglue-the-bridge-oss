# Error Handling Guide

## Using AppError in Routes

```typescript
import { Errors, asyncHandler } from '../middleware/errorHandler.js';

// Example route with error handling
router.get('/projects/:id', asyncHandler(async (req, res) => {
  const project = await getProject(req.params.id);
  
  if (!project) {
    throw Errors.notFound('Project', req.params.id);
  }
  
  res.json(project);
}));

// Example with validation error
router.post('/projects', asyncHandler(async (req, res) => {
  const { name } = req.body;
  
  if (!name || name.trim().length === 0) {
    throw Errors.validation('Project name is required');
  }
  
  const project = await createProject(name);
  res.status(201).json(project);
}));

// Example with conflict error
router.put('/files/:id', asyncHandler(async (req, res) => {
  const { xml, prevUpdatedAt } = req.body;
  const file = await getFile(req.params.id);
  
  if (file.updatedAt !== prevUpdatedAt) {
    throw Errors.conflict('File was modified by another user', {
      currentUpdatedAt: file.updatedAt,
      providedUpdatedAt: prevUpdatedAt,
    });
  }
  
  const updated = await updateFile(req.params.id, xml);
  res.json(updated);
}));
```

## Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Project with id '123' not found"
  }
}
```

With details:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "File was modified by another user",
    "details": {
      "currentUpdatedAt": 1698765432,
      "providedUpdatedAt": 1698765400
    }
  }
}
```

## Available Error Codes

- `BAD_REQUEST` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` (409)
- `VALIDATION_ERROR` (400)
- `INTERNAL_ERROR` (500)
- `SERVICE_UNAVAILABLE` (503)
- `CAMUNDA_ERROR` (502)
