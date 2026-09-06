# Getting started — from zero to a running company

Thirty minutes, no prior knowledge assumed. Every step below is also a
row in the **Setup** screen of each company, which turns green as you go.

## 1. Install and run (once per machine)

```bash
git clone https://github.com/nishgaba-ai/ai-alpha-hive && cd ai-alpha-hive
go build -o hive ./cmd/hive                # or download a release binary
cd runtime && npm install && npm run build && cd ..
cd platform/web && npm install && cd ../..
cp .env.example .env
hive company secret keygen                 # paste the output into .env as VAULT_KEY
```

Two processes run side by side:

```bash
hive company run --group companies --port 4700     # the worker: agents, gates, API
```

```bash
cd platform/web && npm run dev                      # the product: http://localhost:3000
```

`platform/web/.env.local` needs `HIVE_API_URL=http://localhost:4700` and a
first login (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, used once to seed the owner
account; change the password after the first sign-in).

## 2. Launch a company

**+ Launch a company** → pick a template → name, mission, models. Choose
*Demo (mock provider)* to see everything move with no API key; switch
models later in Settings. Each company is a directory under `companies/`
with a `company.yaml` you own and role prompts under `roles/`.

## 3. Add the humans

**ERP → People**: yourself and anyone who reviews (Surabhi), interns,
contractors. Salaries here drive payroll; a Telegram chat id here lets
that person approve from their phone.

## 4. Connect what the roles need

**Integrations** lists every plugin with what it needs and how to get it.
Two paths:

- **API key** (Postmark, Telegram, Postiz): paste the key, click **Run
  healthcheck**.
- **OAuth** (LinkedIn, Reddit, X, Slack, Meta, Google, GitHub for the
  blog): create the provider app once using the guide shown, register the
  **redirect URI** the screen gives you, paste client id and secret, click
  **Connect**, approve at the provider. The badge turns to *connected ·
  auto-refresh*.

The **Setup** screen tells you which integrations the company's roles
actually use and which are still missing, so you only connect what
matters.

### The website blog, specifically

Integrations → **Website blog (GitHub)**: Connect GitHub (or paste a
fine-grained token with *Contents: read/write* on the site repo), then
`BLOG_REPO = owner/name`, `BLOG_SITE_URL`. Posts become commits to
`content/blog/<slug>.md`; Vercel deploys them; `/blog` on the site renders
them. The full picture for blog, LinkedIn, Instagram and Postiz is in
[playbooks/publishing.md](playbooks/publishing.md).

## 5. Add a model key

`.env` → `ANTHROPIC_API_KEY` (or `OPENROUTER_API_KEY`, or run Ollama), then
change each role's `model:` in **Settings** and Apply. Restart the worker
after editing `.env`.

## 6. Give a mission and decide

Start with **Intake**: website, product, audience, goals, competitors,
channels. It is saved as an artifact every agent reads, and the executive
turns it into the first mission (brand brief, 90-day strategy, positioning,
SEO audit, GEO probe, first drafts). After that, **Overview → Give a
mission** (or `/mission` on Telegram, a voice note to the bot, or the Voice
screen). The executive plans; the team works; anything public, any
spend above the threshold, first contact, production deploys and hires
land in your **Inbox**. Approve or deny with a note.

## 7. Read the firm

**Firm** shows every role's responsibilities, tools, budget and gates,
the humans and their tasks, and the schedules: automations, quiet hours,
payroll and the monthly budget cycle. **Task tracker** holds agent and
human tasks together. **Treasury** and **ERP** hold the money.

## 8. Bring in the co-reviewer and interns

**Access → Invite someone**: email, organisation role (viewer by default)
and the company role (reviewer approves and starts missions; viewer only
reads). Send them the link; when they register with it they land in your
organisation with exactly that access. Owners see everything on every
company; a reviewer or viewer sees only the companies they were granted.

## 9. Move machines

```bash
hive company export --group companies
```

Copy the bundle and `VAULT_KEY` to the new machine, `hive company import
<bundle>`, clone workspaces again. Nothing else references a host.

## Where things are

| Need | Where |
|---|---|
| What a tool does and which gate it hits | [tools.md](tools.md) |
| Adding an integration, keys or OAuth | [integrations.md](integrations.md) |
| How money works | [treasury.md](treasury.md) |
| ERP and the CA statement | [erp.md](erp.md) |
| Voice and MCP | [voice.md](voice.md) |
| Publishing: blog, LinkedIn, Instagram, Postiz | [playbooks/publishing.md](playbooks/publishing.md) |
| Creators on commission | [playbooks/ugc-creators.md](playbooks/ugc-creators.md) |
