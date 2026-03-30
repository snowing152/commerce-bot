import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import * as fsSync from "fs";
import { spawn } from "child_process";
import { AutomationEngine } from "./engine";
import * as utils from "./utils";

// Mock the 'fs' module globally for this test file
jest.mock("fs", () => ({
  // Retain all actual 'fs' functions so we don't break other internals
  ...jest.requireActual("fs"),
  // Replace only existsSync with a Jest mock function
  existsSync: jest.fn(),
}));

jest.mock("child_process", () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() })),
}));

describe("Интеграционные тесты AutomationEngine", () => {
  let tempUserDataPath: string;
  let engine: AutomationEngine;

  // Фейковые данные для проверки
  const mockConfig = {
    settings: { base_url: "https://mock-coupang.com" },
    tasks: [
      {
        keyword: "тест",
        target_name: "тестовый товар",
        filters: ["rocket"],
        cost: [],
      },
    ],
  };

  const mockSelectors = {
    search_bar: ".mock-search-input",
    add_to_cart_btn: ".mock-btn",
  };

  // beforeAll запускается один раз ПЕРЕД всеми тестами в этом блоке
  beforeAll(async () => {
    // Создаем уникальную временную папку в системной директории Temp ОС
    tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "bot-test-"));

    // Записываем наши фейковые настройки в эту временную папку
    await fs.writeFile(
      path.join(tempUserDataPath, "config.json"),
      JSON.stringify(mockConfig),
    );
    await fs.writeFile(
      path.join(tempUserDataPath, "selectors.json"),
      JSON.stringify(mockSelectors),
    );
  });

  // afterAll запускается ПОСЛЕ выполнения всех тестов для очистки мусора
  afterAll(async () => {
    // Удаляем временную папку вместе со всеми файлами внутри (recursive: true)
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  });

  test("loadConfigs() должен корректно читать и парсить JSON файлы из userDataPath", async () => {
    // Инициализируем движок, передавая путь к нашей временной папке
    engine = new AutomationEngine(tempUserDataPath);

    // Так как loadConfigs() - это приватный метод (private), TypeScript запрещает вызывать его напрямую.
    // Использование (engine as any) позволяет обойти это ограничение исключительно для целей тестирования,
    // не меняя архитектуру самого класса и не делая метод публичным.
    await (engine as any).loadConfigs();

    // Проверяем, что данные из файлов успешно загрузились в свойства класса
    expect((engine as any).config).toEqual(mockConfig);
    expect((engine as any).selectors).toEqual(mockSelectors);

    // Точечная проверка конкретного поля
    expect((engine as any).config.tasks[0].keyword).toBe("тест");
  });
});

describe("AutomationEngine Error Handling", () => {
  it("should capture rejected promises, log the context, and return the fallback value", async () => {
    // 1. Initialize the engine with a dummy path
    const engine = new AutomationEngine("/fake/user/data/path");

    // 2. Create a mock function to intercept the internal logging mechanism
    const logSpy = jest
      .spyOn(engine as any, "log")
      .mockImplementation(() => {});

    // 3. Create a promise that simulates a Playwright timeout or detached DOM node
    const failingAction = Promise.reject(
      new Error("Playwright Timeout Exceeded"),
    );

    // 4. Call safeExecute. We cast to 'any' to test the private method directly.
    // In strict TDD, you would test a public method that calls safeExecute,
    // but testing the utility directly ensures the wrapper logic is sound.
    const result = await (engine as any).safeExecute(
      failingAction,
      "testing DOM click",
      false, // The expected fallback value
    );

    // 5. Verify the fallback value was returned safely to prevent application crashes
    expect(result).toBe(false);

    // 6. Verify the exact error string was generated and passed to the logger
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[ERROR] Failed during: testing DOM click. Reason: Playwright Timeout Exceeded",
      ),
    );

    // Clean up the spy to prevent memory leaks in the test runner
    logSpy.mockRestore();
  });
});

describe("AutomationEngine Launch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.CHROME_PATH;
  });

  it("should pass the dynamic port to browser launch arguments", async () => {
    // Force the helper to return a specific port for this test
    const portSpy = jest.spyOn(utils, "getFreePort").mockResolvedValue(44444);
    (fsSync.existsSync as jest.Mock).mockReturnValue(true);

    process.env.CHROME_PATH = "C:\\fake\\chrome.exe";

    const engine = new AutomationEngine("/fake/path");
    await (engine as any).launchBrowser();

    expect(portSpy).toHaveBeenCalledWith(9222);
    expect(spawn).toHaveBeenCalledWith(
      "C:\\fake\\chrome.exe",
      expect.arrayContaining(["--remote-debugging-port=44444"]),
      expect.objectContaining({ stdio: "ignore", detached: true }),
    );

    portSpy.mockRestore();
  });
});
