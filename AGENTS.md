# AGENTS.md - ValWars Development Guidelines

## Misi & Overview
ValWars adalah game multiplayer top-down 3D web bertema perang yang self-hosted dan dapat berjalan langsung di Termux (Node.js). Game dirancang agar terasa seperti aplikasi Android native tanpa build step, tanpa dependency native, dan tanpa CDN eksternal.

## Aturan Wajib (Tidak Boleh Dilanggar)
1. **Runtime & Dependency**: Pure Node.js. Hanya package pure-JS (misal `ws`). Dilarang keras menggunakan bcrypt, sharp, canvas, sqlite3, atau native module/binding lainnya.
2. **Distribution & Commits**: Seluruh `node_modules`, `package.json`, dan `package-lock.json` di-commit ke repository. User dapat langsung menjalankan `bash start.sh` tanpa `npm install`.
3. **Vendored Three.js**: Three.js disimpan lokal di `public/vendor/three.module.js`. Penggunaan CDN eksternal dilarang.
4. **Tanpa Build Step**: Tidak ada Webpack/Vite/Rollup. ES modules diimpor langsung oleh browser.
5. **Native Feel**: Root element (`html`, `body`) tidak boleh scroll. Hanya container tertentu dengan `.scrollable` yang boleh scroll.
6. **Orientasi Screen**: Menu portrait, game landscape. Menggunakan `screen.orientation.lock()` best-effort dengan overlay "Putar perangkat" jika gagal/diperlukan.
7. **Zoom & Gestures**: Nonaktifkan pinch zoom, double-tap zoom, text selection, tap highlight, context menu (`contextmenu` event), dan overscroll bounce.
8. **Viewport**: 100dvh dengan CSS `env(safe-area-inset-*)`.
9. **Tema Design**: Terang, modern, minimalis. Palet warna netral dengan satu warna aksen. Tanpa gradient ramai dan shadow berlebihan.
10. **Modularitas**: Terbagi per domain (`auth`, `room`, `match`, `scene`, `controls`, `hud`, `net`).
11. **Lokasi Script**: `start.sh` di root direktori proyek, menggunakan `cd "$(dirname "$0")"`. Dilarang menyentuh `$PREFIX`, `$HOME`, atau path luar proyek.
12. **Cache-Control & Client Assets**: Module dan asset statis publik di-cache dengan `Cache-Control: public, max-age=31536000, immutable` untuk `/vendor/*` agar transfer cepat (< 1MB) tanpa Service Worker.

## Cara Menjalankan di Termux
```bash
pkg install nodejs
bash start.sh
```

## Cara Expose via Tunnel (Contoh cloudflared / Tailscale)
```bash
cloudflared tunnel --url http://localhost:3000
```

## Checklist QA Mobile
- [ ] No-scroll pada root (hanya element `.scrollable` yang scroll)
- [ ] No-zoom (pinch zoom & double tap zoom mati)
- [ ] Safe-area-inset diterapkan pada UI overlay
- [ ] Orientasi: menu portrait, game landscape + overlay rotasi
- [ ] Reconnect WS otomatis dengan exponential backoff
- [ ] Flow Register & Login berfungsi atomik
- [ ] Room join via kode 4 digit & pilihan mode (1v1, 2v2, 3v3, 4v4, FFA) & map (Arena, Kota, Gurun)
- [ ] `data/*.tmp` diabaikan oleh `.gitignore`, namun `users.json` dan `sessions.json` tersimpan dengan baik.
