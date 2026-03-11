# Contributing to OpenClaw App Monorepo

Thanks for helping improve OpenClaw App.

## Before You Start

- Search existing issues and pull requests before opening a new one
- Open an issue first for large behavior changes
- Keep pull requests focused on one problem

## Repository Structure

- Desktop app: `desktop`
- Mobile app: `mobile`
- Server app: `server`

## Development Setup (Desktop)

Requirements:

- Node.js 20+
- Rust toolchain

Install dependencies:

```bash
cd desktop
npm install
```

Run in development mode:

```bash
npm run dev
```

Build installers:

```bash
npm run dist
```

## Branch and Commit Guidelines

- Use clear branch names, e.g. `fix/kernel-detection`, `docs/readme-update`
- Use clear commit messages, e.g.:
  - `fix: detect bundled kernel before npm fallback`
  - `docs: improve setup wizard instructions`
  - `ci: reduce artifact upload size`

## Pull Request Checklist

- Explain what changed and why
- Link related issue(s)
- Include screenshots for UI changes
- Ensure CI passes
- Update docs when behavior changes

## Reporting Bugs

Please include:

- OS and version
- App version
- Steps to reproduce
- Expected behavior
- Actual behavior
- Logs (if available)

## Security Issues

Do not open public issues for security vulnerabilities.
Please follow [SECURITY.md](./SECURITY.md).
