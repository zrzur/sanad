# tools/

Sanad uses **yt-dlp** only as a silent backend to resolve full-length audio that matches Spotify catalog results. Users never paste YouTube links.

## Install

Download the binary for your OS from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) and place it here:

| OS | File name |
|----|-----------|
| Windows | `yt-dlp.exe` |
| Linux / macOS | `yt-dlp` (mark executable: `chmod +x tools/yt-dlp`) |

These binaries are **not** committed to git.

You also need **ffmpeg** on `PATH`, or rely on the `ffmpeg-static` npm package (already a dependency).
