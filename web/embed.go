package web

import "embed"

//go:embed index.html css/* js/*.js js/i18n/*.js icons/* manifest.webmanifest sw.js
var Assets embed.FS
