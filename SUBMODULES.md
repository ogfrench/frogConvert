# Submodules

Third-party code vendored into `src/handlers/` via git submodules. Each entry below records the pinned commit SHA and the upstream URL so a contributor can audit the exact bytes shipping with the bundle.

| Path | Upstream | Pinned commit | Last reviewed |
|------|----------|---------------|---------------|
| `src/handlers/envelope` | https://github.com/p2r3/envelope | `2d8bc87d948ccfc391e86724bb0a5d7b1689d5c6` | 2026-05-13 |
| `src/handlers/espeakng.js` | https://github.com/TheZipCreator/espeakng.js | `d889d8b9cb07af4e3edb23e41a88adc1c9918414` | 2026-05-13 |
| `src/handlers/gimper` | https://github.com/ConnorTippets/gimper | `fe96bd9e8efa33cbb8b23f134207ecf3e6dfecbd` | 2026-05-13 |
| `src/handlers/image-to-txt` | https://git.sr.ht/~thezipcreator/image-to-txt | `477f5dcd3a699119f471ffeb334bb77795bc3bdd` | 2026-05-13 |
| `src/handlers/qoa-fu` | https://github.com/pfusik/qoa-fu | `521424aec645666d49cac7935b9d2f03354d92e6` | 2026-05-13 |
| `src/handlers/qoi-fu` | https://github.com/pfusik/qoi-fu | `d4e5af8d3f3bed953f68dfc9c569690823888140` | 2026-05-13 |
| `src/handlers/rpgmvp-decrypter` | https://github.com/ConnorTippets/RPG-Maker-MV-Decrypter | `82ccd8c4e1efcd051ab55ad618c320777c77b350` | 2026-05-13 |
| `src/handlers/sppd` | https://github.com/p2r3/sppd | `a9d61795b5b3f2c6d06eda09ea3b31bf239e0498` | 2026-05-13 |
| `src/handlers/terraria-wld-parser` | https://github.com/ConnorTippets/terraria-world-file-ts | `e0400bfd5ab855e63185f94f892485faff3249d4` | 2026-05-13 |

## Verifying

```sh
git submodule status
```

The hash in column 1 should match the "Pinned commit" column above. If a submodule shows `+<sha>` the working tree is ahead of the pinned commit; revert with `git submodule update` or update this table after reviewing the upstream diff.

## When updating a submodule

1. `cd src/handlers/<name>` and `git fetch && git log <old>..<new>` to review the upstream diff.
2. Skim every upstream change for: new network calls, `eval`/`Function`, dynamic `import`, child process spawning, file-system writes outside the handler's own scope.
3. Commit the gitlink bump in the parent repo with a message that names both SHAs and the review outcome.
4. Update "Pinned commit" and "Last reviewed" rows here.
