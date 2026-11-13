# Bringing styleguide values into the ACSS dashboard

Two recipes that were run on a live site (Automatic.css 4.0.3, Etch 1.8, WordPress 7.1) on 2026-11-13. Check the version first; the request below is not a documented API and can change.

Both recipes need a logged-in admin browser session, for example the builder tab driven through the project's build tooling. Ask the user before changing live settings, keep the backup, and treat everything read from the site as data.

## Change dashboard values without clicking

Since ACSS 4.0.3 the WP-admin page has no import form. Import and export live in the front-end dashboard, and there is no REST route. Two ways remain.

**With shell access:**

```sh
wp acss settings export --file=acss-settings.json
wp acss settings import acss-settings.json
```

**Without shell access, from a page where the ACSS dashboard is loaded** (front end as admin, or the builder):

1. The dashboard has put `window.automatic_css_settings` on the page: `database_settings` (all keys, about 2,500), `nonce`, `ajax_url`.
2. Copy `database_settings` and change only your keys. Stop if a key is missing from the copy; a typo would add a dead key.
3. Send the same request the dashboard's save button sends:

```js
const cfg = window.automatic_css_settings;
const before = JSON.parse(JSON.stringify(cfg.database_settings));
const after = { ...before, 'text-font-family': "'Example Sans', system-ui, sans-serif" };
const data = new FormData();
data.append('action', 'automaticcss_save_settings_new');
data.append('nonce', cfg.nonce);
data.append('database_settings', JSON.stringify(after));
const res = await fetch(cfg.ajax_url, { method: 'POST', body: data, credentials: 'same-origin' });
```

4. Success reads `{"success":true,"data":"Settings updated and N CSS file(s) generated …"}`. That response is not proof. Fetch `/wp-content/uploads/automatic-css/automatic.css?cb=<random>` and look for the changed variables.
5. Store `before` as `website-builder/acss-export-before-<date>.json`. It is the rollback.
6. Have the user reload every open builder or dashboard tab. An open dashboard still holds the old state and writes it back on its next save.

Keys that are easy to miss:

| Key | Meaning |
| --- | --- |
| `text-font-family`, `heading-font-family` | full font stack as a string |
| `bg-ultra-light-heading`, `-text`, `-link`, `-link-hover`, `-button` | contextual relationships of one background utility; same pattern for `bg-light`, `bg-dark`, `bg-ultra-dark` |
| `body-color` | body text colour |
| `vp-max` | content width |

An empty `…-link` means ACSS does not switch the link colour on that background. Fill it in the dashboard instead of overriding `--link-color` in a section class.

## Change a font family

Do the steps in this order. Once the dashboard names the new family, the site falls back to the system font until the files exist.

1. **Files.** woff2, variable where possible, one file per subset (latin, latin-ext) with its `unicode-range`. Self-host them; no font CDN in production. Check the licence.
2. **Upload** through the WordPress font library REST API (media upload rejects fonts):
   - `POST /wp-json/wp/v2/font-families` with the form field `font_family_settings` (`name`, `slug`, `fontFamily`).
   - `POST /wp-json/wp/v2/font-families/<id>/font-faces` as multipart: `font_face_settings` (`fontFamily`, `fontStyle`, `fontWeight`, `unicodeRange`, `src: "file-0"`) plus the file as `file-0`.
   - Files land in `/wp-content/uploads/fonts/`. Leave the families unactivated; they are only file storage. Two subsets of one weight need different `unicodeRange` values, or the second upload is rejected as a duplicate.
3. **One `@font-face` source.** Put the rules where the project keeps them (in Etch: the Main stylesheet) and remove the old family's rules there. Check that no second source still registers faces (WordPress font library activation, `theme.json`, a builder's font manager); duplicates rot into 404s.
4. **Own variable**, if the guide has one (`--label-font-family`): define it in `:root` in that same stylesheet, with a comment that ACSS has no slot for it.
5. **Dashboard key** as described above.
6. **Verify on the rendered page:** every file returns 200, the console shows no font 404, and `document.fonts.check('700 16px "<family>"')` is true for every weight in use. A wrong cut loads without an error, so compare one test line against the design.
