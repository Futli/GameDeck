import { useState } from 'react';

/** Аватар из Telegram; нет фото или оно не загрузилось — первая буква имени. */
export function Avatar({ url, name }: { url?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return <img className="avatar" src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span className="avatar avatar--letter" aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
