# Release process

This project uses semantic versioning.

## Steps
1) Update `CHANGELOG.md` under "Unreleased".
2) Bump the version in `package.json`.
3) Run `npm run build`.
4) Publish to npm: `npm publish --access public`.
5) Tag the release: `git tag vX.Y.Z`.
6) Push the tag and create a GitHub Release with notes from the changelog.

## Policy
- Patch: fixes and internal improvements.
- Minor: backward-compatible features.
- Major: breaking changes with migration notes.
