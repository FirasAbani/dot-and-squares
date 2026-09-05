# Application

## Recommended Project Structure

A general-purpose starting layout, suitable for most application projects and adaptable to your stack:

```
Application/
├── src/                  # Application source code
│   ├── components/       # Reusable UI components (if applicable)
│   ├── pages/            # Top-level views/routes
│   ├── services/         # API clients, external integrations
│   ├── models/           # Data models/types
│   ├── utils/            # Shared helper functions
│   └── index.*           # Application entry point
├── tests/                # Unit and integration tests
├── public/               # Static assets (if a web app)
├── docs/                 # Additional documentation
├── scripts/              # Build/deploy/dev tooling scripts
├── .env.example          # Sample environment variables
├── .gitignore
├── README.md
└── package.json          # Or equivalent manifest (requirements.txt, go.mod, etc.)
```

Notes:
- Keep `src/` organized by feature or by layer, whichever the team prefers, but stay consistent.
- Colocate tests next to source files (`Component.test.ts` beside `Component.ts`) or mirror the structure under `tests/` — pick one convention.
- Add a `.env.example` to document required environment variables without committing secrets.

