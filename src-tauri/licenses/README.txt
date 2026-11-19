Third-party software in inkd
============================

DirectML.dll
  Microsoft DirectX Machine Learning 1.15.4, x64. The unmodified file from
  Microsoft's Microsoft.AI.DirectML NuGet package. Closed source, under the
  Microsoft Software License Terms in DirectML-LICENSE.txt, which allow it to
  be distributed in applications for Windows (section 1a). Its own notices are
  in DirectML-ThirdPartyNotices.txt.

TexTeller handwriting model
  Not included in the installer. On first run inkd downloads it from
  https://huggingface.co/OleehyO/TexTeller (revision
  7b96df06b9d81cdb129c3bef68b7250bc3e2b0ea), under the Apache License 2.0
  in TexTeller-LICENSE.txt.

Everything else built into inkd.exe and its interface is under permissive
licences (MIT, Apache-2.0, BSD, ISC, Zlib, CDLA-Permissive-2.0), including
Tauri, ONNX Runtime and ort, tokenizers, ureq and rustls, perfect-freehand,
mathjs and KaTeX.
