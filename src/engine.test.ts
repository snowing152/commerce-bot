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
});
