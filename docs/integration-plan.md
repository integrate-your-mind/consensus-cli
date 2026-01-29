# Integration Plan (init-oss merge)

Purpose: preserve remote fixes while keeping local enhancements.

## Keep remote versions (overwrite local)
- src/claudeCli.ts
- src/opencodeState.ts
- src/scan.ts
- src/codexState.ts

## Keep local versions (do not overwrite)
- src/codexLogs.ts
- src/activity.ts
- src/cli.ts
- src/opencodeApi.ts
- src/opencodeEvents.ts
- src/opencodeServer.ts
- src/opencodeStorage.ts
- src/server.ts
- src/tail.ts
- src/types.ts
- src/pidusage.d.ts
- public/*
- src/activity/**
- src/core/**
- src/observability/**
- src/opencodeCmd.ts
- src/opencodeFilter.ts
- src/server/**

## Review for conflicts
- package.json
- package-lock.json
- tests/**

