/** Ошибка, которую можно показать игроку: код для клиента + текст для человека. */
export class RoomError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}
