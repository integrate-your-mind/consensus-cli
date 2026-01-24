---
name: Bug report
description: Report a reproducible problem
labels: [bug]
body:
  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
      description: Include commands and inputs.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Logs or screenshots
      description: Paste relevant output.
