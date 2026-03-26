import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AutomationEngine } from './engine';

describe('Интеграционные тесты AutomationEngine', () => {
    let tempUserDataPath: string;
    let engine: AutomationEngine;

    // Фейковые данные для проверки
    const mockConfig = {
        settings: { base_url: "https://mock-coupang.com" },
        tasks: [
            { keyword: "тест", target_name: "тестовый товар", filters: ["rocket"], cost: [] }
        ]
    };

    const mockSelectors = {
        search_bar: ".mock-search-input",
        add_to_cart_btn: ".mock-btn"
    };

    // beforeAll запускается один раз ПЕРЕД всеми тестами в этом блоке
    beforeAll(async () => {
        // Создаем уникальную временную папку в системной директории Temp ОС
        tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-test-'));
        
        // Записываем наши фейковые настройки в эту временную папку
        await fs.writeFile(path.join(tempUserDataPath, 'config.json'), JSON.stringify(mockConfig));
        await fs.writeFile(path.join(tempUserDataPath, 'selectors.json'), JSON.stringify(mockSelectors));
    });

    // afterAll запускается ПОСЛЕ выполнения всех тестов для очистки мусора
    afterAll(async () => {
        // Удаляем временную папку вместе со всеми файлами внутри (recursive: true)
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    });

    test('loadConfigs() должен корректно читать и парсить JSON файлы из userDataPath', async () => {
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