import { Page, Locator } from "patchright";

/**
 * Класс Humanizer симулирует поведение реального пользователя,
 * добавляя случайные задержки и неточные движения мыши.
 */
export class Humanizer {
  static async wait(min: number, max: number) {
    // Использование Math.random() для создания непредсказуемых пауз, чтобы избежать детектирования ботов
    await new Promise((r) =>
      setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)),
    );
  }

  static async move(page: Page, loc: Locator) {
    try {
      const b = await loc.boundingBox();
      if (b) {
        // Добавление случайного смещения координат (-5 до +5 пикселей) от центра элемента
        const targetX = b.x + b.width / 2 + (Math.random() * 10 - 5);
        const targetY = b.y + b.height / 2 + (Math.random() * 10 - 5);
        await page.mouse.move(targetX, targetY, { steps: 12 });
        await this.wait(150, 400);
      }
    } catch (_) {}
  }

  static async randomMove(page: Page) {
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(
        Math.floor(Math.random() * 1000 + 100),
        Math.floor(Math.random() * 500 + 100),
        { steps: 8 },
      );
      await this.wait(150, 400);
    }
  }

  static async simulateReading(page: Page) {
    console.log("  Читаю страницу товара...");
    for (let i = 0; i < 5; i++) {
      // Плавный скроллинг имитирует чтение страницы человеком
      await page.evaluate(() =>
        window.scrollBy({ top: 350, behavior: "smooth" }),
      );
      await this.wait(1500, 3000);
      try {
        const btn = page
          .locator("button.expand, .product-detail-seemore-icon-wpui")
          .first();
        if (await btn.isVisible({ timeout: 800 })) {
          await btn.click();
          await this.wait(2000, 3000);
          break;
        }
      } catch (_) {}
    }
    await page.evaluate(() =>
      window.scrollBy({ top: 800, behavior: "smooth" }),
    );
    await this.wait(3000, 5000);
  }

  static date(): string {
    const n = new Date(),
      f = (x: number) => String(x).padStart(2, "0");
    return `data(${n.getFullYear()}.${f(n.getMonth() + 1)}.${f(n.getDate())} ${f(n.getHours())}.${f(n.getMinutes())})`;
  }
}

/**
 * Проверка доступности порта отладки Chrome.
 * Используется AbortController для предотвращения утечек памяти при зависании сетевых запросов.
 */
export async function isCDPReady(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function waitForCDP(port: number, ms = 10000): Promise<boolean> {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await isCDPReady(port)) return true;
    // Задержка в цикле предотвращает 100% загрузку CPU
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
