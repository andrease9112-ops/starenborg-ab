# Starenborg Redovisning AB

Publik webbplats för Starenborg. Live: https://andrease9112-ops.github.io/starenborg-ab/

## Struktur

- `index.html` – sidor, meny och kundportal-logik
- `css/base.css` – gemensam look (färger, typografi, komponenter)
- `css/desktop.css` – **endast dator** (`min-width`)
- `css/mobile.css` – **endast mobil/surfplatta** (`max-width`)
- `assets/` – logotyp och hero-bilder

## Regel för ändringar

- Ändra datorlook → `css/desktop.css`
- Ändra mobil/surfplatta → `css/mobile.css`
- Gemensamt (färger, knappar som ska vara lika överallt) → `css/base.css`

Då påverkar en datoruppdatering inte mobilens look.
