import * as net from "net";
import { Humanizer, getFreePort } from "./utils";

// Tell Jest to intercept calls to the 'net' module
jest.mock("net");

// Описание группы тестов для класса Humanizer
describe("Humanizer Utilities", () => {
  // Тест 1: Проверка формата даты
  test("date() должен возвращать строку в правильном формате", () => {
    const dateStr = Humanizer.date();

    // Регулярное выражение для проверки формата data(YYYY.MM.DD HH.MM)
    const regex = /^data\(\d{4}\.\d{2}\.\d{2} \d{2}\.\d{2}\)$/;

    // Ожидаем, что результат соответствует регулярному выражению
    expect(dateStr).toMatch(regex);
  });

  // Тест 2: Проверка функции задержки (асинхронный тест)
  test("wait() должен задерживать выполнение на заданный промежуток времени", async () => {
    const start = Date.now();
    const minTime = 100;
    const maxTime = 200;

    // Вызов тестируемой функции
    await Humanizer.wait(minTime, maxTime);
    const duration = Date.now() - start;

    // Ожидаем, что задержка больше минимальной (с небольшим допуском на обработку Node.js)
    expect(duration).toBeGreaterThanOrEqual(minTime - 5);
    // Ожидаем, что задержка меньше или равна максимальной (+ допуск)
    expect(duration).toBeLessThanOrEqual(maxTime + 20);
  });
});

describe("Dynamic Port Allocation: getFreePort", () => {
  afterEach(() => {
    // Reset mocks to prevent state leakage between tests
    jest.clearAllMocks();
  });

  it("should resolve with a dynamically allocated port from the OS", async () => {
    // Mock a successful server creation and port assignment
    const mockServer = {
      listen: jest.fn((port: number, callback: () => void) => callback()),
      // Simulate the OS assigning port 51022
      address: jest.fn(() => ({ port: 51022 })),
      close: jest.fn((callback: () => void) => callback()),
      on: jest.fn(),
    };
    (net.createServer as jest.Mock).mockReturnValue(mockServer);

    const port = await getFreePort(9222);

    // Verify the OS-assigned port is returned
    expect(port).toBe(51022);
    // Verify it asked the OS for a random port by passing 0
    expect(mockServer.listen).toHaveBeenCalledWith(0, expect.any(Function));
    // Verify the server was immediately closed to free the port for Chromium
    expect(mockServer.close).toHaveBeenCalled();
  });

  it("should return the fallback port if a system error occurs", async () => {
    // Mock a system-level network error (e.g., strict firewall blocking Node)
    const mockServer = {
      listen: jest.fn(),
      on: jest.fn((event: string, callback: (err: Error) => void) => {
        if (event === "error") {
          callback(new Error("EACCES: permission denied"));
        }
      }),
    };
    (net.createServer as jest.Mock).mockReturnValue(mockServer);

    // Suppress console.error output during this specific test run to keep logs clean
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const port = await getFreePort(9222);

    // Verify it safely degrades to the fallback port
    expect(port).toBe(9222);

    consoleSpy.mockRestore();
  });
});
