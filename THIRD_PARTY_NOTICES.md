# Third-Party Notices

CueWeave includes the following direct third-party assets or libraries in its distributed interface. JavaScript package metadata and transitive dependency licenses remain available through `package-lock.json` and the installed packages.

## Phosphor Icons

Copyright (c) 2020 Phosphor Icons

Source: https://github.com/phosphor-icons/react

License: MIT

Phosphor Icons are used as functional interface symbols. CueWeave's brand mark is an original project asset and is not derived from the icon library.

The full MIT license text is available in the upstream repository: https://github.com/phosphor-icons/react/blob/master/LICENSE

## FFmpeg and ffprobe

CueWeave Desktop distributes the FFmpeg and ffprobe 6.1.1 Windows x64 static executables built by Gyan Doshi. They are used for media inspection and bounded background conversion tasks.

License: GNU General Public License version 3 or later

Build source and configuration: https://www.gyan.dev/ffmpeg/builds/

Corresponding FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93

The complete license and build information are installed beside the executables in the desktop application's `resources/tools` directory. CueWeave invokes these programs as separate processes and does not modify them.

## MiSans

Copyright Xiaomi Technology Co., Ltd.

Source and license: https://hyperos.mi.com/font/download

CueWeave uses the official MiSans Regular and Semibold WOFF2 files for interface text and subtitle rendering. The font files are distributed only as part of the CueWeave software and are not offered as standalone downloads.

The official license agreement is bundled unchanged with the [extension font assets](apps/extension/public/fonts/MiSans-LICENSE.pdf) and [desktop font assets](apps/desktop/resources/public/fonts/MiSans-LICENSE.pdf). MiSans font files are not modified, converted, subsetted, or redeveloped.

## yt-dlp

CueWeave Desktop distributes the official yt-dlp Windows x64 executable for supported website metadata, streaming resolution, and download tasks.

Source: https://github.com/yt-dlp/yt-dlp

License: Unlicense; the bundled executable also contains components under additional licenses listed by yt-dlp.

The main license and yt-dlp's complete bundled third-party license list are installed in `resources/tools/licenses`.

## Deno

Copyright 2018–2026 the Deno authors

CueWeave Desktop distributes the official Deno Windows x64 executable as the JavaScript runtime required by the tested yt-dlp website paths.

Source: https://github.com/denoland/deno

License: MIT. The full license is installed in `resources/tools/licenses`.
