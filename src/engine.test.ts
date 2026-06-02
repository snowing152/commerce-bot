import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AutomationEngine } from './engine';
import { Matcher } from './matcher';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

describe('AutomationEngine integration tests', () => {
  let tempUserDataPath: string;
  let engine: AutomationEngine;

  const mockConfig = {
    settings: { base_url: 'https://mock-coupang.com' },
    tasks: [{ keyword: 'test', target_name: 'test product' }],
  };

  const mockSelectors = {
    search_bar: '.mock-search-input',
    add_to_cart_btn: '.mock-btn',
  };

  beforeAll(async () => {
    tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-test-'));
    await fs.writeFile(path.join(tempUserDataPath, 'config.json'), JSON.stringify(mockConfig));
    await fs.writeFile(
      path.join(tempUserDataPath, 'selectors.json'),
      JSON.stringify(mockSelectors),
    );
  });

  afterAll(async () => {
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  });

  test('loadConfigs() should read and parse JSON files from userDataPath', async () => {
    engine = new AutomationEngine(tempUserDataPath);
    await (engine as any).loadConfigs();

    expect((engine as any).config).toEqual(mockConfig);
    expect((engine as any).selectors).toEqual(mockSelectors);
    expect((engine as any).config.tasks[0].keyword).toBe('test');
  });
});

describe('AutomationEngine Error Handling', () => {
  it('should capture rejected promises, log the context, and return the fallback value', async () => {
    const engine = new AutomationEngine('/fake/user/data/path');

    const logSpy = jest.spyOn(engine as any, 'log').mockImplementation(() => {});

    const failingAction = Promise.reject(new Error('Playwright Timeout Exceeded'));

    const result = await (engine as any).safeExecute(failingAction, 'testing DOM click', false);

    expect(result).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed during: testing DOM click. Reason: Playwright Timeout Exceeded',
      ),
    );

    logSpy.mockRestore();
  });
});

// firstVisible must:
//   1. compose `scope.locator(selector).locator('visible=true').first()`
//      so the Playwright `visible=true` engine skips hidden duplicates.
//   2. resolve with the locator only after waitFor({ state: 'visible' }) succeeds.
//   3. return null (never throw) on timeout, so call-sites can pick a fallback.
describe('AutomationEngine.firstVisible', () => {
  const buildScopeMock = (waitForImpl: () => Promise<void>) => {
    const candidate = { waitFor: jest.fn(waitForImpl) };
    const visibleLocator = { first: jest.fn(() => candidate) };
    const rootLocator = { locator: jest.fn(() => visibleLocator) };
    const scope = { locator: jest.fn(() => rootLocator) };
    return { scope, rootLocator, visibleLocator, candidate };
  };

  it('returns the candidate locator when waitFor resolves', async () => {
    const engine = new AutomationEngine('/fake');
    const { scope, rootLocator, candidate } = buildScopeMock(() => Promise.resolve());

    const result = await (engine as any).firstVisible(scope, '.x', 1000);

    expect(scope.locator).toHaveBeenCalledWith('.x');
    expect(rootLocator.locator).toHaveBeenCalledWith('visible=true');
    expect(candidate.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 1000 });
    expect(result).toBe(candidate);
  });

  it('returns null when waitFor rejects (timeout / no visible match)', async () => {
    const engine = new AutomationEngine('/fake');
    const { scope } = buildScopeMock(() => Promise.reject(new Error('Timeout 1000ms exceeded')));

    const result = await (engine as any).firstVisible(scope, '.missing', 1000);

    expect(result).toBeNull();
  });

  it('uses the default 5000ms timeout when none is supplied', async () => {
    const engine = new AutomationEngine('/fake');
    const { scope, candidate } = buildScopeMock(() => Promise.resolve());

    await (engine as any).firstVisible(scope, '.x');

    expect(candidate.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 5000 });
  });
});

// Regression: full target_name matching must not truncate to the first N words.
// Before the fix, all three Korean product variants below shared a 4-word prefix
// and matched the same search card even when the card was a different variant.
describe('Matcher.normalizeName product matching', () => {
  it('matches a card whose name contains the full target name', () => {
    const target = '그린홈 2 in 1 멀티 물걸레 청소포 대형';
    const cardName = '  그린홈  2 in 1 멀티 물걸레  청소포 대형  '; // DOM whitespace
    expect(Matcher.normalizeName(cardName).includes(Matcher.normalizeName(target))).toBe(true);
  });

  it('does NOT match a card that only shares a 4-word prefix with the target', () => {
    const target = '그린홈 2 in 1 멀티 물걸레 청소포 대형';
    const otherCard = '그린홈 2 in 1 스팀 청소기 별도 판매'; // same 4-word prefix, different product
    expect(Matcher.normalizeName(otherCard).includes(Matcher.normalizeName(target))).toBe(false);
  });

  it('is case-insensitive for ASCII portions of product names', () => {
    const target = 'Samsung 2 in 1 Laptop';
    const cardName = 'SAMSUNG 2 IN 1 LAPTOP Pro Edition';
    expect(Matcher.normalizeName(cardName).includes(Matcher.normalizeName(target))).toBe(true);
  });

  // Regression: a target entered as decomposed Hangul (NFD) must still match a
  // card rendered as composed Hangul (NFC). The two are visually identical but
  // differ in code points, so a raw .includes() silently fails.
  it('matches across NFC/NFD Unicode normalization of Korean text', () => {
    const name = '그린홈 2 in 1 꼬리잡기 & 움직이는 나비 자동 고양이 낚시대 장난감'; // DOM (NFC)
    const target = name.normalize('NFD'); // target_name entered as decomposed Hangul

    // Sanity check: the raw strings really are different code points...
    expect(name).not.toBe(target);
    // ...but normalizeName brings them back together.
    expect(Matcher.normalizeName(name).includes(Matcher.normalizeName(target))).toBe(true);
  });

  it('ignores whitespace around slashes in product names', () => {
    const target = '강아지 사료 1kg / 대용량';
    const cardName = '강아지 사료 1kg/대용량 특가';
    expect(Matcher.normalizeName(cardName).includes(Matcher.normalizeName(target))).toBe(true);
  });
});

describe('Matcher.extractProductId (stable card identity)', () => {
  it('extracts the productId from a full Coupang product href', () => {
    const href =
      'https://www.coupang.com/vp/products/9311863111?itemId=27592969896&vendorItemId=94556494020&q=foo';
    expect(Matcher.extractProductId(href)).toBe('9311863111');
  });

  it('extracts the productId from a relative href', () => {
    expect(Matcher.extractProductId('/vp/products/123456?itemId=1')).toBe('123456');
  });

  it('returns null for non-product hrefs and empty input', () => {
    expect(Matcher.extractProductId('https://www.coupang.com/np/search?q=foo')).toBeNull();
    expect(Matcher.extractProductId(null)).toBeNull();
    expect(Matcher.extractProductId(undefined)).toBeNull();
    expect(Matcher.extractProductId('')).toBeNull();
  });

  it('returns null when the product path has no numeric id', () => {
    // The anchor selector (href*="/vp/products/") matches these, but there is no
    // id to extract — getProductId must degrade to null rather than throw/mislog.
    expect(Matcher.extractProductId('/vp/products/?q=x')).toBeNull();
    expect(Matcher.extractProductId('https://www.coupang.com/vp/products/foo')).toBeNull();
  });

  it('does not extract an id from a /vp/products/ substring in the query string', () => {
    // Guards the post-navigation check: a landed URL whose path is NOT a product
    // page must not yield an id just because a redirect param echoes the pattern.
    expect(
      Matcher.extractProductId('https://www.coupang.com/np/search?q=foo&redirect=/vp/products/999'),
    ).toBeNull();
  });

  it('returns null for protocol-relative hrefs (//vp/products/<id>)', () => {
    // new URL('//vp/products/123', base) treats "vp" as the host, so pathname
    // becomes "/products/123" and the regex finds no match. Coupang uses absolute
    // or root-relative hrefs in practice, so this is an accepted trade-off for a
    // logging-only field.
    expect(Matcher.extractProductId('//vp/products/123')).toBeNull();
  });

  it('handles genuinely unparseable URLs via the raw-string fallback', () => {
    // When new URL() throws, the regex runs on the raw string. It correctly finds
    // product paths; it cannot distinguish a path segment from a query value when
    // the URL is malformed (that's an acceptable trade-off for a logging-only field).
    expect(Matcher.extractProductId('http://[invalid/vp/products/42?x=1')).toBe('42');
    // A malformed URL with the pattern in a query value also resolves — documented
    // here so the behavior is explicit rather than silently surprising.
    expect(Matcher.extractProductId('http://[invalid?x=/vp/products/99')).toBe('99');
  });
});

describe('Matcher.productIdMismatch (redirect detection)', () => {
  it('returns true when both ids are present and differ', () => {
    expect(Matcher.productIdMismatch('123', '456')).toBe(true);
  });

  it('returns false when ids match (normal click, no redirect)', () => {
    expect(Matcher.productIdMismatch('123', '123')).toBe(false);
  });

  it('returns false when clicked id is null (anchor had no id — no reliable baseline)', () => {
    expect(Matcher.productIdMismatch(null, '456')).toBe(false);
  });

  it('returns false when nav id is null (landed on a non-product page)', () => {
    expect(Matcher.productIdMismatch('123', null)).toBe(false);
  });
});

describe('Matcher.PRODUCT_ANCHOR_SELECTOR (shared anchor contract)', () => {
  // The engine's click site and matcher.getProductId both consume this constant.
  // Guard the contract so a typo can't silently break anchor resolution: if it
  // stopped matching real hrefs, the engine would find no product-detail link and
  // skip every matched card (a miss).
  it('targets the product-detail link and matches hrefs extractProductId understands', () => {
    expect(Matcher.PRODUCT_ANCHOR_SELECTOR).toBe('a[href*="/vp/products/"]');

    // The substring the selector keys on must be present in any href that
    // extractProductId can parse — i.e. the click target and the id source agree.
    const href = '/vp/products/9311863111?itemId=1';
    const needle = Matcher.PRODUCT_ANCHOR_SELECTOR.match(/href\*="([^"]+)"/)?.[1];
    expect(needle).toBe('/vp/products/');
    expect(href.includes(needle!)).toBe(true);
    expect(Matcher.extractProductId(href)).toBe('9311863111');
  });
});
