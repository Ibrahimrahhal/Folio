import { useEffect, useState } from 'react';
import Library from './components/Library.jsx';
import Reader from './components/Reader.jsx';
import ShortcutsSheet from './components/ShortcutsSheet.jsx';
import Spike from './components/Spike.jsx';
import { isMac } from './windowState.js';

export default function App() {
  const [route, setRoute] = useState({ name: 'library' });
  const [shortcuts, setShortcuts] = useState(false);

  useEffect(() => {
    if (!window.folio) return undefined;
    function onKey(event) {
      const key = event.key;
      const macFullScreen = isMac() && event.metaKey && event.ctrlKey && key.toLowerCase() === 'f';
      if (key === 'F11' || macFullScreen) {
        event.preventDefault();
        window.folio.frame?.toggleFullScreen();
        return;
      }
      const target = event.target;
      const typing = target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]');
      if (key === '?' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setShortcuts(true);
      }
    }
    const onAsk = () => setShortcuts(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('folio:shortcuts', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('folio:shortcuts', onAsk);
    };
  }, []);

  if (!window.folio) {
    return (
      <main className="boot">
        <Spike size={28} />
        <h1>Folio</h1>
        <p>Open the Folio desktop window. The shelf lives in the app, not in a browser tab.</p>
      </main>
    );
  }

  const sheet = shortcuts && (
    <ShortcutsSheet
      context={route.name}
      format={route.book?.format}
      onClose={() => setShortcuts(false)}
    />
  );

  if (route.name === 'reader') {
    return (
      <>
        <Reader
          key={route.book.id}
          book={route.book}
          onBack={() => setRoute({ name: 'library' })}
        />
        {sheet}
      </>
    );
  }

  return (
    <>
      <Library
        onOpen={async (book) => {
          const fresh = await window.folio.getBook(book.id);
          setRoute({ name: 'reader', book: fresh || book });
        }}
      />
      {sheet}
    </>
  );
}
