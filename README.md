# F3Go30

Google Apps Script automation for managing monthly Go30 fitness challenge trackers in Google Sheets.

---

## Getting Started

### Prerequisites

- Google account that owns the Go30 tracker spreadsheet
- [clasp](https://github.com/google/clasp) installed: `npm install -g @google/clasp`
- `TINYURL_ACCESS_TOKEN` Script Property configured (see [OPERATIONS.md](docs/OPERATIONS.md))

### Deploy

```bash
cd script
clasp push
```

Open the spreadsheet with the owner account — the **F3 Go30** custom menu should appear.

See [OPERATIONS.md](docs/OPERATIONS.md) for full configuration and failure mode reference.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [CONTEXT.md](docs/CONTEXT.md) | Purpose, capabilities, use cases, glossary |
| [DESIGN.md](docs/DESIGN.md) | Architecture, modules, data model, runtime risks |
| [OPERATIONS.md](docs/OPERATIONS.md) | Configuration, deployment, failure modes |
| [ADRs](adr/) | Architecture decision records |
