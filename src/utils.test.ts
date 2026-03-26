import { Humanizer } from "./utils";

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
