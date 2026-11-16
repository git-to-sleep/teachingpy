# Intro Python class site (Cloudflare Pages + D1)

One-time setup (needs Node + a free Cloudflare account):

    npm i -g wrangler && wrangler login
    wrangler d1 create pyclass            # copy database_id into wrangler.toml
    wrangler d1 execute pyclass --remote --file=schema.sql
    wrangler pages deploy public --project-name pyclass

Then in the Cloudflare dashboard: Workers & Pages > pyclass > Settings > Bindings,
add a D1 binding named DB pointing at the pyclass database (wrangler.toml may also cover this).
Open the site and the first visit creates your teacher account.

Local test: wrangler d1 execute pyclass --local --file=schema.sql, then wrangler pages dev public
