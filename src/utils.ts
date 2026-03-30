import { Page, Locator } from "patchright";
import * as net from "net";

/**
 * Requests a free port from the operating system and immediately releases it.
 * @param fallbackPort The port to return if the OS fails to allocate one.
 * @returns A promise that resolves to an available port number.
 */
export async function getFreePort(fallbackPort = 9222): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();

    // Catch system-level network errors to prevent application crashes
    server.on("error", (err) => {
      console.error(
        `[ERROR] Failed to allocate dynamic port: ${err.message}. Using fallback: ${fallbackPort}`,
      );
      resolve(fallbackPort);
    });

    // Listening on port 0 forces the OS to automatically assign an unused port
    server.listen(0, () => {
      const address = server.address();

      // Ensure the address is an AddressInfo object, not a string (Unix domain sockets)
      if (address && typeof address !== "string") {
        const port = address.port;
        // The server must be closed immediately so Chromium can bind to this port
        server.close(() => {
          resolve(port);
        });
      } else {
        // Fallback in the rare event the address object is malformed
        server.close(() => resolve(fallbackPort));
      }
    });
  });
}

/**
 * Humanizer simulates real user behavior by adding delays and imprecise moves.
 */
export class Humanizer {
  static async wait(min: number, max: number) {
    // Use Math.random() to add unpredictable pauses and reduce bot detection.
    await new Promise((r) =>
      setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)),
    );
  }

  static async move(page: Page, loc: Locator) {
    try {
      const b = await loc.boundingBox();
      if (b) {
        // Add random offset (-5 to +5 px) from the element center.
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
    console.log("  Reading product page...");
    for (let i = 0; i < 5; i++) {
      // Smooth scrolling simulates a person reading the page.
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
 * Checks whether the Chrome debug port is available.
 * Uses AbortController to avoid hanging network requests.
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
    // Small delay prevents 100% CPU usage.
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
