# Getting it live

## A. Upload it by hand (works right now, ~2 minutes)

`solvix-tender-pages-upload.zip` unzips to **ten files and no folders**. That is
deliberate: GitHub's web uploader silently drops folders, so the whole site is
flat.

1. Unzip it.
2. Open **https://github.com/GODRIC423/solvix-tender-desk**
3. **Add file → Upload files**, then select all ten files and drop them in.
   Overwrite when it asks — four of them are already up there from last time.
4. Commit to `main`.
5. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**

The ten files:

```
index.html            the desk
demo.html             the TRUXCO walkthrough
manifest.webmanifest  makes it installable as an app
sw.js                 offline cache + update prompt
version.json          build id
icon-192.png  icon-512.png  apple-touch-icon.png  favicon.ico  favicon-32.png
```

Then:

- https://godric423.github.io/solvix-tender-desk/ — the desk, passcode `solvix204`
- https://godric423.github.io/solvix-tender-desk/demo.html — the walkthrough, public

## B. Authorize the repo so I can push (ends the uploading for good)

The git proxy in this session only injects credentials for repositories in the
session's authorized set, so my push is refused:

```
access denied by the git proxy: GODRIC423/solvix-tender-desk is not in this
session's authorized repository set … add the repository to the session's sources.
```

Add that repo as a source for this session in the Claude app, wherever your
GitHub connection lists which repositories Claude may touch. After that,
`./deploy.sh` rebuilds and pushes on its own, and the site switches to the
self-hosted build — pdf.js and Tesseract served from your own domain, no CDN,
fully offline.

Do **A** now to get it working. **B** whenever you have a minute.
