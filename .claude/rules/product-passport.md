# Product Passport: always maintain the map

For every substantive feature addition/removal, regression fix, changed user journey, integration, state or persistence boundary, plugin/CLI/API contract or release-verification task:

1. Read executable code and tests before relying on documentation. Consult `docs/product-passport/README.md` for navigation, not authority.
2. Update affected product map entries in the **same PR** once ownership and behavior have been checked. For structural root causes, use Architecture Gardener; for behavior and real evidence, use Product Passport. Never restructure working architecture to satisfy stale documentation.
3. Distinguish documented, implemented, tested, runtime-verified, deployed and released. List skipped or blocked checks explicitly.
4. At completion say `map updated` with paths, `map unchanged` with a reason, or `map blocked` with missing evidence. Do not rewrite maps for trivial copy or formatting changes.

Keep sensitive data and evidence in this repository only. Never copy private project content into the public shared setup.
