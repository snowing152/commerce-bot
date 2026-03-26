module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Явно указываем, как обрабатывать файлы TypeScript
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json' // Принудительно используем наши настройки компилятора
    }],
  },
  // Указываем расширения файлов, которые Jest должен искать
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Игнорируем трансформацию для библиотек
  transformIgnorePatterns: ['/node_modules/'],
};