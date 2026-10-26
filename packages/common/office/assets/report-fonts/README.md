# Report font

Noto Sans CJK SC Regular, version 2.004. Copyright Adobe and Google; distributed under the SIL Open Font License 1.1 in `LICENSE.txt`. The unmodified OpenType font includes simplified and traditional Chinese glyphs.

Source: https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/SimplifiedChinese

Vendored file SHA-256: `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`.

Runtime exports use this vendored content without a network request. PDF embeds the complete CFF OpenType font with the correct OpenType stream subtype. This avoids a CFF subsetting interoperability issue in the bundled font library. Offline ZIP includes the font and license. Editable PPTX declares Noto Sans CJK SC and reports a compatibility notice when a viewer may substitute a locally installed CJK font.

## Emoji fallback

`NotoEmoji-Variable.ttf` is the unmodified monochrome Noto Emoji font from
[Google Fonts](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoemoji).
The original copyright and SIL Open Font License 1.1 are retained in
`NotoEmoji-LICENSE.txt`; the source revision is recorded in `NotoEmoji-source.json`.
SHA-256: `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`.
DOCX PDF exports embed this fallback locally for supported emoji code points.
This does not claim color emoji, full grapheme shaping, or universal Unicode coverage.
