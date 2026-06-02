import { Page, Locator } from 'patchright';

type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'SKIP' | 'ACTION' | 'SUCCESS' | 'ERROR';
export type LogCallback = (level: LogLevel, message: string, context: string) => void;

export class Matcher {
  private readonly log: LogCallback;

  constructor(log: LogCallback) {
    this.log = log;
  }

  // Single source of truth for Coupang's product-detail anchor. Shared by
  // findCards (structural fallback), extractProductId, and the engine's click
  // target, so the selector can't silently diverge across call sites.
  static readonly PRODUCT_ANCHOR_SELECTOR = 'a[href*="/vp/products/"]';

  // Normalization rule sources shared with the in-page label normalizer in
  // engine.ts (which is serialized into the browser and can't import this module).
  // Any rule change must update these constants — engine.ts passes them as params
  // so both normalizers stay in sync without duplicating the regex strings.
  static readonly NORM_WHITESPACE_RE = '\\s+';
  static readonly NORM_SLASH_RE = '\\s*\\/\\s*';

  static normalizeName(s: string): string {
    // NFC-normalize so visually-identical Korean text (composed vs decomposed
    // Hangul) compares equal. Same NFC + whitespace + slash rules as the in-page
    // normalizer in engine.ts (see NORM_*_RE constants); name matching additionally
    // lowercases (the label normalizer does not, since it compares Korean labels exactly).
    return s
      .normalize('NFC')
      .toLowerCase()
      .replace(new RegExp(Matcher.NORM_WHITESPACE_RE, 'g'), ' ')
      .replace(new RegExp(Matcher.NORM_SLASH_RE, 'g'), '/')
      .trim();
  }

  // Coupang's product-detail URL is a backend contract: /vp/products/<productId>.
  // The numeric id is the strongest *stable identity* a card has — we don't match
  // on it (search is keyword-only), but the engine logs it (extracted from the
  // resolved click anchor) so same-named variants can be told apart in the logs.
  static extractProductId(href: string | null | undefined): string | null {
    if (!href) return null;
    // Match the id on the URL *path* only, so a "/vp/products/<id>" substring that
    // happens to sit in a query string (e.g. ?redirect=/vp/products/999 on a landed
    // URL) can't be mis-extracted. Resolve against a dummy base so relative hrefs
    // ("/vp/products/123?x=1") still parse.
    let path = href;
    try {
      path = new URL(href, 'https://www.coupang.com').pathname;
    } catch (_) {
      // Unparseable as a URL — fall back to anchoring the match at a path boundary.
    }
    const m = path.match(/\/vp\/products\/(\d+)(?:[/?#]|$)/);
    return m ? m[1] : null;
  }

  // Returns true only when both ids are known and differ, signalling an unexpected
  // server-side redirect between two distinct products after a card click. Used by
  // the engine's post-navigation WARN check; pure/static so it's unit-testable.
  static productIdMismatch(clickedId: string | null, navId: string | null): boolean {
    return !!clickedId && !!navId && clickedId !== navId;
  }

  async findCards(page: Page): Promise<{ loc: Locator | null; count: number }> {
    // The exact hashed class (e.g. `ProductUnit_productUnit__Qd6sv`) is a
    // CSS-module build artifact that changes on every Coupang frontend redeploy,
    // so we never depend on it. Tried in order:
    //  1. `li[class*="ProductUnit"]` — partial match survives hash churn (the
    //     CSS-module *root* name "ProductUnit" is stable); supersets the exact class.
    //  2/3. Legacy results-list containers — class-scoped to the real results grid.
    //  4. `li:has(<product anchor>)` — purely structural; the genuine last resort
    //     when every class-based selector fails. It is deliberately last because it
    //     is unscoped and can also catch non-result rails (related-keyword /
    //     recently-viewed lists are <li>s with product links too); downstream
    //     guards (isAdCard, empty-name skip, name match) then do the filtering.
    const selectors = [
      'li[class*="ProductUnit"]',
      'ul.ProductList li',
      '.search-product-list li',
      `li:has(${Matcher.PRODUCT_ANCHOR_SELECTOR})`,
    ];
    for (const sel of selectors) {
      const l = page.locator(sel);
      const c = await l.count().catch(() => 0);
      if (c > 0) {
        this.log('DEBUG', `Selector "${sel}" matched ${c} cards.`, 'findCards');
        return { loc: l, count: c };
      }
    }
    this.log('DEBUG', 'No cards found with known selectors.', 'findCards');
    return { loc: null, count: 0 };
  }

  async getName(card: Locator): Promise<string> {
    // Stable-first again: `[class*="productName"]` matches the current hashed
    // `...productNameV2...` class AND any future hash, so it leads. Legacy class
    // names follow. The img `alt` is the final fallback — Coupang sets the card
    // image's alt text to the full product title, so name survives even if every
    // text class is renamed.
    const textSelectors = ['[class*="productName"]', '.product-name', 'span.name', 'dt.title'];
    for (const sel of textSelectors) {
      try {
        const t = await card.locator(sel).first().innerText({ timeout: 800 });
        if (t?.trim()) return t.trim();
      } catch (_) {}
    }
    // Last resort: the product image's alt (≈ the product title). Resolve the
    // product-detail anchor with visible=true first — same resolution as the
    // engine's click path — then read the thumbnail alt within it. This ensures
    // the name we return belongs to the same anchor the engine will click, even
    // on a multi-anchor card (e.g. a recommendation rail caught by the structural
    // li:has(...) fallback selector). Avoids badge/coupon icon alts as a bonus.
    try {
      const alt = await card
        .locator(Matcher.PRODUCT_ANCHOR_SELECTOR)
        .locator('visible=true')
        .first()
        .locator('img[alt]')
        .first()
        .getAttribute('alt', { timeout: 800 });
      if (alt?.trim()) return alt.trim();
    } catch (_) {}
    return '';
  }

  async isAdCard(card: Locator): Promise<boolean> {
    try {
      const [enCount, koCount, ariaCount, classCount] = await Promise.all([
        card.locator('span:has-text("AD")').count(),
        card.locator('span:has-text("광고")').count(),
        card.locator('button[aria-label="Ad information"]').count(),
        card.locator('[class*="AdMark"]').count(),
      ]);
      return enCount > 0 || koCount > 0 || ariaCount > 0 || classCount > 0;
    } catch (_) {
      return false;
    }
  }
}
