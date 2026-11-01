QUICHE CT. — SITEMAP-BASED WEBSITE (VERSION 2)
================================================
This is an ACTUAL multi-page static website, not a mockup.

The center box of the original hand-drawn sitemap is index.html.
Each surrounding note or topic has its own independent .html page.
The main page shows 16 clickable topic cards grouped by theme.

LOCAL TEST
Unzip to a folder, then open index.html in your browser.

HOSTING ON DANBOURRETPHOTOS.COM (NODE/EXPRESS ON HOSTINGER)
Keep your existing website unchanged. Add this folder as a static subsite,
for example: /hidden-owls/

Option A — If your existing Express app is configured to serve a static public folder:
Put the CONTENTS of this package in public/hidden-owls/ (including index.html).
Visit https://danbourretphotos.com/hidden-owls/

Option B — If static routes are configured individually:
Add a static route in server.js BEFORE your final catch-all route:
  const path = require('path');
  app.use('/hidden-owls', express.static(path.join(__dirname, 'hidden-owls')));
Place the CONTENTS of this ZIP in the hidden-owls folder next to server.js.
Deploy and restart your Node app as usual.

IMPORTANT: The actual paths in your project might differ. Compare with how
sports pages are routed. Don't overwrite server.js or index.html at the root.

UNLISTED IS NOT SECURE
This website uses noindex/nofollow metadata and is not linked to your public
homepage. Anyone who knows the URL could still open it. A password is needed
if you want genuinely restricted access. No password protection is included.

ADDING MORE IMAGES
1. Copy images into assets/images/ and use .webp (or add JPG and use its exact name).
2. In the relevant .html page, duplicate a <figure> inside <div class="photo-grid">.
3. Change src, alt text and caption.

CONTENT PLACEHOLDERS
The neighborhood letter and poems were not supplied, so placeholders remain.
Audio player will work after adding assets/audio/original-soundtrack.mp3.
Images on the site are user-supplied examples and earlier generated owl illustrations.
Some supplied photos have credits or watermarks; confirm reuse permission for any
photos you did not take or license before sharing the page with visitors.

Potential family links to Australian companies are presented as unverified.
This version does not change anything on your live website.

VERSION 3: Click any photograph on any page to enlarge it. Use left/right arrows (or keyboard arrow keys) to move through photos on the current page. Escape or × closes the viewer. Gallery works on phones and desktop. Note: enlargement uses the original image files included in this site, not higher-resolution source files.
