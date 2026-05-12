export type Language = 'en' | 'ru'

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
]

type Dict = Record<string, string>

const en: Dict = {
  // Common
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.back': 'Back to dashboard',
  'common.esc': 'Esc',
  'common.toCancel': 'to cancel',
  'common.tryAgain': 'Try again',
  'common.continue': 'Continue',

  // Auth page
  'auth.signInTitle': 'Sign in to continue',
  'auth.signInSubtitle': 'Coupang Bot uses Telegram for secure, password-free login.',
  'auth.continueWithTelegram': 'Continue with Telegram',
  'auth.waiting': 'Waiting…',
  'auth.terms': 'By signing in you agree to the Terms of Use.',
  'auth.status.idle.label': 'Ready',
  'auth.status.idle.hint': 'Tap below to open Telegram and authorize this device.',
  'auth.status.waiting.label': 'Waiting for confirmation',
  'auth.status.waiting.hint': 'Open Telegram and tap “Confirm login” in the chat.',
  'auth.status.confirmed.label': 'Confirmed',
  'auth.status.confirmed.hint': 'Redirecting to your dashboard…',
  'auth.status.error.label': 'Authorization failed',
  'auth.status.error.hint': "We didn't hear back. Check Telegram and try again.",

  // Subscription page
  'sub.section': 'Account',
  'sub.title': 'Subscription',
  'sub.subtitle': 'Manage your plan and renewals via Telegram.',
  'sub.plan': '{plan} Plan',
  'sub.billed': '{price} · billed monthly',
  'sub.status': 'Status',
  'sub.active': 'Active',
  'sub.expired': 'Expired',
  'sub.renewsOn': 'Renews on',
  'sub.expiredOn': 'Expired on',
  'sub.daysRemaining': 'Days remaining',
  'sub.daysSinceExpiry': 'Days since expiry',
  'sub.days': '{n} days',
  'sub.concurrent': 'Concurrent tasks',
  'sub.renewalCopy': "Renewal is handled in our Telegram billing bot. You'll get a confirmation here when it completes.",
  'sub.extend': 'Extend via Telegram',
  'sub.help': 'Need help? Contact @coupangbot_support',
  'sub.loading': 'Loading subscription…',
  'sub.loadError': 'Could not load subscription',
  'sub.loadErrorFallback': 'Could not load subscription data.',

  // Dashboard topbar
  'top.subscription': 'Subscription',
  'top.logout': 'Logout',

  // Dashboard tasks
  'tasks.title': 'Tasks',
  'tasks.counts.running': '{n} running · ',
  'tasks.counts.total': '{n} total',
  'tasks.new': 'New task',
  'tasks.empty.title': 'No tasks yet',
  'tasks.empty.subtitle': 'Add a task to start searching on Coupang',
  'tasks.empty.cta': 'Add task',
  'tasks.addMore': 'Add task',
  'tasks.found': 'Found',
  'tasks.edit': 'Edit task',
  'tasks.delete': 'Delete task',
  'tasks.confirmDelete': 'Confirm delete',

  // Dashboard right panel
  'panel.log': 'Live Log',
  'panel.results': 'Results',
  'panel.sendTg': 'TG',
  'panel.clear': 'Clear',
  'panel.exportCsv': 'Export CSV',
  'panel.noLogs': 'No log lines.',
  'panel.noLogsAt': 'No log lines at {filter}.',
  'panel.noResults': 'No results yet. Start the bot to see matches here.',
  'panel.runId': 'Run #{id}',
  'panel.previousRuns': 'Previous runs',
  'panel.resultsCount': '{n} results',
  'panel.resultsCount.one': '1 result',
  'panel.col.num': '#',
  'panel.col.date': 'Date',
  'panel.col.keyword': 'Keyword',
  'panel.col.product': 'Product',
  'panel.col.location': 'Location',

  // Dashboard footer
  'footer.start': 'Start bot',
  'footer.pause': 'Pause',
  'footer.stop': 'Stop',
  'footer.viewScreenshot': 'View screenshot',
  'footer.tasksLabel': '{n} tasks',
  'footer.state.idle': 'idle',
  'footer.state.running': 'running',
  'footer.state.paused': 'paused',

  // Task modal
  'modal.new.title': 'New task',
  'modal.edit.title': 'Edit task',
  'modal.new.subtitle': 'The bot will poll Coupang for this product and order when it falls in band.',
  'modal.edit.subtitle': 'Update the keyword and target product name.',
  'modal.keywordLabel': 'Search keyword',
  'modal.keywordHint': 'Korean text supported',
  'modal.keywordPlaceholder': 'e.g. 무선 이어폰',
  'modal.productLabel': 'Target product name',
  'modal.productHint': 'Substring match against listing titles',
  'modal.productPlaceholder': 'e.g. Galaxy Buds3 Pro 화이트',
  'modal.create': 'Create task',
  'modal.save': 'Save changes',

  // Auto-updater (from main.ts)
  'update.unavailable': 'Auto-updater unavailable.',
  'update.devOnly': 'Auto-update is only available in the packaged build.',
  'update.checking': 'Checking for updates…',
  'update.found': 'Update found. Downloading in background…',
  'update.uptodate': 'You are on the latest version.',
  'update.downloading': 'Downloading update: {percent}%',
  'update.ready': 'Update ready. Restarting…',
  'update.errorRetry': 'Update error. Retrying in {sec}s.',
  'update.retrying': 'Retrying update check…',
  'update.errorPrefix': 'Update error: {message}',
}

const ru: Dict = {
  // Common
  'common.cancel': 'Отмена',
  'common.confirm': 'Подтвердить',
  'common.retry': 'Повторить',
  'common.loading': 'Загрузка…',
  'common.back': 'Назад к панели',
  'common.esc': 'Esc',
  'common.toCancel': 'для отмены',
  'common.tryAgain': 'Попробовать снова',
  'common.continue': 'Продолжить',

  // Auth page
  'auth.signInTitle': 'Войдите, чтобы продолжить',
  'auth.signInSubtitle': 'Coupang Bot использует Telegram для безопасного входа без пароля.',
  'auth.continueWithTelegram': 'Продолжить через Telegram',
  'auth.waiting': 'Ожидание…',
  'auth.terms': 'Входя, вы соглашаетесь с условиями использования.',
  'auth.status.idle.label': 'Готово',
  'auth.status.idle.hint': 'Нажмите ниже, чтобы открыть Telegram и авторизовать устройство.',
  'auth.status.waiting.label': 'Ожидание подтверждения',
  'auth.status.waiting.hint': 'Откройте Telegram и нажмите «Подтвердить вход» в чате.',
  'auth.status.confirmed.label': 'Подтверждено',
  'auth.status.confirmed.hint': 'Переход к панели…',
  'auth.status.error.label': 'Ошибка авторизации',
  'auth.status.error.hint': 'Ответ не получен. Проверьте Telegram и попробуйте снова.',

  // Subscription page
  'sub.section': 'Аккаунт',
  'sub.title': 'Подписка',
  'sub.subtitle': 'Управляйте планом и продлением через Telegram.',
  'sub.plan': 'Тариф {plan}',
  'sub.billed': '{price} · ежемесячно',
  'sub.status': 'Статус',
  'sub.active': 'Активна',
  'sub.expired': 'Истекла',
  'sub.renewsOn': 'Продление',
  'sub.expiredOn': 'Истекла',
  'sub.daysRemaining': 'Дней осталось',
  'sub.daysSinceExpiry': 'Дней после окончания',
  'sub.days': '{n} дн.',
  'sub.concurrent': 'Параллельных задач',
  'sub.renewalCopy': 'Продление обрабатывает наш Telegram-бот биллинга. Подтверждение появится здесь по завершении.',
  'sub.extend': 'Продлить через Telegram',
  'sub.help': 'Нужна помощь? Напишите @coupangbot_support',
  'sub.loading': 'Загрузка подписки…',
  'sub.loadError': 'Не удалось загрузить подписку',
  'sub.loadErrorFallback': 'Не удалось получить данные подписки.',

  // Dashboard topbar
  'top.subscription': 'Подписка',
  'top.logout': 'Выйти',

  // Dashboard tasks
  'tasks.title': 'Задачи',
  'tasks.counts.running': '{n} активны · ',
  'tasks.counts.total': 'всего {n}',
  'tasks.new': 'Новая задача',
  'tasks.empty.title': 'Задач пока нет',
  'tasks.empty.subtitle': 'Добавьте задачу, чтобы начать поиск на Coupang',
  'tasks.empty.cta': 'Добавить задачу',
  'tasks.addMore': 'Добавить задачу',
  'tasks.found': 'Найдено',
  'tasks.edit': 'Изменить задачу',
  'tasks.delete': 'Удалить задачу',
  'tasks.confirmDelete': 'Подтвердить удаление',

  // Dashboard right panel
  'panel.log': 'Лог',
  'panel.results': 'Результаты',
  'panel.sendTg': 'TG',
  'panel.clear': 'Очистить',
  'panel.exportCsv': 'Экспорт CSV',
  'panel.noLogs': 'Записей в логе нет.',
  'panel.noLogsAt': 'Нет записей уровня {filter}.',
  'panel.noResults': 'Результатов пока нет. Запустите бота, чтобы увидеть совпадения.',
  'panel.runId': 'Запуск №{id}',
  'panel.previousRuns': 'Предыдущие запуски',
  'panel.resultsCount': '{n} результатов',
  'panel.resultsCount.one': '1 результат',
  'panel.col.num': '#',
  'panel.col.date': 'Дата',
  'panel.col.keyword': 'Запрос',
  'panel.col.product': 'Товар',
  'panel.col.location': 'Расположение',

  // Dashboard footer
  'footer.start': 'Запустить',
  'footer.pause': 'Пауза',
  'footer.stop': 'Остановить',
  'footer.viewScreenshot': 'Открыть скриншот',
  'footer.tasksLabel': 'задач: {n}',
  'footer.state.idle': 'ожидание',
  'footer.state.running': 'работа',
  'footer.state.paused': 'пауза',

  // Task modal
  'modal.new.title': 'Новая задача',
  'modal.edit.title': 'Изменить задачу',
  'modal.new.subtitle': 'Бот будет опрашивать Coupang и оформит заказ, когда цена попадёт в диапазон.',
  'modal.edit.subtitle': 'Обновите запрос и название товара.',
  'modal.keywordLabel': 'Поисковый запрос',
  'modal.keywordHint': 'Поддерживается корейский текст',
  'modal.keywordPlaceholder': 'например 무선 이어폰',
  'modal.productLabel': 'Название товара',
  'modal.productHint': 'Подстрока, ищется в названиях товаров',
  'modal.productPlaceholder': 'например Galaxy Buds3 Pro 화이트',
  'modal.create': 'Создать задачу',
  'modal.save': 'Сохранить изменения',

  // Auto-updater
  'update.unavailable': 'Модуль автообновления недоступен.',
  'update.devOnly': 'Автообновление доступно только в собранной версии.',
  'update.checking': 'Проверяю обновления…',
  'update.found': 'Найдено обновление. Загрузка в фоне…',
  'update.uptodate': 'Установлена последняя версия.',
  'update.downloading': 'Скачивание обновления: {percent}%',
  'update.ready': 'Обновление готово. Перезапуск…',
  'update.errorRetry': 'Ошибка обновления. Повтор через {sec} сек.',
  'update.retrying': 'Повторяю проверку обновлений…',
  'update.errorPrefix': 'Ошибка обновления: {message}',
}

export const translations: Record<Language, Dict> = { en, ru }

export function translate(
  lang: Language,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = translations[lang]?.[key] ?? translations.en[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`,
  )
}
