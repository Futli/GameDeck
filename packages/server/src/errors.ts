/** Ошибка, которую можно показать игроку: код для клиента + текст для человека. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
