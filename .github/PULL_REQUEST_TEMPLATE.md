## Summary

Describe the change and why it’s needed.

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Docs
- [ ] Refactor

## How to test

Provide steps to validate the change.

- [ ] Backend (if applicable): `cd backend && pnpm run dev`
- [ ] Frontend (if applicable): `cd frontend && pnpm run dev`
- [ ] Typecheck: `cd backend && npx tsc --noEmit`
- [ ] Frontend build: `cd frontend && pnpm run build`

## Release impact

- Release-note fragment: `.release-notes/<change-id>.json`
- Expected application bump: patch / minor / major / none
- Compatibility: backward-compatible / deprecated / breaking
- Required operator action: none, or summarize and link the fragment
- Release-note exemption (internal-only changes):

`Release-note exemption: <reason>`

## Checklist

- [ ] I have kept the PR focused and scoped
- [ ] PR title follows release format (for example: `feat(scope): summary`, `fix(scope): summary`)
- [ ] I have added/updated tests where appropriate
- [ ] I have updated documentation where appropriate
- [ ] I have added a release label (`release:feature`, `release:fix`, `release:breaking`, etc.)
- [ ] I added and previewed a structured release-note fragment, or documented an allowed `release-note:none` exemption
- [ ] If this is breaking, I added compatibility + migration notes in this PR
- [ ] I confirmed release impact (patch/minor/major) for this change
- [ ] I have included screenshots for UI changes (if applicable)
- [ ] I have not included secrets in code or logs

## Related issues

Link to issues/discussions (optional).
