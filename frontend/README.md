# Expense Manager — Frontend

Web dashboard for the [expense manager backend](../backend/README.md). Shows account balances, transaction history, and parsed expenses, and can trigger a Gmail sync.

Built with Vite, React 19, TypeScript, React Router 7, TanStack Query 5, and Tailwind CSS v4.

## Prerequisites

The backend must be running first — the UI has no data source of its own:

```bash
cd ../backend
npm install
npm run server      # http://localhost:3000
```

## Setup

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

No environment variables are needed. The API base URL is the fixed path `/api`, and the Vite dev server proxies `/api/*` to `http://localhost:3000`, stripping the `/api` prefix (see `vite.config.ts`). If your backend runs on a different port, change the proxy target there.

> For a production build, `/api` must be routed to the backend by whatever serves the static files — the Vite proxy is dev-only.

## Scripts

```bash
npm run dev        # start the dev server with HMR
npm run build      # type-check (tsc -b) and build to dist/
npm run lint       # eslint
npm run preview    # serve the production build locally
```

There is no test runner configured.

## Pages

| Route | Page | What it shows |
|-------|------|---------------|
| `/` | Dashboard | KPI cards (total assets, total owed, account count), month-to-date spend, category breakdown, recent expenses |
| `/expenses` | Expenses | Paged expense table with category and account-last4 filters |
| `/accounts` | Accounts | Account cards with balances; "Add account" modal |
| `/accounts/:id` | Account detail | Balance, transaction history, and actions: add funds, record a payment, backfill |

The **Sync** button in the sidebar calls `POST /sync`. A `409` response is surfaced as an info toast ("Sync already in progress") rather than an error.

## Structure

```
src/
├── main.tsx                 # QueryClient → BrowserRouter → ToastProvider → App
├── App.tsx                  # Route table
├── types.ts                 # API types — snake_case, mirroring the DB columns
├── lib/
│   ├── api.ts               # fetch wrapper over base "/api"; throws ApiError (carries .status)
│   └── format.ts            # INR currency/date formatting, account + txn type labels
├── hooks/                   # useAccounts, useExpenses, useSync — queries + cache invalidation
├── context/ToastContext.tsx # Toasts, auto-dismissed after 4s
├── components/              # Layout, AccountCard, Modal, Badge, Spinner, EmptyState, ErrorState, forms/
└── pages/                   # Dashboard, Expenses, Accounts, AccountDetail
```

### Data fetching

All server state goes through TanStack Query — no manual `useEffect` fetching. Defaults are set in `main.tsx` (`staleTime` 30s, one retry). Mutations invalidate the account, transaction, and expense caches they affect, so the UI refreshes itself after a sync, payment, or balance change.

### Styling

Tailwind v4 via the `@tailwindcss/vite` plugin. There is no `tailwind.config.js` — theme tokens are declared in an `@theme` block at the top of `src/index.css`.

## Notes

- Balance signs follow the backend's semantics: for credit cards a positive balance means you *owe* it; for savings/salary/debit accounts it's money you *have*. `isAssetAccount()` in `lib/format.ts` is what decides which reading applies.
- `GET /expenses` returns a bare array with no total count, so the Expenses pager can only tell that a full page *might* have more after it.
- The Dashboard computes month-to-date totals client-side from `GET /expenses?limit=200`; there is no aggregate endpoint, so months with more than 200 expenses would under-report.
- Amounts and dates are formatted for the `en-IN` locale and default to INR.
