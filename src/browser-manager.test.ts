import * as fsSync from 'fs';
import { spawn } from 'child_process';
import { BrowserManager } from './browser-manager';
import * as utils from './utils';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() })),
}));

describe('BrowserManager.launch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.CHROME_PATH;
  });

  it('passes the dynamic port to browser launch arguments', async () => {
    const portSpy = jest.spyOn(utils, 'getFreePort').mockResolvedValue(44444);
    (fsSync.existsSync as jest.Mock).mockReturnValue(true);

    process.env.CHROME_PATH = 'C:\\fake\\chrome.exe';

    const manager = new BrowserManager('/fake/path', 9222, jest.fn());
    await manager.launch();

    expect(portSpy).toHaveBeenCalledWith(9222);
    expect(spawn).toHaveBeenCalledWith(
      'C:\\fake\\chrome.exe',
      expect.arrayContaining(['--remote-debugging-port=44444']),
      expect.objectContaining({ stdio: 'ignore', detached: true }),
    );

    portSpy.mockRestore();
  });
});

describe('BrowserManager.detectBrowser', () => {
  it.each([
    ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'Chrome', '--incognito'],
    ['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'Edge', '-inprivate'],
    [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'Brave',
      '--incognito',
    ],
    ['C:\\Users\\user\\AppData\\Local\\Programs\\Opera\\opera.exe', 'Opera', '--private'],
    [
      'C:\\Users\\user\\AppData\\Local\\Vivaldi\\Application\\vivaldi.exe',
      'Vivaldi',
      '--incognito',
    ],
    [
      'C:\\Users\\user\\AppData\\Local\\Chromium\\Application\\chrome.exe',
      'Chromium',
      '--incognito',
    ],
  ])('%s → %s (%s)', (exePath, expectedName, expectedFlag) => {
    const result = BrowserManager.detectBrowser(exePath);
    expect(result.name).toBe(expectedName);
    expect(result.privateFlag).toBe(expectedFlag);
  });
});
