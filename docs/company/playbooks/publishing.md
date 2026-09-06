# Playbook: connecting the website blog, LinkedIn, Instagram and the rest

How Prodigal AI publishes, end to end, the way Okara does it: content is
written by agents, approved by the board, and delivered through the
channel's own API. The blog is the anchor; social carries links to it.

## The shape

```
writer drafts (content.draft)  →  CMO requests publish  →  board approves (inbox / Telegram / voice)
        │                                                        │
        └── blog.publish  ──commit──▶  GitHub repo  ──push──▶  Vercel deploys  ──▶  /blog/<slug> live
                                                                  │
   social role: linkedin.post · instagram.post · postiz.schedule · x.post · reddit.reply  (each parks)
```

Every arrow on the right is a `publish` side effect: it parks for the
board with the exact text visible. Nothing goes out that you did not read.

## 1. The website blog (GitHub → Vercel)

Okara updates GitHub to post blogs; so do we. A post is a Markdown file
with front matter committed to the site repository; Vercel deploys on
push (or `hive ship` deploys from the workspace).

**One-time setup, in the Integrations screen → Website blog (GitHub):**

1. Connect GitHub with OAuth (scope `repo`) or paste a fine-grained
   personal access token with *Contents: read/write* on the site repo.
2. `BLOG_REPO = owner/name`, `BLOG_PATH = content/blog`, `BLOG_BRANCH = main`,
   `BLOG_SITE_URL = https://…`.
3. The site must render the folder. `platform/web` does: `/blog` lists
   `content/blog/*.md`, `/blog/<slug>` renders one, with title,
   description, date, tags and author from the front matter. Any Next.js
   site can copy `platform/web/app/(site)/blog/`.
4. Import the repo in Vercel once so every commit deploys.

**Then, every post:** the writer drafts with `content.draft`; the CMO (or
SEO lead) calls `blog.publish` with title, description, body, tags; it
parks; you approve; the commit lands with the message "Publish: <title>
· approved by the board"; Vercel builds; the post is live at
`/blog/<slug>`. `blog.unpublish` deletes it the same way.

## 2. LinkedIn

- Connect with OAuth (Integrations → LinkedIn), scopes `openid profile
  w_member_social`. For the company page you also need the Community
  Management API product and an organisation URN.
- Store `LINKEDIN_AUTHOR_URN`. The social role posts with
  `linkedin.post` (text plus the blog link), parks, you approve.
- Analytics for organisation posts come back through `linkedin.analytics`.

## 3. Instagram

- The account must be **Professional** and linked to a Facebook Page.
- Connect with the Meta login (Integrations → Instagram); scopes
  `instagram_basic instagram_content_publish pages_show_list`.
- Posts need a public image or video URL. The writer puts the image in
  the site repo (`public/blog/<slug>.jpg`) with the post, so the URL is
  `${BLOG_SITE_URL}/blog/<slug>.jpg`; the social role then calls
  `instagram.post` with that URL and a caption. Parks; you approve.

## 4. Everything at once: Postiz

If you would rather connect channels once and schedule from one place,
connect them inside Postiz (it does each network's OAuth: LinkedIn, X,
Instagram, TikTok, YouTube, Threads, Bluesky) and give the company only
`POSTIZ_API_KEY`. `postiz.channels` lists the channel ids;
`postiz.schedule` posts now or at a time. Same gate: parks for you.

Use direct integrations when you want analytics and replies (LinkedIn,
Reddit, X); use Postiz for scheduling breadth.

## 5. Who does what in Prodigal AI

| Step | Role | Tool | Gate |
|---|---|---|---|
| Brief and keywords | SEO specialist | `search-console.query`, `content.draft` | — |
| Draft the post | writer | `content.draft` | — |
| Publish to the site | CMO or SEO lead | `blog.publish` | publish (you) |
| Announce | social | `linkedin.post`, `instagram.post`, `postiz.schedule`, `x.post` | publish (you) |
| Conversations | social | `reddit.reply`, `x.post` (reply) | send / publish (you) |
| Measure | analyst | `ga4.report`, `search-console.query`, `linkedin.analytics`, `instagram.media` | — |

Automate the rhythm in `company.yaml`:

```yaml
automations:
  - id: weekly-post
    every: 1w
    at: "09:00"
    mission: "Publish one blog post on the pillar topic with the weakest coverage, then announce it on LinkedIn and Instagram"
  - id: daily-conversations
    every: 1d
    at: "10:00"
    mission: "Find five conversations on Reddit and X where the product is the honest answer and draft replies for approval"
```

## 6. What to set now, in order

1. Integrations → Website blog: Connect GitHub, set `BLOG_REPO` to the
   Prodigal AI site repo, `BLOG_SITE_URL`.
2. Integrations → LinkedIn: Connect, store `LINKEDIN_AUTHOR_URN`.
3. Integrations → Instagram: Connect with the Page that owns the account.
4. Optional: Postiz key for scheduling breadth.
5. Settings: the cmo template already grants `blog.*` to the CMO and SEO
   lead, `instagram.*` and `postiz.*` to the social role. Apply.
6. Give the mission; approve the first post from your inbox or Telegram.
