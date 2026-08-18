# kabir5296.github.io

Personal academic website for A F M Mahfuzul Kabir.

## Local preview

This site is dependency-free. From the repository root, run:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

The site uses a persistent sidebar on tablets, laptops, and desktops. On phones,
the profile and page links move into a compact navigation drawer. Page sections
use hash routes such as `/#research` and `/#projects`. Background, Projects, and
Awards & Achievements also support section routes such as
`/#background/education`, `/#projects/personal-projects`, and
`/#awards/presentations`.

## Structure

- `index.html` — site shell and page content
- `assets/css/styles.css` — shared visual system, typography, and content styles
- `assets/css/palette-green-backup.css` — archived original green palette (not loaded)
- `assets/css/site.css` — persistent-sidebar and responsive page layout
- `assets/js/site.js` — page routing/loading, mobile navigation, interactive visuals, theme preference, and year
- `assets/images/favicon-green-backup.svg` — archived original green favicon (not loaded)
- `assets/images/profile.jpg` — local original portrait source (ignored by Git)
- `assets/images/profile-display.jpg` — resized, metadata-free web portrait
- `assets/images/IMG_1402.jpg` — landscape image used in the sidebar
- `assets/images/logos/` — education and employer logos
- `assets/images/projects/` — local project screenshots and photographs
- `assets/images/awards/` — local competition certificates, award photographs, and presentation media

Research, Resume, ECA, and Photo Blog remain lightweight placeholders until
their page content is built.
